import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Group,
  Light,
  Mesh,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { IDENTITY_PLACEMENT, type Placement, type SceneEntry } from '../scenes/manifest';
import { placementMatrix } from '../scenes/placement';
import { findWindowCamera, hasNonUnitScale, windowRootMatrix } from './sceneRoot';
import { loadSplat } from './splatLoader';

export interface SceneWarning {
  code: 'no-window-camera' | 'window-scale' | 'not-crossing-screen' | 'not-metric' | 'no-lights';
  message: string;
}

export interface LoadedScene {
  root: Group;
  /** Bounds in the screen frame (metres), after re-rooting / placement. */
  bounds: Box3;
  warnings: SceneWarning[];
  /** The group whose transform is the placement (absent when a `window` node fixed the pose). */
  placementGroup: Group | undefined;
  splatCount?: number;
}

export interface LoadSceneOptions {
  /** Multiplier applied to lights authored in the glTF. */
  lightsScale?: number;
  /** Mark every mesh to cast and receive shadows. */
  shadows?: boolean;
  /** Applied to scenes without a `window` node (glTF) and to every splat. */
  placement?: Placement;
}

/** Wrap a loaded scene in a group carrying the placement transform. */
export function applyPlacement(inner: Group, placement: Placement): Group {
  const group = new Group();
  group.name = 'placement';
  group.add(inner);
  placementMatrix(placement).decompose(group.position, group.quaternion, group.scale);
  group.updateMatrixWorld(true);
  return group;
}

/** Load any manifest entry: glTF or Gaussian splat. */
export async function loadSceneEntry(
  entry: SceneEntry,
  localUrl: string,
  opts: LoadSceneOptions,
  gl: { scene: Scene; renderer: WebGLRenderer },
): Promise<LoadedScene> {
  if (entry.kind === 'splat') {
    const { root, bounds, splatCount } = await loadSplat(localUrl, gl.scene, gl.renderer);
    const placementGroup = applyPlacement(root, opts.placement ?? IDENTITY_PLACEMENT);
    return {
      root: placementGroup,
      bounds: bounds.clone().applyMatrix4(placementGroup.matrixWorld),
      warnings: [],
      placementGroup,
      splatCount,
    };
  }
  return loadScene(localUrl, opts);
}

/**
 * Load a glTF and express it in the screen frame. See docs/scene-authoring.md for the
 * invariants. The returned group is ready to add to the Three scene.
 */
export async function loadScene(url: string, opts: LoadSceneOptions = {}): Promise<LoadedScene> {
  const gltf = await new GLTFLoader().loadAsync(url);
  const warnings: SceneWarning[] = [];
  const root = new Group();
  root.name = 'scene-root';
  root.add(gltf.scene);
  gltf.scene.updateMatrixWorld(true);

  let placementGroup: Group | undefined;
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
      message: 'no camera named "window" in the glTF; the scene origin is placed by `placement`',
    });
    placementGroup = applyPlacement(root, opts.placement ?? IDENTITY_PLACEMENT);
  }
  const outer = placementGroup ?? root;
  outer.updateMatrixWorld(true);

  const bounds = new Box3().setFromObject(outer);
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
    if (o instanceof Light) {
      hasLights = true;
      o.intensity *= opts.lightsScale ?? 1;
    }
    if (opts.shadows && o instanceof Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
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

  return { root: outer, bounds, warnings, placementGroup };
}
