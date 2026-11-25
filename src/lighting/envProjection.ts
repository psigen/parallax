/**
 * Direction conventions shared by the environment-map shader and its tests. The GLSL in
 * environmentMap.ts copies these formulas line for line.
 */
import { cameraToImage, type CameraModel } from '../math/eyeEstimator';
import { inverseTransformDirection, mat4FromEulerXYZ, v3, type Vec3 } from '../math/vec';

/** Three.js equirectUv: u = atan2(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5. */
export function directionToEquirectUv(d: Vec3): { u: number; v: number } {
  return {
    u: Math.atan2(d.z, d.x) / (2 * Math.PI) + 0.5,
    v: Math.asin(Math.min(1, Math.max(-1, d.y))) / Math.PI + 0.5,
  };
}

export function equirectUvToDirection(u: number, v: number): Vec3 {
  const theta = (u - 0.5) * 2 * Math.PI;
  const phi = (v - 0.5) * Math.PI;
  return v3(Math.cos(phi) * Math.cos(theta), Math.sin(phi), Math.cos(phi) * Math.sin(theta));
}

export interface ImageHit {
  /** Normalized image coordinates (may lie outside [0,1]). */
  u: number;
  v: number;
  /** True when the direction is in front of the camera and inside the frame. */
  inside: boolean;
  /** Angular distance (rad) outside the frame, 0 when inside; used to fade to the mean colour. */
  outsideRad: number;
}

const DEG = Math.PI / 180;

/** Where a world direction lands in the camera image. */
export function directionToImageUv(dWorld: Vec3, cam: CameraModel): ImageHit {
  const [pitch, yaw, roll] = cam.extrinsics.rotation_deg;
  const R = mat4FromEulerXYZ(pitch * DEG, yaw * DEG, roll * DEG);
  const d = inverseTransformDirection(R, dWorld);
  if (d.z <= 1e-6) {
    return {
      u: NaN,
      v: NaN,
      inside: false,
      outsideRad: Math.PI / 2 + Math.atan2(-d.z, Math.hypot(d.x, d.y)),
    };
  }
  const { x: u, y: v } = cameraToImage(d, cam);
  const k = cam.intrinsics;
  // Angular overshoot beyond the frame edges, in radians, using the half-FOVs.
  const halfH = Math.atan(k.width_px / 2 / k.fx_px);
  const halfV = Math.atan(k.height_px / 2 / k.fy_px);
  const angX = Math.atan2(Math.abs(d.x), d.z);
  const angY = Math.atan2(Math.abs(d.y), d.z);
  const outsideRad = Math.max(0, angX - halfH, angY - halfV);
  const inside = u >= 0 && u <= 1 && v >= 0 && v <= 1;
  return { u, v, inside, outsideRad };
}
