import { Box3, DirectionalLight, Group, Vector3 } from 'three';
import type { TrackedLight } from './lightAssignment';

export interface KeyLightRigParams {
  maxLights: number;
  shadows: boolean;
  shadowMapPx: number;
}

/**
 * A fixed pool of directional lights driven by tracked sources. Each light sits outside the
 * scene bounds along its source direction, aims at the bounds' centre, and (optionally) casts a
 * VSM shadow whose blur follows the source's angular size.
 */
export class KeyLightRig {
  readonly group = new Group();
  private readonly lights: DirectionalLight[] = [];
  private readonly centre = new Vector3();
  private readonly size = new Vector3();

  constructor(p: KeyLightRigParams) {
    this.group.name = 'key-lights';
    for (let i = 0; i < p.maxLights; i++) {
      const light = new DirectionalLight(0xffffff, 0);
      light.visible = false;
      light.castShadow = p.shadows;
      light.shadow.mapSize.set(p.shadowMapPx, p.shadowMapPx);
      light.shadow.bias = -0.0005;
      this.group.add(light, light.target);
      this.lights.push(light);
    }
  }

  /** Lights currently shown, for the HUD. */
  get activeCount(): number {
    return this.lights.filter((l) => l.visible).length;
  }

  update(tracked: readonly TrackedLight[], bounds: Box3): void {
    bounds.getCenter(this.centre);
    bounds.getSize(this.size);
    const radius = Math.max(0.05, this.size.length() / 2);
    const active = tracked.filter((t) => t.active).sort((a, b) => b.intensity - a.intensity);
    this.lights.forEach((light, i) => {
      const t = active[i];
      if (!t) {
        light.visible = false;
        return;
      }
      light.visible = true;
      light.intensity = t.intensity;
      light.position.set(
        this.centre.x + t.direction.x * radius * 3,
        this.centre.y + t.direction.y * radius * 3,
        this.centre.z + t.direction.z * radius * 3,
      );
      light.target.position.copy(this.centre);
      const cam = light.shadow.camera;
      cam.left = -radius * 1.2;
      cam.right = radius * 1.2;
      cam.top = radius * 1.2;
      cam.bottom = -radius * 1.2;
      cam.near = radius * 0.5;
      cam.far = radius * 6;
      cam.updateProjectionMatrix();
      // VSM blur radius in texels: a 1 deg source is crisp, a 10 deg panel is very soft.
      light.shadow.radius = Math.min(12, Math.max(1, (t.angularDiameterRad * 180) / Math.PI));
    });
  }
}
