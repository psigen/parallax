import type { LightSource } from './sourceDetector';

/**
 * Turns a detected source into a light intensity. A webcam auto-exposes and clips, so absolute
 * radiance is unknowable; models here are estimates with one gain knob. Intensity is in the
 * units of a Three.js DirectionalLight (irradiance, lux-like).
 */
export interface BrightnessModel {
  intensity(source: LightSource, solidAngleSr: number): number;
}

export interface LinearSolidAngleParams {
  /** Irradiance per unit (linear luminance x steradian). */
  gain: number;
  /** Multiplier for sources with clipped pixels, whose real brightness exceeds the measurement. */
  saturationBoost: number;
}

/**
 * radiance ~ gain * meanLum (x saturationBoost if clipped); irradiance = radiance * solid angle.
 * A small bright lamp and a large dim panel with the same flux give the same intensity.
 */
export class LinearSolidAngleModel implements BrightnessModel {
  /** `params` is read on every call so it can be tuned live. */
  constructor(private readonly params: () => LinearSolidAngleParams) {}

  intensity(source: LightSource, solidAngleSr: number): number {
    const p = this.params();
    const radiance = p.gain * source.meanLum * (source.saturated ? p.saturationBoost : 1);
    return Math.max(0, radiance * solidAngleSr);
  }
}
