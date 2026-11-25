import { Box3, Scene, WebGLRenderer } from 'three';
import type { LightingConfig } from '../config/schema';
import type { CameraModel } from '../math/eyeEstimator';
import { LinearSolidAngleModel, type BrightnessModel } from './brightnessModel';
import { EnvironmentMap } from './environmentMap';
import { KeyLightRig } from './keyLightRig';
import { assignSources, type LightCandidate, type TrackedLight } from './lightAssignment';
import { luminanceFromRgba } from './luminanceImage';
import { detectSources, type LightSource } from './sourceDetector';
import { mapSource, type MappedSource } from './sourceMapping';

export type LightingMode = 'off' | 'environment' | 'full';
export const LIGHTING_MODES: LightingMode[] = ['off', 'environment', 'full'];

export interface DetectedLight {
  source: LightSource;
  mapped: MappedSource;
  intensity: number;
}

export interface LightingStats {
  mode: LightingMode;
  envMs: number;
  analysisMs: number;
  lights: number;
  strongest: TrackedLight | undefined;
}

/**
 * Orchestrates camera-based lighting: at `update_hz`, downsample the webcam frame, detect bright
 * sources, map them into the world, estimate intensities, track them across updates and drive
 * the key-light rig; on the same cadence refresh the environment map.
 */
export class CameraLighting {
  mode: LightingMode;
  readonly rig: KeyLightRig;
  lastDetected: DetectedLight[] = [];
  readonly analysisWidth: number;
  readonly analysisHeight: number;
  private readonly env: EnvironmentMap | undefined;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly brightness: BrightnessModel;
  private tracked: TrackedLight[] = [];
  private nextId = 1;
  private lastUpdateMs = -Infinity;
  private analysisMs = 0;

  constructor(
    renderer: WebGLRenderer,
    private readonly scene: Scene,
    private readonly video: HTMLVideoElement,
    private readonly cam: CameraModel,
    private readonly config: LightingConfig,
    private readonly bounds: Box3,
  ) {
    // Disabled in config: still constructed so `i` can turn it on, but starts off.
    this.mode = !config.enabled ? 'off' : config.key_lights.enabled ? 'full' : 'environment';
    const kl = config.key_lights;
    this.analysisWidth = kl.analysis_width_px;
    this.analysisHeight = Math.max(
      1,
      Math.round((kl.analysis_width_px * cam.intrinsics.height_px) / cam.intrinsics.width_px),
    );
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.analysisWidth;
    this.canvas.height = this.analysisHeight;
    const ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    this.brightness = new LinearSolidAngleModel(() => ({
      gain: this.config.key_lights.brightness.gain,
      saturationBoost: this.config.key_lights.brightness.saturation_boost,
    }));
    this.rig = new KeyLightRig({
      maxLights: kl.max_lights,
      shadows: kl.shadows,
      shadowMapPx: kl.shadow_map_px,
    });
    scene.add(this.rig.group);
    if (config.environment.enabled) {
      this.env = new EnvironmentMap(renderer, video, cam, {
        resolutionPx: config.environment.resolution_px,
        fadeDeg: config.environment.fade_deg,
      });
    }
    this.applyMode();
  }

  cycleMode(): LightingMode {
    const i = LIGHTING_MODES.indexOf(this.mode);
    this.mode = LIGHTING_MODES[(i + 1) % LIGHTING_MODES.length] ?? 'off';
    this.applyMode();
    return this.mode;
  }

  get stats(): LightingStats {
    const active = this.tracked.filter((t) => t.active).sort((a, b) => b.intensity - a.intensity);
    return {
      mode: this.mode,
      envMs: this.env?.lastCostMs ?? 0,
      analysisMs: this.analysisMs,
      lights: this.rig.activeCount,
      strongest: active[0],
    };
  }

  /** Call once per rendered frame; does work only at the configured update rate. */
  tick(nowMs: number): void {
    if (this.mode === 'off') return;
    const period = 1000 / Math.max(0.1, Math.max(this.config.environment.update_hz, 0.1));
    if (nowMs - this.lastUpdateMs < period) return;
    const dtS =
      this.lastUpdateMs === -Infinity ? period / 1000 : (nowMs - this.lastUpdateMs) / 1000;
    this.lastUpdateMs = nowMs;
    if (this.video.readyState < 2) return;

    if (this.env) {
      this.scene.environment = this.env.update();
      this.scene.environmentIntensity = this.config.environment.intensity;
    }
    if (this.mode === 'full') this.updateKeyLights(dtS);
  }

  dispose(): void {
    this.scene.remove(this.rig.group);
    this.scene.environment = null;
    this.env?.dispose();
  }

  private applyMode(): void {
    this.rig.group.visible = this.mode === 'full';
    if (this.mode === 'off') {
      this.scene.environment = null;
      this.tracked = [];
      this.lastDetected = [];
    }
    this.lastUpdateMs = -Infinity;
  }

  private updateKeyLights(dtS: number): void {
    const t0 = performance.now();
    const kl = this.config.key_lights;
    this.ctx.drawImage(this.video, 0, 0, this.analysisWidth, this.analysisHeight);
    const rgba = this.ctx.getImageData(0, 0, this.analysisWidth, this.analysisHeight).data;
    const lum = luminanceFromRgba(rgba, this.analysisWidth, this.analysisHeight);
    const sources = detectSources(lum, {
      threshold: kl.threshold,
      minAreaPx: kl.min_area_px,
      maxLights: kl.max_lights,
      mergeRadiusPx: kl.merge_radius_px,
    });
    this.lastDetected = sources.map((source) => {
      const mapped = mapSource(source, this.cam, this.analysisWidth, this.analysisHeight);
      return { source, mapped, intensity: this.brightness.intensity(source, mapped.solidAngleSr) };
    });
    const candidates: LightCandidate[] = this.lastDetected.map((d) => ({
      direction: d.mapped.directionWorld,
      intensity: d.intensity,
      angularDiameterRad: d.mapped.angularDiameterRad,
    }));
    this.tracked = assignSources(
      this.tracked,
      candidates,
      dtS,
      { maxAngleRad: 0.15, holdFrames: kl.hold_frames, smoothingHz: kl.smoothing_hz },
      () => this.nextId++,
    );
    this.rig.update(this.tracked, this.bounds);
    this.analysisMs = performance.now() - t0;
  }
}
