import type { Vec3 } from '../math/vec';

/** One estimate of the viewer's eye position, with timing for the latency HUD. */
export interface EyeSample {
  /** Cyclopean eye in the screen frame, millimetres. */
  eyeMm: Vec3;
  /** When the camera frame was captured, performance.now() clock, ms. */
  tCaptureMs: number;
  /** When the sample became available on the main thread, ms. */
  tReadyMs: number;
  /** Optional per-stage timings, ms. */
  timings?: {
    /** Capture to the frame being handed to the tracker. */
    captureToTrackerMs: number;
    /** Tracker inference time. */
    inferenceMs: number;
  };
  /** 0..1, for debugging; 1 for synthetic trackers. */
  confidence: number;
}

export type EyeSampleListener = (sample: EyeSample) => void;

/** Anything that produces timestamped eye positions. */
export interface Tracker {
  readonly name: string;
  start(): Promise<void>;
  stop(): void;
  onSample(listener: EyeSampleListener): () => void;
}

export class SampleEmitter {
  private readonly listeners = new Set<EyeSampleListener>();

  add(listener: EyeSampleListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(sample: EyeSample): void {
    for (const l of this.listeners) l(sample);
  }
}
