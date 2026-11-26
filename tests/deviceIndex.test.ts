import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDeviceIndex } from '../src/device/index';

const yaml = readFileSync(new URL('../config/devices.yaml', import.meta.url), 'utf8');

describe('config/devices.yaml', () => {
  const index = parseDeviceIndex(yaml);

  it('validates and has unique ids', () => {
    const ids = [...index.screens.map((s) => s.id), ...index.cameras.map((c) => c.id)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(index.screens.length).toBeGreaterThan(5);
  });

  it('has physical sizes consistent with native resolution and ppi', () => {
    for (const s of index.screens) {
      const [w, h] = s.panel.native_px;
      expect(Math.abs((w / s.panel.ppi) * 25.4 - s.panel.width_mm)).toBeLessThan(0.5);
      expect(Math.abs((h / s.panel.ppi) * 25.4 - s.panel.height_mm)).toBeLessThan(0.5);
    }
  });

  it('has css modes that keep the panel aspect ratio', () => {
    for (const s of index.screens) {
      const aspect = s.panel.native_px[0] / s.panel.native_px[1];
      for (const [w, h] of s.css_modes) expect(Math.abs(w / h - aspect)).toBeLessThan(0.02);
    }
  });

  it('references existing cameras from built-in camera slots', () => {
    const cams = new Set(index.cameras.map((c) => c.id));
    for (const s of index.screens) {
      if (s.builtin_camera) expect(cams.has(s.builtin_camera.camera)).toBe(true);
    }
  });

  it('keeps the 14-inch MacBook Pro numbers used in earlier hand-written config', () => {
    const mbp = index.screens.find((s) => s.id === 'apple-mbp-14-m4');
    expect(mbp?.panel.width_mm).toBeCloseTo(302.4);
    expect(mbp?.panel.height_mm).toBeCloseTo(196.4);
    expect(mbp?.builtin_camera?.position_mm[1]).toBeCloseTo(94.7);
  });
});
