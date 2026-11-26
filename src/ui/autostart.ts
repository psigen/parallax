/**
 * One-shot flag so a scene switch (which reloads the page with ?scene=) resumes tracking
 * directly instead of showing the landing dialog again.
 */
const KEY = 'parallax.autostart';

export function markAutostart(): void {
  try {
    sessionStorage.setItem(KEY, '1');
  } catch {
    /* ignore: private mode */
  }
}

/** Returns true once after `markAutostart`, then clears the flag. */
export function consumeAutostart(): boolean {
  try {
    const set = sessionStorage.getItem(KEY) === '1';
    sessionStorage.removeItem(KEY);
    return set;
  } catch {
    return false;
  }
}

/** Reload with a different scene, resuming without the dialog. */
export function switchScene(sceneId: string): void {
  markAutostart();
  const url = new URL(location.href);
  url.searchParams.set('scene', sceneId);
  location.assign(url.toString());
}
