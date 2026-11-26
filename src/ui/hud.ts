export interface HudStats {
  trackerName: string;
  tracking: boolean;
  eyeMm: { x: number; y: number; z: number };
  eyeOffsetMm: { x: number; y: number; z: number };
  renderFps: number;
  sampleHz: number;
  /** Capture → sample ready on main thread. */
  trackerLatencyMs: number;
  inferenceMs: number;
  /** Capture time of the newest sample → display time of this frame (what prediction hides). */
  captureToDisplayMs: number;
  predictionLeadMs: number;
  viewportMm: { w: number; h: number };
  /** Std dev of raw x over the last second, mm. */
  noiseMm: number;
  /** Raw browser metrics behind the viewport mapping, for diagnosing placement. */
  browser: string;
  camera: string;
  lighting: string;
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
      `eye mm    x${f(s.eyeMm.x)} y${f(s.eyeMm.y)} z${f(s.eyeMm.z)}   offset ${f(s.eyeOffsetMm.x, 1)} ${f(s.eyeOffsetMm.y, 1)} ${f(s.eyeOffsetMm.z, 1)}`,
      `render    ${f(s.renderFps, 1)} fps     samples ${f(s.sampleHz, 1)} Hz     jitter σ ${f(s.noiseMm, 2)} mm`,
      `latency   capture→main ${f(s.trackerLatencyMs, 1)} ms   inference ${f(s.inferenceMs, 1)} ms`,
      `          capture→display ${f(s.captureToDisplayMs, 1)} ms   predicted lead ${f(s.predictionLeadMs, 1)} ms`,
      `viewport  ${f(s.viewportMm.w, 1)} x ${f(s.viewportMm.h, 1)} mm`,
      `browser   ${s.browser}`,
      `camera    ${s.camera}`,
      `lighting  ${s.lighting}`,
      ...s.warnings.map((w) => `log       ${w}`),
      `keys      h hud  d debug  s scope  g glass  l lighting  t tuning  r ruler  p snapshot  c calibrate  C clear-cal  o zero-y  O clear-offset  arrows/[ ] nudge  f freeze  F fullscreen  R reset-filter`,
    ];
    this.el.textContent = lines.join('\n');
  }
}
