import type { DetectedLight } from '../lighting/cameraLighting';
import type { TrackerDebugFrame } from '../tracking/mediapipeTracker';
import { LEFT_IRIS_CENTRE, RIGHT_IRIS_CENTRE, landmarkAt } from '../tracking/protocol';

/** Mirrored camera preview with iris landmarks and the numbers behind the depth estimate. */
export class DebugView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private visible = false;
  /** Detected light sources to overlay (set by the lighting orchestrator each update). */
  sources: DetectedLight[] = [];
  analysisWidth = 1;

  constructor(parent: HTMLElement, width = 320) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = Math.round((width * 9) / 16);
    Object.assign(this.canvas.style, {
      position: 'fixed',
      right: '8px',
      bottom: '8px',
      border: '1px solid #4a6',
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

  draw(f: TrackerDebugFrame): void {
    if (!this.visible) return;
    const { ctx } = this;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.save();
    // Mirror so it behaves like a mirror for the person in front of it.
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(f.video, 0, 0, w, h);
    if (f.found) {
      ctx.fillStyle = 'rgba(0,255,120,0.5)';
      for (let i = 0; i < f.landmarks.length / 3; i++) {
        const p = landmarkAt(f.landmarks, i);
        ctx.fillRect(p.x * w - 0.5, p.y * h - 0.5, 1, 1);
      }
      for (const [idx, color] of [
        [LEFT_IRIS_CENTRE, '#f0f'],
        [RIGHT_IRIS_CENTRE, '#0ff'],
      ] as const) {
        const p = landmarkAt(f.landmarks, idx);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    // Light sources: circle radius from the blob area, label with the estimated intensity.
    for (const d of this.sources) {
      const px = w / this.analysisWidth;
      const r = Math.max(3, Math.sqrt(d.source.areaPx / Math.PI) * px);
      ctx.strokeStyle = d.source.saturated ? '#ff0' : '#fa0';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(d.source.u * w, d.source.v * h, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#fd8';
      ctx.font = '10px ui-monospace, monospace';
      ctx.fillText(d.intensity.toFixed(2), d.source.u * w + r + 2, d.source.v * h + 3);
    }
    ctx.restore();
    ctx.fillStyle = f.found ? '#9f9' : '#f99';
    ctx.font = '11px ui-monospace, monospace';
    const deg = (r: number) => ((r * 180) / Math.PI).toFixed(0);
    const t = f.faceTranslationCm;
    const lines = f.found
      ? [
          `iris ${f.irisSeparationPx.toFixed(1)} px  depth ${f.depthMm.toFixed(0)} mm  yaw ${deg(f.yawRad)}°  pitch ${deg(f.pitchRad)}°  ${f.inferenceMs.toFixed(1)} ms`,
          t
            ? `mediapipe xyz ${(t.x * 10).toFixed(0)} ${(t.y * 10).toFixed(0)} ${(t.z * 10).toFixed(0)} mm (its own camera model)`
            : '',
        ]
      : [`no face  (${f.inferenceMs.toFixed(1)} ms)`];
    lines.forEach((line, i) => ctx.fillText(line, 4, h - 6 - (lines.length - 1 - i) * 13));
  }
}
