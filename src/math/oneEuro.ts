/**
 * One Euro filter (Casiez, Roussel, Vogel 2012): an adaptive first-order low-pass whose cutoff
 * rises with speed, giving low jitter at rest and low lag in motion. Also exposes the filtered
 * derivative, which the predictor uses for extrapolation.
 */
import { v3, type Vec3 } from './vec';

export interface OneEuroParams {
  /** Minimum cutoff frequency (Hz). Lower = smoother at rest, more lag. */
  minCutoffHz: number;
  /** Speed coefficient. Higher = cutoff rises faster with speed, less lag when moving. */
  beta: number;
  /** Cutoff for the derivative estimate (Hz). */
  dCutoffHz: number;
}

function smoothingFactor(dtS: number, cutoffHz: number): number {
  const r = 2 * Math.PI * cutoffHz * dtS;
  return r / (r + 1);
}

export class OneEuroFilter {
  private x: number | null = null;
  private rawPrev = 0;
  private dx = 0;
  private tS: number | null = null;

  constructor(public params: OneEuroParams) {}

  reset(): void {
    this.x = null;
    this.rawPrev = 0;
    this.dx = 0;
    this.tS = null;
  }

  /** Derivative of the filtered signal (units per second). */
  get velocity(): number {
    return this.dx;
  }

  get value(): number | null {
    return this.x;
  }

  /** Feed a sample at time tS (seconds, monotonic). Returns the filtered value. */
  filter(value: number, tS: number): number {
    if (this.x === null || this.tS === null) {
      this.x = value;
      this.rawPrev = value;
      this.dx = 0;
      this.tS = tS;
      return value;
    }
    const dt = tS - this.tS;
    if (!(dt > 0)) {
      return this.x;
    }
    this.tS = tS;
    const rawDx = (value - this.rawPrev) / dt;
    this.rawPrev = value;
    const aD = smoothingFactor(dt, this.params.dCutoffHz);
    this.dx = aD * rawDx + (1 - aD) * this.dx;
    const cutoff = this.params.minCutoffHz + this.params.beta * Math.abs(this.dx);
    const a = smoothingFactor(dt, cutoff);
    this.x = a * value + (1 - a) * this.x;
    return this.x;
  }
}

export class OneEuroVec3 {
  private readonly fx: OneEuroFilter;
  private readonly fy: OneEuroFilter;
  private readonly fz: OneEuroFilter;

  constructor(params: OneEuroParams) {
    this.fx = new OneEuroFilter(params);
    this.fy = new OneEuroFilter(params);
    this.fz = new OneEuroFilter(params);
  }

  setParams(params: OneEuroParams): void {
    this.fx.params = params;
    this.fy.params = params;
    this.fz.params = params;
  }

  reset(): void {
    this.fx.reset();
    this.fy.reset();
    this.fz.reset();
  }

  filter(p: Vec3, tS: number): Vec3 {
    return v3(this.fx.filter(p.x, tS), this.fy.filter(p.y, tS), this.fz.filter(p.z, tS));
  }

  get velocity(): Vec3 {
    return v3(this.fx.velocity, this.fy.velocity, this.fz.velocity);
  }
}
