import type { TrackingConfig } from '../config/schema';
import { OneEuroVec3 } from '../math/oneEuro';
import { predictPosition, type MotionState } from '../math/predictor';
import { add, scale, sub, v3, type Vec3 } from '../math/vec';
import type { EyeSample } from './types';

/**
 * Holds the filtered eye state and answers "where is the eye at time t?" for the render loop.
 * Filtering is done on the capture-time clock; prediction extrapolates to display time. After
 * `loss_timeout_ms` without samples the eye eases back toward the default position.
 */
export class EyeState {
  private readonly filter: OneEuroVec3;
  private state: MotionState | undefined;
  private lastSampleMs = -Infinity;
  private held: Vec3;

  constructor(
    private config: TrackingConfig,
    private defaultEyeMm: Vec3,
  ) {
    this.filter = new OneEuroVec3(toParams(config));
    this.held = defaultEyeMm;
  }

  setDefaultEye(eyeMm: Vec3): void {
    this.defaultEyeMm = eyeMm;
  }

  setConfig(config: TrackingConfig): void {
    this.config = config;
    this.filter.setParams(toParams(config));
  }

  get tracking(): boolean {
    return this.state !== undefined;
  }

  get raw(): MotionState | undefined {
    return this.state;
  }

  push(sample: EyeSample): void {
    const tS = sample.tCaptureMs / 1000;
    if (sample.tCaptureMs - this.lastSampleMs > this.config.loss_timeout_ms) {
      // Re-acquired after a gap (or first sample): start the filter fresh at the new position.
      this.filter.reset();
    }
    this.lastSampleMs = sample.tCaptureMs;
    const position = this.filter.filter(sample.eyeMm, tS);
    // A held sample repeats the last good position: do not let the predictor keep extrapolating.
    if (sample.held) this.filter.zeroVelocity();
    this.state = { position, velocity: this.filter.velocity, tS };
  }

  /**
   * Eye position (mm) to render for a frame that will be displayed at `tDisplayMs`
   * (performance.now() clock).
   */
  eyeAt(tDisplayMs: number): Vec3 {
    const lost = tDisplayMs - this.lastSampleMs > this.config.loss_timeout_ms;
    if (this.state && !lost) {
      const { prediction } = this.config;
      const target = prediction.enabled
        ? predictPosition(
            this.state,
            (tDisplayMs + prediction.extra_lead_ms) / 1000,
            prediction.max_lead_ms / 1000,
          )
        : this.state.position;
      this.held = target;
      return target;
    }
    if (this.state && lost) {
      this.state = undefined;
    }
    // Ease toward the default so a lost face does not snap the view.
    this.held = add(this.held, scale(sub(this.defaultEyeMm, this.held), 0.05));
    return v3(this.held.x, this.held.y, this.held.z);
  }
}

function toParams(c: TrackingConfig) {
  return {
    minCutoffHz: c.filter.min_cutoff_hz,
    beta: c.filter.beta,
    dCutoffHz: c.filter.d_cutoff_hz,
  };
}
