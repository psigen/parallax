import { describe, expect, it } from 'vitest';
import {
  directionToEquirectUv,
  directionToImageUv,
  equirectUvToDirection,
} from '../src/lighting/envProjection';
import type { CameraModel } from '../src/math/eyeEstimator';
import { normalize, v3 } from '../src/math/vec';

const cam: CameraModel = {
  intrinsics: { width_px: 1280, height_px: 720, fx_px: 890, fy_px: 890, cx_px: 640, cy_px: 360 },
  extrinsics: { position_mm: [0, 94.7, 0], rotation_deg: [0, 0, 0] },
  mirrored: false,
};

describe('equirect conventions', () => {
  it('round-trips directions through Three.js equirectUv', () => {
    for (const d of [
      v3(0, 0, 1),
      v3(1, 0, 0),
      v3(0, 1, 0),
      normalize(v3(0.3, -0.5, 0.8)),
      normalize(v3(-1, 0.2, -0.4)),
    ]) {
      const { u, v } = directionToEquirectUv(d);
      const back = equirectUvToDirection(u, v);
      expect(back.x).toBeCloseTo(d.x, 9);
      expect(back.y).toBeCloseTo(d.y, 9);
      expect(back.z).toBeCloseTo(d.z, 9);
    }
  });

  it('puts +z at u = 0.75 and +x at u = 0.5 (Three convention)', () => {
    expect(directionToEquirectUv(v3(0, 0, 1)).u).toBeCloseTo(0.75);
    expect(directionToEquirectUv(v3(1, 0, 0)).u).toBeCloseTo(0.5);
    expect(directionToEquirectUv(v3(0, 1, 0)).v).toBeCloseTo(1);
  });
});

describe('directionToImageUv', () => {
  it('maps +z to the principal point, inside the frame', () => {
    const h = directionToImageUv(v3(0, 0, 1), cam);
    expect(h.u).toBeCloseTo(0.5);
    expect(h.v).toBeCloseTo(0.5);
    expect(h.inside).toBe(true);
    expect(h.outsideRad).toBe(0);
  });

  it('maps viewer-right (+x) to the image left for an unmirrored camera', () => {
    expect(directionToImageUv(normalize(v3(0.3, 0, 1)), cam).u).toBeLessThan(0.5);
  });

  it('reports directions behind the camera and beyond the FOV as outside with a growing angle', () => {
    const behind = directionToImageUv(v3(0, 0, -1), cam);
    expect(behind.inside).toBe(false);
    expect(behind.outsideRad).toBeGreaterThan(1);
    const side = directionToImageUv(normalize(v3(1, 0, 0.5)), cam); // ~63 deg off axis, half-FOV ~36 deg
    expect(side.inside).toBe(false);
    expect(side.outsideRad).toBeCloseTo(Math.atan2(1, 0.5) - Math.atan(640 / 890), 6);
  });
});
