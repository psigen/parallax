import type { CameraConfig } from '../config/schema';
import {
  calibrateFocalLength,
  estimateEye,
  type CameraModel,
  type EyeSelect,
  type IrisObservation,
} from '../math/eyeEstimator';
import { CameraSource, type CameraSettings } from './cameraSource';
import {
  faceTranslationCm,
  irisCentres,
  type LightingAnalysisParams,
  type LightingAnalysisResult,
  type WorkerRequest,
  type WorkerResponse,
} from './protocol';
import { SampleEmitter, type EyeSampleListener, type Tracker } from './types';

export interface TrackerDebugFrame {
  video: HTMLVideoElement;
  found: boolean;
  landmarks: Float32Array;
  yawRad: number;
  pitchRad: number;
  irisSeparationPx: number;
  depthMm: number;
  /** MediaPipe's own translation estimate (cm, its virtual camera), for cross-checking. */
  faceTranslationCm: { x: number; y: number; z: number } | undefined;
  /** Raw MediaPipe matrix (16 numbers) or empty. */
  matrix: number[];
  inferenceMs: number;
}

export type TrackerDebugListener = (frame: TrackerDebugFrame) => void;
export type LightingListener = (result: LightingAnalysisResult) => void;

/** What the camera-lighting orchestrator needs from a frame source. */
export interface LightingAnalysisSource {
  setLightingAnalysis(params: LightingAnalysisParams | null): void;
  onLighting(listener: LightingListener): void;
}

export interface MediapipeTrackerOptions {
  camera: CameraConfig;
  /** Receives progress and warning messages from the worker. */
  onLog?: (message: string) => void;
  ipdMm: number;
  yawCorrection: boolean;
  eyeSelect?: EyeSelect;
  wasmPath: string;
  modelPath: string;
  /** Calibrated focal length override (px at the intrinsics' reference width), if any. */
  focalOverridePx?: number;
}

/**
 * Webcam → worker (MediaPipe FaceLandmarker) → iris landmarks → eye position. Frames arriving
 * while one is in flight are dropped, not queued: a stale frame is worth nothing for latency.
 */
export class MediapipeTracker implements Tracker, LightingAnalysisSource {
  readonly name: string;
  readonly model: CameraModel;
  private readonly emitter = new SampleEmitter();
  private readonly source = new CameraSource();
  private worker: Worker | undefined;
  private inFlight: { id: number; captureMs: number; sentMs: number } | undefined;
  private nextId = 1;
  private debugListener: TrackerDebugListener | undefined;
  private lightingListener: LightingListener | undefined;
  private lightingParams: LightingAnalysisParams | null = null;
  private lastObservation: IrisObservation | undefined;
  settings: CameraSettings | undefined;
  delegate: 'GPU' | 'CPU' | undefined;
  droppedFrames = 0;
  /** Live-tunable. */
  yawCorrection: boolean;
  eyeSelect: EyeSelect;
  lastDebug: TrackerDebugFrame | undefined;

  constructor(private readonly opts: MediapipeTrackerOptions) {
    this.name = `mediapipe:${opts.camera.id}`;
    this.yawCorrection = opts.yawCorrection;
    this.eyeSelect = opts.eyeSelect ?? 'cyclopean';
    const intrinsics = { ...opts.camera.intrinsics };
    if (opts.focalOverridePx !== undefined) {
      intrinsics.fx_px = opts.focalOverridePx;
      intrinsics.fy_px = opts.focalOverridePx;
    }
    this.model = { intrinsics, extrinsics: opts.camera.extrinsics, mirrored: opts.camera.mirrored };
  }

  get video(): HTMLVideoElement {
    return this.source.video;
  }

  async start(): Promise<void> {
    const worker = new Worker(new URL('./faceLandmarker.worker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker = worker;
    const ready = new Promise<void>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const msg = e.data;
        if (msg.type === 'ready') {
          this.delegate = msg.delegate;
          worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onWorkerMessage(ev.data);
          resolve();
        } else if (msg.type === 'error') {
          reject(new Error(`face landmarker worker: ${msg.message}`));
        } else if (msg.type === 'log') {
          this.opts.onLog?.(`[worker] ${msg.message}`);
        }
      };
      worker.onerror = (ev) => reject(new Error(`face landmarker worker failed: ${ev.message}`));
    });
    const init: WorkerRequest = {
      type: 'init',
      wasmPath: this.opts.wasmPath,
      modelPath: this.opts.modelPath,
      delegate: 'GPU',
    };
    worker.postMessage(init);

    this.opts.onLog?.('[tracker] opening camera');
    const [settings] = await Promise.all([this.source.start(this.opts.camera), ready]);
    if (this.lightingParams) this.postLighting();
    this.settings = settings;
    const refAspect = this.model.intrinsics.width_px / this.model.intrinsics.height_px;
    if (Math.abs(settings.width / settings.height - refAspect) > 0.02) {
      console.warn(
        `[tracker] stream is ${settings.width}x${settings.height} but intrinsics are for ${this.model.intrinsics.width_px}x${this.model.intrinsics.height_px}; the field of view may differ. Recalibrate.`,
      );
    }
    this.source.onFrame((frame) => {
      if (this.inFlight) {
        this.droppedFrames++;
        frame.bitmap.close();
        return;
      }
      const id = this.nextId++;
      this.inFlight = { id, captureMs: frame.captureMs, sentMs: performance.now() };
      const req: WorkerRequest = {
        type: 'frame',
        id,
        bitmap: frame.bitmap,
        timestampMs: frame.captureMs,
      };
      worker.postMessage(req, [frame.bitmap]);
    });
  }

  stop(): void {
    this.source.stop();
    this.worker?.terminate();
    this.worker = undefined;
    this.inFlight = undefined;
  }

  onSample(listener: EyeSampleListener): () => void {
    return this.emitter.add(listener);
  }

  onDebug(listener: TrackerDebugListener): void {
    this.debugListener = listener;
  }

  /** Ask the worker to detect bright sources on tracked frames (null stops it). */
  setLightingAnalysis(params: LightingAnalysisParams | null): void {
    this.lightingParams = params;
    if (this.delegate) this.postLighting();
  }

  onLighting(listener: LightingListener): void {
    this.lightingListener = listener;
  }

  private postLighting(): void {
    const req: WorkerRequest = { type: 'lighting', params: this.lightingParams };
    this.worker?.postMessage(req);
  }

  /**
   * Set the focal length so that the most recent observation corresponds to the given
   * eye-to-screen distance. Returns the new focal length (px) or undefined if no face is visible.
   */
  calibrate(knownDepthMm: number): number | undefined {
    if (!this.lastObservation) return undefined;
    const fx = calibrateFocalLength(
      this.lastObservation,
      this.model,
      this.opts.ipdMm,
      knownDepthMm,
    );
    this.model.intrinsics.fx_px = fx;
    this.model.intrinsics.fy_px = fx;
    return fx;
  }

  private onWorkerMessage(msg: WorkerResponse): void {
    if (msg.type === 'log') {
      this.opts.onLog?.(`[worker] ${msg.message}`);
      return;
    }
    if (msg.type === 'error') {
      console.error('[tracker]', msg.message);
      this.inFlight = undefined;
      return;
    }
    if (msg.type !== 'result') return;
    const flight = this.inFlight;
    this.inFlight = undefined;
    const now = performance.now();
    const captureMs = flight?.captureMs ?? msg.timestampMs;
    if (msg.lighting) this.lightingListener?.({ ...msg.lighting, tCaptureMs: captureMs });

    if (!msg.found) {
      this.lastObservation = undefined;
      this.lastDebug = {
        video: this.source.video,
        found: false,
        landmarks: msg.landmarks,
        yawRad: 0,
        pitchRad: 0,
        irisSeparationPx: 0,
        depthMm: 0,
        faceTranslationCm: undefined,
        matrix: [],
        inferenceMs: msg.inferenceMs,
      };
      this.debugListener?.(this.lastDebug);
      return;
    }
    const { left, right } = irisCentres(msg.landmarks);
    const obs: IrisObservation = { left, right, yawRad: msg.yawRad };
    this.lastObservation = obs;
    const est = estimateEye(obs, this.model, this.opts.ipdMm, this.yawCorrection, this.eyeSelect);
    this.emitter.emit({
      eyeMm: est.eyeMm,
      tCaptureMs: captureMs,
      tReadyMs: now,
      timings: {
        captureToTrackerMs: (flight?.sentMs ?? now) - captureMs,
        inferenceMs: msg.inferenceMs,
      },
      confidence: 1,
    });
    this.lastDebug = {
      video: this.source.video,
      found: true,
      landmarks: msg.landmarks,
      yawRad: msg.yawRad,
      pitchRad: msg.pitchRad,
      irisSeparationPx: est.irisSeparationPx,
      depthMm: est.depthMm,
      faceTranslationCm: faceTranslationCm(msg.matrix),
      matrix: msg.matrix,
      inferenceMs: msg.inferenceMs,
    };
    this.debugListener?.(this.lastDebug);
  }
}
