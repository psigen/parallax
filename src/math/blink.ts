/**
 * Blink detection from eyelid geometry and a plausibility guard on the iris separation.
 * Both are pure so the behaviour is unit-tested; the tracker decides what to do with a hold.
 */
import { landmarkAt } from '../tracking/protocol';

/** MediaPipe face-mesh indices (subject's anatomical sides). */
export const EYE_LANDMARKS = {
  right: {
    outer: 33,
    inner: 133,
    lids: [
      [159, 145],
      [158, 153],
    ] as const,
  },
  left: {
    outer: 263,
    inner: 362,
    lids: [
      [386, 374],
      [385, 380],
    ] as const,
  },
} as const;

export interface EyeAspectRatios {
  left: number;
  right: number;
}

/**
 * Eye aspect ratio per eye: mean lid gap over eye width, in pixel units (normalized x scaled by
 * the frame aspect so the ratio does not depend on the frame shape or the head distance).
 */
export function eyeAspectRatios(landmarks: Float32Array, frameAspect: number): EyeAspectRatios {
  const dist = (a: number, b: number): number => {
    const p = landmarkAt(landmarks, a);
    const q = landmarkAt(landmarks, b);
    return Math.hypot((p.x - q.x) * frameAspect, p.y - q.y);
  };
  const ear = (eye: (typeof EYE_LANDMARKS)[keyof typeof EYE_LANDMARKS]): number => {
    const width = dist(eye.outer, eye.inner);
    if (!(width > 0)) return 0;
    const gap = eye.lids.reduce((s, [u, l]) => s + dist(u, l), 0) / eye.lids.length;
    return gap / width;
  };
  return { left: ear(EYE_LANDMARKS.left), right: ear(EYE_LANDMARKS.right) };
}

export interface BlinkParams {
  /** Closed when the ratio drops below enter_ratio x baseline. */
  enterRatio: number;
  /** Open again when it rises above exit_ratio x baseline (hysteresis). */
  exitRatio: number;
  /** Time constant (s) of the open-eye baseline average. */
  baselineTauS: number;
  /** Open frames needed before the baseline is trusted. */
  warmupFrames: number;
  /** Frames to keep holding after both eyes reopen (the first reopened frame is unreliable). */
  holdFramesAfter: number;
}

export interface BlinkState {
  blinking: boolean;
  leftClosed: boolean;
  rightClosed: boolean;
  baseline: EyeAspectRatios;
  /** True until warmup has completed; detection is inactive meanwhile. */
  warmingUp: boolean;
}

class EyeTracker {
  baseline = 0;
  closed = false;
  private openFrames = 0;
  private lastMs: number | undefined;

  constructor(private readonly p: BlinkParams) {}

  get warmingUp(): boolean {
    return this.openFrames < this.p.warmupFrames;
  }

  update(ear: number, nowMs: number): boolean {
    if (this.warmingUp) {
      // Simple running mean of the first open frames; everything is treated as open.
      this.baseline = (this.baseline * this.openFrames + ear) / (this.openFrames + 1);
      this.openFrames++;
      this.lastMs = nowMs;
      this.closed = false;
      return false;
    }
    const threshold = (this.closed ? this.p.exitRatio : this.p.enterRatio) * this.baseline;
    this.closed = ear < threshold;
    if (!this.closed) {
      const dt = this.lastMs === undefined ? 0 : Math.max(0, (nowMs - this.lastMs) / 1000);
      const alpha = 1 - Math.exp(-dt / Math.max(1e-3, this.p.baselineTauS));
      this.baseline += (ear - this.baseline) * alpha;
    }
    this.lastMs = nowMs;
    return this.closed;
  }
}

/** Per-eye hysteresis on the eye aspect ratio with a self-calibrating open baseline. */
export class BlinkDetector {
  private readonly left: EyeTracker;
  private readonly right: EyeTracker;
  private holdAfter = 0;

  constructor(private readonly p: BlinkParams) {
    this.left = new EyeTracker(p);
    this.right = new EyeTracker(p);
  }

  update(ears: EyeAspectRatios, nowMs: number): BlinkState {
    const leftClosed = this.left.update(ears.left, nowMs);
    const rightClosed = this.right.update(ears.right, nowMs);
    const warmingUp = this.left.warmingUp || this.right.warmingUp;
    const closed = leftClosed || rightClosed;
    if (closed) this.holdAfter = this.p.holdFramesAfter + 1;
    const blinking = !warmingUp && this.holdAfter > 0;
    if (!closed && this.holdAfter > 0) this.holdAfter--;
    return {
      blinking,
      leftClosed,
      rightClosed,
      baseline: { left: this.left.baseline, right: this.right.baseline },
      warmingUp,
    };
  }
}

export interface GuardParams {
  /** Largest plausible relative change of the iris separation between accepted samples. */
  maxJumpRatio: number;
  /** Gaps longer than this accept anything (no recent reference). */
  windowMs: number;
  /** Consecutive rejections after which the new value is accepted (the world really changed). */
  maxRejectFrames: number;
}

export type GuardReason = 'first' | 'stale' | 'within' | 'corroborated' | 'jump' | 'override';
export interface GuardVerdict {
  accept: boolean;
  reason: GuardReason;
}

/**
 * Rejects iris-separation samples that jump implausibly fast, unless the face transformation
 * matrix's depth changed by a consistent ratio (separation is proportional to 1/Z).
 */
export class SeparationGuard {
  private last: { sep: number; faceZ: number | undefined; t: number } | undefined;
  private rejects = 0;

  constructor(private readonly p: GuardParams) {}

  check(separationPx: number, faceZ: number | undefined, nowMs: number): GuardVerdict {
    const accept = (reason: GuardReason): GuardVerdict => {
      this.last = { sep: separationPx, faceZ, t: nowMs };
      this.rejects = 0;
      return { accept: true, reason };
    };
    if (!this.last) return accept('first');
    if (nowMs - this.last.t > this.p.windowMs) return accept('stale');
    const ratio = separationPx / this.last.sep;
    if (Math.abs(ratio - 1) <= this.p.maxJumpRatio) return accept('within');
    if (faceZ !== undefined && this.last.faceZ !== undefined && faceZ !== 0) {
      const expected = this.last.faceZ / faceZ;
      if (Math.abs(ratio / expected - 1) <= this.p.maxJumpRatio) return accept('corroborated');
    }
    if (++this.rejects >= this.p.maxRejectFrames) return accept('override');
    return { accept: false, reason: 'jump' };
  }
}
