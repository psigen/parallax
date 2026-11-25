import defaultYaml from '../config/default.yaml?raw';
import { findCamera, mmToM, parseConfig } from './config/load';
import {
  fullScreenRectMm,
  readBrowserMetrics,
  rectHeight,
  rectWidth,
  scaleRect,
  viewportRectMm,
} from './math/viewportRect';
import { scale, v3 } from './math/vec';
import { App } from './render/app';
import { loadScene } from './render/sceneLoader';
import { EyeState } from './tracking/eyeState';
import { MediapipeTracker } from './tracking/mediapipeTracker';
import { MouseTracker } from './tracking/mouseTracker';
import { StaticTracker } from './tracking/staticTracker';
import type { EyeSample, Tracker } from './tracking/types';
import { irisCentres } from './tracking/protocol';
import { DebugView } from './ui/debugView';
import { Hud } from './ui/hud';
import { RulerOverlay } from './ui/ruler';
import { TuningPanel } from './ui/tuning';

const WASM_PATH = '/mediapipe/wasm';
const MODEL_PATH = '/models/face_landmarker.task';
const focalKey = (cameraId: string) => `parallax.focal_px.${cameraId}`;

function readFocalOverride(cameraId: string): number | undefined {
  try {
    const v = localStorage.getItem(focalKey(cameraId));
    return v ? Number(v) : undefined;
  } catch {
    return undefined;
  }
}

async function main(): Promise<void> {
  const config = parseConfig(defaultYaml);
  const params = new URLSearchParams(location.search);
  const container = document.getElementById('app');
  if (!container) throw new Error('#app missing');

  const app = new App(container, mmToM(config.rendering.near_mm), mmToM(config.rendering.far_mm));
  const hud = new Hud(container);
  const ruler = new RulerOverlay(container);
  const debugView = new DebugView(container);
  // Recent log lines are mirrored into the HUD so they are visible without devtools.
  const messages: string[] = [];
  const log = (level: 'info' | 'warn', msg: string): void => {
    if (level === 'warn') console.warn(msg);
    else console.info(msg);
    messages.push(msg);
    if (messages.length > 6) messages.shift();
  };
  const warn = (msg: string): void => {
    log('warn', msg);
  };

  const { root, warnings: sceneWarnings } = await loadScene(config.rendering.scene_url);
  for (const w of sceneWarnings) warn(`[scene] ${w.code}: ${w.message}`);
  app.setSceneRoot(root);

  const [dx, dy, dz] = config.viewer.default_eye_mm;
  const eyeState = new EyeState(config.tracking, v3(dx, dy, dz));
  const tuning = new TuningPanel(config.tracking, (t) => {
    eyeState.setConfig(t);
    if (mpTracker) {
      mpTracker.yawCorrection = t.yaw_correction;
      mpTracker.eyeSelect = t.eye;
    }
  });
  // ?diag=1 logs the first few tracker results in full (matrix included) for offline checking.
  let diagLeft = params.get('diag') ? 5 : 0;

  // Tracker selection: ?tracker=camera (default) | mouse | static (&eye=x,y,z); ?camera=<id>.
  const trackerKind = params.get('tracker') ?? 'camera';
  const cameraId = params.get('camera') ?? config.default_camera;
  let tracker: Tracker;
  let mpTracker: MediapipeTracker | undefined;
  if (trackerKind === 'static') {
    const [sx = 0, sy = 0, sz = dz] = (params.get('eye') ?? '').split(',').map(Number);
    tracker = new StaticTracker(v3(sx, sy, sz));
  } else if (trackerKind === 'mouse') {
    tracker = new MouseTracker(300, dz);
  } else {
    const camera = findCamera(config, cameraId);
    const focalOverridePx = readFocalOverride(camera.id);
    if (focalOverridePx !== undefined) {
      console.info(
        `[tracker] using calibrated focal length ${focalOverridePx.toFixed(1)} px for ${camera.id}`,
      );
    }
    mpTracker = new MediapipeTracker({
      camera,
      ipdMm: config.viewer.ipd_mm,
      yawCorrection: config.tracking.yaw_correction,
      wasmPath: WASM_PATH,
      modelPath: MODEL_PATH,
      eyeSelect: config.tracking.eye,
      onLog: (m) => log('info', m),
      ...(focalOverridePx !== undefined ? { focalOverridePx } : {}),
    });
    mpTracker.onDebug((f) => {
      debugView.draw(f);
      if (diagLeft > 0 && f.found) {
        diagLeft--;
        const { left, right } = irisCentres(f.landmarks);
        console.info(
          `[diag] iris L=(${left.x.toFixed(4)},${left.y.toFixed(4)}) R=(${right.x.toFixed(4)},${right.y.toFixed(4)}) sep=${f.irisSeparationPx.toFixed(2)}px depth=${f.depthMm.toFixed(1)}mm yaw=${f.yawRad.toFixed(3)} pitch=${f.pitchRad.toFixed(3)} mpT=${JSON.stringify(f.faceTranslationCm)} matrix=${JSON.stringify(f.matrix.map((v) => Number(v.toFixed(3))))}`,
        );
      }
    });
    tracker = mpTracker;
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

  const onSample = (s: EyeSample): void => {
    lastSample = s;
    sampleCount++;
    eyeState.push(s);
  };
  let trackerStatus = 'starting';
  tracker.onSample(onSample);
  const startTracker = async (): Promise<void> => {
    try {
      await tracker.start();
      trackerStatus = 'running';
      if (mpTracker?.settings) {
        const s = mpTracker.settings;
        log(
          'info',
          `[tracker] ${s.label}: ${s.width}x${s.height} @ ${s.frameRate} fps, delegate ${mpTracker.delegate ?? '?'}`,
        );
      }
    } catch (err) {
      warn(
        `[tracker] ${tracker.name} failed (${err instanceof Error ? err.message : String(err)}); using mouse`,
      );
      tracker.stop();
      mpTracker = undefined;
      tracker = new MouseTracker(300, dz);
      tracker.onSample(onSample);
      await tracker.start();
      trackerStatus = 'running';
    }
  };
  void startTracker();

  window.addEventListener('resize', () => app.resize());
  window.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'h':
        hud.toggle();
        break;
      case 'm':
        ruler.toggle();
        break;
      case 'd':
        debugView.toggle();
        break;
      case 'g':
        tuning.toggle();
        break;
      case 'p': {
        const text = snapshot();
        console.info(text);
        navigator.clipboard.writeText(text).then(
          () => log('info', '[snapshot] copied to clipboard (also in the console)'),
          () => log('warn', '[snapshot] clipboard unavailable; see the console'),
        );
        break;
      }
      case 'f':
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
        break;
      case 'r':
        eyeState.setConfig(config.tracking);
        break;
      case 'c': {
        if (!mpTracker) break;
        const answer = window.prompt(
          'Calibrate focal length.\nDistance from your eyes to the screen, in mm:',
          '500',
        );
        const depth = Number(answer);
        if (!(depth > 0)) break;
        const fx = mpTracker.calibrate(depth);
        if (fx === undefined) {
          warn('[calibrate] no face visible');
          break;
        }
        log(
          'info',
          `[calibrate] focal length ${fx.toFixed(1)} px at ${mpTracker.model.intrinsics.width_px} px width. ` +
            `Paste into config/default.yaml: fx_px: ${fx.toFixed(1)}  fy_px: ${fx.toFixed(1)}`,
        );
        try {
          localStorage.setItem(focalKey(cameraId), String(fx));
        } catch {
          /* private mode: override lives only for this session */
        }
        break;
      }
      case 'x':
        try {
          localStorage.removeItem(focalKey(cameraId));
          log('info', '[calibrate] cleared stored focal length; reload to use the config value');
        } catch {
          /* ignore */
        }
        break;
      default:
        break;
    }
  });

  const browserLine = (): string => {
    const m = readBrowserMetrics(window);
    return `screen ${m.screenWidth}x${m.screenHeight}  win @${m.screenX},${m.screenY}  outer ${m.outerWidth}x${m.outerHeight}  inner ${m.innerWidth}x${m.innerHeight}  dpr ${window.devicePixelRatio}  fs ${document.fullscreenElement ? 'yes' : 'no'}  mode ${viewportMode}`;
  };
  const cameraLine = (): string => {
    if (!mpTracker) return tracker.name;
    const s = mpTracker.settings;
    const k = mpTracker.model.intrinsics;
    return `${s ? `${s.label} ${s.width}x${s.height}@${s.frameRate}` : 'starting'}  fx ${k.fx_px.toFixed(0)}px @${k.width_px}  ipd ${config.viewer.ipd_mm}  eye ${mpTracker.eyeSelect}  yawcorr ${mpTracker.yawCorrection ? 'on' : 'off'}  dropped ${mpTracker.droppedFrames}`;
  };

  const snapshot = (): string => {
    const d = mpTracker?.lastDebug;
    const debugLine = d
      ? d.found
        ? `debug     iris ${d.irisSeparationPx.toFixed(1)}px depth ${d.depthMm.toFixed(0)}mm yaw ${((d.yawRad * 180) / Math.PI).toFixed(1)}° pitch ${((d.pitchRad * 180) / Math.PI).toFixed(1)}° mediapipe ${d.faceTranslationCm ? `${(d.faceTranslationCm.x * 10).toFixed(0)},${(d.faceTranslationCm.y * 10).toFixed(0)},${(d.faceTranslationCm.z * 10).toFixed(0)}mm` : 'n/a'}`
        : 'debug     no face'
      : 'debug     n/a';
    return [
      `snapshot  ${new Date().toISOString()}  ${location.href}`,
      hud.text,
      debugLine,
      `config    ${JSON.stringify(config.tracking)}`,
    ].join('\n');
  };

  const frame = (tFrameMs: number): void => {
    if (lastFrameMs > 0) {
      const dt = tFrameMs - lastFrameMs;
      if (dt > 1 && dt < 100) frameIntervalMs = frameIntervalMs * 0.9 + dt * 0.1;
    }
    lastFrameMs = tFrameMs;

    const tDisplayMs = tFrameMs + frameIntervalMs;
    const eyeMm = eyeState.eyeAt(tDisplayMs);
    const gain = config.tracking.parallax_gain;
    const eyeRenderMm = gain === 1 ? eyeMm : v3(eyeMm.x * gain, eyeMm.y * gain, eyeMm.z);

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

    app.render(scale(eyeRenderMm, 1 / 1000), scaleRect(rectMm, 1 / 1000));
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
      trackerName: `${tracker.name}${mpTracker?.delegate ? ` (${mpTracker.delegate})` : ''} [${trackerStatus}]`,
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
      browser: browserLine(),
      camera: cameraLine(),
      warnings: messages,
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
