import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDeviceIndex } from '../src/device/index';
import type { Observation } from '../src/device/observation';
import { resolveDevice } from '../src/device/resolve';

const index = parseDeviceIndex(
  readFileSync(new URL('../config/devices.yaml', import.meta.url), 'utf8'),
);

const mbp: Observation = {
  platform: 'macos',
  userAgent: 'mac',
  cssWidth: 1512,
  cssHeight: 982,
  availHeight: 945,
  dpr: 2,
  gpu: 'Apple M4 Max',
  maxTouchPoints: 0,
  cameras: [
    { label: 'MacBook Pro Camera', deviceId: '1' },
    { label: 'MX Brio', deviceId: '2' },
  ],
};
const auto = { screen: 'auto' as const, cameras: 'auto' as const, default_camera: 'auto' as const };

describe('resolveDevice', () => {
  it('resolves the MacBook Pro and its cameras from observations alone', () => {
    const r = resolveDevice(auto, mbp, index);
    expect(r.screen.width_mm).toBeCloseTo(302.4);
    expect(r.provenance.screen.source).toBe('index');
    expect(r.provenance.screen.confidence).toBe('exact');
    expect(r.cameras.map((c) => c.id)).toEqual(['apple-12mp-center-stage', 'logitech-mx-brio']);
    expect(r.defaultCamera).toBe('apple-12mp-center-stage');
    const builtin = r.cameras[0];
    expect(builtin?.extrinsics.position_mm[1]).toBeCloseTo(94.7);
    expect(builtin?.label_match).toBe('MacBook Pro Camera');
    const brio = r.cameras[1];
    expect(brio?.extrinsics.position_mm[1]).toBeCloseTo(196.4 / 2 + 15);
    expect(brio?.capture.frame_rate).toBe(60);
    expect(r.provenance.cameras['logitech-mx-brio']?.estimates.join()).toContain('mount');
  });

  it('extrapolates an unknown display and keeps going', () => {
    const r = resolveDevice(
      auto,
      {
        ...mbp,
        platform: 'windows',
        cssWidth: 1536,
        cssHeight: 864,
        dpr: 1.25,
        gpu: 'Intel Iris Xe',
        cameras: [{ label: 'Integrated Camera', deviceId: '9' }],
      },
      index,
    );
    expect(r.provenance.screen.source).toBe('extrapolated');
    expect(r.provenance.screen.confidence).toBe('guessed');
    expect(r.cameras[0]?.id).toBe('laptop-integrated-generic');
    expect(r.cameras[0]?.extrinsics.position_mm[1]).toBeCloseTo(r.screen.height_mm / 2 + 6);
    expect(r.defaultCamera).toBe('laptop-integrated-generic');
  });

  it('lets explicit config win over everything', () => {
    const r = resolveDevice(
      {
        screen: { name: 'bench', width_mm: 500, height_mm: 300 },
        cameras: [{ ref: 'logitech-mx-brio', position_mm: [0, 160, 10] }],
        default_camera: 'logitech-mx-brio',
      },
      mbp,
      index,
      { forcedScreenId: 'apple-mbp-16-m4' },
    );
    expect(r.screen.width_mm).toBe(500);
    expect(r.provenance.screen.source).toBe('config');
    expect(r.cameras).toHaveLength(1);
    expect(r.cameras[0]?.extrinsics.position_mm).toEqual([0, 160, 10]);
    expect(r.cameras[0]?.intrinsics.fx_px).toBeCloseTo(640 / Math.tan((82 * Math.PI) / 360), 3);
  });

  it('merges field overrides over a referenced entry and honours forcing', () => {
    const r = resolveDevice(
      { ...auto, screen: { ref: 'apple-mbp-16-m4', width_mm: 340 } },
      mbp,
      index,
    );
    expect(r.screen.width_mm).toBe(340);
    expect(r.screen.height_mm).toBeCloseTo(223.4);
    const f = resolveDevice(auto, mbp, index, { forcedScreenId: 'apple-studio-display' });
    expect(f.provenance.screen.source).toBe('forced');
    expect(f.screen.width_mm).toBeCloseTo(596.6);
    expect(f.cameras[0]?.extrinsics.position_mm[1]).toBeCloseTo(179.8);
  });

  it('pins the size and rejects an unknown default camera', () => {
    const r = resolveDevice(auto, mbp, index, { pinnedScreenMm: [600, 340] });
    expect(r.screen.width_mm).toBe(600);
    expect(() => resolveDevice({ ...auto, default_camera: 'nope' }, mbp, index)).toThrow(
      /default_camera/,
    );
  });

  it('gives generic cameras distinct ids and leaves default undefined when none are present', () => {
    const r = resolveDevice(
      auto,
      {
        ...mbp,
        cameras: [
          { label: 'USB Camera', deviceId: 'x' },
          { label: 'USB Camera', deviceId: 'y' },
        ],
      },
      index,
    );
    expect(r.cameras.map((c) => c.id)).toEqual(['generic-usb-camera', 'generic-usb-camera-2']);
    expect(resolveDevice(auto, { ...mbp, cameras: [] }, index).defaultCamera).toBeUndefined();
  });
});
