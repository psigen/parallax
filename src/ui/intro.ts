import type { SceneManifest } from '../scenes/manifest';

export interface IntroOptions {
  manifest: SceneManifest;
  currentSceneId: string;
  /** Called with the chosen scene id when Start is pressed. */
  onStart: (sceneId: string) => void;
}

/**
 * The landing dialog: a short explanation, a scene picker and a Start button, over a blurred
 * view of the scene already rendering behind it. The camera is only requested after Start
 * (a user gesture), which is the polite way to ask for a webcam.
 */
export class IntroOverlay {
  private readonly el: HTMLDivElement;

  constructor(parent: HTMLElement, opts: IntroOptions) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(5, 7, 10, 0.45)',
      backdropFilter: 'blur(14px) saturate(1.1)',
      WebkitBackdropFilter: 'blur(14px) saturate(1.1)',
      zIndex: '20',
      font: '400 15px/1.55 var(--font-ui)',
      color: '#eef',
    } satisfies Partial<CSSStyleDeclaration & { WebkitBackdropFilter: string }>);

    const card = document.createElement('div');
    Object.assign(card.style, {
      maxWidth: '520px',
      margin: '16px',
      padding: '28px 32px',
      background: 'rgba(12, 16, 24, 0.82)',
      border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '14px',
      boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
    } satisfies Partial<CSSStyleDeclaration>);

    const h1 = document.createElement('h1');
    h1.textContent = 'Parallax Window';
    Object.assign(h1.style, {
      margin: '0 0 14px',
      font: '500 26px/1.2 inherit',
      letterSpacing: '0.3px',
      textAlign: 'center',
    });

    const p = document.createElement('p');
    p.innerHTML =
      'Hi! This is a little experiment in making your screen feel like a window. If you let it use ' +
      'your webcam, it keeps an eye on where you are and redraws the scene from your point of view, so ' +
      'when you lean or move your head, the room behind the glass shifts the way a real one would. ' +
      "It's easiest to see with one eye closed and from about an arm's length away. Everything stays " +
      'on your computer; the video never goes anywhere.';
    Object.assign(p.style, { margin: '0 0 20px', color: '#d6dcea' });

    const row = document.createElement('div');
    Object.assign(row.style, {
      display: 'flex',
      gap: '10px',
      alignItems: 'center',
      flexWrap: 'wrap',
    });

    const label = document.createElement('label');
    label.textContent = 'Scene';
    Object.assign(label.style, { color: '#9aa5bd' });
    const select = document.createElement('select');
    Object.assign(select.style, {
      flex: '1 1 200px',
      padding: '8px 10px',
      background: '#161c28',
      color: '#eef',
      border: '1px solid #3a4458',
      borderRadius: '8px',
      font: 'inherit',
    } satisfies Partial<CSSStyleDeclaration>);
    for (const s of opts.manifest.scenes) {
      const o = document.createElement('option');
      o.value = s.id;
      o.textContent = s.name;
      o.selected = s.id === opts.currentSceneId;
      select.appendChild(o);
    }
    const button = document.createElement('button');
    button.textContent = 'Start';
    Object.assign(button.style, {
      padding: '9px 22px',
      background: '#4f8cff',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      font: '600 15px inherit',
      cursor: 'pointer',
    } satisfies Partial<CSSStyleDeclaration>);
    row.append(label, select, button);

    const hint = document.createElement('p');
    hint.innerHTML =
      "Pick a scene and press Start; your browser will ask about the camera. If you're curious what's " +
      'going on under the hood, <kbd>h</kbd> shows the numbers and <kbd>F</kbd> goes fullscreen. You ' +
      'can change scenes any time from the menu in the top-right corner.';
    Object.assign(hint.style, { margin: '16px 0 0', fontSize: '13px', color: '#9aa5bd' });
    for (const kbd of hint.querySelectorAll('kbd')) {
      Object.assign(kbd.style, {
        padding: '1px 5px',
        border: '1px solid #4a5468',
        borderRadius: '4px',
        font: '12px ui-monospace, monospace',
        color: '#eef',
      });
    }

    card.append(h1, p, row, hint);
    this.el.appendChild(card);
    parent.appendChild(this.el);

    const start = () => {
      opts.onStart(select.value);
    };
    button.addEventListener('click', start);
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') start();
    });
    button.focus();
  }

  close(): void {
    this.el.remove();
  }
}
