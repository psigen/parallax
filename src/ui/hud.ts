export interface HudStats {
  trackerName: string;
  tracking: boolean;
  eyeMm: { x: number; y: number; z: number };
  renderFps: number;
  sampleHz: number;
  /** Capture → sample ready on main thread. */
  trackerLatencyMs: number;
  inferenceMs: number;
  /** Capture time of the newest sample → display time of this frame (what prediction hides). */
  captureToDisplayMs: number;
  predictionLeadMs: number;
  viewportMm: { w: number; h: number };
  /** Raw browser metrics behind the viewport mapping, for diagnosing placement. */
  browser: string;
  camera: string;
  warnings: string[];
}

export class Hud {
  private readonly el: HTMLPreElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('pre');
    Object.assign(this.el.style, {
      position: 'fixed',
      left: '8px',
      top: '8px',
      margin: '0',
      padding: '6px 8px',
      background: 'rgba(0,0,0,0.55)',
      color: '#cfe',
      font: '12px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace',
      pointerEvents: 'none',
      whiteSpace: 'pre',
    } satisfies Partial<CSSStyleDeclaration>);
    parent.appendChild(this.el);
  }

  toggle(): void {
    this.el.style.display = this.el.style.display === 'none' ? 'block' : 'none';
  }

  get text(): string {
    return this.el.textContent ?? '';
  }

  update(s: HudStats): void {
    const f = (n: number, d = 0) => n.toFixed(d).padStart(6);
    const lines = [
      `tracker   ${s.trackerName}${s.tracking ? '' : '  (no face: easing to default)'}`,
      `eye mm    x${f(s.eyeMm.x)} y${f(s.eyeMm.y)} z${f(s.eyeMm.z)}`,
      `render    ${f(s.renderFps, 1)} fps     samples ${f(s.sampleHz, 1)} Hz`,
      `latency   capture→main ${f(s.trackerLatencyMs, 1)} ms   inference ${f(s.inferenceMs, 1)} ms`,
      `          capture→display ${f(s.captureToDisplayMs, 1)} ms   predicted lead ${f(s.predictionLeadMs, 1)} ms`,
      `viewport  ${f(s.viewportMm.w, 1)} x ${f(s.viewportMm.h, 1)} mm`,
      `browser   ${s.browser}`,
      `camera    ${s.camera}`,
      ...s.warnings.map((w) => `log       ${w}`),
      `keys      h hud  d debug  g tuning  m ruler  f fullscreen  c calibrate  x clear-cal  p snapshot  r reset`,
    ];
    this.el.textContent = lines.join('\n');
  }
}
