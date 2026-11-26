/**
 * Runs MediaPipe FaceLandmarker off the main thread. Receives ImageBitmaps (transferred), replies
 * with landmarks and head angles. Lives in a module worker; see docs/tracking-pipeline.md.
 */
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import { dueForAnalysis } from '../lighting/analysisSchedule';
import { eyeAspectRatios } from '../math/blink';
import { luminanceFromRgba } from '../lighting/luminanceImage';
import { detectSources } from '../lighting/sourceDetector';
import {
  headAnglesFromMatrix,
  LANDMARK_COUNT,
  type LightingAnalysisParams,
  type LightingAnalysisResult,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol';

let landmarker: FaceLandmarker | undefined;
let lastTimestampMs = -1;

// Bright-source analysis for camera lighting, run here so the frame readback never stalls the
// main thread. The bitmap is already in this worker for the landmarker.
let lightingParams: LightingAnalysisParams | null = null;
let lastAnalysisMs = -Infinity;
let analysisCanvas: OffscreenCanvas | undefined;
let analysisCtx: OffscreenCanvasRenderingContext2D | null = null;
let analysisLogged = false;

function analyzeLighting(
  bitmap: ImageBitmap,
): Omit<LightingAnalysisResult, 'tCaptureMs'> | undefined {
  const p = lightingParams;
  const now = performance.now();
  if (!p || !dueForAnalysis(now, lastAnalysisMs, p.updateHz)) return undefined;
  lastAnalysisMs = now;
  const w = p.analysisWidthPx;
  const h = Math.max(1, Math.round((w * bitmap.height) / bitmap.width));
  if (analysisCanvas?.width !== w || analysisCanvas.height !== h) {
    analysisCanvas = new OffscreenCanvas(w, h);
    analysisCtx = analysisCanvas.getContext('2d', { willReadFrequently: true });
  }
  if (!analysisCtx) return undefined;
  analysisCtx.drawImage(bitmap, 0, 0, w, h);
  const rgba = analysisCtx.getImageData(0, 0, w, h).data;
  const sources = detectSources(luminanceFromRgba(rgba, w, h), {
    threshold: p.threshold,
    minAreaPx: p.minAreaPx,
    maxLights: p.maxLights,
    mergeRadiusPx: p.mergeRadiusPx,
  });
  const analysisMs = performance.now() - now;
  if (!analysisLogged) {
    analysisLogged = true;
    post({
      type: 'log',
      message: `lighting analysis ${w}x${h}: ${analysisMs.toFixed(1)} ms (first run)`,
    });
  }
  return { sources, width: w, height: h, analysisMs };
}

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  self.postMessage(msg, { transfer });
}

async function init(msg: Extract<WorkerRequest, { type: 'init' }>): Promise<void> {
  post({ type: 'log', message: 'loading wasm runtime' });
  const fileset = await FilesetResolver.forVisionTasks(msg.wasmPath, true);
  post({ type: 'log', message: 'creating face landmarker' });
  const create = (delegate: 'GPU' | 'CPU') =>
    FaceLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: msg.modelPath, delegate },
      runningMode: 'VIDEO',
      numFaces: 1,
      outputFacialTransformationMatrixes: true,
      outputFaceBlendshapes: false,
      canvas: new OffscreenCanvas(1, 1),
    });
  try {
    landmarker = await create(msg.delegate);
    post({ type: 'ready', delegate: msg.delegate });
  } catch (err) {
    if (msg.delegate === 'GPU') {
      post({
        type: 'log',
        message: `GPU delegate failed (${err instanceof Error ? err.message : String(err)}); using CPU`,
      });
      landmarker = await create('CPU');
      post({ type: 'ready', delegate: 'CPU' });
    } else {
      throw err;
    }
  }
}

function detect(msg: Extract<WorkerRequest, { type: 'frame' }>): void {
  if (!landmarker) {
    msg.bitmap.close();
    return;
  }
  // MediaPipe requires strictly increasing timestamps.
  const ts = msg.timestampMs > lastTimestampMs ? msg.timestampMs : lastTimestampMs + 1;
  lastTimestampMs = ts;
  const t0 = performance.now();
  const result = landmarker.detectForVideo(msg.bitmap, ts);
  const inferenceMs = performance.now() - t0;
  const frameAspect = msg.bitmap.width / Math.max(1, msg.bitmap.height);
  const lighting = analyzeLighting(msg.bitmap);
  msg.bitmap.close();

  const face = result.faceLandmarks[0];
  if (!face) {
    post({
      type: 'result',
      id: msg.id,
      timestampMs: msg.timestampMs,
      inferenceMs,
      found: false,
      landmarks: new Float32Array(0),
      yawRad: 0,
      pitchRad: 0,
      matrix: [],
      ...(lighting ? { lighting } : {}),
    });
    return;
  }
  const landmarks = new Float32Array(LANDMARK_COUNT * 3);
  for (let i = 0; i < Math.min(face.length, LANDMARK_COUNT); i++) {
    const l = face[i];
    if (!l) continue;
    landmarks[i * 3] = l.x;
    landmarks[i * 3 + 1] = l.y;
    landmarks[i * 3 + 2] = l.z;
  }
  const matrix = result.facialTransformationMatrixes[0];
  const angles = matrix ? headAnglesFromMatrix(matrix.data) : { yawRad: 0, pitchRad: 0 };
  const ears = eyeAspectRatios(landmarks, frameAspect);
  post(
    {
      type: 'result',
      id: msg.id,
      timestampMs: msg.timestampMs,
      inferenceMs,
      found: true,
      landmarks,
      ...angles,
      matrix: matrix ? Array.from(matrix.data) : [],
      ...(lighting ? { lighting } : {}),
      ears,
    },
    [landmarks.buffer],
  );
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    init(msg).catch((err: unknown) => {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    });
  } else if (msg.type === 'lighting') {
    lightingParams = msg.params;
    lastAnalysisMs = -Infinity;
  } else {
    try {
      detect(msg);
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }
};
