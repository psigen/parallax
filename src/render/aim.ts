import { Quaternion, Vector3 } from 'three';
import type { Vec3 } from '../math/vec';

const FORWARD = new Vector3(0, 0, -1);

/**
 * Rotation that turns the scene so its −z axis (into the scene, away from the glass) points along
 * the line from the eye through the display centre. The rotation is about the display centre and
 * keeps "up" as upright as possible. With it, a viewer at `eyeM` looking at the screen centre
 * looks straight down the scene's axis instead of down into it (a laptop display is below eye
 * level, so an un-aimed window shows the room from above).
 */
export function aimQuaternion(eyeM: Vec3): Quaternion {
  const eye = new Vector3(eyeM.x, eyeM.y, eyeM.z);
  if (eye.lengthSq() < 1e-12) return new Quaternion();
  // Object3D.lookAt semantics for non-cameras: +z points at the target, so −z points away from the eye.
  const q = new Quaternion().setFromUnitVectors(FORWARD, eye.clone().negate().normalize());
  // Remove any twist about the new forward axis so the scene's +x stays level with the screen.
  const fwd = eye.clone().negate().normalize();
  const upRotated = new Vector3(0, 1, 0).applyQuaternion(q);
  const upTarget = new Vector3(0, 1, 0).sub(fwd.clone().multiplyScalar(fwd.y)).normalize();
  if (upTarget.lengthSq() < 1e-9) return q;
  const twist = new Quaternion().setFromUnitVectors(upRotated, upTarget);
  return twist.multiply(q);
}
