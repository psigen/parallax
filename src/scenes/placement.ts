import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { Placement } from './manifest';

const DEG = Math.PI / 180;

/**
 * Transform placing a scene (authored in metres with no `window` node) in the screen frame:
 * uniform scale, then rotation (pitch about x, yaw about y, roll about z), then translation
 * (given in mm, applied in metres).
 */
export function placementMatrix(p: Placement): Matrix4 {
  const [pitch, yaw, roll] = p.rotation_deg;
  const q = new Quaternion().setFromEuler(new Euler(pitch * DEG, yaw * DEG, roll * DEG, 'XYZ'));
  const [x, y, z] = p.position_mm;
  return new Matrix4().compose(
    new Vector3(x / 1000, y / 1000, z / 1000),
    q,
    new Vector3(p.scale, p.scale, p.scale),
  );
}

/** The YAML line to paste into config/scenes.yaml for a tuned placement. */
export function placementYaml(p: Placement): string {
  const r = p.rotation_deg.map((n) => Math.round(n * 10) / 10);
  const t = p.position_mm.map((n) => Math.round(n));
  return `placement: { scale: ${Number(p.scale.toFixed(4))}, rotation_deg: [${r.join(', ')}], position_mm: [${t.join(', ')}] }`;
}
