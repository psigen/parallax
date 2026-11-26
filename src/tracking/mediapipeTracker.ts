import type { CameraConfig } from '../config/schema';
import {
  calibrateFocalLength,
  estimateEye,
  type CameraModel,
  type EyeSelect,
  type IrisObservation,
} from '../math/eyeEstimator';
import { nextZoomStep, ZOOM_FALLBACK_FRAMES } from '../device/heuristics';
import { BlinkDetector, SeparationGuard, type BlinkState } from '../math/blink';
import type { Vec3 } from '../math/vec';
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
  /** Eye aspect ratios and blink state for this frame, when available. */
  ears?: { left: number; right: number };
  hold?: 'blink' | 'guard';
}

export type TrackerDebugListener = (frame: TrackerDebugFrame) => void;
export type LightingListener = (result: LightingAnalysisResult) => void;

/** What the camera-lighting orchestrator needs from a frame source. */
export interface LightingAnalysisSource {
  setLightingAnalysis(params: LightingAnalysisParams | null): void;
  onLighting(listener: LightingListener): void;
}

export interface BlinkOptions {
  enabled: boolean;
  enter_ratio: number;
  exit_ratio: number;
  baseline_tau_s: number;
  warmup_frames: number;
  hold_frames_after: number;
}
export interface GuardOptions {
  enabled: boolean;
  max_jump_ratio: number;
  window_ms: number;
  max_reject_frames: number;
}

export interface HoldStats {
  /** Current hold reason, if any. */
  holding: 'blink' | 'guard' | undefined;
  /** Duration of the current hold, ms. */
  holdMs: number;
  /** Holds that engaged in the last minute (rolling). */
  holdsPerMinute: number;
  blink: BlinkState | undefined;
}

export interface MediapipeTrackerOptions {
  camera: CameraConfig;
  /** Read live (the tuning panel mutates the config object). */
  blink?: () => BlinkOptions;
  guard?: () => GuardOptions;
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
  /** Intrinsics at zoom 1 (the index/config values); the model's are scaled by the zoom in effect. */
  private readonly baseFx: number;
  private readonly baseFy: number;
  private zoom = 1;
  private framesWithoutFace = 0;
  private blinkDetector: BlinkDetector | undefined;
  private guard: SeparationGuard | undefined;
  private lastGoodEyeMm: Vec3 | undefined;
  private holdStartMs: number | undefined;
  private holding: 'blink' | 'guard' | undefined;
  private holdTimes: number[] = [];
  private lastBlink: BlinkState | undefined;

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
    this.baseFx = intrinsics.fx_px;
    this.baseFy = intrinsics.fy_px;
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
    this.applyZoom(settings.zoom);
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

  get holdStats(): HoldStats {
    const now = performance.now();
    this.holdTimes = this.holdTimes.filter((t) => now - t < 60_000);
    return {
      holding: this.holding,
      holdMs: this.holding && this.holdStartMs !== undefined ? now - this.holdStartMs : 0,
      holdsPerMinute: this.holdTimes.length,
      blink: this.lastBlink,
    };
  }

  /**
   * Decide whether this frame's irises can be trusted. Returns the hold reason when the last
   * good position should be repeated instead.
   */
  private holdReason(
    ears: { left: number; right: number } | undefined,
    separationPx: number,
    faceZ: number | undefined,
    captureMs: number,
  ): 'blink' | 'guard' | undefined {
    const b = this.opts.blink?.();
    const g = this.opts.guard?.();
    let reason: 'blink' | 'guard' | undefined;
    if (b?.enabled && ears) {
      this.blinkDetector ??= new BlinkDetector({
        enterRatio: b.enter_ratio,
        exitRatio: b.exit_ratio,
        baselineTauS: b.baseline_tau_s,
        warmupFrames: b.warmup_frames,
        holdFramesAfter: b.hold_frames_after,
      });
      this.lastBlink = this.blinkDetector.update(ears, captureMs);
      if (this.lastBlink.blinking) reason = 'blink';
    } else {
      this.blinkDetector = undefined;
      this.lastBlink = undefined;
    }
    if (g?.enabled) {
      this.guard ??= new SeparationGuard({
        maxJumpRatio: g.max_jump_ratio,
        windowMs: g.window_ms,
        maxRejectFrames: g.max_reject_frames,
      });
      // A blink frame must not become the guard's reference either.
      if (reason === undefined && !this.guard.check(separationPx, faceZ, captureMs).accept) {
        reason = 'guard';
      }
    } else {
      this.guard = undefined;
    }
    if (reason && !this.holding) {
      this.holdStartMs = captureMs;
      this.holdTimes.push(performance.now());
    }
    this.holding = reason;
    return reason;
  }

  /** Rebuild detector and guard after their settings change in the tuning panel. */
  resetHoldState(): void {
    this.blinkDetector = undefined;
    this.guard = undefined;
    this.holding = undefined;
  }

  /** Digital zoom crops the sensor, so the focal length in pixels scales with it. */
  private applyZoom(zoom: number): void {
    this.zoom = zoom;
    this.model.intrinsics.fx_px = this.baseFx * zoom;
    this.model.intrinsics.fy_px = this.baseFy * zoom;
  }

  /**
   * Widest zoom gives the most room to move but can distort the face beyond what the detector
   * handles; after a run of frames without a face, step the zoom toward 1x.
   */
  private async zoomFallback(): Promise<void> {
    const next = nextZoomStep(this.zoom);
    if (next === undefined || !this.settings?.zoomRange) return;
    const applied = await this.source.setZoom(next);
    this.applyZoom(applied);
    this.framesWithoutFace = 0;
    this.opts.onLog?.(
      `[tracker] no face at zoom ${this.zoom.toFixed(2)}; trying ${applied.toFixed(2)}`,
    );
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
      if (++this.framesWithoutFace >= ZOOM_FALLBACK_FRAMES && this.settings?.zoomRange) {
        this.framesWithoutFace = 0;
        void this.zoomFallback();
      }
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
    this.framesWithoutFace = 0;
    const { left, right } = irisCentres(msg.landmarks);
    const obs: IrisObservation = { left, right, yawRad: msg.yawRad };
    this.lastObservation = obs;
    const est = estimateEye(obs, this.model, this.opts.ipdMm, this.yawCorrection, this.eyeSelect);
    const faceT = faceTranslationCm(msg.matrix);
    const hold = this.holdReason(msg.ears, est.irisSeparationPx, faceT?.z, captureMs);
    const useHeld = hold !== undefined && this.lastGoodEyeMm !== undefined;
    const eyeMm = useHeld && this.lastGoodEyeMm ? this.lastGoodEyeMm : est.eyeMm;
    if (!hold) this.lastGoodEyeMm = est.eyeMm;
    this.emitter.emit({
      eyeMm,
      tCaptureMs: captureMs,
      tReadyMs: now,
      timings: {
        captureToTrackerMs: (flight?.sentMs ?? now) - captureMs,
        inferenceMs: msg.inferenceMs,
      },
      confidence: useHeld ? 0.5 : 1,
      ...(useHeld && hold ? { held: hold } : {}),
    });
    this.lastDebug = {
      video: this.source.video,
      found: true,
      landmarks: msg.landmarks,
      yawRad: msg.yawRad,
      pitchRad: msg.pitchRad,
      irisSeparationPx: est.irisSeparationPx,
      depthMm: est.depthMm,
      faceTranslationCm: faceT,
      matrix: msg.matrix,
      inferenceMs: msg.inferenceMs,
      ...(msg.ears ? { ears: msg.ears } : {}),
      ...(hold ? { hold } : {}),
    };
    this.debugListener?.(this.lastDebug);
  }
}
