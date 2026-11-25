/**
 * Converts iris landmarks (normalized image coordinates) into the viewer's cyclopean eye position
 * in the screen frame (mm), using pinhole intrinsics, the camera's pose on the screen, and the
 * viewer's interpupillary distance.
 *
 * Depth: Z = fx * IPD * cos(yaw) / d_px, where d_px is the iris separation in pixels at the
 * intrinsics' reference resolution. cos(yaw) undoes foreshortening when the head is turned.
 */
import type { Extrinsics, Intrinsics } from '../config/schema';
import {
  add,
  inverseTransformDirection,
  mat4FromEulerXYZ,
  sub,
  transformDirection,
  v3,
  type Mat4,
  type Vec2,
  type Vec3,
} from './vec';

export interface IrisObservation {
  /** Subject's left iris centre, normalized [0,1] image coordinates (x right, y down). */
  left: Vec2;
  /** Subject's right iris centre, normalized [0,1]. */
  right: Vec2;
  /** Head yaw in radians (sign irrelevant); 0 if unknown. */
  yawRad: number;
}

export interface CameraModel {
  intrinsics: Intrinsics;
  extrinsics: Extrinsics;
  mirrored: boolean;
}

const DEG = Math.PI / 180;

function extrinsicRotation(e: Extrinsics): Mat4 {
  const [pitch, yaw, roll] = e.rotation_deg;
  return mat4FromEulerXYZ(pitch * DEG, yaw * DEG, roll * DEG);
}

/**
 * Camera-frame -> screen-frame. The camera's nominal frame is aligned with the screen frame
 * (it looks along +z at the viewer): a point at image pixel (u, v) with depth Z lies at
 * camera-frame (-(u - cx) Z / fx, -(v - cy) Z / fy, Z); the sign flips come from the camera facing
 * the viewer (image-right is the viewer's left) and image-y pointing down.
 */
export function cameraToScreen(pCam: Vec3, cam: CameraModel): Vec3 {
  const R = extrinsicRotation(cam.extrinsics);
  const [px, py, pz] = cam.extrinsics.position_mm;
  return add(transformDirection(R, pCam), v3(px, py, pz));
}

export function screenToCamera(pScreen: Vec3, cam: CameraModel): Vec3 {
  const R = extrinsicRotation(cam.extrinsics);
  const [px, py, pz] = cam.extrinsics.position_mm;
  return inverseTransformDirection(R, sub(pScreen, v3(px, py, pz)));
}

/** Back-project a normalized image point at a given camera-frame depth (mm). */
export function imageToCamera(n: Vec2, depthMm: number, cam: CameraModel): Vec3 {
  const { intrinsics: k } = cam;
  const u = n.x * k.width_px;
  const v = n.y * k.height_px;
  const xs = cam.mirrored ? 1 : -1;
  return v3(
    (xs * (u - k.cx_px) * depthMm) / k.fx_px,
    (-(v - k.cy_px) * depthMm) / k.fy_px,
    depthMm,
  );
}

/** Forward projection of a camera-frame point (mm) to normalized image coordinates. Used in tests. */
export function cameraToImage(pCam: Vec3, cam: CameraModel): Vec2 {
  const { intrinsics: k } = cam;
  if (!(pCam.z > 0)) throw new RangeError('point must be in front of the camera');
  const xs = cam.mirrored ? 1 : -1;
  const u = k.cx_px + (xs * k.fx_px * pCam.x) / pCam.z;
  const v = k.cy_px - (k.fy_px * pCam.y) / pCam.z;
  return { x: u / k.width_px, y: v / k.height_px };
}

/** Which point to render for: the midpoint of the irises, or one eye (close the other to judge correctness). */
export type EyeSelect = 'cyclopean' | 'left' | 'right';

export interface EyeEstimate {
  /** Cyclopean eye position in the screen frame, mm. */
  eyeMm: Vec3;
  /** Camera-frame depth used, mm. */
  depthMm: number;
  /** Iris separation in pixels at the reference resolution. */
  irisSeparationPx: number;
}

export function estimateEye(
  obs: IrisObservation,
  cam: CameraModel,
  ipdMm: number,
  yawCorrection = true,
  eyeSelect: EyeSelect = 'cyclopean',
): EyeEstimate {
  const { intrinsics: k } = cam;
  const dx = (obs.left.x - obs.right.x) * k.width_px;
  const dy = (obs.left.y - obs.right.y) * k.height_px;
  const irisSeparationPx = Math.hypot(dx, dy);
  if (!(irisSeparationPx > 0)) {
    throw new RangeError('iris centres coincide; cannot estimate depth');
  }
  const foreshorten = yawCorrection ? Math.max(0.2, Math.abs(Math.cos(obs.yawRad))) : 1;
  const depthMm = (k.fx_px * ipdMm * foreshorten) / irisSeparationPx;
  const point: Vec2 =
    eyeSelect === 'left'
      ? obs.left
      : eyeSelect === 'right'
        ? obs.right
        : { x: (obs.left.x + obs.right.x) / 2, y: (obs.left.y + obs.right.y) / 2 };
  const eyeMm = cameraToScreen(imageToCamera(point, depthMm, cam), cam);
  return { eyeMm, depthMm, irisSeparationPx };
}

/**
 * Solve for the focal length that makes the observed iris separation consistent with a known
 * camera-frame depth. Used by the in-app calibration step.
 */
export function calibrateFocalLength(
  obs: IrisObservation,
  cam: CameraModel,
  ipdMm: number,
  knownDepthMm: number,
): number {
  const { intrinsics: k } = cam;
  const dx = (obs.left.x - obs.right.x) * k.width_px;
  const dy = (obs.left.y - obs.right.y) * k.height_px;
  const sep = Math.hypot(dx, dy);
  const foreshorten = Math.max(0.2, Math.abs(Math.cos(obs.yawRad)));
  return (sep * knownDepthMm) / (ipdMm * foreshorten);
}
