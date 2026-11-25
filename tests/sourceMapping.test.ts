import { describe, expect, it } from 'vitest';
import type { CameraModel } from '../src/math/eyeEstimator';
import { LinearSolidAngleModel } from '../src/lighting/brightnessModel';
import { mapSource } from '../src/lighting/sourceMapping';
import type { LightSource } from '../src/lighting/sourceDetector';

const cam: CameraModel = {
  intrinsics: { width_px: 1280, height_px: 720, fx_px: 890, fy_px: 890, cx_px: 640, cy_px: 360 },
  extrinsics: { position_mm: [0, 94.7, 0], rotation_deg: [0, 0, 0] },
  mirrored: false,
};

const src = (u: number, v: number, areaPx = 10): LightSource => ({
  u,
  v,
  areaPx,
  meanLum: 0.9,
  peakLum: 0.95,
  saturated: false,
  flux: 9,
});

describe('mapSource', () => {
  it('maps the image centre to +z', () => {
    const m = mapSource(src(0.5, 0.5), cam, 96, 54);
    expect(m.directionWorld.x).toBeCloseTo(0, 9);
    expect(m.directionWorld.y).toBeCloseTo(0, 9);
    expect(m.directionWorld.z).toBeCloseTo(1, 9);
  });

  it('maps image-left to the viewer right (+x) for an unmirrored camera, and -x when mirrored', () => {
    expect(mapSource(src(0.2, 0.5), cam, 96, 54).directionWorld.x).toBeGreaterThan(0.2);
    expect(
      mapSource(src(0.2, 0.5), { ...cam, mirrored: true }, 96, 54).directionWorld.x,
    ).toBeLessThan(-0.2);
  });

  it('maps image-top to +y', () => {
    expect(mapSource(src(0.5, 0.1), cam, 96, 54).directionWorld.y).toBeGreaterThan(0.2);
  });

  it('converts analysis-pixel area to a solid angle at the reference resolution', () => {
    const m = mapSource(src(0.5, 0.5, 10), cam, 96, 54);
    const scale = (1280 / 96) * (720 / 54);
    expect(m.solidAngleSr).toBeCloseTo((10 * scale) / (890 * 890), 9);
    expect(m.angularDiameterRad).toBeCloseTo(2 * Math.sqrt(m.solidAngleSr / Math.PI), 9);
    expect(mapSource(src(0.5, 0.5, 20), cam, 96, 54).solidAngleSr).toBeCloseTo(
      2 * m.solidAngleSr,
      9,
    );
  });
});

describe('LinearSolidAngleModel', () => {
  const model = new LinearSolidAngleModel({ gain: 40, saturationBoost: 2 });

  it('is linear in luminance and solid angle', () => {
    const a = model.intensity({ ...src(0.5, 0.5), meanLum: 0.5 }, 0.01);
    const b = model.intensity({ ...src(0.5, 0.5), meanLum: 1.0 }, 0.01);
    const c = model.intensity({ ...src(0.5, 0.5), meanLum: 0.5 }, 0.02);
    expect(a).toBeCloseTo(0.2);
    expect(b).toBeCloseTo(2 * a);
    expect(c).toBeCloseTo(2 * a);
  });

  it('boosts saturated sources', () => {
    const plain = model.intensity({ ...src(0.5, 0.5), meanLum: 0.9 }, 0.01);
    const sat = model.intensity({ ...src(0.5, 0.5), meanLum: 0.9, saturated: true }, 0.01);
    expect(sat).toBeCloseTo(2 * plain);
  });
});
