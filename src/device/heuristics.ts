/**
 * THE ONLY HEURISTIC CODE in the project: everything that turns observations into a guess about
 * the display and cameras. Scoring weights, the notch tell, pixel-pitch tables, FOV defaults,
 * mount guesses and the "pick something when nothing is known" rules all live here, so the rest
 * of the code can be deterministic. Every function is pure.
 */
import type { CaptureConfig } from '../config/schema';
import type { CameraEntry, DeviceIndex, Platform, ScreenEntry } from './index';
import type { CameraObservation, Observation } from './observation';

// ---- Tunables -----------------------------------------------------------------------------

/** Evidence weights. "Strong" signals identify a model by themselves. */
export const WEIGHT = {
  cssMode: 3, // CSS size equals one of the device's scaled modes (macOS) or logical size (phones)
  native: 3, // CSS size x dpr equals the native resolution (Windows/Linux/Android)
  label: 3, // Window Management screen label matches
  model: 3, // device model string names the entry (Android)
  aspect: 1, // aspect ratio within ASPECT_TOLERANCE
  notch: 1, // menu-bar height agrees with the panel having a notch
  gpu: 1, // WebGL renderer names the machine's chip family
  dpr: 1, // devicePixelRatio equals the entry's expected value (phones)
} as const;
const STRONG = 3;
const ASPECT_TOLERANCE = 0.01;

/** macOS menu bar heights in CSS px: 25 on a plain panel, 37 when the panel has a notch. */
const MENU_BAR_PLAIN_PX = 25;
const MENU_BAR_NOTCH_PX = 37;

/** Pixel pitches (ppi) assumed when extrapolating on macOS, by panel family. */
const MACOS_PPI = { notchedLaptop: 254, plainLaptop: 227, desktop: 218 } as const;
/** macOS default scaling renders at half the native ppi. */
const MACOS_DEFAULT_SCALE = 2;

/** Default horizontal FOV for a camera we know nothing about. */
export const GENERIC_HFOV_DEG = 65;
/** iOS CSS pixel pitch by devicePixelRatio: 3x panels are ~460 ppi, 2x panels ~326 ppi. */
const IOS_PPI_BY_DPR: Record<number, number> = { 3: 460, 2: 326 };
/** Android defines a CSS px as 1/160 inch (density buckets make this ±10 %). */
const ANDROID_CSS_PX_PER_INCH = 160;
/** Phone front cameras sit about this far below the top edge of the active area. */
const PHONE_CAMERA_BELOW_TOP_MM = 6;
/** Monitor model numbers usually embed the diagonal: "U2720Q" → 27, "27GL850" → 27, "S32B800" → 32. */
const MONITOR_INCHES = /(?:^|[^0-9])(19|[2-4][0-9])(?:[0-9]{2}|[A-Z]|$)/;
const PHONE_PLATFORMS: readonly string[] = ['ios', 'android'];
/** Built-in laptop cameras sit this far below the top edge of the active area (notched panels). */
const NOTCH_CAMERA_BELOW_TOP_MM = 3.5;
/** Built-in cameras in a bezel sit this far above the top edge of the active area. */
const BEZEL_CAMERA_ABOVE_TOP_MM = 6;
/** Clip-on external cameras: above the top edge and forward of the panel. */
const EXTERNAL_MOUNT_MM: [number, number, number] = [0, 15, 20];

const BUILTIN_LABEL =
  /facetime|built-?in|integrated|internal|macbook|imac|studio display camera|front camera|facing front|camera2 1/i;

// ---- Screens ------------------------------------------------------------------------------

export interface ScreenCandidate {
  entry: ScreenEntry;
  score: number;
  /** Number of strong signals that matched. */
  strong: number;
  reasons: string[];
}

export type Confidence = 'exact' | 'nearest' | 'guessed';

/** The notch tell on macOS, from the menu bar height; undefined when inconclusive. */
export function notchTell(
  obs: Pick<Observation, 'platform' | 'cssHeight' | 'availHeight'>,
): boolean | undefined {
  if (obs.platform !== 'macos') return undefined;
  const bar = obs.cssHeight - obs.availHeight;
  if (bar === MENU_BAR_NOTCH_PX) return true;
  if (bar === MENU_BAR_PLAIN_PX) return false;
  return undefined;
}

/** Diagonal in inches parsed from a monitor's EDID label, if its model number embeds one. */
export function inchesFromLabel(label: string): number | undefined {
  for (const token of label.toUpperCase().split(/\s+/)) {
    const m = MONITOR_INCHES.exec(token);
    if (m?.[1]) return Number(m[1]);
  }
  return undefined;
}

export function scoreScreen(obs: Observation, entry: ScreenEntry): ScreenCandidate | undefined {
  if (entry.platform !== 'any' && entry.platform !== obs.platform) return undefined;
  if (entry.external && obs.isInternal === true) return undefined;
  // Phones report their logical size in either orientation.
  const sizes: [number, number][] = PHONE_PLATFORMS.includes(obs.platform)
    ? [
        [obs.cssWidth, obs.cssHeight],
        [obs.cssHeight, obs.cssWidth],
      ]
    : [[obs.cssWidth, obs.cssHeight]];
  let score = 0;
  let strong = 0;
  const reasons: string[] = [];
  const add = (w: number, why: string) => {
    score += w;
    if (w >= STRONG) strong++;
    reasons.push(why);
  };

  if (entry.css_modes.some(([w, h]) => sizes.some(([sw, sh]) => w === sw && h === sh))) {
    add(WEIGHT.cssMode, `css mode ${obs.cssWidth}x${obs.cssHeight}`);
  }
  const [nw, nh] = entry.panel.native_px;
  if (
    sizes.some(([sw, sh]) => Math.round(sw * obs.dpr) === nw && Math.round(sh * obs.dpr) === nh)
  ) {
    // A laptop panel at 125-200 % scaling shares native resolutions with monitors; for an
    // external-only entry the resolution is strong evidence only when the display is known to
    // be external or runs unscaled.
    const externalEvidence = obs.isInternal === false || obs.dpr <= 1;
    if (!entry.external || externalEvidence) add(WEIGHT.native, `native ${nw}x${nh} @${obs.dpr}`);
    else add(WEIGHT.aspect, `native ${nw}x${nh} but scaled like a laptop`);
  }
  if (obs.model) {
    const model = obs.model.toLowerCase();
    // The longest matching hint wins ties ("Pixel 8 Pro" over "Pixel 8").
    const hint = entry.model_hints
      .filter((m) => model.includes(m.toLowerCase()))
      .sort((a, b) => b.length - a.length)[0];
    if (hint) add(WEIGHT.model + hint.length / 100, `model "${obs.model}"`);
  }
  if (entry.dpr !== undefined && entry.dpr === obs.dpr) {
    add(WEIGHT.dpr, `dpr ${obs.dpr}`);
  }
  if (
    obs.screenLabel &&
    entry.labels.some((l) => obs.screenLabel?.toLowerCase().includes(l.toLowerCase()))
  ) {
    add(WEIGHT.label, `screen label "${obs.screenLabel}"`);
  }
  if (sizes.some(([sw, sh]) => Math.abs(sw / sh - nw / nh) <= ASPECT_TOLERANCE)) {
    add(WEIGHT.aspect, 'aspect ratio');
  }
  const notch = notchTell(obs);
  if (notch !== undefined && notch === entry.panel.notch) {
    add(WEIGHT.notch, notch ? 'notch (37 px menu bar)' : 'no notch (25 px menu bar)');
  }
  if (obs.gpu && entry.gpu_hints.some((g) => obs.gpu?.includes(g))) {
    add(WEIGHT.gpu, `gpu "${obs.gpu}"`);
  }
  return score > 0 ? { entry, score, strong, reasons } : undefined;
}

/** Best candidate first. */
export function rankScreens(obs: Observation, index: DeviceIndex): ScreenCandidate[] {
  return index.screens
    .map((e) => scoreScreen(obs, e))
    .filter((c): c is ScreenCandidate => c !== undefined)
    .sort((a, b) => b.score - a.score || b.strong - a.strong);
}

/** exact: two strong signals; nearest: one strong signal (the HUD says "nearest"); else guess. */
export function confidenceOf(c: ScreenCandidate | undefined): Confidence {
  if (!c) return 'guessed';
  if (c.strong >= 2) return 'exact';
  if (c.strong >= 1) return 'nearest';
  return 'guessed';
}

export interface ScreenGuess {
  name: string;
  width_mm: number;
  height_mm: number;
  notch: boolean;
  reasons: string[];
  estimates: string[];
}

/** Physical size from pixels alone, when no index entry fits. */
export function extrapolateScreen(obs: Observation): ScreenGuess {
  const reasons: string[] = [];
  const estimates: string[] = ['display size extrapolated from pixel metrics'];
  const aspect = obs.cssWidth / obs.cssHeight;

  if (obs.platform === 'ios') {
    const ppi = IOS_PPI_BY_DPR[Math.round(obs.dpr)] ?? 460;
    reasons.push(`iOS, ${ppi} ppi assumed for dpr ${obs.dpr}`);
    const width_mm = (obs.cssWidth * obs.dpr * 25.4) / ppi;
    return {
      name: `Unknown iPhone/iPad (${obs.cssWidth}x${obs.cssHeight}@${obs.dpr})`,
      width_mm,
      height_mm: width_mm / aspect,
      notch: false,
      reasons,
      estimates,
    };
  }
  if (obs.platform === 'android') {
    reasons.push(
      `Android, CSS px = 1/${ANDROID_CSS_PX_PER_INCH} inch by definition (density bucket ±10 %)`,
    );
    const width_mm = (obs.cssWidth * 25.4) / ANDROID_CSS_PX_PER_INCH;
    return {
      name: `Unknown Android device (${obs.cssWidth}x${obs.cssHeight}@${obs.dpr}${obs.model ? `, ${obs.model}` : ''})`,
      width_mm,
      height_mm: width_mm / aspect,
      notch: false,
      reasons,
      estimates,
    };
  }
  // A monitor label with an embedded diagonal beats every size-class guess below.
  const labelInches = obs.screenLabel ? inchesFromLabel(obs.screenLabel) : undefined;
  if (labelInches !== undefined && obs.isInternal !== true) {
    reasons.push(`monitor label "${obs.screenLabel}" implies ${labelInches}-inch`);
    const diagonalMm = labelInches * 25.4;
    const width_mm = (diagonalMm * aspect) / Math.sqrt(1 + aspect * aspect);
    return {
      name: `${obs.screenLabel} (${labelInches}-inch)`,
      width_mm,
      height_mm: width_mm / aspect,
      notch: false,
      reasons,
      estimates,
    };
  }
  if (obs.platform === 'macos') {
    const notch = notchTell(obs) ?? false;
    const family = notch ? 'notchedLaptop' : obs.cssWidth >= 1920 ? 'desktop' : 'plainLaptop';
    const ppi = MACOS_PPI[family];
    reasons.push(
      `macOS, ${family} assumed (${ppi} ppi at ${MACOS_DEFAULT_SCALE}x default scaling)`,
    );
    const width_mm = (obs.cssWidth * MACOS_DEFAULT_SCALE * 25.4) / ppi;
    return {
      name: `Unknown Mac display (${obs.cssWidth}x${obs.cssHeight})`,
      width_mm,
      height_mm: width_mm / aspect,
      notch,
      reasons,
      estimates,
    };
  }

  // Windows/Linux/ChromeOS: css x dpr is native; classify by size class.
  const nativeW = Math.round(obs.cssWidth * obs.dpr);
  const laptopLike = obs.dpr >= 1.25;
  let diagonalIn: number;
  if (nativeW <= 1600) diagonalIn = 14;
  else if (nativeW <= 2000) diagonalIn = laptopLike ? 15.6 : 24;
  else if (nativeW <= 2600) diagonalIn = laptopLike ? 16 : 27;
  else diagonalIn = laptopLike ? 16 : 27;
  reasons.push(
    `${obs.platform}, native ${nativeW} px wide at dpr ${obs.dpr}: ${laptopLike ? 'laptop' : 'desktop'} class, ${diagonalIn}-inch assumed`,
  );
  const diagonalMm = diagonalIn * 25.4;
  const width_mm = (diagonalMm * aspect) / Math.sqrt(1 + aspect * aspect);
  return {
    name: `Unknown ${diagonalIn}-inch display (${nativeW}x${Math.round(obs.cssHeight * obs.dpr)})`,
    width_mm,
    height_mm: width_mm / aspect,
    notch: false,
    reasons,
    estimates,
  };
}

// ---- Cameras ------------------------------------------------------------------------------

export interface CameraMatch {
  entry: CameraEntry;
  reasons: string[];
  /** True when the match fell back to the generic entry. */
  generic: boolean;
}

export function isBuiltinCameraLabel(label: string): boolean {
  return BUILTIN_LABEL.test(label);
}

export function slug(label: string): string {
  const s = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return s || 'camera';
}

/** Label substring match, disambiguated by max frame height when entries share a label. */
export function matchCamera(cam: CameraObservation, index: DeviceIndex): CameraMatch {
  const label = cam.label.toLowerCase();
  const byLabel = index.cameras.filter((c) =>
    c.label_match.some((m) => label.includes(m.toLowerCase())),
  );
  if (byLabel.length === 0) {
    const generic = index.cameras.find((c) => c.id === 'generic-uvc');
    if (!generic) throw new Error('device index has no generic-uvc camera entry');
    return { entry: generic, reasons: [`label "${cam.label}" unrecognised`], generic: true };
  }
  const reasons = [`label "${cam.label}"`];
  if (byLabel.length > 1 && cam.maxHeightPx !== undefined) {
    const h = cam.maxHeightPx;
    const exact = byLabel.find((c) => c.max_height_px === h);
    if (exact) return { entry: exact, reasons: [...reasons, `max height ${h} px`], generic: false };
    const fits = byLabel.filter((c) => c.max_height_px === undefined || c.max_height_px <= h);
    const pick = fits.sort((a, b) => (b.max_height_px ?? 0) - (a.max_height_px ?? 0))[0];
    if (pick)
      return { entry: pick, reasons: [...reasons, `max height ${h} px (nearest)`], generic: false };
  }
  // Prefer the entry whose matching label is the most specific (longest); then the first.
  const longestMatch = (c: CameraEntry) =>
    Math.max(...c.label_match.filter((m) => label.includes(m.toLowerCase())).map((m) => m.length));
  const pick = [...byLabel].sort((a, b) => longestMatch(b) - longestMatch(a))[0]!;
  return { entry: pick, reasons, generic: false };
}

/** Pinhole intrinsics for a horizontal field of view at a reference frame size. */
export function intrinsicsFromHfov(hfovDeg: number, widthPx: number, heightPx: number) {
  const fx = widthPx / 2 / Math.tan((hfovDeg * Math.PI) / 360);
  return {
    width_px: widthPx,
    height_px: heightPx,
    fx_px: fx,
    fy_px: fx,
    cx_px: widthPx / 2,
    cy_px: heightPx / 2,
  };
}

/** A built-in camera's lens position (mm, screen frame) when the index does not say. */
export function builtinCameraPositionGuess(
  heightMm: number,
  notch: boolean,
  platform: Platform = 'other',
): [number, number, number] {
  if (PHONE_PLATFORMS.includes(platform)) return [0, heightMm / 2 - PHONE_CAMERA_BELOW_TOP_MM, 0];
  return [0, heightMm / 2 + (notch ? -NOTCH_CAMERA_BELOW_TOP_MM : BEZEL_CAMERA_ABOVE_TOP_MM), 0];
}

/** An external camera's lens position from its mount guess relative to the display's top centre. */
export function externalCameraPosition(
  heightMm: number,
  mount: [number, number, number] | undefined,
): [number, number, number] {
  const [mx, my, mz] = mount ?? EXTERNAL_MOUNT_MM;
  return [mx, heightMm / 2 + my, mz];
}

/** Which camera to use when the config says auto: the display's own if present, else the first recognised one. */
export function chooseDefaultCamera(
  cameras: readonly { id: string; builtin: boolean; generic: boolean }[],
): string | undefined {
  return (
    cameras.find((c) => c.builtin)?.id ?? cameras.find((c) => !c.generic)?.id ?? cameras[0]?.id
  );
}

/** How to open the camera on each platform: phones get the front camera at its widest zoom. */
export function capturePolicy(platform: Platform): Pick<CaptureConfig, 'facing_mode' | 'zoom'> {
  return PHONE_PLATFORMS.includes(platform) ? { facing_mode: 'user', zoom: 'widest' } : {};
}

/** Frames without a face before the zoom is stepped toward the nominal 1x (phones at widest zoom). */
export const ZOOM_FALLBACK_FRAMES = 90;
/**
 * The next zoom to try when detection fails at the current one: a step toward `nominal`
 * (never beyond it); undefined when already there.
 */
export function nextZoomStep(current: number, nominal = 1, factor = 1.25): number | undefined {
  if (current >= nominal) return undefined;
  return Math.min(nominal, current * factor);
}

/** Identifier for a resolved camera: the index id, or a slug of the label for generic ones. */
export function cameraIdFor(cam: CameraObservation, match: CameraMatch): string {
  return match.generic ? `generic-${slug(cam.label)}` : match.entry.id;
}

export function platformLabel(p: Platform): string {
  return {
    macos: 'macOS',
    windows: 'Windows',
    linux: 'Linux',
    chromeos: 'ChromeOS',
    ios: 'iOS',
    android: 'Android',
    other: 'unknown OS',
  }[p];
}
