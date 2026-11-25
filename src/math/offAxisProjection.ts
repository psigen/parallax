/**
 * Off-axis ("window") perspective projection.
 *
 * The display is a rectangle in the z = 0 plane of the screen frame (+x right, +y up, +z toward
 * the viewer). Given the viewer's eye position, the frustum is the pyramid from the eye through
 * the rectangle. Because the eye is generally not on the rectangle's normal through its centre,
 * the frustum is asymmetric: this is what gives correct parallax for a "window" display.
 *
 * Reference: R. Kooima, "Generalized Perspective Projection", 2008.
 */
import {
  cross,
  dot,
  mat4Identity,
  mat4Multiply,
  mat4Translation,
  normalize,
  scale,
  sub,
  type Mat4,
  type Vec3,
} from './vec';

/** Screen rectangle in the z = 0 plane. Any consistent unit (the renderer uses metres). */
export interface ScreenRect {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export interface Frustum {
  left: number;
  right: number;
  bottom: number;
  top: number;
  near: number;
  far: number;
}

/**
 * Near-plane extents of the frustum from `eye` through `rect` (both in the screen frame).
 * The eye must be in front of the screen (eye.z > 0).
 */
export function offAxisFrustum(eye: Vec3, rect: ScreenRect, near: number, far: number): Frustum {
  if (!(eye.z > 0)) {
    throw new RangeError(`eye must be in front of the screen plane (eye.z > 0), got ${eye.z}`);
  }
  const s = near / eye.z;
  return {
    left: (rect.left - eye.x) * s,
    right: (rect.right - eye.x) * s,
    bottom: (rect.bottom - eye.y) * s,
    top: (rect.top - eye.y) * s,
    near,
    far,
  };
}

/** Standard OpenGL frustum matrix (column-major), camera looking down -z. */
export function frustumMatrix(f: Frustum): Mat4 {
  const { left: l, right: r, bottom: b, top: t, near: n, far: fa } = f;
  const m = new Float64Array(16);
  m[0] = (2 * n) / (r - l);
  m[5] = (2 * n) / (t - b);
  m[8] = (r + l) / (r - l);
  m[9] = (t + b) / (t - b);
  m[10] = -(fa + n) / (fa - n);
  m[11] = -1;
  m[14] = (-2 * fa * n) / (fa - n);
  return m;
}

/**
 * Full projection * view matrix for the screen-aligned case. The view transform is a pure
 * translation by -eye because the camera axes coincide with the screen frame (looking down -z,
 * i.e. into the scene behind the window).
 */
export function offAxisViewProjection(
  eye: Vec3,
  rect: ScreenRect,
  near: number,
  far: number,
): Mat4 {
  const proj = frustumMatrix(offAxisFrustum(eye, rect, near, far));
  const view = mat4Translation(scale(eye, -1));
  return mat4Multiply(proj, view);
}

/**
 * Kooima's general form for an arbitrarily placed screen given its lower-left (pa), lower-right
 * (pb) and upper-left (pc) corners. Used to prove the screen-aligned fast path is a special case.
 */
export function generalizedViewProjection(
  eye: Vec3,
  pa: Vec3,
  pb: Vec3,
  pc: Vec3,
  near: number,
  far: number,
): Mat4 {
  const vr = normalize(sub(pb, pa));
  const vu = normalize(sub(pc, pa));
  const vn = normalize(cross(vr, vu));

  const va = sub(pa, eye);
  const vb = sub(pb, eye);
  const vc = sub(pc, eye);

  const d = -dot(va, vn);
  const s = near / d;
  const proj = frustumMatrix({
    left: dot(vr, va) * s,
    right: dot(vr, vb) * s,
    bottom: dot(vu, va) * s,
    top: dot(vu, vc) * s,
    near,
    far,
  });

  // Rotation taking world axes into the screen basis (rows are vr, vu, vn).
  const rot = mat4Identity();
  rot[0] = vr.x;
  rot[4] = vr.y;
  rot[8] = vr.z;
  rot[1] = vu.x;
  rot[5] = vu.y;
  rot[9] = vu.z;
  rot[2] = vn.x;
  rot[6] = vn.y;
  rot[10] = vn.z;

  return mat4Multiply(proj, mat4Multiply(rot, mat4Translation(scale(eye, -1))));
}
