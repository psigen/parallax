/**
 * Deterministic precedence: explicit config > forced device > heuristics. Produces the
 * ScreenConfig / CameraConfig the rest of the app consumes, plus provenance saying where each
 * value came from. No guessing here; see heuristics.ts.
 */
import type {
  CameraConfig,
  CameraSpec,
  DeviceSection,
  ScreenConfig,
  ScreenSpec,
} from '../config/schema';
import {
  builtinCameraPositionGuess,
  cameraIdFor,
  capturePolicy,
  chooseDefaultCamera,
  confidenceOf,
  externalCameraPosition,
  extrapolateScreen,
  intrinsicsFromHfov,
  isBuiltinCameraLabel,
  matchCamera,
  rankScreens,
  type Confidence,
} from './heuristics';
import { findCameraEntry, findScreenEntry, type DeviceIndex, type ScreenEntry } from './index';
import type { Observation } from './observation';

type Vec3 = [number, number, number];

export interface Provenance {
  source: 'config' | 'forced' | 'index' | 'extrapolated';
  deviceId?: string;
  name: string;
  confidence: Confidence;
  reasons: string[];
  /** Values that are estimates rather than specifications. */
  estimates: string[];
}

export interface ResolvedDevice {
  screen: ScreenConfig;
  cameras: CameraConfig[];
  defaultCamera: string | undefined;
  /** Whether the resolved display has a notch (for camera placement guesses). */
  notch: boolean;
  provenance: { screen: Provenance; cameras: Record<string, Provenance> };
}

export interface ResolveOptions {
  /** `?device=<screen id>` or a stored choice. */
  forcedScreenId?: string;
  /** `?screen_mm=WxH`. */
  pinnedScreenMm?: [number, number];
}

interface ScreenResolution {
  screen: ScreenConfig;
  entry: ScreenEntry | undefined;
  notch: boolean;
  provenance: Provenance;
}

function resolveScreen(
  spec: 'auto' | ScreenSpec,
  obs: Observation,
  index: DeviceIndex,
  opts: ResolveOptions,
): ScreenResolution {
  let entry: ScreenEntry | undefined;
  let provenance: Provenance;
  let base: { name: string; width_mm: number; height_mm: number; notch: boolean };

  const explicit =
    spec !== 'auto' && spec.width_mm !== undefined && spec.height_mm !== undefined && !spec.ref;
  if (explicit) {
    base = {
      name: spec.name ?? 'configured display',
      width_mm: spec.width_mm!,
      height_mm: spec.height_mm!,
      notch: false,
    };
    provenance = {
      source: 'config',
      name: base.name,
      confidence: 'exact',
      reasons: ['screen given in config'],
      estimates: [],
    };
  } else if (opts.forcedScreenId) {
    entry = findScreenEntry(index, opts.forcedScreenId);
    if (!entry) throw new Error(`unknown device id "${opts.forcedScreenId}"`);
    base = { name: entry.name, ...entry.panel };
    provenance = {
      source: 'forced',
      deviceId: entry.id,
      name: entry.name,
      confidence: 'exact',
      reasons: ['device forced'],
      estimates: [],
    };
  } else if (spec !== 'auto' && spec.ref) {
    entry = findScreenEntry(index, spec.ref);
    if (!entry) throw new Error(`unknown screen ref "${spec.ref}" in config`);
    base = { name: entry.name, ...entry.panel };
    provenance = {
      source: 'config',
      deviceId: entry.id,
      name: entry.name,
      confidence: 'exact',
      reasons: [`config ref ${entry.id}`],
      estimates: [],
    };
  } else {
    const best = rankScreens(obs, index)[0];
    const confidence = confidenceOf(best);
    if (best && confidence !== 'guessed') {
      entry = best.entry;
      base = { name: entry.name, ...entry.panel };
      provenance = {
        source: 'index',
        deviceId: entry.id,
        name: entry.name,
        confidence,
        reasons: best.reasons,
        estimates: [],
      };
    } else {
      const guess = extrapolateScreen(obs);
      base = guess;
      provenance = {
        source: 'extrapolated',
        name: guess.name,
        confidence: 'guessed',
        reasons: best
          ? [`nearest "${best.entry.name}" too weak (${best.reasons.join(', ')})`, ...guess.reasons]
          : guess.reasons,
        estimates: guess.estimates,
      };
    }
  }

  // Explicit field overrides on top of a ref/auto result.
  if (spec !== 'auto') {
    if (spec.name !== undefined) base.name = spec.name;
    if (spec.width_mm !== undefined) base.width_mm = spec.width_mm;
    if (spec.height_mm !== undefined) base.height_mm = spec.height_mm;
  }
  if (opts.pinnedScreenMm) {
    [base.width_mm, base.height_mm] = opts.pinnedScreenMm;
    provenance.reasons.push(
      `size pinned to ${opts.pinnedScreenMm[0]}x${opts.pinnedScreenMm[1]} mm`,
    );
  }

  const screen: ScreenConfig = {
    name: base.name,
    width_mm: base.width_mm,
    height_mm: base.height_mm,
    viewport_override_mm:
      spec !== 'auto' && spec.viewport_override_mm !== undefined ? spec.viewport_override_mm : null,
  };
  return { screen, entry, notch: base.notch, provenance };
}

function cameraFromSpec(
  spec: CameraSpec,
  index: DeviceIndex,
  screen: ScreenResolution,
): { config: CameraConfig; provenance: Provenance } {
  const entry = spec.ref ? findCameraEntry(index, spec.ref) : undefined;
  if (spec.ref && !entry) throw new Error(`unknown camera ref "${spec.ref}" in config`);
  const capture = spec.capture ?? entry?.capture;
  if (!capture) throw new Error(`camera "${spec.id ?? spec.ref ?? '?'}" needs capture or a ref`);
  const hfov = spec.hfov_deg ?? entry?.hfov_deg;
  const intrinsics =
    spec.intrinsics ??
    (hfov !== undefined
      ? intrinsicsFromHfov(hfov, capture.width_px, capture.height_px)
      : undefined);
  if (!intrinsics)
    throw new Error(`camera "${spec.id ?? spec.ref ?? '?'}" needs intrinsics, hfov_deg or a ref`);
  const label = spec.label_match ?? entry?.label_match[0];
  if (!label) throw new Error(`camera "${spec.id ?? spec.ref ?? '?'}" needs label_match or a ref`);
  const id = spec.id ?? entry?.id ?? label;
  const builtin = screen.entry?.builtin_camera?.camera === entry?.id;
  const position: Vec3 =
    spec.position_mm ??
    (builtin && screen.entry?.builtin_camera
      ? screen.entry.builtin_camera.position_mm
      : externalCameraPosition(screen.screen.height_mm, entry?.mount?.position_mm_from_top_centre));
  const estimates: string[] = [];
  if (!spec.intrinsics && (entry?.estimate ?? true))
    estimates.push('focal length from nominal FOV');
  if (!spec.position_mm && !builtin) estimates.push('camera position from mount guess');
  return {
    config: {
      id,
      label_match: label,
      capture,
      mirrored: spec.mirrored ?? entry?.mirrored ?? false,
      intrinsics,
      extrinsics: { position_mm: position, rotation_deg: spec.rotation_deg ?? [0, 0, 0] },
    },
    provenance: {
      source: 'config',
      ...(entry ? { deviceId: entry.id } : {}),
      name: entry?.name ?? id,
      confidence: 'exact',
      reasons: ['camera given in config'],
      estimates,
    },
  };
}

function cameraFromObservation(
  cam: Observation['cameras'][number],
  obs: Observation,
  index: DeviceIndex,
  screen: ScreenResolution,
): { config: CameraConfig; provenance: Provenance; builtin: boolean; generic: boolean } {
  const match = matchCamera(cam, index);
  const { entry } = match;
  const id = cameraIdFor(cam, match);
  const screenBuiltin = screen.entry?.builtin_camera;
  const isScreenCamera = screenBuiltin?.camera === entry.id;
  const builtin = isScreenCamera || isBuiltinCameraLabel(cam.label);
  const estimates: string[] = [];
  let position: Vec3;
  let rotation: Vec3 = [0, 0, 0];
  if (isScreenCamera && screenBuiltin) {
    position = screenBuiltin.position_mm;
    rotation = screenBuiltin.rotation_deg;
  } else if (builtin) {
    position = builtinCameraPositionGuess(screen.screen.height_mm, screen.notch, obs.platform);
    estimates.push('built-in camera position guessed from the display size');
  } else {
    position = externalCameraPosition(
      screen.screen.height_mm,
      entry.mount?.position_mm_from_top_centre,
    );
    estimates.push('external camera position from mount guess');
  }
  if (entry.estimate) estimates.push(`focal length from nominal ${entry.hfov_deg}° FOV`);
  return {
    config: {
      id,
      label_match: cam.label,
      capture: { ...entry.capture, ...capturePolicy(obs.platform) },
      mirrored: entry.mirrored,
      intrinsics: intrinsicsFromHfov(
        entry.hfov_deg,
        entry.capture.width_px,
        entry.capture.height_px,
      ),
      extrinsics: { position_mm: position, rotation_deg: rotation },
    },
    provenance: {
      source: match.generic ? 'extrapolated' : 'index',
      deviceId: entry.id,
      name: entry.name,
      confidence: match.generic ? 'guessed' : 'exact',
      reasons: match.reasons,
      estimates,
    },
    builtin,
    generic: match.generic,
  };
}

export function resolveDevice(
  section: DeviceSection,
  obs: Observation,
  index: DeviceIndex,
  opts: ResolveOptions = {},
): ResolvedDevice {
  const screen = resolveScreen(section.screen, obs, index, opts);
  const cameras: CameraConfig[] = [];
  const provenance: Record<string, Provenance> = {};
  const choices: { id: string; builtin: boolean; generic: boolean }[] = [];

  if (section.cameras !== 'auto') {
    for (const spec of section.cameras) {
      const { config, provenance: p } = cameraFromSpec(spec, index, screen);
      cameras.push(config);
      provenance[config.id] = p;
      const observed = obs.cameras.some((c) =>
        c.label.toLowerCase().includes(config.label_match.toLowerCase()),
      );
      choices.push({
        id: config.id,
        builtin: observed && isBuiltinCameraLabel(config.label_match),
        generic: !observed,
      });
    }
  } else {
    for (const cam of obs.cameras) {
      const {
        config,
        provenance: p,
        builtin,
        generic,
      } = cameraFromObservation(cam, obs, index, screen);
      if (cameras.some((c) => c.id === config.id)) config.id = `${config.id}-${cameras.length + 1}`;
      cameras.push(config);
      provenance[config.id] = p;
      choices.push({ id: config.id, builtin, generic });
    }
  }

  let defaultCamera: string | undefined;
  if (section.default_camera !== 'auto') {
    if (!cameras.some((c) => c.id === section.default_camera)) {
      throw new Error(
        `default_camera "${section.default_camera}" is not among the cameras (${cameras.map((c) => c.id).join(', ')})`,
      );
    }
    defaultCamera = section.default_camera;
  } else {
    defaultCamera = chooseDefaultCamera(choices);
  }

  return {
    screen: screen.screen,
    cameras,
    defaultCamera,
    notch: screen.notch,
    provenance: { screen: screen.provenance, cameras: provenance },
  };
}
