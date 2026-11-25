import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findCamera, parseConfig } from '../src/config/load';

const defaultYaml = readFileSync(new URL('../config/default.yaml', import.meta.url), 'utf8');

describe('config/default.yaml', () => {
  it('validates against the schema', () => {
    const cfg = parseConfig(defaultYaml);
    expect(cfg.screen.width_mm).toBeCloseTo(302.4);
    expect(cfg.viewer.ipd_mm).toBe(63);
    expect(cfg.default_camera).toBe('mbp14-builtin');
    expect(findCamera(cfg, 'mbp14-builtin').capture.frame_rate).toBe(30);
    expect(findCamera(cfg, 'mx-brio').capture.frame_rate).toBe(60);
  });

  it('describes a 14.2-inch diagonal display', () => {
    const cfg = parseConfig(defaultYaml);
    const diagIn = Math.hypot(cfg.screen.width_mm, cfg.screen.height_mm) / 25.4;
    expect(diagIn).toBeCloseTo(14.2, 1);
  });

  it('rejects a default_camera that is not listed', () => {
    const bad = defaultYaml.replace('default_camera: mbp14-builtin', 'default_camera: nope');
    expect(() => parseConfig(bad)).toThrow(/default_camera/);
  });

  it('rejects far <= near', () => {
    const bad = defaultYaml.replace('far_mm: 20000', 'far_mm: 5');
    expect(() => parseConfig(bad)).toThrow(/far_mm/);
  });

  it('findCamera throws a helpful error for unknown ids', () => {
    const cfg = parseConfig(defaultYaml);
    expect(() => findCamera(cfg, 'ghost')).toThrow(/ghost.*mbp14-builtin/);
  });
});

describe('lighting config', () => {
  it('has the documented defaults', () => {
    const cfg = parseConfig(defaultYaml);
    expect(cfg.lighting.enabled).toBe(true);
    expect(cfg.lighting.environment.update_hz).toBe(10);
    expect(cfg.lighting.key_lights.max_lights).toBe(4);
    expect(cfg.lighting.key_lights.brightness.gain).toBe(150);
  });

  it('fills defaults when the section is absent', () => {
    const cfg = parseConfig(defaultYaml.slice(0, defaultYaml.indexOf('\nlighting:')));
    expect(cfg.lighting.key_lights.shadows).toBe(true);
  });
});
