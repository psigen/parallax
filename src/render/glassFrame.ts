import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments } from 'three';
import type { ScreenRect } from '../math/offAxisProjection';

/**
 * A rectangle and crosshair drawn exactly in the screen plane (z = 0), inset from the viewport
 * edges. Anything on the glass must stay perfectly still on screen as the eye moves; if this
 * frame drifts, the viewport-to-physical mapping or the projection is wrong. Key `w`.
 */
export class GlassFrame extends LineSegments {
  constructor() {
    super(new BufferGeometry(), new LineBasicMaterial({ color: 0x00ff88, depthTest: false }));
    this.renderOrder = 1000;
    this.frustumCulled = false;
    this.visible = false;
  }

  /** Update to the current viewport rectangle (metres). */
  update(rectM: ScreenRect, insetM = 0.01): void {
    const l = rectM.left + insetM;
    const r = rectM.right - insetM;
    const b = rectM.bottom + insetM;
    const t = rectM.top - insetM;
    const cx = (l + r) / 2;
    const cy = (b + t) / 2;
    const c = 0.01;
    const v = [
      l,
      b,
      0,
      r,
      b,
      0,
      r,
      b,
      0,
      r,
      t,
      0,
      r,
      t,
      0,
      l,
      t,
      0,
      l,
      t,
      0,
      l,
      b,
      0,
      cx - c,
      cy,
      0,
      cx + c,
      cy,
      0,
      cx,
      cy - c,
      0,
      cx,
      cy + c,
      0,
    ];
    this.geometry.setAttribute('position', new Float32BufferAttribute(v, 3));
  }
}
