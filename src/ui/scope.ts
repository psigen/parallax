import type { Vec3 } from '../math/vec';

interface Point {
  t: number;
  raw?: Vec3;
  rendered?: Vec3;
}

/**
 * Strip chart of the tracked eye over the last few seconds: raw samples (dots) versus the eye
 * actually rendered after filtering and prediction (line). Shows lag (line trailing the dots),
 * overshoot (line crossing ahead), jitter (dot scatter at rest) and dropouts (gaps). Key `s`.
 */
export class TrackingScope {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly points: Point[] = [];
  private visible = false;
  private readonly windowMs = 3000;

  constructor(parent: HTMLElement, width = 600, height = 180) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    Object.assign(this.canvas.style, {
      position: 'fixed',
      left: '8px',
      bottom: '8px',
      background: 'rgba(0,0,0,0.6)',
      border: '1px solid #468',
      display: 'none',
      pointerEvents: 'none',
    });
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('2d context unavailable');
    this.ctx = ctx;
    parent.appendChild(this.canvas);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.canvas.style.display = this.visible ? 'block' : 'none';
  }

  pushRaw(tMs: number, eyeMm: Vec3): void {
    this.points.push({ t: tMs, raw: eyeMm });
    this.trim(tMs);
  }

  pushRendered(tMs: number, eyeMm: Vec3): void {
    this.points.push({ t: tMs, rendered: eyeMm });
    this.trim(tMs);
  }

  /** Standard deviation (mm) of raw x over the last second: jitter at rest. */
  noiseMm(now: number): number {
    const xs = this.points.filter((p) => p.raw && now - p.t < 1000).map((p) => p.raw?.x ?? 0);
    if (xs.length < 3) return 0;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  }

  draw(now: number): void {
    if (!this.visible) return;
    const { ctx } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    const axes: ['x' | 'y' | 'z', string][] = [
      ['x', '#6cf'],
      ['y', '#fc6'],
      ['z', '#c6f'],
    ];
    const rows = axes.length;
    const rowH = h / rows;
    axes.forEach(([axis, color], i) => {
      const y0 = i * rowH;
      const raw = this.points.filter((p) => p.raw);
      const rend = this.points.filter((p) => p.rendered);
      const vals = [
        ...raw.map((p) => p.raw?.[axis] ?? 0),
        ...rend.map((p) => p.rendered?.[axis] ?? 0),
      ];
      if (vals.length === 0) return;
      const lo = Math.min(...vals);
      const hi = Math.max(...vals);
      const span = Math.max(hi - lo, axis === 'z' ? 40 : 20);
      const mid = (hi + lo) / 2;
      const sy = (v: number) => y0 + rowH / 2 - ((v - mid) / span) * (rowH - 8);
      const sx = (t: number) => w - ((now - t) / this.windowMs) * w;
      ctx.strokeStyle = '#345';
      ctx.beginPath();
      ctx.moveTo(0, y0 + rowH);
      ctx.lineTo(w, y0 + rowH);
      ctx.stroke();
      ctx.fillStyle = color;
      for (const p of raw) ctx.fillRect(sx(p.t) - 1.5, sy(p.raw?.[axis] ?? 0) - 1.5, 3, 3);
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      rend.forEach((p, k) => {
        const px = sx(p.t);
        const py = sy(p.rendered?.[axis] ?? 0);
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.font = '11px ui-monospace, monospace';
      ctx.fillText(`${axis}  span ${span.toFixed(0)} mm   dots raw, line rendered`, 4, y0 + 12);
    });
  }

  private trim(now: number): void {
    while (this.points.length > 0 && now - (this.points[0]?.t ?? now) > this.windowMs)
      this.points.shift();
  }
}
