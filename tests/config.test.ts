import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findCamera, parseConfig } from '../src/config/load';
import { parseDeviceIndex } from '../src/device/index';
import type { Observation } from '../src/device/observation';
import { resolveDevice } from '../src/device/resolve';

const defaultYaml = readFileSync(new URL('../config/default.yaml', import.meta.url), 'utf8');
const index = parseDeviceIndex(
  readFileSync(new URL('../config/devices.yaml', import.meta.url), 'utf8'),
);

const mbpObs: Observation = {
  platform: 'macos',
  userAgent: 'mac',
  cssWidth: 1512,
  cssHeight: 982,
  availHeight: 945,
  dpr: 2,
  gpu: 'Apple M4 Max',
  maxTouchPoints: 0,
  cameras: [{ label: 'MacBook Pro Camera', deviceId: '1' }],
};

describe('config/default.yaml', () => {
  it('validates and names no device (everything auto)', () => {
    const cfg = parseConfig(defaultYaml);
    expect(cfg.device).toEqual({ screen: 'auto', cameras: 'auto', default_camera: 'auto' });
    expect(cfg.viewer.ipd_mm).toBe(63);
    expect(defaultYaml).not.toMatch(/302\.4|mbp14|MX Brio/);
  });

  it('resolves to the 14-inch MacBook Pro on that machine', () => {
    const cfg = parseConfig(defaultYaml);
    const d = resolveDevice(cfg.device, mbpObs, index);
    expect(d.screen.width_mm).toBeCloseTo(302.4);
    expect(d.screen.height_mm).toBeCloseTo(196.4);
    expect(findCamera(d.cameras, d.defaultCamera ?? '').extrinsics.position_mm[1]).toBeCloseTo(
      94.7,
    );
  });

  it('accepts an index reference with overrides and explicit cameras', () => {
    const yaml = defaultYaml
      .replace('screen: auto', 'screen: { ref: apple-mbp-16-m4, name: bench }')
      .replace('cameras: auto', 'cameras: [{ ref: logitech-mx-brio, position_mm: [0, 160, 10] }]')
      .replace('default_camera: auto', 'default_camera: logitech-mx-brio');
    const d = resolveDevice(parseConfig(yaml).device, mbpObs, index);
    expect(d.screen.name).toBe('bench');
    expect(d.screen.width_mm).toBeCloseTo(345.6);
    expect(d.cameras.map((c) => c.id)).toEqual(['logitech-mx-brio']);
    expect(d.defaultCamera).toBe('logitech-mx-brio');
  });

  it('rejects far <= near', () => {
    const bad = defaultYaml.replace('far_mm: 20000', 'far_mm: 5');
    expect(() => parseConfig(bad)).toThrow(/far_mm/);
  });

  it('findCamera throws a helpful error for unknown ids', () => {
    expect(() => findCamera([], 'ghost')).toThrow(/ghost.*none/);
  });
});

describe('lighting config', () => {
  it('has the documented defaults', () => {
    const cfg = parseConfig(defaultYaml);
    expect(cfg.lighting.enabled).toBe(false);
    expect(cfg.lighting.environment.update_hz).toBe(10);
    expect(cfg.lighting.key_lights.max_lights).toBe(4);
    expect(cfg.lighting.key_lights.brightness.gain).toBe(150);
  });

  it('fills defaults when the section is absent', () => {
    const cfg = parseConfig(defaultYaml.slice(0, defaultYaml.indexOf('\nlighting:')));
    expect(cfg.lighting.key_lights.shadows).toBe(true);
  });
});
