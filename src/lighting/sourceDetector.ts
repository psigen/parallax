import type { LuminanceImage } from './luminanceImage';

export interface DetectorParams {
  /** Linear luminance a pixel must exceed to belong to a source. */
  threshold: number;
  minAreaPx: number;
  maxLights: number;
  /** Blobs whose centroids are closer than this (px) are merged. */
  mergeRadiusPx: number;
}

export interface LightSource {
  /** Centroid, normalized image coordinates (x right, y down). */
  u: number;
  v: number;
  areaPx: number;
  meanLum: number;
  peakLum: number;
  /** Any pixel at or near clipping: the true brightness is unknown and higher. */
  saturated: boolean;
  /** meanLum * areaPx: proxy for the light's flux, used for ranking. */
  flux: number;
}

const SATURATION = 0.98;

interface Blob {
  sumX: number;
  sumY: number;
  sumLum: number;
  area: number;
  peak: number;
}

/**
 * Finds bright peaks: threshold, 4-connected components, centroid/area/luminance per
 * component, merge near-coincident blobs, rank by flux, keep the strongest `maxLights`.
 */
export function detectSources(img: LuminanceImage, p: DetectorParams): LightSource[] {
  const { width: w, height: h, data } = img;
  const visited = new Uint8Array(w * h);
  const blobs: Blob[] = [];
  const stack: number[] = [];

  for (let start = 0; start < w * h; start++) {
    if (visited[start] || (data[start] ?? 0) <= p.threshold) continue;
    const blob: Blob = { sumX: 0, sumY: 0, sumLum: 0, area: 0, peak: 0 };
    stack.push(start);
    visited[start] = 1;
    while (stack.length > 0) {
      const i = stack.pop()!;
      const lum = data[i] ?? 0;
      const x = i % w;
      const y = (i - x) / w;
      blob.sumX += x * lum;
      blob.sumY += y * lum;
      blob.sumLum += lum;
      blob.area++;
      if (lum > blob.peak) blob.peak = lum;
      const neighbours = [
        x > 0 ? i - 1 : -1,
        x < w - 1 ? i + 1 : -1,
        y > 0 ? i - w : -1,
        y < h - 1 ? i + w : -1,
      ];
      for (const n of neighbours) {
        if (n >= 0 && !visited[n] && (data[n] ?? 0) > p.threshold) {
          visited[n] = 1;
          stack.push(n);
        }
      }
    }
    if (blob.area >= p.minAreaPx) blobs.push(blob);
  }

  // Merge blobs whose (luminance-weighted) centroids are within mergeRadiusPx.
  const merged: Blob[] = [];
  for (const b of blobs) {
    const bx = b.sumX / b.sumLum;
    const by = b.sumY / b.sumLum;
    const target = merged.find(
      (m) => Math.hypot(m.sumX / m.sumLum - bx, m.sumY / m.sumLum - by) <= p.mergeRadiusPx,
    );
    if (target) {
      target.sumX += b.sumX;
      target.sumY += b.sumY;
      target.sumLum += b.sumLum;
      target.area += b.area;
      target.peak = Math.max(target.peak, b.peak);
    } else {
      merged.push({ ...b });
    }
  }

  return merged
    .map((b): LightSource => {
      const meanLum = b.sumLum / b.area;
      return {
        // +0.5 puts the centroid at pixel centres.
        u: (b.sumX / b.sumLum + 0.5) / w,
        v: (b.sumY / b.sumLum + 0.5) / h,
        areaPx: b.area,
        meanLum,
        peakLum: b.peak,
        saturated: b.peak >= SATURATION,
        flux: meanLum * b.area,
      };
    })
    .sort((a, b) => b.flux - a.flux)
    .slice(0, p.maxLights);
}
