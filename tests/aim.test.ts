import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { aimQuaternion } from '../src/render/aim';
import { v3 } from '../src/math/vec';

describe('aimQuaternion', () => {
  it('is identity for an eye on the display normal', () => {
    const q = aimQuaternion(v3(0, 0, 0.55));
    const f = new Vector3(0, 0, -1).applyQuaternion(q);
    expect(f.z).toBeCloseTo(-1, 9);
  });

  it('points the scene axis away from the eye through the display centre', () => {
    for (const eye of [v3(0, 0.15, 0.55), v3(0.2, -0.1, 0.4), v3(-0.3, 0.25, 0.7)]) {
      const q = aimQuaternion(eye);
      const f = new Vector3(0, 0, -1).applyQuaternion(q);
      const expected = new Vector3(eye.x, eye.y, eye.z).negate().normalize();
      expect(f.distanceTo(expected)).toBeLessThan(1e-9);
      // No twist: the scene's x axis stays horizontal (perpendicular to world up).
      const x = new Vector3(1, 0, 0).applyQuaternion(q);
      expect(Math.abs(x.y)).toBeLessThan(1e-9);
    }
  });

  it('tilts the room so its axis continues the eye-to-centre line of sight', () => {
    const q = aimQuaternion(v3(0, 0.15, 0.55));
    const back = new Vector3(0, 0, -0.5).applyQuaternion(q);
    // Eye above the display looking down at it: the room's axis goes down and away, so the
    // viewer looks straight along it. Its depth from the glass is nearly unchanged.
    expect(back.y).toBeCloseTo(-0.5 * (0.15 / Math.hypot(0.15, 0.55)), 6);
    expect(back.z).toBeLessThan(-0.45);
  });
});
