import { AmbientLight, Box3, DirectionalLight, Group, Light, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { findWindowCamera, hasNonUnitScale, windowRootMatrix } from './sceneRoot';

export interface SceneWarning {
  code: 'no-window-camera' | 'window-scale' | 'not-crossing-screen' | 'not-metric' | 'no-lights';
  message: string;
}

export interface LoadedScene {
  root: Group;
  warnings: SceneWarning[];
}

/**
 * Load a glTF and express it in the screen frame. See docs/scene-authoring.md for the
 * invariants. The returned group is ready to add to the Three scene.
 */
export async function loadScene(url: string): Promise<LoadedScene> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const warnings: SceneWarning[] = [];
  const root = new Group();
  root.name = 'scene-root';
  root.add(gltf.scene);
  gltf.scene.updateMatrixWorld(true);

  const windowCam = findWindowCamera(gltf.cameras);
  if (windowCam) {
    if (hasNonUnitScale(windowCam)) {
      warnings.push({
        code: 'window-scale',
        message:
          'window camera node has non-unit world scale; the scene will be rescaled accordingly',
      });
    }
    const m = windowRootMatrix(windowCam.matrixWorld);
    m.decompose(root.position, root.quaternion, root.scale);
    windowCam.removeFromParent();
  } else {
    warnings.push({
      code: 'no-window-camera',
      message:
        'no camera named "window" in the glTF; assuming the scene origin is the display centre',
    });
  }
  root.updateMatrixWorld(true);

  const bounds = new Box3().setFromObject(root);
  const size = bounds.getSize(new Vector3());
  if (Math.max(size.x, size.y, size.z) > 50) {
    warnings.push({
      code: 'not-metric',
      message: `scene spans ${size.x.toFixed(1)} x ${size.y.toFixed(1)} x ${size.z.toFixed(1)} units; expected metres`,
    });
  }
  if (bounds.min.z > 0 || bounds.max.z < 0) {
    warnings.push({
      code: 'not-crossing-screen',
      message: 'scene bounds do not cross the screen plane z = 0',
    });
  }

  let hasLights = false;
  root.traverse((o) => {
    if (o instanceof Light) hasLights = true;
  });
  if (!hasLights) {
    warnings.push({
      code: 'no-lights',
      message: 'glTF has no lights; adding a default directional light',
    });
    const sun = new DirectionalLight(0xffffff, 2.5);
    sun.position.set(0.3, 0.6, 0.8);
    root.add(sun, sun.target);
  }
  // A faint ambient keeps shadowed walls readable without washing out the lights.
  root.add(new AmbientLight(0xffffff, 0.25));

  return { root, warnings };
}
