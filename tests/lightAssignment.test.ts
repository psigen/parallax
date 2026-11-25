import { describe, expect, it } from 'vitest';
import {
  assignSources,
  type AssignParams,
  type TrackedLight,
} from '../src/lighting/lightAssignment';
import { normalize, v3 } from '../src/math/vec';

const p: AssignParams = { maxAngleRad: 0.2, holdFrames: 3, smoothingHz: 3 };
const ids = () => {
  let n = 1;
  return () => n++;
};

describe('assignSources', () => {
  it('requires holdFrames sightings before a light becomes active', () => {
    const next = ids();
    let lights: TrackedLight[] = [];
    const cand = [{ direction: v3(0, 0, 1), intensity: 1, angularDiameterRad: 0.05 }];
    lights = assignSources(lights, cand, 0.1, p, next);
    expect(lights[0]?.active).toBe(false);
    lights = assignSources(lights, cand, 0.1, p, next);
    expect(lights[0]?.active).toBe(false);
    lights = assignSources(lights, cand, 0.1, p, next);
    expect(lights[0]?.active).toBe(true);
    expect(lights[0]?.id).toBe(1);
  });

  it('keeps identity through a small direction change and smooths toward it', () => {
    const next = ids();
    let lights = assignSources(
      [],
      [{ direction: v3(0, 0, 1), intensity: 1, angularDiameterRad: 0.05 }],
      0.1,
      p,
      next,
    );
    const moved = normalize(v3(0.1, 0, 1));
    for (let i = 0; i < 20; i++) {
      lights = assignSources(
        lights,
        [{ direction: moved, intensity: 2, angularDiameterRad: 0.05 }],
        0.1,
        p,
        next,
      );
    }
    expect(lights).toHaveLength(1);
    expect(lights[0]?.id).toBe(1);
    expect(lights[0]?.direction.x).toBeCloseTo(moved.x, 2);
    expect(lights[0]?.intensity).toBeCloseTo(2, 2);
  });

  it('treats a far-away candidate as a new light', () => {
    const next = ids();
    let lights = assignSources(
      [],
      [{ direction: v3(0, 0, 1), intensity: 1, angularDiameterRad: 0.05 }],
      0.1,
      p,
      next,
    );
    lights = assignSources(
      lights,
      [{ direction: normalize(v3(1, 0, 1)), intensity: 1, angularDiameterRad: 0.05 }],
      0.1,
      p,
      next,
    );
    expect(lights.map((l) => l.id).sort()).toEqual([1, 2]);
  });

  it('holds a vanished light for holdFrames updates, then drops it', () => {
    const next = ids();
    let lights = assignSources(
      [],
      [{ direction: v3(0, 0, 1), intensity: 1, angularDiameterRad: 0.05 }],
      0.1,
      p,
      next,
    );
    for (let i = 0; i < 3; i++) {
      lights = assignSources(lights, [], 0.1, p, next);
      expect(lights).toHaveLength(1);
      expect(lights[0]?.missing).toBe(i + 1);
    }
    lights = assignSources(lights, [], 0.1, p, next);
    expect(lights).toHaveLength(0);
  });

  it('smoothing factor goes to 1 for large dt', () => {
    const next = ids();
    let lights = assignSources(
      [],
      [{ direction: v3(0, 0, 1), intensity: 1, angularDiameterRad: 0.05 }],
      0.1,
      p,
      next,
    );
    lights = assignSources(
      lights,
      [{ direction: v3(0, 0, 1), intensity: 5, angularDiameterRad: 0.05 }],
      10,
      p,
      next,
    );
    expect(lights[0]?.intensity).toBeCloseTo(5, 6);
  });
});
