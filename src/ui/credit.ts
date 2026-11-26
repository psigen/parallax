/** Attribution line for scenes whose licence requires credit (CC BY). Independent of the HUD. */
export class CreditOverlay {
  private readonly el: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed',
      left: '8px',
      bottom: '8px',
      padding: '3px 6px',
      background: 'rgba(0,0,0,0.5)',
      color: '#ddd',
      font: '11px/1.3 ui-sans-serif, system-ui, sans-serif',
      pointerEvents: 'auto',
      display: 'none',
      maxWidth: '60vw',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(this.el);
  }

  set(credit: string | undefined, sourceUrl?: string): void {
    this.el.replaceChildren();
    if (!credit) {
      this.el.style.display = 'none';
      return;
    }
    if (sourceUrl) {
      const a = document.createElement('a');
      a.href = sourceUrl;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = credit;
      a.style.color = '#ddd';
      this.el.appendChild(a);
    } else {
      this.el.textContent = credit;
    }
    this.el.style.display = 'block';
  }
}
