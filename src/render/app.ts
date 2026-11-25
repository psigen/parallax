import { ACESFilmicToneMapping, Color, Scene, WebGLRenderer, type Group } from 'three';
import type { ScreenRect } from '../math/offAxisProjection';
import type { Vec3 } from '../math/vec';
import { OffAxisCamera } from './OffAxisCamera';

/** Owns the renderer, scene graph and camera. The caller drives it once per animation frame. */
export class App {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: OffAxisCamera;
  private sceneRoot: Group | undefined;

  constructor(container: HTMLElement, nearM: number, farM: number) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);
    this.scene.background = new Color(0x05070a);
    this.camera = new OffAxisCamera(nearM, farM);
    this.resize();
  }

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
    this.camera.setScreen(screenRectM);
    this.camera.setEye(eyeM);
    this.renderer.render(this.scene, this.camera);
  }
}
