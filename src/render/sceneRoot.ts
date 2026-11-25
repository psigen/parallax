import { Matrix4, Object3D, type Camera } from 'three';

export const WINDOW_NODE_NAME = 'window';

/**
 * Given the world matrix of the glTF's `window` camera node, the transform to apply to the
 * loaded scene so that node's pose becomes the screen frame: its position the display centre,
 * its −z the direction into the scene, its +y up.
 */
export function windowRootMatrix(windowMatrixWorld: Matrix4): Matrix4 {
  return windowMatrixWorld.clone().invert();
}

/**
 * Pick the camera that defines the window: one named `window` (case-insensitive), else the only
 * camera if there is exactly one, else none.
 */
export function findWindowCamera(cameras: readonly Camera[]): Camera | undefined {
  const named = cameras.find((c) => c.name.toLowerCase() === WINDOW_NODE_NAME);
  if (named) return named;
  return cameras.length === 1 ? cameras[0] : undefined;
}

export function hasNonUnitScale(obj: Object3D, tolerance = 1e-3): boolean {
  const s = obj.getWorldScale(obj.scale.clone());
  return (
    Math.abs(s.x - 1) > tolerance || Math.abs(s.y - 1) > tolerance || Math.abs(s.z - 1) > tolerance
  );
}
