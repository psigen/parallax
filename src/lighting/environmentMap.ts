import {
  EquirectangularReflectionMapping,
  HalfFloatType,
  LinearFilter,
  Matrix3,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  VideoTexture,
  WebGLCubeRenderTarget,
  WebGLRenderer,
  WebGLRenderTarget,
  type Texture,
} from 'three';
import type { CameraModel } from '../math/eyeEstimator';
import { mat4FromEulerXYZ } from '../math/vec';

export interface EnvironmentMapParams {
  resolutionPx: number;
  fadeDeg: number;
}

const DEG = Math.PI / 180;

/**
 * Projects the webcam frame onto the +z hemisphere of an equirectangular map (the light that
 * enters through the window from the viewer's room), fills the rest with the frame's mean
 * colour, and prefilters it (PMREM) for image-based lighting. The direction conventions are
 * those of src/lighting/envProjection.ts, which is unit-tested; the GLSL below mirrors it.
 */
export class EnvironmentMap {
  private readonly video: VideoTexture;
  private readonly equirect: WebGLRenderTarget;
  private readonly material: ShaderMaterial;
  private readonly quadScene = new Scene();
  private readonly quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly pmrem: PMREMGenerator;
  private envTarget: WebGLCubeRenderTarget | null = null;
  lastCostMs = 0;

  constructor(
    private readonly renderer: WebGLRenderer,
    videoEl: HTMLVideoElement,
    cam: CameraModel,
    params: EnvironmentMapParams,
  ) {
    this.video = new VideoTexture(videoEl);
    this.video.colorSpace = SRGBColorSpace;
    this.video.minFilter = LinearFilter;
    this.video.generateMipmaps = false;

    const w = params.resolutionPx;
    this.equirect = new WebGLRenderTarget(w, Math.max(1, Math.round(w / 2)), {
      type: HalfFloatType,
      depthBuffer: false,
      stencilBuffer: false,
    });
    this.equirect.texture.mapping = EquirectangularReflectionMapping;

    const k = cam.intrinsics;
    const [pitch, yaw, roll] = cam.extrinsics.rotation_deg;
    const R = mat4FromEulerXYZ(pitch * DEG, yaw * DEG, roll * DEG);
    // Inverse rotation (world -> camera) = transpose; Matrix3.set takes row-major arguments.
    const rotInv = new Matrix3().set(
      R[0] ?? 1,
      R[1] ?? 0,
      R[2] ?? 0,
      R[4] ?? 0,
      R[5] ?? 1,
      R[6] ?? 0,
      R[8] ?? 0,
      R[9] ?? 0,
      R[10] ?? 1,
    );
    this.material = new ShaderMaterial({
      uniforms: {
        videoTex: { value: this.video },
        // fx, fy, cx, cy normalized by frame width/height so uv comes out in [0,1].
        k: {
          value: [
            k.fx_px / k.width_px,
            k.fy_px / k.height_px,
            k.cx_px / k.width_px,
            k.cy_px / k.height_px,
          ],
        },
        mirrorSign: { value: cam.mirrored ? 1 : -1 },
        rotInv: { value: rotInv },
        halfFov: {
          value: [Math.atan(k.width_px / 2 / k.fx_px), Math.atan(k.height_px / 2 / k.fy_px)],
        },
        fadeRad: { value: params.fadeDeg * DEG },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        precision highp float;
        uniform sampler2D videoTex;
        uniform vec4 k;
        uniform float mirrorSign;
        uniform mat3 rotInv;
        uniform vec2 halfFov;
        uniform float fadeRad;
        varying vec2 vUv;

        // Inverse of Three.js equirectUv (see envProjection.ts).
        vec3 dirFromUv(vec2 uv) {
          float theta = (uv.x - 0.5) * 6.28318530718;
          float phi = (uv.y - 0.5) * 3.14159265359;
          return vec3(cos(phi) * cos(theta), sin(phi), cos(phi) * sin(theta));
        }

        void main() {
          vec3 d = rotInv * dirFromUv(vUv);
          vec3 mean = vec3(0.0);
          for (int i = 0; i < 4; i++) {
            for (int j = 0; j < 4; j++) {
              mean += texture2D(videoTex, (vec2(float(i), float(j)) + 0.5) / 4.0).rgb;
            }
          }
          mean /= 16.0;
          if (d.z <= 0.001) {
            gl_FragColor = vec4(mean, 1.0);
            return;
          }
          // Image coordinates: x right, y down (cameraToImage in eyeEstimator.ts).
          vec2 uv = vec2(k.z + mirrorSign * k.x * d.x / d.z, k.w - k.y * d.y / d.z);
          float angX = atan(abs(d.x), d.z);
          float angY = atan(abs(d.y), d.z);
          float outside = max(0.0, max(angX - halfFov.x, angY - halfFov.y));
          // VideoTexture is flipped (v = 0 at the bottom), so sample at 1 - v.
          vec2 tex = vec2(clamp(uv.x, 0.0, 1.0), 1.0 - clamp(uv.y, 0.0, 1.0));
          vec3 edge = texture2D(videoTex, tex).rgb;
          float t = fadeRad > 0.0 ? clamp(outside / fadeRad, 0.0, 1.0) : step(0.0001, outside);
          gl_FragColor = vec4(mix(edge, mean, t), 1.0);
        }
      `,
      depthTest: false,
      depthWrite: false,
    });
    this.quadScene.add(new Mesh(new PlaneGeometry(2, 2), this.material));
    this.pmrem = new PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();
  }

  /** Re-project the current video frame and prefilter. Returns the environment texture. */
  update(): Texture {
    const t0 = performance.now();
    const prevTarget = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.equirect);
    this.renderer.render(this.quadScene, this.quadCamera);
    this.renderer.setRenderTarget(prevTarget);
    this.envTarget = this.pmrem.fromEquirectangular(this.equirect.texture, this.envTarget);
    this.lastCostMs = performance.now() - t0;
    return this.envTarget.texture;
  }

  dispose(): void {
    this.video.dispose();
    this.equirect.dispose();
    this.material.dispose();
    this.envTarget?.dispose();
    this.pmrem.dispose();
  }
}
