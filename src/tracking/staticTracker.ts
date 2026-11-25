import type { Vec3 } from '../math/vec';
import { SampleEmitter, type EyeSampleListener, type Tracker } from './types';

/** Emits a fixed eye position at a steady rate. For screenshots and automated checks. */
export class StaticTracker implements Tracker {
  readonly name = 'static';
  private readonly emitter = new SampleEmitter();
  private timer: number | undefined;

  constructor(
    private readonly eyeMm: Vec3,
    private readonly rateHz = 30,
  ) {}

  start(): Promise<void> {
    this.timer = window.setInterval(() => {
      const now = performance.now();
      this.emitter.emit({ eyeMm: this.eyeMm, tCaptureMs: now, tReadyMs: now, confidence: 1 });
    }, 1000 / this.rateHz);
    return Promise.resolve();
  }

  stop(): void {
    if (this.timer !== undefined) window.clearInterval(this.timer);
  }

  onSample(listener: EyeSampleListener): () => void {
    return this.emitter.add(listener);
  }
}
