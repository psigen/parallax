import { describe, expect, it } from 'vitest';
import { BlinkDetector, EYE_LANDMARKS, SeparationGuard, eyeAspectRatios } from '../src/math/blink';
import { LANDMARK_COUNT } from '../src/tracking/protocol';

/** Landmarks with both eyes drawn as simple geometry: width w, lid gap g (normalized units). */
function eyes(gapLeft: number, gapRight: number, scale = 1): Float32Array {
  const lm = new Float32Array(LANDMARK_COUNT * 3);
  const set = (i: number, x: number, y: number) => {
    lm[i * 3] = x * scale;
    lm[i * 3 + 1] = y * scale;
  };
  for (const [eye, cx, gap] of [
    [EYE_LANDMARKS.right, 0.4, gapRight],
    [EYE_LANDMARKS.left, 0.6, gapLeft],
  ] as const) {
    set(eye.outer, cx - 0.05, 0.5);
    set(eye.inner, cx + 0.05, 0.5);
    for (const [u, l] of eye.lids) {
      set(u, cx, 0.5 - gap / 2);
      set(l, cx, 0.5 + gap / 2);
    }
  }
  return lm;
}

const params = {
  enterRatio: 0.6,
  exitRatio: 0.75,
  baselineTauS: 2,
  warmupFrames: 5,
  holdFramesAfter: 1,
};

describe('eyeAspectRatios', () => {
  it('is lid gap over eye width and independent of scale', () => {
    const open = eyeAspectRatios(eyes(0.03, 0.03), 1);
    expect(open.left).toBeCloseTo(0.3, 6);
    expect(open.right).toBeCloseTo(0.3, 6);
    const far = eyeAspectRatios(eyes(0.03, 0.03, 0.5), 1);
    expect(far.left).toBeCloseTo(0.3, 6);
    expect(eyeAspectRatios(eyes(0.03, 0.005), 1).right).toBeCloseTo(0.05, 6);
  });

  it('accounts for the frame aspect', () => {
    // Width is horizontal, gap vertical: a 16:9 frame scales x by 16/9 in pixel units.
    const r = eyeAspectRatios(eyes(0.03, 0.03), 16 / 9);
    expect(r.left).toBeCloseTo(0.3 / (16 / 9), 6);
  });
});

describe('BlinkDetector', () => {
  const run = (d: BlinkDetector, seq: [number, number][], startMs = 0) =>
    seq.map(([l, r], i) => d.update({ left: l, right: r }, startMs + i * 33));

  it('treats warmup frames as open and settles a baseline', () => {
    const d = new BlinkDetector(params);
    const states = run(
      d,
      Array.from({ length: 5 }, () => [0.3, 0.3] as [number, number]),
    );
    expect(states.every((s) => !s.blinking)).toBe(true);
    expect(states.slice(0, 4).every((s) => s.warmingUp)).toBe(true);
    const next = d.update({ left: 0.3, right: 0.3 }, 200);
    expect(next.warmingUp).toBe(false);
    expect(next.baseline.left).toBeCloseTo(0.3, 6);
  });

  it('detects a blink with hysteresis and holds one frame after reopening', () => {
    const d = new BlinkDetector(params);
    run(
      d,
      Array.from({ length: 6 }, () => [0.3, 0.3] as [number, number]),
    );
    const seq: [number, number][] = [
      [0.2, 0.2], // 0.67 of baseline: above enter (0.6) -> still open
      [0.15, 0.15], // 0.5 -> closed
      [0.2, 0.2], // 0.67: below exit (0.75) -> still closed (hysteresis)
      [0.28, 0.28], // open again -> hold one more frame
      [0.3, 0.3], // released
    ];
    const states = run(d, seq, 1000);
    expect(states.map((s) => s.blinking)).toEqual([false, true, true, true, false]);
  });

  it('counts a one-eyed wink as a blink', () => {
    const d = new BlinkDetector(params);
    run(
      d,
      Array.from({ length: 6 }, () => [0.3, 0.3] as [number, number]),
    );
    const s = d.update({ left: 0.3, right: 0.1 }, 1000);
    expect(s.blinking).toBe(true);
    expect(s.rightClosed).toBe(true);
    expect(s.leftClosed).toBe(false);
  });

  it('does not let closed frames pull the baseline down', () => {
    const d = new BlinkDetector(params);
    run(
      d,
      Array.from({ length: 6 }, () => [0.3, 0.3] as [number, number]),
    );
    for (let i = 0; i < 30; i++) d.update({ left: 0.05, right: 0.05 }, 1000 + i * 33);
    expect(d.update({ left: 0.05, right: 0.05 }, 3000).baseline.left).toBeCloseTo(0.3, 6);
  });
});

describe('SeparationGuard', () => {
  const p = { maxJumpRatio: 0.12, windowMs: 150, maxRejectFrames: 3 };

  it('accepts the first sample, small changes, and stale references', () => {
    const g = new SeparationGuard(p);
    expect(g.check(60, undefined, 0).reason).toBe('first');
    expect(g.check(63, undefined, 33).reason).toBe('within');
    expect(g.check(40, undefined, 1000).reason).toBe('stale');
  });

  it('rejects an implausible jump and overrides after repeated rejections', () => {
    const g = new SeparationGuard(p);
    g.check(60, undefined, 0);
    expect(g.check(48, undefined, 33).accept).toBe(false);
    expect(g.check(48, undefined, 66).accept).toBe(false);
    expect(g.check(48, undefined, 99)).toEqual({ accept: true, reason: 'override' });
    expect(g.check(49, undefined, 132).reason).toBe('within');
  });

  it('accepts a jump corroborated by the face matrix depth', () => {
    const g = new SeparationGuard(p);
    g.check(60, -60, 0);
    // The face came 25 % closer according to the matrix: separation should grow ~1.33x.
    expect(g.check(80, -45, 33).reason).toBe('corroborated');
    // A separation jump the matrix does not explain is still rejected.
    expect(g.check(60, -45, 66).accept).toBe(false);
  });
});
