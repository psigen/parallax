import { Box3, Group, Scene, WebGLRenderer } from 'three';

export interface LoadedSplat {
  root: Group;
  bounds: Box3;
  splatCount: number;
}

/**
 * Loads a Gaussian splat (.spz/.sog/.ply/.splat/.ksplat) with Spark. Spark is imported lazily
 * (about 3 MB with its WASM) so glTF-only sessions never pay for it. Spark projects splat
 * centres with the camera's full projectionMatrix and derives the splat footprint from its
 * diagonal terms, which is exact for our off-axis frustum (docs/scene-authoring.md).
 */
export async function loadSplat(
  url: string,
  scene: Scene,
  renderer: WebGLRenderer,
): Promise<LoadedSplat> {
  const { SparkRenderer, SplatMesh } = await import('@sparkjsdev/spark');
  // One SparkRenderer per scene; radial sort is stable under the small eye translations of
  // head tracking (sort order lags the render by about a frame).
  if (!scene.getObjectByName('spark-renderer')) {
    const spark = new SparkRenderer({ renderer, sortRadial: true });
    spark.name = 'spark-renderer';
    scene.add(spark);
  }
  const mesh = new SplatMesh({ url, lod: false });
  await mesh.initialized;
  const root = new Group();
  root.name = 'splat-root';
  root.add(mesh);
  const bounds = mesh.getBoundingBox(true);
  return { root, bounds, splatCount: mesh.packedSplats?.numSplats ?? 0 };
}
