import { describe, expect, it } from 'vitest';
import { Vector4 } from 'three';
import { offAxisViewProjection } from '../src/math/offAxisProjection';
import { v3 } from '../src/math/vec';
import { OffAxisCamera } from '../src/render/OffAxisCamera';

const rect = { left: -0.1512, right: 0.1512, bottom: -0.0982, top: 0.0982 };

describe('OffAxisCamera', () => {
  it('produces the same view-projection as the pure math', () => {
    const cam = new OffAxisCamera(0.01, 20);
    const eye = v3(0.12, -0.04, 0.6);
    cam.setScreen(rect);
    cam.setEye(eye);
    cam.updateMatrixWorld(true);
    const vp = cam.projectionMatrix.clone().multiply(cam.matrixWorldInverse);
    const expected = offAxisViewProjection(eye, rect, 0.01, 20);
    for (let k = 0; k < 16; k++) {
      expect(vp.elements[k]).toBeCloseTo(expected[k] ?? NaN, 7);
    }
  });

  it('keeps the off-axis frustum when updateProjectionMatrix is called by resize code', () => {
    const cam = new OffAxisCamera(0.01, 20);
    cam.setScreen(rect);
    cam.setEye(v3(0.2, 0.1, 0.5));
    const before = cam.projectionMatrix.clone();
    cam.aspect = 3; // what a naive resize handler would set
    cam.updateProjectionMatrix();
    expect(cam.projectionMatrix.equals(before)).toBe(true);
  });

  it('maps the screen corners to NDC ±1 through the Three.js matrices', () => {
    const cam = new OffAxisCamera(0.01, 20);
    cam.setScreen(rect);
    cam.setEye(v3(-0.3, 0.2, 0.4));
    cam.updateMatrixWorld(true);
    const p = new Vector4(rect.right, rect.top, 0, 1)
      .applyMatrix4(cam.matrixWorldInverse)
      .applyMatrix4(cam.projectionMatrix);
    expect(p.x / p.w).toBeCloseTo(1, 9);
    expect(p.y / p.w).toBeCloseTo(1, 9);
  });

  it('keeps the projection inverse in sync', () => {
    const cam = new OffAxisCamera(0.01, 20);
    cam.setScreen(rect);
    cam.setEye(v3(0.05, 0.05, 0.7));
    const id = cam.projectionMatrix.clone().multiply(cam.projectionMatrixInverse);
    for (let k = 0; k < 16; k++) {
      expect(id.elements[k]).toBeCloseTo(k % 5 === 0 ? 1 : 0, 9);
    }
  });
});
