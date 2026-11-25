import { cameraToScreen, imageToCamera, type CameraModel } from '../math/eyeEstimator';
import { normalize, sub, v3, type Vec3 } from '../math/vec';
import type { LightSource } from './sourceDetector';

export interface MappedSource {
  /** Unit vector from the window toward the light, screen frame (+z is toward the viewer). */
  directionWorld: Vec3;
  solidAngleSr: number;
  angularDiameterRad: number;
}

/**
 * Where a detected source is, in the world: back-project its centroid through the camera model
 * (so mirroring and the camera's pose are honoured) and convert its pixel area to a solid angle.
 */
export function mapSource(
  source: LightSource,
  cam: CameraModel,
  analysisWidthPx: number,
  analysisHeightPx: number,
): MappedSource {
  const pCam = imageToCamera({ x: source.u, y: source.v }, 1, cam);
  const pWorld = cameraToScreen(pCam, cam);
  const [px, py, pz] = cam.extrinsics.position_mm;
  const directionWorld = normalize(sub(pWorld, v3(px, py, pz)));

  const k = cam.intrinsics;
  const scaleX = k.width_px / analysisWidthPx;
  const scaleY = k.height_px / analysisHeightPx;
  const areaRefPx = source.areaPx * scaleX * scaleY;
  const solidAngleSr = areaRefPx / (k.fx_px * k.fy_px);
  const angularDiameterRad = 2 * Math.sqrt(solidAngleSr / Math.PI);
  return { directionWorld, solidAngleSr, angularDiameterRad };
}
