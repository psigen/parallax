import defaultYaml from '../config/default.yaml?raw';
import { mmToM, parseConfig } from './config/load';
import { scaleRect } from './math/viewportRect';
import {
  fullScreenRectMm,
  readBrowserMetrics,
  rectHeight,
  rectWidth,
  viewportRectMm,
} from './math/viewportRect';
import { scale, v3 } from './math/vec';
import { App } from './render/app';
import { loadScene } from './render/sceneLoader';
import { EyeState } from './tracking/eyeState';
import { MouseTracker } from './tracking/mouseTracker';
import { StaticTracker } from './tracking/staticTracker';
import type { EyeSample, Tracker } from './tracking/types';
import { Hud } from './ui/hud';
import { RulerOverlay } from './ui/ruler';

async function main(): Promise<void> {
  const config = parseConfig(defaultYaml);
  const params = new URLSearchParams(location.search);
  const container = document.getElementById('app');
  if (!container) throw new Error('#app missing');

  const app = new App(container, mmToM(config.rendering.near_mm), mmToM(config.rendering.far_mm));
  const hud = new Hud(container);
  const ruler = new RulerOverlay(container);
  const warnings: string[] = [];

  const { root, warnings: sceneWarnings } = await loadScene(config.rendering.scene_url);
  for (const w of sceneWarnings) {
    console.warn(`[scene] ${w.code}: ${w.message}`);
    warnings.push(`${w.code}: ${w.message}`);
  }
  app.setSceneRoot(root);

  const [dx, dy, dz] = config.viewer.default_eye_mm;
  const eyeState = new EyeState(config.tracking, v3(dx, dy, dz));

  const trackerKind = params.get('tracker') ?? 'mouse';
  let tracker: Tracker;
  if (trackerKind === 'static') {
    const [sx = 0, sy = 0, sz = dz] = (params.get('eye') ?? '').split(',').map(Number);
    tracker = new StaticTracker(v3(sx, sy, sz));
  } else {
    if (trackerKind !== 'mouse')
      warnings.push(`tracker "${trackerKind}" not available yet; using mouse`);
    tracker = new MouseTracker(300, dz);
  }
  // ?viewport=full assumes the viewport covers the whole display (exact in fullscreen, and the
  // only sane choice when the browser reports bogus screen metrics, e.g. headless).
  const viewportMode = params.get('viewport') ?? 'auto';

  // Rolling stats for the HUD.
  let lastSample: EyeSample | undefined;
  let sampleCount = 0;
  let sampleHz = 0;
  let frameCount = 0;
  let renderFps = 0;
  let statsT0 = performance.now();
  let frameIntervalMs = 1000 / 60;
  let lastFrameMs = 0;

  tracker.onSample((s) => {
    lastSample = s;
    sampleCount++;
    eyeState.push(s);
  });
  await tracker.start();

  window.addEventListener('resize', () => app.resize());
  window.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'h':
        hud.toggle();
        break;
      case 'm':
        ruler.toggle();
        break;
      case 'f':
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
        break;
      case 'r':
        eyeState.setConfig(config.tracking);
        break;
      default:
        break;
    }
  });

  const frame = (tFrameMs: number): void => {
    if (lastFrameMs > 0) {
      const dt = tFrameMs - lastFrameMs;
      if (dt > 1 && dt < 100) frameIntervalMs = frameIntervalMs * 0.9 + dt * 0.1;
    }
    lastFrameMs = tFrameMs;

    const tDisplayMs = tFrameMs + frameIntervalMs;
    const eyeMm = eyeState.eyeAt(tDisplayMs);

    const override = config.screen.viewport_override_mm;
    const rectMm = override
      ? {
          left: override.left_mm,
          right: override.right_mm,
          bottom: override.bottom_mm,
          top: override.top_mm,
        }
      : viewportMode === 'full'
        ? fullScreenRectMm(config.screen)
        : viewportRectMm(readBrowserMetrics(window), config.screen);

    app.render(scale(eyeMm, 1 / 1000), scaleRect(rectMm, 1 / 1000));
    ruler.update(rectWidth(rectMm) / window.innerWidth);

    frameCount++;
    const now = performance.now();
    if (now - statsT0 >= 500) {
      const dtS = (now - statsT0) / 1000;
      renderFps = frameCount / dtS;
      sampleHz = sampleCount / dtS;
      frameCount = 0;
      sampleCount = 0;
      statsT0 = now;
    }
    const raw = eyeState.raw;
    hud.update({
      trackerName: tracker.name,
      tracking: eyeState.tracking,
      eyeMm,
      renderFps,
      sampleHz,
      trackerLatencyMs: lastSample ? lastSample.tReadyMs - lastSample.tCaptureMs : 0,
      inferenceMs: lastSample?.timings?.inferenceMs ?? 0,
      captureToDisplayMs: lastSample ? tDisplayMs - lastSample.tCaptureMs : 0,
      predictionLeadMs: raw
        ? Math.min(Math.max(tDisplayMs - raw.tS * 1000, 0), config.tracking.prediction.max_lead_ms)
        : 0,
      viewportMm: { w: rectWidth(rectMm), h: rectHeight(rectMm) },
      warnings,
    });
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

main().catch((err: unknown) => {
  console.error(err);
  const pre = document.createElement('pre');
  pre.style.color = '#f66';
  pre.style.padding = '16px';
  pre.textContent = err instanceof Error ? (err.stack ?? err.message) : String(err);
  document.body.appendChild(pre);
});
