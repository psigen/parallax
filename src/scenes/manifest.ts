/** Scene manifest (config/scenes.yaml): what can be shown behind the window and how it is placed. */
import { parse } from 'yaml';
import { z } from 'zod';

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const placementSchema = z.object({
  scale: z.number().positive().default(1),
  rotation_deg: vec3.default([0, 0, 0]),
  position_mm: vec3.default([0, 0, 0]),
});
export type Placement = z.infer<typeof placementSchema>;
export const IDENTITY_PLACEMENT: Placement = {
  scale: 1,
  rotation_deg: [0, 0, 0],
  position_mm: [0, 0, 0],
};

export const sceneKindSchema = z.enum(['gltf', 'splat']);
export type SceneKind = z.infer<typeof sceneKindSchema>;

export const sceneEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: sceneKindSchema,
  url: z.string().min(1),
  sha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
  license: z.string().optional(),
  credit: z.string().optional(),
  source_url: z.string().optional(),
  placement: placementSchema.prefault({}),
});
export type SceneEntry = z.infer<typeof sceneEntrySchema>;

export const sceneManifestSchema = z.object({ scenes: z.array(sceneEntrySchema).min(1) });
export type SceneManifest = z.infer<typeof sceneManifestSchema>;

export function parseSceneManifest(yamlText: string): SceneManifest {
  const raw: unknown = parse(yamlText);
  const m = sceneManifestSchema.parse(raw);
  const ids = m.scenes.map((s) => s.id);
  if (new Set(ids).size !== ids.length) throw new Error('scene manifest has duplicate ids');
  return m;
}

const SPLAT_EXTENSIONS = ['.spz', '.sog', '.ply', '.splat', '.ksplat'];

/** Scene kind from a URL's extension; undefined when unrecognised. */
export function kindFromUrl(url: string): SceneKind | undefined {
  const path = url.split('?')[0]?.split('#')[0]?.toLowerCase() ?? '';
  if (path.endsWith('.glb') || path.endsWith('.gltf')) return 'gltf';
  if (SPLAT_EXTENSIONS.some((e) => path.endsWith(e))) return 'splat';
  return undefined;
}

/** True for assets that `fetch-scenes` must download (anything not served from this site). */
export function isExternalUrl(url: string): boolean {
  return /^https?:\/\//i.test(url);
}

/** Where an entry is served from at runtime: external assets land in /scenes/<id>.<ext>. */
export function localUrlFor(entry: SceneEntry): string {
  if (!isExternalUrl(entry.url)) return entry.url;
  const ext = entry.url.split('?')[0]?.match(/\.[a-z0-9]+$/i)?.[0] ?? '';
  return `/scenes/${entry.id}${ext}`;
}

/**
 * Resolve a reference (manifest id, or a URL/path to a glTF or splat) to an entry. A bare URL
 * gets a synthetic entry with no credit and identity placement.
 */
export function resolveSceneRef(ref: string, manifest: SceneManifest): SceneEntry {
  const byId = manifest.scenes.find((s) => s.id === ref);
  if (byId) return byId;
  const kind = kindFromUrl(ref);
  if (!kind) {
    throw new Error(
      `unknown scene "${ref}": not a manifest id (${manifest.scenes.map((s) => s.id).join(', ')}) and no recognised extension`,
    );
  }
  return { id: ref, name: ref, kind, url: ref, placement: { ...IDENTITY_PLACEMENT } };
}
