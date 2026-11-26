import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isExternalUrl,
  kindFromUrl,
  localUrlFor,
  parseSceneManifest,
  resolveSceneRef,
} from '../src/scenes/manifest';
import { placementMatrix, placementYaml } from '../src/scenes/placement';
import { Vector3 } from 'three';

const manifest = parseSceneManifest(
  readFileSync(new URL('../config/scenes.yaml', import.meta.url), 'utf8'),
);

describe('config/scenes.yaml', () => {
  it('validates, has unique ids and a bundled room', () => {
    expect(manifest.scenes.find((s) => s.id === 'room')?.kind).toBe('gltf');
    expect(manifest.scenes.find((s) => s.id === 'racoon')?.kind).toBe('splat');
  });

  it('rejects duplicate ids', () => {
    expect(() =>
      parseSceneManifest(
        'scenes:\n  - {id: a, name: a, kind: gltf, url: /a.glb}\n  - {id: a, name: b, kind: gltf, url: /b.glb}\n',
      ),
    ).toThrow(/duplicate/);
  });
});

describe('scene references', () => {
  it('maps extensions to kinds', () => {
    expect(kindFromUrl('/scenes/room.glb')).toBe('gltf');
    expect(kindFromUrl('https://x/y.GLTF?v=1')).toBe('gltf');
    for (const e of ['spz', 'sog', 'ply', 'splat', 'ksplat'])
      expect(kindFromUrl(`/a/b.${e}`)).toBe('splat');
    expect(kindFromUrl('/a/b.txt')).toBeUndefined();
  });

  it('resolves ids, bare URLs, and rejects nonsense', () => {
    expect(resolveSceneRef('racoon', manifest).url).toContain('racoonfamily.spz');
    const bare = resolveSceneRef('/custom/thing.spz', manifest);
    expect(bare.kind).toBe('splat');
    expect(bare.placement.scale).toBe(1);
    expect(bare.credit).toBeUndefined();
    expect(() => resolveSceneRef('nope', manifest)).toThrow(/unknown scene/);
  });

  it('serves external assets from /scenes/<id>.<ext>', () => {
    const racoon = resolveSceneRef('racoon', manifest);
    expect(isExternalUrl(racoon.url)).toBe(true);
    expect(localUrlFor(racoon)).toBe('/scenes/racoon.spz');
    expect(localUrlFor(resolveSceneRef('room', manifest))).toBe('/scenes/room.glb');
  });
});

describe('placement', () => {
  it('scales, rotates and translates (mm → m)', () => {
    const m = placementMatrix({
      scale: 1 / 6,
      rotation_deg: [0, 0, 0],
      position_mm: [0, -100, -250],
    });
    // A point 3 m deep in the authored scene lands 0.5 m behind the placement origin.
    const p = new Vector3(0, 0, -3).applyMatrix4(m);
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(-0.1, 9);
    expect(p.z).toBeCloseTo(-0.25 - 0.5, 9);
  });

  it('applies yaw about +y', () => {
    const m = placementMatrix({ scale: 1, rotation_deg: [0, 90, 0], position_mm: [0, 0, 0] });
    const p = new Vector3(0, 0, -1).applyMatrix4(m);
    expect(p.x).toBeCloseTo(-1, 9);
    expect(p.z).toBeCloseTo(0, 9);
  });

  it('prints a YAML line', () => {
    expect(
      placementYaml({
        scale: 0.16667,
        rotation_deg: [0, 90.04, 0],
        position_mm: [0, -100.4, -250],
      }),
    ).toBe('placement: { scale: 0.1667, rotation_deg: [0, 90, 0], position_mm: [0, -100, -250] }');
  });
});
