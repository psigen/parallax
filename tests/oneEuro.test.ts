import { describe, expect, it } from 'vitest';
import { OneEuroFilter, OneEuroVec3 } from '../src/math/oneEuro';
import { predictPosition } from '../src/math/predictor';
import { v3 } from '../src/math/vec';

const params = { minCutoffHz: 1, beta: 0.05, dCutoffHz: 1 };

describe('OneEuroFilter', () => {
  it('passes the first sample through unchanged', () => {
    const f = new OneEuroFilter(params);
    expect(f.filter(42, 0)).toBe(42);
    expect(f.velocity).toBe(0);
  });

  it('converges to a step without overshoot', () => {
    const f = new OneEuroFilter(params);
    f.filter(0, 0);
    let last = 0;
    for (let i = 1; i <= 120; i++) {
      const y = f.filter(100, i / 30);
      expect(y).toBeGreaterThanOrEqual(last - 1e-9);
      expect(y).toBeLessThanOrEqual(100 + 1e-9);
      last = y;
    }
    expect(last).toBeGreaterThan(99);
  });

  it('tracks a constant-velocity ramp with bounded lag and a correct velocity estimate', () => {
    const f = new OneEuroFilter(params);
    const speed = 300; // mm/s
    let y = 0;
    for (let i = 0; i <= 90; i++) {
      const t = i / 30;
      y = f.filter(speed * t, t);
    }
    const lagS = (speed * 3 - y) / speed;
    expect(lagS).toBeLessThan(0.1);
    expect(f.velocity).toBeCloseTo(speed, 0);
  });

  it('smooths jitter at rest more than a plain pass-through', () => {
    const f = new OneEuroFilter(params);
    let maxDev = 0;
    for (let i = 0; i <= 300; i++) {
      const noise = i % 2 === 0 ? 2 : -2;
      const y = f.filter(500 + noise, i / 30);
      if (i > 30) maxDev = Math.max(maxDev, Math.abs(y - 500));
    }
    expect(maxDev).toBeLessThan(1);
  });

  it('ignores non-increasing timestamps', () => {
    const f = new OneEuroFilter(params);
    f.filter(1, 1);
    expect(f.filter(1000, 1)).toBe(1);
    expect(f.filter(1000, 0.5)).toBe(1);
  });

  it('resets', () => {
    const f = new OneEuroFilter(params);
    f.filter(1, 0);
    f.reset();
    expect(f.value).toBeNull();
    expect(f.filter(7, 5)).toBe(7);
  });
});

describe('OneEuroVec3', () => {
  it('filters each axis independently', () => {
    const f = new OneEuroVec3(params);
    f.filter(v3(0, 0, 0), 0);
    let p = v3(0, 0, 0);
    for (let i = 1; i <= 90; i++) {
      p = f.filter(v3(10 * i, -5 * i, 0), i / 30);
    }
    expect(p.x).toBeGreaterThan(800);
    expect(p.y).toBeLessThan(-400);
    expect(p.z).toBe(0);
    expect(f.velocity.x).toBeCloseTo(300, 0);
    expect(f.velocity.y).toBeCloseTo(-150, 0);
  });
});

describe('predictPosition', () => {
  const state = { position: v3(10, 20, 500), velocity: v3(100, -50, 0), tS: 1 };

  it('extrapolates along the velocity', () => {
    const p = predictPosition(state, 1.05, 0.08);
    expect(p.x).toBeCloseTo(15);
    expect(p.y).toBeCloseTo(17.5);
    expect(p.z).toBeCloseTo(500);
  });

  it('clamps the lead time', () => {
    const p = predictPosition(state, 2, 0.08);
    expect(p.x).toBeCloseTo(18);
  });

  it('never predicts backwards', () => {
    const p = predictPosition(state, 0.5, 0.08);
    expect(p.x).toBeCloseTo(10);
  });
});
