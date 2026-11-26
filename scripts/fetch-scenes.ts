/**
 * Downloads external scene assets listed in config/scenes.yaml into public/scenes/, verifying
 * sha256 when the manifest gives one (and printing it when it does not, so it can be filled in).
 * A missing asset is a warning; a checksum mismatch is an error.
 * Assets are never committed; the build and the Pages workflow run this first.
 *
 *   npm run fetch:scenes
 */
import { execSync } from 'node:child_process';
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

/** A GitHub token for private release assets: GITHUB_TOKEN (CI) or the local `gh` login. */
function githubToken(): string | undefined {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    return (
      execSync('gh auth token', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() || undefined
    );
  } catch {
    return undefined;
  }
}

const RELEASE_URL =
  /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/([^/?#]+)$/;

/** "owner/repo" of this repository: GITHUB_REPOSITORY in Actions, else the git origin remote. */
function thisRepository(): string | undefined {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY.toLowerCase();
  try {
    const remote = execSync('git remote get-url origin', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    const m = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
    return m ? `${m[1]}/${m[2]}`.toLowerCase() : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Download a URL. Release assets of THIS repository go through the GitHub API with a token
 * (the same path works whether the repository is public or private: GITHUB_TOKEN in CI, the
 * `gh` login locally). Every other URL, including other GitHub repositories, is fetched directly.
 */
async function download(url: string): Promise<Response> {
  const m = RELEASE_URL.exec(url);
  const ours = m && `${m[1]}/${m[2]}`.toLowerCase() === thisRepository();
  if (!m || !ours) return fetch(url, { redirect: 'follow' });
  const [, owner, repo, tag, name] = m;
  const token = githubToken();
  if (!token)
    throw new Error(`no GitHub token for ${url}: set GITHUB_TOKEN or run \`gh auth login\``);
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  const rel = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/tags/${tag}`, {
    headers,
  });
  if (!rel.ok) throw new Error(`release ${owner}/${repo}@${tag}: HTTP ${rel.status}`);
  const assets = ((await rel.json()) as { assets: { name: string; url: string }[] }).assets;
  const asset = assets.find((a) => a.name === name);
  if (!asset)
    throw new Error(
      `release ${tag} has no asset named ${name} (have: ${assets.map((a) => a.name).join(', ') || 'none'})`,
    );
  // The asset endpoint redirects to a signed URL; follow it without the auth header.
  const first = await fetch(asset.url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/octet-stream' },
    redirect: 'manual',
  });
  if (first.ok) return first;
  const location = first.headers.get('location');
  if (!location) throw new Error(`asset ${name}: HTTP ${first.status} and no redirect`);
  return fetch(location, { redirect: 'follow' });
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
  let res: Response;
  try {
    res = await download(entry.url);
  } catch (err) {
    // A missing asset must not break the build: the scene just fails to load if selected.
    console.warn(
      `${entry.id}: ${err instanceof Error ? err.message : String(err)}; skipping (the scene will be unavailable)`,
    );
    continue;
  }
  if (!res.ok) {
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
