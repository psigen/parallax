import { describe, expect, it } from 'vitest';
import {
  calibrateFocalLength,
  cameraToImage,
  cameraToScreen,
  estimateEye,
  screenToCamera,
  type CameraModel,
} from '../src/math/eyeEstimator';
import { add, scale, sub, v3, type Vec3 } from '../src/math/vec';

const mbp: CameraModel = {
  intrinsics: { width_px: 1280, height_px: 720, fx_px: 890, fy_px: 890, cx_px: 640, cy_px: 360 },
  extrinsics: { position_mm: [0, 94.7, 0], rotation_deg: [0, 0, 0] },
  mirrored: false,
};

const IPD = 63;

/** Synthesize iris observations for a cyclopean eye at `eyeScreenMm` with the head yawed by `yawRad`. */
function observe(eyeScreenMm: Vec3, cam: CameraModel, yawRad = 0) {
  // The eye baseline runs along the viewer's +x, rotated about +y by yaw.
  const half = scale(v3(Math.cos(yawRad), 0, Math.sin(yawRad)), IPD / 2);
  const leftScreen = add(eyeScreenMm, half); // subject's left eye is on the viewer's +x side
  const rightScreen = sub(eyeScreenMm, half);
  return {
    left: cameraToImage(screenToCamera(leftScreen, cam), cam),
    right: cameraToImage(screenToCamera(rightScreen, cam), cam),
    yawRad,
  };
}

describe('cameraToImage', () => {
  it('puts the optical axis at the principal point', () => {
    const n = cameraToImage(v3(0, 0, 500), mbp);
    expect(n.x).toBeCloseTo(0.5);
    expect(n.y).toBeCloseTo(0.5);
  });

  it('places the viewer right of centre on the image left for a raw (unmirrored) stream', () => {
    const n = cameraToImage(v3(100, 0, 500), mbp);
    expect(n.x).toBeLessThan(0.5);
  });

  it('flips horizontally when mirrored', () => {
    const n = cameraToImage(v3(100, 0, 500), { ...mbp, mirrored: true });
    expect(n.x).toBeGreaterThan(0.5);
  });

  it('places points above the axis higher in the image (smaller y)', () => {
    const n = cameraToImage(v3(0, 100, 500), mbp);
    expect(n.y).toBeLessThan(0.5);
  });
});

describe('cameraToScreen / screenToCamera', () => {
  it('round-trips with rotation and translation', () => {
    const cam: CameraModel = {
      ...mbp,
      extrinsics: { position_mm: [10, 95, 5], rotation_deg: [-8, 3, 1] },
    };
    const p = v3(37, -120, 610);
    const back = screenToCamera(cameraToScreen(p, cam), cam);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
    expect(back.z).toBeCloseTo(p.z, 9);
  });

  it('offsets by the camera position when unrotated', () => {
    const p = cameraToScreen(v3(0, 0, 500), mbp);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(94.7);
    expect(p.z).toBeCloseTo(500);
  });
});

describe('estimateEye', () => {
  it('recovers a centred eye position', () => {
    const truth = v3(0, 0, 550);
    const est = estimateEye(observe(truth, mbp), mbp, IPD);
    expect(est.eyeMm.x).toBeCloseTo(truth.x, 6);
    expect(est.eyeMm.y).toBeCloseTo(truth.y, 6);
    expect(est.eyeMm.z).toBeCloseTo(truth.z, 6);
  });

  it('recovers off-axis positions across the working volume', () => {
    for (const truth of [v3(150, -80, 400), v3(-200, 50, 800), v3(60, 120, 300)]) {
      const est = estimateEye(observe(truth, mbp), mbp, IPD);
      expect(est.eyeMm.x).toBeCloseTo(truth.x, 6);
      expect(est.eyeMm.y).toBeCloseTo(truth.y, 6);
      expect(est.eyeMm.z).toBeCloseTo(truth.z, 6);
    }
  });

  it('is unaffected by the mirrored flag when observations are consistent', () => {
    const cam = { ...mbp, mirrored: true };
    const truth = v3(120, -30, 500);
    const est = estimateEye(observe(truth, cam), cam, IPD);
    expect(est.eyeMm.x).toBeCloseTo(truth.x, 6);
  });

  it('corrects foreshortening from head yaw', () => {
    const truth = v3(0, 0, 550);
    const yaw = (30 * Math.PI) / 180;
    const obs = observe(truth, mbp, yaw);
    const corrected = estimateEye(obs, mbp, IPD, true);
    const uncorrected = estimateEye(obs, mbp, IPD, false);
    // Perspective makes the correction approximate; it should be within ~1 % of truth.
    expect(Math.abs(corrected.eyeMm.z - truth.z) / truth.z).toBeLessThan(0.01);
    // Without correction the eye is placed much too far away (1/cos 30 deg ~ 15 % too far).
    expect(uncorrected.eyeMm.z).toBeGreaterThan(truth.z * 1.1);
  });

  it('honours a tilted camera', () => {
    const cam: CameraModel = {
      ...mbp,
      extrinsics: { position_mm: [0, 94.7, 0], rotation_deg: [-10, 0, 0] },
    };
    const truth = v3(-40, 20, 600);
    const est = estimateEye(observe(truth, cam), cam, IPD);
    expect(est.eyeMm.x).toBeCloseTo(truth.x, 5);
    expect(est.eyeMm.y).toBeCloseTo(truth.y, 5);
    expect(est.eyeMm.z).toBeCloseTo(truth.z, 5);
  });

  it('throws when the irises coincide', () => {
    expect(() =>
      estimateEye({ left: { x: 0.5, y: 0.5 }, right: { x: 0.5, y: 0.5 }, yawRad: 0 }, mbp, IPD),
    ).toThrow(RangeError);
  });
});

describe('calibrateFocalLength', () => {
  it('recovers the focal length that generated the observation', () => {
    const truth = v3(0, 0, 500);
    const obs = observe(truth, mbp);
    const depthCam = screenToCamera(truth, mbp).z;
    expect(calibrateFocalLength(obs, mbp, IPD, depthCam)).toBeCloseTo(890, 6);
  });
});
