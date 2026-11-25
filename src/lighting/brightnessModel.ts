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
  constructor(private readonly p: LinearSolidAngleParams) {}

  intensity(source: LightSource, solidAngleSr: number): number {
    const radiance = this.p.gain * source.meanLum * (source.saturated ? this.p.saturationBoost : 1);
    return Math.max(0, radiance * solidAngleSr);
  }
}
