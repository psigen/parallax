import { Group, Mesh, MeshBasicMaterial, PlaneGeometry } from 'three';
import type { ScreenRect } from '../math/offAxisProjection';

/**
 * A rectangle and crosshair drawn exactly in the screen plane (z = 0), inset from the viewport
 * edges, as solid bars (WebGL lines are always one pixel wide): a dark outline under a bright
 * core so it reads on any background. Anything on the glass must stay perfectly still on
 * screen as the eye moves; if this frame drifts, the viewport-to-physical mapping or the
 * projection is wrong. Key `w`.
 */
export class GlassFrame extends Group {
  private readonly bars: { core: Mesh; outline: Mesh }[] = [];
  private static readonly CORE_M = 0.003;
  private static readonly OUTLINE_M = 0.006;

  constructor() {
    super();
    this.visible = false;
    this.renderOrder = 1000;
    const geo = new PlaneGeometry(1, 1);
    const coreMat = new MeshBasicMaterial({
      color: 0x00ff66,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const outlineMat = new MeshBasicMaterial({
      color: 0x000000,
      depthTest: false,
      depthWrite: false,
    });
    for (let i = 0; i < 6; i++) {
      const outline = new Mesh(geo, outlineMat);
      outline.renderOrder = 1000;
      const core = new Mesh(geo, coreMat);
      core.renderOrder = 1001;
      this.add(outline, core);
      this.bars.push({ core, outline });
    }
  }

  /** Update to the current viewport rectangle (metres). */
  update(rectM: ScreenRect, insetM = 0.01): void {
    const l = rectM.left + insetM;
    const r = rectM.right - insetM;
    const b = rectM.bottom + insetM;
    const t = rectM.top - insetM;
    const cx = (l + r) / 2;
    const cy = (b + t) / 2;
    const c = 0.015;
    // [centre x, centre y, length, horizontal?]
    const spec: [number, number, number, boolean][] = [
      [cx, b, r - l, true],
      [cx, t, r - l, true],
      [l, cy, t - b, false],
      [r, cy, t - b, false],
      [cx, cy, 2 * c, true],
      [cx, cy, 2 * c, false],
    ];
    spec.forEach(([x, y, len, horizontal], i) => {
      const bar = this.bars[i];
      if (!bar) return;
      for (const [mesh, w] of [
        [bar.outline, GlassFrame.OUTLINE_M],
        [bar.core, GlassFrame.CORE_M],
      ] as const) {
        mesh.position.set(x, y, 0);
        if (horizontal) mesh.scale.set(len + w, w, 1);
        else mesh.scale.set(w, len + w, 1);
      }
    });
  }
}
