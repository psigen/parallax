import {
  ACESFilmicToneMapping,
  Color,
  Scene,
  VSMShadowMap,
  WebGLRenderer,
  type Group,
} from 'three';
import type { ScreenRect } from '../math/offAxisProjection';
import type { Vec3 } from '../math/vec';
import { GlassFrame } from './glassFrame';
import { OffAxisCamera } from './OffAxisCamera';

/** Owns the renderer, scene graph and camera. The caller drives it once per animation frame. */
export class App {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: OffAxisCamera;
  readonly glassFrame = new GlassFrame();
  private sceneRoot: Group | undefined;

  constructor(
    container: HTMLElement,
    nearM: number,
    farM: number,
    opts: { antialias?: boolean; maxPixelRatio?: number } = {},
  ) {
    this.renderer = new WebGLRenderer({
      antialias: opts.antialias ?? true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, opts.maxPixelRatio ?? 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);
    this.scene.background = new Color(0x05070a);
    this.camera = new OffAxisCamera(nearM, farM);
    this.scene.add(this.glassFrame);
    this.resize();
  }

  enableShadows(): void {
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = VSMShadowMap;
  }

  /** The scene is always axis-aligned with the display: the screen is a flat plate at z = 0. */
  setSceneRoot(root: Group): void {
    if (this.sceneRoot) this.scene.remove(this.sceneRoot);
    this.sceneRoot = root;
    this.scene.add(root);
  }

  resize(): void {
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
  }

  /** Render the scene for an eye and a screen rectangle, both in metres in the screen frame. */
  render(eyeM: Vec3, screenRectM: ScreenRect): void {
    if (this.glassFrame.visible) this.glassFrame.update(screenRectM, eyeM);
    this.camera.setScreen(screenRectM);
    this.camera.setEye(eyeM);
    this.renderer.render(this.scene, this.camera);
  }
}
