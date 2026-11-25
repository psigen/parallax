/** A small grayscale image of linear luminance values in [0, 1]. */
export interface LuminanceImage {
  width: number;
  height: number;
  data: Float32Array;
}

export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

const LUT = new Float32Array(256).map((_, i) => srgbToLinear(i / 255));

/** Rec. 709 luminance of 8-bit sRGB RGBA pixels, linearised. */
export function luminanceFromRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): LuminanceImage {
  const data = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = LUT[rgba[i * 4] ?? 0] ?? 0;
    const g = LUT[rgba[i * 4 + 1] ?? 0] ?? 0;
    const b = LUT[rgba[i * 4 + 2] ?? 0] ?? 0;
    data[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  return { width, height, data };
}

export function meanLuminance(img: LuminanceImage): number {
  let s = 0;
  for (const v of img.data) s += v;
  return img.data.length ? s / img.data.length : 0;
}
