import { PerspectiveCamera } from 'three';
import { offAxisFrustum, type ScreenRect } from '../math/offAxisProjection';
import { v3, type Vec3 } from '../math/vec';

/**
 * A Three.js camera whose projection is the off-axis frustum from the eye through the screen
 * rectangle (both in metres, screen frame). It overrides `updateProjectionMatrix` so that any
 * code calling it (resize handlers, renderer internals) rebuilds the correct asymmetric
 * frustum instead of Three's symmetric one. The camera's rotation is always identity: it looks
 * down −z, into the scene behind the window.
 */
export class OffAxisCamera extends PerspectiveCamera {
  private eye: Vec3 | undefined;
  private rect: ScreenRect | undefined;

  constructor(nearM: number, farM: number) {
    super();
    this.near = nearM;
    this.far = farM;
    this.eye = v3(0, 0, 0.55);
    this.rect = { left: -0.15, right: 0.15, bottom: -0.1, top: 0.1 };
    this.setEye(this.eye);
  }

  get eyeM(): Vec3 {
    return this.eye ?? v3(0, 0, 0.55);
  }

  get screenRectM(): ScreenRect {
    return this.rect ?? { left: -0.15, right: 0.15, bottom: -0.1, top: 0.1 };
  }

  setEye(eyeM: Vec3): void {
    this.eye = eyeM;
    this.position.set(eyeM.x, eyeM.y, eyeM.z);
    this.quaternion.identity();
    this.updateProjectionMatrix();
  }

  setScreen(rectM: ScreenRect): void {
    this.rect = rectM;
    this.updateProjectionMatrix();
  }

  override updateProjectionMatrix(): void {
    // Called from the PerspectiveCamera constructor before our fields exist.
    if (this.eye === undefined || this.rect === undefined) {
      super.updateProjectionMatrix();
      return;
    }
    const f = offAxisFrustum(this.eye, this.rect, this.near, this.far);
    this.projectionMatrix.makePerspective(
      f.left,
      f.right,
      f.top,
      f.bottom,
      f.near,
      f.far,
      this.coordinateSystem,
    );
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
}
