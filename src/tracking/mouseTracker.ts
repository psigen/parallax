import { v3 } from '../math/vec';
import { SampleEmitter, type EyeSampleListener, type Tracker } from './types';

/**
 * Drives the eye position with the mouse so the rendering path can be exercised without a
 * camera. Horizontal/vertical mouse position maps to ±rangeMm around the display centre;
 * the wheel changes distance. Emits at a fixed rate like a camera would.
 */
export class MouseTracker implements Tracker {
  readonly name = 'mouse';
  private readonly emitter = new SampleEmitter();
  private x = 0;
  private y = 0;
  private z: number;
  private timer: number | undefined;
  private readonly onMove = (e: MouseEvent): void => {
    this.x = (e.clientX / window.innerWidth - 0.5) * 2 * this.rangeMm;
    this.y = -(e.clientY / window.innerHeight - 0.5) * 2 * this.rangeMm;
  };
  private readonly onWheel = (e: WheelEvent): void => {
    this.z = Math.min(2000, Math.max(150, this.z + e.deltaY * 0.5));
  };

  constructor(
    private readonly rangeMm = 300,
    initialZMm = 550,
    private readonly rateHz = 30,
  ) {
    this.z = initialZMm;
  }

  start(): Promise<void> {
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    this.timer = window.setInterval(() => {
      const now = performance.now();
      this.emitter.emit({
        eyeMm: v3(this.x, this.y, this.z),
        tCaptureMs: now,
        tReadyMs: now,
        confidence: 1,
      });
    }, 1000 / this.rateHz);
    return Promise.resolve();
  }

  stop(): void {
    window.removeEventListener('mousemove', this.onMove);
    window.removeEventListener('wheel', this.onWheel);
    if (this.timer !== undefined) window.clearInterval(this.timer);
  }

  onSample(listener: EyeSampleListener): () => void {
    return this.emitter.add(listener);
  }
}
