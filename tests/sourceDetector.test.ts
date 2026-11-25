import { describe, expect, it } from 'vitest';
import { luminanceFromRgba, meanLuminance, srgbToLinear } from '../src/lighting/luminanceImage';
import { detectSources, type DetectorParams } from '../src/lighting/sourceDetector';

const params: DetectorParams = { threshold: 0.8, minAreaPx: 2, maxLights: 4, mergeRadiusPx: 2 };

function image(w: number, h: number, paint: (x: number, y: number) => number) {
  const data = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data[y * w + x] = paint(x, y);
  return { width: w, height: h, data };
}

describe('luminanceFromRgba', () => {
  it('linearises sRGB and weights channels by Rec. 709', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 0, 255, 0, 255]);
    const img = luminanceFromRgba(rgba, 3, 1);
    expect(img.data[0]).toBeCloseTo(1, 5);
    expect(img.data[1]).toBeCloseTo(0, 5);
    expect(img.data[2]).toBeCloseTo(0.7152, 4);
    expect(srgbToLinear(0.5)).toBeCloseTo(0.214, 3);
    expect(meanLuminance(img)).toBeCloseTo((1 + 0.7152) / 3, 4);
  });
});

describe('detectSources', () => {
  it('finds nothing in a dark image', () => {
    expect(
      detectSources(
        image(16, 8, () => 0.2),
        params,
      ),
    ).toEqual([]);
  });

  it('finds one blob with the right centroid, area and peak', () => {
    const img = image(32, 18, (x, y) => (x >= 10 && x <= 13 && y >= 5 && y <= 6 ? 0.9 : 0.1));
    const [s, ...rest] = detectSources(img, params);
    expect(rest).toHaveLength(0);
    expect(s).toBeDefined();
    expect(s?.areaPx).toBe(8);
    expect(s?.u).toBeCloseTo((11.5 + 0.5) / 32, 6);
    expect(s?.v).toBeCloseTo((5.5 + 0.5) / 18, 6);
    expect(s?.peakLum).toBeCloseTo(0.9);
    expect(s?.saturated).toBe(false);
  });

  it('ranks two blobs by flux and flags saturation', () => {
    const img = image(32, 18, (x, y) => {
      if (x >= 2 && x <= 3 && y >= 2 && y <= 3) return 1.0; // small, clipped
      if (x >= 20 && x <= 25 && y >= 10 && y <= 14) return 0.85; // large, dim
      return 0;
    });
    const sources = detectSources(img, params);
    expect(sources).toHaveLength(2);
    expect(sources[0]?.areaPx).toBe(30);
    expect(sources[1]?.saturated).toBe(true);
  });

  it('merges blobs whose centroids are within the merge radius', () => {
    // Two 1-px-wide columns separated by one dark column: distinct components, centroids 2 px apart.
    const img = image(16, 8, (x, y) => ((x === 5 || x === 7) && y >= 2 && y <= 5 ? 0.9 : 0));
    const sources = detectSources(img, { ...params, mergeRadiusPx: 2.5 });
    expect(sources).toHaveLength(1);
    expect(sources[0]?.areaPx).toBe(8);
    expect(sources[0]?.u).toBeCloseTo((6 + 0.5) / 16, 6);
    expect(detectSources(img, { ...params, mergeRadiusPx: 1 })).toHaveLength(2);
  });

  it('drops blobs below the minimum area and caps the count', () => {
    const img = image(40, 8, (x, y) => (y === 3 && x % 4 === 0 ? 0.95 : 0));
    expect(detectSources(img, { ...params, minAreaPx: 2 })).toHaveLength(0);
    expect(
      detectSources(img, { ...params, minAreaPx: 1, maxLights: 3, mergeRadiusPx: 0 }),
    ).toHaveLength(3);
  });
});
