/** A 100 mm square drawn in CSS pixels so the physical-size mapping can be checked with a ruler. */
export class RulerOverlay {
  private readonly el: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    Object.assign(this.el.style, {
      position: 'fixed',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%, -50%)',
      border: '2px solid #ff0',
      boxSizing: 'border-box',
      pointerEvents: 'none',
      display: 'none',
      color: '#ff0',
      padding: '4px',
      font: '12px ui-monospace, monospace',
    } satisfies Partial<CSSStyleDeclaration>);
    this.el.textContent = '100 mm square';
    parent.appendChild(this.el);
  }

  update(mmPerCssPx: number): void {
    const px = 100 / mmPerCssPx;
    this.el.style.width = `${px}px`;
    this.el.style.height = `${px}px`;
  }

  toggle(): void {
    this.el.style.display = this.el.style.display === 'none' ? 'block' : 'none';
  }
}
