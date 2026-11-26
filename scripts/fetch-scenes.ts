/**
 * Downloads external scene assets listed in config/scenes.yaml into public/scenes/, verifying
 * sha256 when the manifest gives one (and printing it when it does not, so it can be filled in).
 * A missing asset is a warning; a checksum mismatch is an error.
 * Assets are never committed; the build and the Pages workflow run this first.
 *
 *   npm run fetch:scenes
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExternalUrl, localUrlFor, parseSceneManifest } from '../src/scenes/manifest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = parseSceneManifest(readFileSync(resolve(root, 'config/scenes.yaml'), 'utf8'));
const outDir = resolve(root, 'public/scenes');
mkdirSync(outDir, { recursive: true });

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

let failed = false;
for (const entry of manifest.scenes) {
  if (!isExternalUrl(entry.url)) continue;
  const target = resolve(root, 'public', localUrlFor(entry).replace(/^\//, ''));
  if (existsSync(target)) {
    const have = sha256(readFileSync(target));
    if (!entry.sha256 || have === entry.sha256) {
      console.log(`${entry.id}: present (${have.slice(0, 12)}…)`);
      continue;
    }
    console.log(`${entry.id}: checksum differs, re-downloading`);
  }
  console.log(`${entry.id}: downloading ${entry.url}`);
  const res = await fetch(entry.url, { redirect: 'follow' });
  if (!res.ok) {
    // A missing asset must not break the build: the scene just fails to load if selected.
    console.warn(`${entry.id}: HTTP ${res.status}; skipping (the scene will be unavailable)`);
    continue;
  }
  const bytes = Buffer.from(await res.arrayBuffer());
  const have = sha256(bytes);
  if (entry.sha256 && have !== entry.sha256) {
    console.error(`${entry.id}: sha256 mismatch (expected ${entry.sha256}, got ${have})`);
    failed = true;
    continue;
  }
  writeFileSync(target, bytes);
  console.log(
    `${entry.id}: ${(bytes.length / 1e6).toFixed(1)} MB → ${target}${entry.sha256 ? '' : `  (add sha256: ${have})`}`,
  );
}
process.exit(failed ? 1 : 0);
