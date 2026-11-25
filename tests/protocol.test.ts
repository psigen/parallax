import { describe, expect, it } from 'vitest';
import {
  headAnglesFromMatrix,
  irisCentres,
  LANDMARK_COUNT,
  LEFT_IRIS_CENTRE,
  RIGHT_IRIS_CENTRE,
} from '../src/tracking/protocol';

function rotationY(rad: number, columnMajor: boolean): number[] {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  // Column-major: columns are (c,0,-s), (0,1,0), (s,0,c).
  const cm = [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
  if (columnMajor) return cm;
  const rm = new Array<number>(16).fill(0);
  for (let r = 0; r < 4; r++)
    for (let col = 0; col < 4; col++) rm[r * 4 + col] = cm[col * 4 + r] ?? 0;
  return rm;
}

describe('headAnglesFromMatrix', () => {
  it('reports zero angles for identity', () => {
    const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    const a = headAnglesFromMatrix(id);
    expect(a.yawRad).toBeCloseTo(0, 12);
    expect(a.pitchRad).toBeCloseTo(0, 12);
  });

  it('recovers yaw magnitude for either memory layout', () => {
    const yaw = (25 * Math.PI) / 180;
    expect(Math.abs(headAnglesFromMatrix(rotationY(yaw, true)).yawRad)).toBeCloseTo(yaw, 9);
    expect(Math.abs(headAnglesFromMatrix(rotationY(yaw, false)).yawRad)).toBeCloseTo(yaw, 9);
  });

  it('tolerates malformed input', () => {
    expect(headAnglesFromMatrix([])).toEqual({ yawRad: 0, pitchRad: 0 });
  });
});

describe('irisCentres', () => {
  it('reads the documented landmark indices', () => {
    const lm = new Float32Array(LANDMARK_COUNT * 3);
    lm[LEFT_IRIS_CENTRE * 3] = 0.6;
    lm[LEFT_IRIS_CENTRE * 3 + 1] = 0.4;
    lm[RIGHT_IRIS_CENTRE * 3] = 0.4;
    lm[RIGHT_IRIS_CENTRE * 3 + 1] = 0.41;
    const { left, right } = irisCentres(lm);
    expect(left.x).toBeCloseTo(0.6);
    expect(left.y).toBeCloseTo(0.4);
    expect(right.x).toBeCloseTo(0.4);
    // Un-mirrored frame: the subject's left eye is on the image's right.
    expect(left.x).toBeGreaterThan(right.x);
  });
});
