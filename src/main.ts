import defaultYaml from '../config/default.yaml?raw';
import devicesYaml from '../config/devices.yaml?raw';
import scenesYaml from '../config/scenes.yaml?raw';
import { findCamera, mmToM, parseConfig } from './config/load';
import type { ScreenConfig } from './config/schema';
import { parseDeviceIndex } from './device/index';
import {
  probe,
  probeCameras,
  probeModel,
  probeScreenDetails,
  screenSignature,
  type Observation,
} from './device/observation';
import { resolveDevice, type ResolvedDevice } from './device/resolve';
import {
  fullScreenRectMm,
  readBrowserMetrics,
  rectHeight,
  rectWidth,
  scaleRect,
  viewportRectMm,
} from './math/viewportRect';
import { add, scale, v3, type Vec3 } from './math/vec';
import { CameraLighting } from './lighting/cameraLighting';
import { App } from './render/app';
import { buildReferenceScene } from './render/referenceScene';
import { loadSceneEntry } from './render/sceneLoader';
import {
  localUrlFor,
  parseSceneManifest,
  resolveSceneRef,
  type Placement,
  type SceneEntry,
} from './scenes/manifest';
import { placementMatrix, placementYaml } from './scenes/placement';
import { CreditOverlay } from './ui/credit';
import { ScenePicker } from './ui/scenePicker';
import { Box3, type Group } from 'three';
import { EyeState } from './tracking/eyeState';
import { MediapipeTracker } from './tracking/mediapipeTracker';
import { MouseTracker } from './tracking/mouseTracker';
import { StaticTracker } from './tracking/staticTracker';
import type { EyeSample, Tracker } from './tracking/types';
import { irisCentres } from './tracking/protocol';
import { DebugView } from './ui/debugView';
import { Hud } from './ui/hud';
import { RulerOverlay } from './ui/ruler';
import { TrackingScope } from './ui/scope';
import { TuningPanel } from './ui/tuning';

const WASM_PATH = '/mediapipe/wasm';
const MODEL_PATH = '/models/face_landmarker.task';
const focalKey = (cameraId: string) => `parallax.focal_px.${cameraId}`;
const deviceKey = (signature: string) => `parallax.device.${signature}`;
const offsetKey = (cameraId: string) => `parallax.eye_offset_mm.${cameraId}`;

function readOffsetOverride(cameraId: string): [number, number, number] | undefined {
  try {
    const v = localStorage.getItem(offsetKey(cameraId));
    if (!v) return undefined;
    const arr: unknown = JSON.parse(v);
    if (Array.isArray(arr) && arr.length === 3 && arr.every((n) => typeof n === 'number')) {
      return arr as [number, number, number];
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

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

  // Scene reference (manifest id or URL) is resolved before the renderer exists: splat scenes
  // render without MSAA (Spark's recommendation; it only costs fill rate for splats).
  const sceneParam = params.get('scene');
  const manifest = parseSceneManifest(scenesYaml);
  const sceneRef = sceneParam ?? config.rendering.scene;
  const sceneEntry: SceneEntry | undefined =
    sceneRef === 'reference' ? undefined : resolveSceneRef(sceneRef, manifest);
  const isSplat = sceneEntry?.kind === 'splat';
  const app = new App(container, mmToM(config.rendering.near_mm), mmToM(config.rendering.far_mm), {
    antialias: !isSplat,
    // Splats are fill-rate bound: render them at a lower pixel ratio (config) than the glTF scenes.
    maxPixelRatio: isSplat ? config.rendering.splat_pixel_ratio : 2,
  });
  const credit = new CreditOverlay(container);
  new ScenePicker(container, manifest, sceneRef);
  const hud = new Hud(container);
  const ruler = new RulerOverlay(container);
  const debugView = new DebugView(container);
  const scope = new TrackingScope(container);
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

  // ?scene=reference (depth markers to 30 m) or ?scene=<url> overrides the configured glTF.
  const shadows = config.lighting.enabled && config.lighting.key_lights.shadows;
  if (shadows) app.enableShadows();
  let sceneBounds: Box3;
  // Placement: manifest defaults, then config overrides, then URL params (?scene_scale=,
  // ?scene_pos=x,y,z, ?scene_rot=pitch,yaw,roll). Live-tunable in the panel (`t`).
  const placement: Placement = {
    ...(sceneEntry?.placement ?? { scale: 1, rotation_deg: [0, 0, 0], position_mm: [0, 0, 0] }),
  };
  const po = config.rendering.placement;
  if (po?.scale !== undefined) placement.scale = po.scale;
  if (po?.rotation_deg) placement.rotation_deg = [...po.rotation_deg];
  if (po?.position_mm) placement.position_mm = [...po.position_mm];
  const num3 = (v: string | null): [number, number, number] | undefined => {
    const a = v?.split(',').map(Number);
    return a?.length === 3 && a.every(Number.isFinite) ? [a[0]!, a[1]!, a[2]!] : undefined;
  };
  if (Number(params.get('scene_scale')) > 0) placement.scale = Number(params.get('scene_scale'));
  const posParam = num3(params.get('scene_pos'));
  if (posParam) placement.position_mm = posParam;
  const rotParam = num3(params.get('scene_rot'));
  if (rotParam) placement.rotation_deg = rotParam;
  let placementGroup: Group | undefined;
  let splatCount: number | undefined;
  let shownEntry: SceneEntry | undefined = sceneEntry;

  if (!sceneEntry) {
    const ref = buildReferenceScene(0.55, shadows);
    app.setSceneRoot(ref);
    sceneBounds = new Box3().setFromObject(ref);
  } else {
    const loadOpts = {
      lightsScale: config.lighting.enabled ? config.lighting.scene_lights_scale : 1,
      shadows,
      placement,
    };
    const gl = { scene: app.scene, renderer: app.renderer };
    let entryToShow: SceneEntry = sceneEntry;
    let loaded;
    try {
      loaded = await loadSceneEntry(sceneEntry, localUrlFor(sceneEntry), loadOpts, gl);
    } catch (err) {
      // A missing or broken asset (e.g. not yet uploaded) must not blank the page.
      warn(
        `[scene] ${sceneEntry.id} failed to load (${err instanceof Error ? err.message : String(err)}); showing the bundled room`,
      );
      entryToShow = resolveSceneRef('room', manifest);
      Object.assign(placement, entryToShow.placement);
      loaded = await loadSceneEntry(entryToShow, localUrlFor(entryToShow), loadOpts, gl);
    }
    for (const w of loaded.warnings) warn(`[scene] ${w.code}: ${w.message}`);
    app.setSceneRoot(loaded.root);
    sceneBounds = loaded.bounds;
    placementGroup = loaded.placementGroup;
    splatCount = loaded.splatCount;
    shownEntry = entryToShow;
    credit.set(entryToShow.credit, entryToShow.source_url);
    const b = loaded.bounds;
    const mm = (n: number) => Math.round(n * 1000);
    log(
      'info',
      `[scene] ${entryToShow.name} (${entryToShow.kind}${splatCount ? `, ${splatCount.toLocaleString()} splats` : ''})${placementGroup ? `; ${placementYaml(placement)}` : ''}; bounds mm x ${mm(b.min.x)}..${mm(b.max.x)} y ${mm(b.min.y)}..${mm(b.max.y)} z ${mm(b.min.z)}..${mm(b.max.z)}`,
    );
  }
  const applyPlacementLive = (): void => {
    if (!placementGroup) return;
    placementMatrix(placement).decompose(
      placementGroup.position,
      placementGroup.quaternion,
      placementGroup.scale,
    );
    placementGroup.updateMatrixWorld(true);
    log('info', `[scene] ${placementYaml(placement)}`);
  };

  const [dx, dy, dz] = config.viewer.rest_eye_mm;
  const eyeState = new EyeState(config.tracking, v3(dx, dy, dz));
  const tuning = new TuningPanel(
    config.tracking,
    config.lighting,
    placement,
    applyPlacementLive,
    (t) => {
      eyeState.setConfig(t);
      if (mpTracker) {
        mpTracker.yawCorrection = t.yaw_correction;
        mpTracker.eyeSelect = t.eye;
      }
      lighting?.syncParams();
      mpTracker?.resetHoldState();
    },
  );
  // ?diag=1 logs the first few tracker results in full (matrix included) for offline checking.
  let diagLeft = params.get('diag') ? 5 : 0;

  // ---- Device: observe the machine, resolve screen + cameras (docs/devices.md) ----
  const trackerKind = params.get('tracker') ?? 'camera';
  const index = parseDeviceIndex(devicesYaml);
  const obs: Observation = probe();
  if (trackerKind === 'camera') obs.cameras = await probeCameras();
  if (obs.model === undefined) {
    const model = await probeModel();
    if (model) obs.model = model;
  }
  const signature = screenSignature(obs);
  let storedDevice: string | undefined;
  try {
    storedDevice = localStorage.getItem(deviceKey(signature)) ?? undefined;
  } catch {
    /* ignore */
  }
  const forcedDevice = params.get('device') ?? storedDevice;
  if (params.get('device')) {
    try {
      localStorage.setItem(deviceKey(signature), params.get('device')!);
    } catch {
      /* ignore */
    }
  }
  const pinned = params.get('screen_mm')?.split('x').map(Number);
  const resolveOpts = {
    ...(forcedDevice ? { forcedScreenId: forcedDevice } : {}),
    ...(pinned?.length === 2 && pinned.every((n) => n > 0)
      ? { pinnedScreenMm: [pinned[0], pinned[1]] as [number, number] }
      : {}),
  };
  let device: ResolvedDevice = resolveDevice(config.device, obs, index, resolveOpts);
  let screenCfg: ScreenConfig = device.screen;
  const describeDevice = (d: ResolvedDevice): string => {
    const p = d.provenance.screen;
    const est = p.estimates.length ? ', estimated' : '';
    return `${p.name} [${p.source}/${p.confidence}${est}: ${p.reasons.join(', ')}]`;
  };
  log('info', `[device] ${describeDevice(device)}`);
  for (const cam of device.cameras) {
    const p = device.provenance.cameras[cam.id];
    if (p)
      log(
        'info',
        `[device] camera "${cam.label_match}" → ${cam.id} (${p.confidence}${p.estimates.length ? '; ' + p.estimates.join('; ') : ''})`,
      );
  }

  // Tracker selection: ?tracker=camera (default) | mouse | static (&eye=x,y,z); ?camera=<id>.
  const cameraId = params.get('camera') ?? device.defaultCamera ?? 'none';
  let tracker: Tracker;
  let mpTracker: MediapipeTracker | undefined;
  if (trackerKind === 'static') {
    const [sx = 0, sy = 0, sz = dz] = (params.get('eye') ?? '').split(',').map(Number);
    tracker = new StaticTracker(v3(sx, sy, sz));
  } else if (trackerKind === 'mouse' || device.cameras.length === 0) {
    if (trackerKind === 'camera') warn('[device] no camera found; using the mouse tracker');
    tracker = new MouseTracker(300, dz);
  } else {
    const camera = findCamera(device.cameras, cameraId);
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
      // ?blink=0 disables blink holding and the separation guard for A/B comparison.
      blink: () => ({
        ...config.tracking.blink,
        enabled: config.tracking.blink.enabled && params.get('blink') !== '0',
      }),
      guard: () => ({
        ...config.tracking.guard,
        enabled: config.tracking.guard.enabled && params.get('blink') !== '0',
      }),
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
  // ?hud=1 shows the HUD from the start (same as pressing `h`); it is hidden by default.
  if (params.get('hud') === '1') hud.toggle();
  // ?glass=1 shows the screen-plane frame from the start (same as pressing `g`).
  app.glassFrame.visible = params.get('glass') === '1';

  // Constant added to every tracked eye position (zero = strict window). `o` re-zeroes only Y.
  const defaultOffset = (): Vec3 => v3(...config.viewer.eye_offset_mm);
  let eyeOffsetMm = defaultOffset();
  const stored = readOffsetOverride(cameraId);
  if (stored) eyeOffsetMm = v3(...stored);
  // Empirical centre-of-projection calibration: arrow keys nudge the offset (see docs/calibration.md).
  const storeOffset = (why: string): void => {
    const rounded = [eyeOffsetMm.x, eyeOffsetMm.y, eyeOffsetMm.z].map(
      (n) => Math.round(n * 10) / 10,
    );
    try {
      localStorage.setItem(offsetKey(cameraId), JSON.stringify(rounded));
    } catch {
      /* ignore */
    }
    log('info', `[offset] ${why}: eye_offset_mm: [${rounded.join(', ')}]`);
  };
  // `f` freezes the tracked eye so alignment tests are not disturbed by tracking jitter.
  let frozenEyeMm: Vec3 | undefined;
  // ?eye_offset=x,y,z overrides both config and stored values (e.g. 0,0,0 for a strict window).
  const offsetParam = params.get('eye_offset');
  if (offsetParam) {
    const [ox = 0, oy = 0, oz = 0] = offsetParam.split(',').map(Number);
    if ([ox, oy, oz].every(Number.isFinite)) eyeOffsetMm = v3(ox, oy, oz);
  }
  log(
    'info',
    `[viewer] eye offset ${[eyeOffsetMm.x, eyeOffsetMm.y, eyeOffsetMm.z].map((n) => n.toFixed(1)).join(', ')} mm${stored ? ' (stored)' : ''}`,
  );

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
    scope.pushRaw(s.tCaptureMs, s.eyeMm, s.held !== undefined);
  };
  let trackerStatus = 'starting';
  let lighting: CameraLighting | undefined;
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
      if (mpTracker) {
        lighting = new CameraLighting(
          app.renderer,
          app.scene,
          mpTracker.video,
          mpTracker.model,
          config.lighting,
          sceneBounds,
          mpTracker,
        );
        // ?lighting=off|environment|full overrides the configured start mode.
        const requested = params.get('lighting');
        if (requested === 'off' || requested === 'environment' || requested === 'full') {
          lighting.setMode(requested);
        }
        log('info', `[lighting] camera lighting ${lighting.mode}`);
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

  window.addEventListener('resize', () => {
    app.resize();
    const fresh = probe();
    if (screenSignature(fresh) !== screenSignature(obs)) {
      Object.assign(obs, {
        cssWidth: fresh.cssWidth,
        cssHeight: fresh.cssHeight,
        availHeight: fresh.availHeight,
        dpr: fresh.dpr,
      });
      delete obs.screenLabel;
      delete obs.isInternal;
      device = resolveDevice(config.device, obs, index, resolveOpts);
      screenCfg = device.screen;
      warn(`[device] display changed: ${describeDevice(device)}`);
    }
  });
  window.addEventListener('keydown', (e) => {
    switch (e.key) {
      case 'h':
        hud.toggle();
        break;
      case 'r':
        ruler.toggle();
        break;
      case 'd':
        debugView.toggle();
        break;
      case 't':
        tuning.toggle();
        break;
      case 's':
        scope.toggle();
        break;
      case 'l':
        if (lighting) log('info', `[lighting] mode ${lighting.cycleMode()}`);
        else warn('[lighting] needs the camera tracker');
        break;
      case 'g':
        app.glassFrame.visible = !app.glassFrame.visible;
        break;
      case 'D': {
        void probeScreenDetails().then((details) => {
          if (!details) {
            warn(
              '[device] screen details unavailable (needs Chromium and the window-management permission)',
            );
            return;
          }
          Object.assign(obs, details);
          device = resolveDevice(config.device, obs, index, resolveOpts);
          screenCfg = device.screen;
          log(
            'info',
            `[device] screen "${details.screenLabel ?? '?'}" (${details.isInternal ? 'internal' : 'external'}): ${describeDevice(device)}`,
          );
        });
        break;
      }
      case 'p': {
        const text = snapshot();
        console.info(text);
        navigator.clipboard.writeText(text).then(
          () => log('info', '[snapshot] copied to clipboard (also in the console)'),
          () => log('warn', '[snapshot] clipboard unavailable; see the console'),
        );
        break;
      }
      case 'F':
        if (document.fullscreenElement) void document.exitFullscreen();
        else void document.documentElement.requestFullscreen();
        break;
      case 'R':
        eyeState.setConfig(config.tracking);
        break;
      case 'o': {
        // Re-zero the vertical view: make the current tracked y read as 0. x and z are untouched.
        const cur = eyeState.raw?.position;
        if (!cur) {
          warn('[offset] no tracked eye to capture');
          break;
        }
        // Absolute: the raw tracked y (offset not applied) must read as zero, so the offset is
        // exactly its negation; pressing again with the eye still gives the same value.
        eyeOffsetMm = v3(eyeOffsetMm.x, -cur.y, eyeOffsetMm.z);
        storeOffset('y re-zeroed at the current position');
        break;
      }
      case 'O':
        try {
          localStorage.removeItem(offsetKey(cameraId));
        } catch {
          /* ignore */
        }
        eyeOffsetMm = defaultOffset();
        log('info', '[offset] cleared the stored eye offset; using the config value');
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
      case '[':
      case ']': {
        // Nudge the centre of projection: 1 mm per press, 10 mm with Shift ([ ] move z by 10/50).
        const step = e.shiftKey ? 10 : 1;
        const dz = (e.key === ']' ? 1 : e.key === '[' ? -1 : 0) * (e.shiftKey ? 50 : 10);
        const dx = e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0;
        const dy = e.key === 'ArrowUp' ? step : e.key === 'ArrowDown' ? -step : 0;
        eyeOffsetMm = v3(eyeOffsetMm.x + dx, eyeOffsetMm.y + dy, eyeOffsetMm.z + dz);
        storeOffset('nudged');
        e.preventDefault();
        break;
      }
      case 'f': {
        if (frozenEyeMm) {
          frozenEyeMm = undefined;
          log('info', '[eye] tracking resumed');
        } else {
          const cur = eyeState.raw?.position;
          if (!cur) {
            warn('[eye] no tracked eye to freeze');
            break;
          }
          frozenEyeMm = v3(cur.x, cur.y, cur.z);
          log(
            'info',
            `[eye] frozen at ${[cur.x, cur.y, cur.z].map((n) => n.toFixed(0)).join(', ')} mm (raw, before offset changes)`,
          );
        }
        break;
      }
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
      case 'C':
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

  const lightingLine = (): string => {
    if (!lighting) return config.lighting.enabled ? 'waiting for camera' : 'disabled';
    const s = lighting.stats;
    const strongest = s.strongest
      ? `  strongest dir ${[s.strongest.direction.x, s.strongest.direction.y, s.strongest.direction.z].map((n) => n.toFixed(2)).join(',')} I ${s.strongest.intensity.toFixed(2)}`
      : '';
    return `${s.mode}  env ${s.envMs.toFixed(1)} ms  analysis ${s.analysisMs.toFixed(1)} ms  lights ${s.lights}${strongest}`;
  };

  const holdLine = (): string => {
    if (!mpTracker) return '';
    const h = mpTracker.holdStats;
    const blinkOff = params.get('blink') === '0' || !config.tracking.blink.enabled;
    const state = h.holding
      ? `held: ${h.holding} ${h.holdMs.toFixed(0)} ms`
      : blinkOff
        ? 'blink hold off'
        : 'blink hold on';
    const ears = h.blink
      ? `  EAR ${h.blink.leftClosed ? 'L closed' : 'L open'}/${h.blink.rightClosed ? 'R closed' : 'R open'}${h.blink.warmingUp ? ' (warming up)' : ''}`
      : '';
    return `${state}  holds/min ${h.holdsPerMinute}${ears}`;
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
      `device    ${JSON.stringify({ observation: obs, provenance: device.provenance, screen: device.screen })}`,
    ].join('\n');
  };

  const frame = (tFrameMs: number): void => {
    if (lastFrameMs > 0) {
      const dt = tFrameMs - lastFrameMs;
      if (dt > 1 && dt < 100) frameIntervalMs = frameIntervalMs * 0.9 + dt * 0.1;
    }
    lastFrameMs = tFrameMs;

    const tDisplayMs = tFrameMs + frameIntervalMs;
    // Offset is applied here (not to samples) so nudges and the freeze act immediately.
    const eyeMm = add(frozenEyeMm ?? eyeState.eyeAt(tDisplayMs), eyeOffsetMm);
    const gain = config.tracking.parallax_gain;
    const eyeRenderMm = gain === 1 ? eyeMm : v3(eyeMm.x * gain, eyeMm.y * gain, eyeMm.z);

    const override = screenCfg.viewport_override_mm;
    const rectMm = override
      ? {
          left: override.left_mm,
          right: override.right_mm,
          bottom: override.bottom_mm,
          top: override.top_mm,
        }
      : viewportMode === 'full'
        ? fullScreenRectMm(screenCfg)
        : viewportRectMm(readBrowserMetrics(window), screenCfg);

    if (lighting) {
      lighting.tick(tFrameMs);
      debugView.sources = lighting.mode === 'full' ? lighting.lastDetected : [];
      debugView.analysisWidth = lighting.analysisWidth;
    }
    app.render(scale(eyeRenderMm, 1 / 1000), scaleRect(rectMm, 1 / 1000));
    scope.pushRendered(tDisplayMs, eyeRenderMm);
    scope.draw(tFrameMs);
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
      trackerName: `${tracker.name}${mpTracker?.delegate ? ` (${mpTracker.delegate})` : ''} [${trackerStatus}]${frozenEyeMm ? ' [FROZEN k]' : ''}`,
      hold: holdLine(),
      tracking: eyeState.tracking,
      eyeMm,
      eyeOffsetMm,
      renderFps,
      sampleHz,
      trackerLatencyMs: lastSample ? lastSample.tReadyMs - lastSample.tCaptureMs : 0,
      inferenceMs: lastSample?.timings?.inferenceMs ?? 0,
      captureToDisplayMs: lastSample ? tDisplayMs - lastSample.tCaptureMs : 0,
      predictionLeadMs: raw
        ? Math.min(Math.max(tDisplayMs - raw.tS * 1000, 0), config.tracking.prediction.max_lead_ms)
        : 0,
      viewportMm: { w: rectWidth(rectMm), h: rectHeight(rectMm) },
      noiseMm: scope.noiseMm(tFrameMs),
      browser: browserLine(),
      camera: cameraLine(),
      lighting: lightingLine(),
      device: describeDevice(device),
      scene: shownEntry
        ? `${shownEntry.id} (${shownEntry.kind}${splatCount ? `, ${splatCount.toLocaleString()} splats` : ''})${placementGroup ? `  ${placementYaml(placement)}` : ''}`
        : 'reference',
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
