import { describe, expect, it } from 'vitest';
import { Euler, Group, Matrix4, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { findWindowCamera, hasNonUnitScale, windowRootMatrix } from '../src/render/sceneRoot';

describe('windowRootMatrix', () => {
  it('moves the window node to the origin with identity orientation', () => {
    const scene = new Group();
    const parent = new Group();
    parent.position.set(1, 2, 3);
    parent.rotation.set(0, Math.PI / 4, 0);
    const win = new PerspectiveCamera();
    win.name = 'window';
    win.position.set(0, 0.14, 0);
    parent.add(win);
    scene.add(parent);
    scene.updateMatrixWorld(true);

    const root = new Group();
    root.add(scene);
    windowRootMatrix(win.matrixWorld).decompose(root.position, root.quaternion, root.scale);
    root.updateMatrixWorld(true);

    const origin = new Vector3().setFromMatrixPosition(win.matrixWorld);
    expect(origin.length()).toBeLessThan(1e-9);
    // The camera's local −z (its look direction) should now be world −z.
    const look = new Vector3(0, 0, -1).transformDirection(win.matrixWorld);
    expect(look.x).toBeCloseTo(0);
    expect(look.z).toBeCloseTo(-1);
  });

  it('is the inverse of the window world matrix', () => {
    const m = new Matrix4().compose(
      new Vector3(0.3, -0.2, 1),
      new Quaternion().setFromEuler(new Euler(0.1, 0.2, 0.3)),
      new Vector3(1, 1, 1),
    );
    const id = windowRootMatrix(m).multiply(m);
    for (let k = 0; k < 16; k++) {
      expect(id.elements[k]).toBeCloseTo(k % 5 === 0 ? 1 : 0, 9);
    }
  });
});

describe('findWindowCamera', () => {
  const named = new PerspectiveCamera();
  named.name = 'Window';
  const other = new PerspectiveCamera();
  other.name = 'fly-through';

  it('prefers the camera named window, case-insensitively', () => {
    expect(findWindowCamera([other, named])).toBe(named);
  });

  it('falls back to a lone camera', () => {
    expect(findWindowCamera([other])).toBe(other);
  });

  it('returns undefined when ambiguous or absent', () => {
    expect(findWindowCamera([other, new PerspectiveCamera()])).toBeUndefined();
    expect(findWindowCamera([])).toBeUndefined();
  });
});

describe('hasNonUnitScale', () => {
  it('detects inherited scale', () => {
    const parent = new Group();
    parent.scale.set(2, 2, 2);
    const child = new Group();
    parent.add(child);
    parent.updateMatrixWorld(true);
    expect(hasNonUnitScale(child)).toBe(true);
    expect(hasNonUnitScale(new Group())).toBe(false);
  });
});
