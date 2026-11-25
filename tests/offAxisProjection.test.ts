import { describe, expect, it } from 'vitest';
import {
  frustumMatrix,
  generalizedViewProjection,
  offAxisFrustum,
  offAxisViewProjection,
  type ScreenRect,
} from '../src/math/offAxisProjection';
import { transformPoint, v3, type Vec3 } from '../src/math/vec';

// Deterministic pseudo-random so failures reproduce.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const screen: ScreenRect = { left: -0.1512, right: 0.1512, bottom: -0.0982, top: 0.0982 };
const near = 0.01;
const far = 20;

function randomEye(rand: () => number): Vec3 {
  return v3((rand() - 0.5) * 1.2, (rand() - 0.5) * 0.8, 0.25 + rand() * 1.5);
}

describe('offAxisFrustum', () => {
  it('is symmetric when the eye is centred on the screen normal', () => {
    const f = offAxisFrustum(v3(0, 0, 0.5), screen, near, far);
    expect(f.left).toBeCloseTo(-f.right);
    expect(f.bottom).toBeCloseTo(-f.top);
    expect(f.right).toBeCloseTo((0.1512 * near) / 0.5);
  });

  it('shifts the frustum opposite to the eye offset', () => {
    const f = offAxisFrustum(v3(0.2, 0, 0.5), screen, near, far);
    // Eye moved right: the screen is now mostly to the eye's left.
    expect(f.left).toBeLessThan(0);
    expect(Math.abs(f.left)).toBeGreaterThan(Math.abs(f.right));
  });

  it('rejects an eye behind the screen', () => {
    expect(() => offAxisFrustum(v3(0, 0, -0.5), screen, near, far)).toThrow(RangeError);
  });
});

describe('offAxisViewProjection', () => {
  it('maps the screen corners to the NDC corners for any eye position', () => {
    const rand = lcg(1);
    for (let i = 0; i < 200; i++) {
      const eye = randomEye(rand);
      const vp = offAxisViewProjection(eye, screen, near, far);
      const corners: [Vec3, [number, number]][] = [
        [v3(screen.left, screen.bottom, 0), [-1, -1]],
        [v3(screen.right, screen.bottom, 0), [1, -1]],
        [v3(screen.left, screen.top, 0), [-1, 1]],
        [v3(screen.right, screen.top, 0), [1, 1]],
      ];
      for (const [p, [nx, ny]] of corners) {
        const ndc = transformPoint(vp, p);
        expect(ndc.x).toBeCloseTo(nx, 9);
        expect(ndc.y).toBeCloseTo(ny, 9);
      }
    }
  });

  it('projects any point on the screen plane to the same pixel regardless of eye position', () => {
    // This is the defining property of a window: things *on* the glass never move.
    const rand = lcg(2);
    for (let i = 0; i < 200; i++) {
      const p = v3(
        screen.left + rand() * (screen.right - screen.left),
        screen.bottom + rand() * (screen.top - screen.bottom),
        0,
      );
      const expectedX = ((p.x - screen.left) / (screen.right - screen.left)) * 2 - 1;
      const expectedY = ((p.y - screen.bottom) / (screen.top - screen.bottom)) * 2 - 1;
      for (let j = 0; j < 5; j++) {
        const ndc = transformPoint(offAxisViewProjection(randomEye(rand), screen, near, far), p);
        expect(ndc.x).toBeCloseTo(expectedX, 9);
        expect(ndc.y).toBeCloseTo(expectedY, 9);
      }
    }
  });

  it('slides points behind the screen with the eye and points in front against it', () => {
    // Looking through a window and stepping right: a distant object stays straight ahead, so on
    // the glass it moves right with you (by less than you moved, approaching 1:1 at infinity).
    // Something between you and the glass swings the other way.
    const behind = v3(0, 0, -0.3);
    const farBehind = v3(0, 0, -300);
    const inFront = v3(0, 0, 0.1);
    const centre = offAxisViewProjection(v3(0, 0, 0.6), screen, near, far);
    const right = offAxisViewProjection(v3(0.2, 0, 0.6), screen, near, far);
    expect(transformPoint(centre, behind).x).toBeCloseTo(0);
    const eyeNdcX = 0.2 / screen.right; // where the eye's own x lands on the glass
    const behindX = transformPoint(right, behind).x;
    expect(behindX).toBeGreaterThan(0);
    expect(behindX).toBeLessThan(eyeNdcX);
    expect(transformPoint(right, farBehind).x).toBeCloseTo(eyeNdcX, 2);
    expect(transformPoint(right, inFront).x).toBeLessThan(0);
  });

  it('maps near and far to NDC z = -1 and +1', () => {
    const eye = v3(0.1, -0.05, 0.7);
    const vp = offAxisViewProjection(eye, screen, near, far);
    expect(transformPoint(vp, v3(eye.x, eye.y, eye.z - near)).z).toBeCloseTo(-1, 6);
    expect(transformPoint(vp, v3(eye.x, eye.y, eye.z - far)).z).toBeCloseTo(1, 6);
  });

  it('equals Kooima generalized projection for the screen-aligned case', () => {
    const rand = lcg(3);
    const pa = v3(screen.left, screen.bottom, 0);
    const pb = v3(screen.right, screen.bottom, 0);
    const pc = v3(screen.left, screen.top, 0);
    for (let i = 0; i < 100; i++) {
      const eye = randomEye(rand);
      const fast = offAxisViewProjection(eye, screen, near, far);
      const general = generalizedViewProjection(eye, pa, pb, pc, near, far);
      for (let k = 0; k < 16; k++) {
        expect(fast[k]).toBeCloseTo(general[k] ?? NaN, 9);
      }
    }
  });
});

describe('frustumMatrix', () => {
  it('matches the symmetric perspective matrix for a symmetric frustum', () => {
    const n = 0.1;
    const f = 100;
    const t = n * Math.tan((60 * Math.PI) / 360);
    const r = t * (16 / 9);
    const m = frustumMatrix({ left: -r, right: r, bottom: -t, top: t, near: n, far: f });
    expect(m[0]).toBeCloseTo(n / r);
    expect(m[5]).toBeCloseTo(n / t);
    expect(m[8]).toBeCloseTo(0);
    expect(m[9]).toBeCloseTo(0);
    expect(m[11]).toBe(-1);
  });
});
