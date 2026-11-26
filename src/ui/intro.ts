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
      'This page turns your screen into a window onto a 3D scene. With your permission, the ' +
      'webcam tracks the position of your eyes, and the scene is rendered with the exact ' +
      'perspective for that position. Move your head and the view through the window changes ' +
      'as it would through real glass. For the clearest effect, close one eye and sit about an ' +
      "arm's length away.";
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
      display: 'block',
      width: '100%',
      marginTop: '22px',
      padding: '12px 22px',
      background: '#4f8cff',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      font: '600 15px inherit',
      cursor: 'pointer',
    } satisfies Partial<CSSStyleDeclaration>);
    row.append(label, select);

    const hint = document.createElement('p');
    hint.innerHTML =
      'Choose a scene and press Start; the browser will ask for camera access. Press <kbd>h</kbd> ' +
      'for the diagnostics HUD and <kbd>F</kbd> for fullscreen. The menu in the top-right corner ' +
      'switches scenes later.';
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

    // Privacy note and modal: the camera frames never leave the browser.
    const privacy = document.createElement('p');
    Object.assign(privacy.style, {
      margin: '14px 0 0',
      fontSize: '12px',
      color: '#8f9ab2',
      textAlign: 'center',
    });
    const privacyLink = document.createElement('a');
    privacyLink.href = '#privacy';
    privacyLink.textContent = 'Privacy: the camera feed stays on your device';
    Object.assign(privacyLink.style, {
      color: '#aeb8cc',
      textDecoration: 'underline',
      cursor: 'pointer',
    });
    privacyLink.addEventListener('click', (e) => {
      e.preventDefault();
      this.openPrivacy();
    });
    privacy.appendChild(privacyLink);

    card.append(h1, p, row, hint, button, privacy);
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

  /** A small modal spelling out what happens with the camera feed. */
  private openPrivacy(): void {
    const scrim = document.createElement('div');
    Object.assign(scrim.style, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(0,0,0,0.55)',
      zIndex: '30',
      font: 'inherit',
    } satisfies Partial<CSSStyleDeclaration>);
    const box = document.createElement('div');
    Object.assign(box.style, {
      maxWidth: '460px',
      margin: '16px',
      padding: '24px 28px',
      background: '#101522',
      border: '1px solid rgba(255,255,255,0.14)',
      borderRadius: '12px',
      color: '#e6ebf5',
    } satisfies Partial<CSSStyleDeclaration>);
    const title = document.createElement('h2');
    title.textContent = 'Your camera, your computer';
    Object.assign(title.style, { margin: '0 0 12px', font: '500 20px/1.2 inherit' });
    const body = document.createElement('div');
    body.innerHTML = `
      <p style="margin:0 0 10px">The webcam video is processed entirely inside this browser tab, by a face-tracking
      model running on your own machine. No frame is ever stored, uploaded, or shared, and the page
      makes no network request that carries camera data. Close the tab and it's gone.</p>
      <p style="margin:0 0 10px">The only things kept are a few calibration numbers (your display, your camera's focal
      length, an eye-position offset) in this browser's local storage, so you don't have to redo them next
      time. They contain no images and never leave your browser either.</p>
      <p style="margin:0">Loading the page fetches the app, a font, and the 3D scenes from the web host, like any
      website. That's all.</p>`;
    const ok = document.createElement('button');
    ok.textContent = 'Got it';
    Object.assign(ok.style, {
      display: 'block',
      width: '100%',
      marginTop: '18px',
      padding: '10px',
      background: '#2d3650',
      color: '#fff',
      border: 'none',
      borderRadius: '8px',
      font: '500 14px inherit',
      cursor: 'pointer',
    } satisfies Partial<CSSStyleDeclaration>);
    const close = () => scrim.remove();
    ok.addEventListener('click', close);
    scrim.addEventListener('click', (e) => {
      if (e.target === scrim) close();
    });
    scrim.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      e.stopPropagation();
    });
    box.append(title, body, ok);
    scrim.appendChild(box);
    this.el.appendChild(scrim);
    ok.focus();
  }

  close(): void {
    this.el.remove();
  }
}
