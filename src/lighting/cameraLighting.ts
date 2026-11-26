import { Box3, Scene, WebGLRenderer } from 'three';
import type { LightingConfig } from '../config/schema';
import type { CameraModel } from '../math/eyeEstimator';
import type { LightingAnalysisSource } from '../tracking/mediapipeTracker';
import type { LightingAnalysisParams, LightingAnalysisResult } from '../tracking/protocol';
import { LinearSolidAngleModel, type BrightnessModel } from './brightnessModel';
import { EnvironmentMap } from './environmentMap';
import { KeyLightRig } from './keyLightRig';
import { assignSources, type LightCandidate, type TrackedLight } from './lightAssignment';
import type { LightSource } from './sourceDetector';
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
 * Orchestrates camera-based lighting. Bright-source detection runs in the tracking worker on the
 * frames it already has (see faceLandmarker.worker.ts); this class receives the sources, maps
 * them into the world, estimates intensities, tracks them across updates and drives the key-light
 * rig. On its own cadence it refreshes the environment map (which must live in the renderer's
 * GL context, so it stays on the main thread).
 */
export class CameraLighting {
  mode: LightingMode;
  readonly rig: KeyLightRig;
  lastDetected: DetectedLight[] = [];
  /** Analysis image size the latest sources were detected at (for the debug overlay). */
  analysisWidth = 1;
  analysisHeight = 1;
  private readonly env: EnvironmentMap | undefined;
  private readonly brightness: BrightnessModel;
  private tracked: TrackedLight[] = [];
  private nextId = 1;
  private lastEnvMs = -Infinity;
  private lastSourcesMs = -Infinity;
  private analysisMs = 0;

  constructor(
    renderer: WebGLRenderer,
    private readonly scene: Scene,
    video: HTMLVideoElement,
    private readonly cam: CameraModel,
    private readonly config: LightingConfig,
    private readonly bounds: Box3,
    private readonly analysis: LightingAnalysisSource,
  ) {
    // Disabled in config: still constructed so `l` can turn it on, but starts off.
    this.mode = !config.enabled ? 'off' : config.key_lights.enabled ? 'full' : 'environment';
    const kl = config.key_lights;
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
    analysis.onLighting((r) => this.onSources(r));
    this.applyMode();
  }

  cycleMode(): LightingMode {
    const i = LIGHTING_MODES.indexOf(this.mode);
    this.setMode(LIGHTING_MODES[(i + 1) % LIGHTING_MODES.length] ?? 'off');
    return this.mode;
  }

  setMode(mode: LightingMode): void {
    this.mode = mode;
    this.applyMode();
  }

  /** Push the current detection parameters to the worker (call after live tuning). */
  syncParams(): void {
    this.analysis.setLightingAnalysis(this.mode === 'full' ? this.analysisParams() : null);
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

  /** Call once per rendered frame; refreshes the environment map at its configured rate. */
  tick(nowMs: number): void {
    if (this.mode === 'off' || !this.env) return;
    if (nowMs - this.lastEnvMs < 1000 / Math.max(0.1, this.config.environment.update_hz)) return;
    this.lastEnvMs = nowMs;
    this.scene.environment = this.env.update();
    this.scene.environmentIntensity = this.config.environment.intensity;
  }

  dispose(): void {
    this.analysis.setLightingAnalysis(null);
    this.scene.remove(this.rig.group);
    this.scene.environment = null;
    this.env?.dispose();
  }

  private analysisParams(): LightingAnalysisParams {
    const kl = this.config.key_lights;
    return {
      analysisWidthPx: kl.analysis_width_px,
      threshold: kl.threshold,
      minAreaPx: kl.min_area_px,
      maxLights: kl.max_lights,
      mergeRadiusPx: kl.merge_radius_px,
      updateHz: this.config.environment.update_hz,
    };
  }

  private applyMode(): void {
    this.rig.group.visible = this.mode === 'full';
    if (this.mode === 'off') this.scene.environment = null;
    if (this.mode !== 'full') {
      this.tracked = [];
      this.lastDetected = [];
      this.rig.update([], this.bounds);
    }
    this.lastEnvMs = -Infinity;
    this.lastSourcesMs = -Infinity;
    this.syncParams();
  }

  private onSources(r: LightingAnalysisResult): void {
    if (this.mode !== 'full') return;
    const kl = this.config.key_lights;
    const dtS =
      this.lastSourcesMs === -Infinity
        ? 1 / this.config.environment.update_hz
        : (r.tCaptureMs - this.lastSourcesMs) / 1000;
    this.lastSourcesMs = r.tCaptureMs;
    this.analysisMs = r.analysisMs;
    this.analysisWidth = r.width;
    this.analysisHeight = r.height;
    this.lastDetected = r.sources.map((source) => {
      const mapped = mapSource(source, this.cam, r.width, r.height);
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
      Math.max(dtS, 0),
      { maxAngleRad: 0.15, holdFrames: kl.hold_frames, smoothingHz: kl.smoothing_hz },
      () => this.nextId++,
    );
    this.rig.update(this.tracked, this.bounds);
  }
}
