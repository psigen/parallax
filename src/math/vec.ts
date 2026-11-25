/** Minimal vector/matrix helpers so the math modules have no renderer dependency. */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Vec2 {
  x: number;
  y: number;
}

/** Column-major 4x4 matrix, same layout as WebGL and THREE.Matrix4.elements. */
export type Mat4 = Float64Array;

export const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, s: number): Vec3 => v3(a.x * s, a.y * s, a.z * s);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const length = (a: Vec3): number => Math.sqrt(dot(a, a));
export const normalize = (a: Vec3): Vec3 => scale(a, 1 / length(a));

export function mat4Identity(): Mat4 {
  const m = new Float64Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

/** a * b (column-major). */
export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float64Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let s = 0;
      for (let k = 0; k < 4; k++) {
        s += (a[row + 4 * k] ?? 0) * (b[k + 4 * col] ?? 0);
      }
      out[row + 4 * col] = s;
    }
  }
  return out;
}

export function mat4Translation(t: Vec3): Mat4 {
  const m = mat4Identity();
  m[12] = t.x;
  m[13] = t.y;
  m[14] = t.z;
  return m;
}

/** Transform a point (w = 1) and perform the perspective divide. */
export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const x = (m[0] ?? 0) * p.x + (m[4] ?? 0) * p.y + (m[8] ?? 0) * p.z + (m[12] ?? 0);
  const y = (m[1] ?? 0) * p.x + (m[5] ?? 0) * p.y + (m[9] ?? 0) * p.z + (m[13] ?? 0);
  const z = (m[2] ?? 0) * p.x + (m[6] ?? 0) * p.y + (m[10] ?? 0) * p.z + (m[14] ?? 0);
  const w = (m[3] ?? 0) * p.x + (m[7] ?? 0) * p.y + (m[11] ?? 0) * p.z + (m[15] ?? 0);
  return v3(x / w, y / w, z / w);
}

/** Rotation matrix (column-major 3x3 packed into Mat4) from pitch (x), yaw (y), roll (z) in radians, applied as Rz * Ry * Rx. */
export function mat4FromEulerXYZ(pitch: number, yaw: number, roll: number): Mat4 {
  const cx = Math.cos(pitch);
  const sx = Math.sin(pitch);
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cz = Math.cos(roll);
  const sz = Math.sin(roll);
  const m = mat4Identity();
  // Rz * Ry * Rx
  m[0] = cz * cy;
  m[1] = sz * cy;
  m[2] = -sy;
  m[4] = cz * sy * sx - sz * cx;
  m[5] = sz * sy * sx + cz * cx;
  m[6] = cy * sx;
  m[8] = cz * sy * cx + sz * sx;
  m[9] = sz * sy * cx - cz * sx;
  m[10] = cy * cx;
  return m;
}

/** Transform a direction (w = 0) by the upper-left 3x3 of m. */
export function transformDirection(m: Mat4, p: Vec3): Vec3 {
  return v3(
    (m[0] ?? 0) * p.x + (m[4] ?? 0) * p.y + (m[8] ?? 0) * p.z,
    (m[1] ?? 0) * p.x + (m[5] ?? 0) * p.y + (m[9] ?? 0) * p.z,
    (m[2] ?? 0) * p.x + (m[6] ?? 0) * p.y + (m[10] ?? 0) * p.z,
  );
}

/** Inverse-rotate a direction by the upper-left 3x3 (assumes an orthonormal rotation: transpose). */
export function inverseTransformDirection(m: Mat4, p: Vec3): Vec3 {
  return v3(
    (m[0] ?? 0) * p.x + (m[1] ?? 0) * p.y + (m[2] ?? 0) * p.z,
    (m[4] ?? 0) * p.x + (m[5] ?? 0) * p.y + (m[6] ?? 0) * p.z,
    (m[8] ?? 0) * p.x + (m[9] ?? 0) * p.y + (m[10] ?? 0) * p.z,
  );
}
