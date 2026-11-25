/**
 * Runs MediaPipe FaceLandmarker off the main thread. Receives ImageBitmaps (transferred), replies
 * with landmarks and head angles. Lives in a module worker; see docs/tracking-pipeline.md.
 */
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';
import {
  headAnglesFromMatrix,
  LANDMARK_COUNT,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol';

let landmarker: FaceLandmarker | undefined;
let lastTimestampMs = -1;

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
  } else {
    try {
      detect(msg);
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }
};
