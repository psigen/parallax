import type { SceneManifest } from '../scenes/manifest';
import { switchScene } from './autostart';

/**
 * A small always-visible dropdown (top-right) to switch scenes. Switching reloads the page with
 * `?scene=<id>` so renderer settings that depend on the scene kind (MSAA, pixel ratio, Spark)
 * are applied cleanly; other URL parameters are preserved.
 */
export class ScenePicker {
  private readonly select: HTMLSelectElement;

  constructor(parent: HTMLElement, manifest: SceneManifest, current: string) {
    this.select = document.createElement('select');
    Object.assign(this.select.style, {
      position: 'fixed',
      right: '8px',
      top: '8px',
      padding: '3px 6px',
      background: 'rgba(0,0,0,0.6)',
      color: '#ddd',
      border: '1px solid #555',
      borderRadius: '4px',
      font: '12px var(--font-ui)',
      zIndex: '10',
    } satisfies Partial<CSSStyleDeclaration>);
    const options = [
      ...manifest.scenes.map((s) => ({ id: s.id, label: s.name })),
      { id: 'reference', label: 'Reference posts (diagnostic)' },
    ];
    if (!options.some((o) => o.id === current)) options.unshift({ id: current, label: current });
    for (const o of options) {
      const el = document.createElement('option');
      el.value = o.id;
      el.textContent = o.label;
      el.selected = o.id === current;
      this.select.appendChild(el);
    }
    this.select.title = 'Scene';
    this.select.addEventListener('change', () => switchScene(this.select.value));
    parent.appendChild(this.select);
  }
}
