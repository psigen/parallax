/**
 * Facts the browser can observe about the machine, with no interpretation. Everything that
 * turns these into a device choice lives in heuristics.ts.
 */
import type { Platform } from './index';

export interface CameraObservation {
  label: string;
  deviceId: string;
  /** Largest frame height the device reports, when the browser exposes capabilities. */
  maxHeightPx?: number;
}

export interface Observation {
  platform: Platform;
  userAgent: string;
  /** window.screen.width / height, CSS px (on macOS: the scaled mode, not native). */
  cssWidth: number;
  cssHeight: number;
  /** window.screen.availHeight, CSS px. */
  availHeight: number;
  dpr: number;
  /** WEBGL_debug_renderer_info unmasked renderer string, if obtainable. */
  gpu?: string;
  /** Window Management API, only after the user opts in. */
  screenLabel?: string;
  isInternal?: boolean;
  /** Device model string when the platform exposes one (Android UA / UA-data). */
  model?: string;
  maxTouchPoints: number;
  cameras: CameraObservation[];
}

/**
 * Maps a UA-data platform name or a user-agent string to a platform enum. Deterministic.
 * iPadOS Safari presents a Macintosh UA; a Mac with more than one touch point is an iPad.
 */
export function detectPlatform(
  userAgent: string,
  uaDataPlatform?: string,
  maxTouchPoints = 0,
): Platform {
  const ua = userAgent.toLowerCase();
  const p = (uaDataPlatform ?? '').toLowerCase();
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ipod') || p === 'ios')
    return 'ios';
  if (ua.includes('android') || p === 'android') return 'android';
  if (p.includes('mac') || ua.includes('mac os x') || ua.includes('macintosh')) {
    return maxTouchPoints > 1 ? 'ios' : 'macos';
  }
  if (p.includes('windows') || ua.includes('windows')) return 'windows';
  if (p.includes('chrome os') || p.includes('chromeos') || ua.includes('cros')) return 'chromeos';
  if (p.includes('linux') || ua.includes('linux')) return 'linux';
  return 'other';
}

/** The device model from an Android user agent ("Linux; Android 14; Pixel 8 Build/…"), if present. */
export function modelFromUserAgent(userAgent: string): string | undefined {
  const m = /Android [\d.]+; ([^;)]+?)(?: Build\/| MIUI|\))/.exec(userAgent);
  const model = m?.[1]?.trim();
  // Chrome's reduced UA replaces the model with "K".
  return model && model !== 'K' ? model : undefined;
}

function readGpu(): string | undefined {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return undefined;
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const value: unknown = ext
      ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER);
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

interface NavigatorUAData {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string }>;
}

/** Synchronous facts. Cameras, screen labels and the UA-data model need async flows (below). */
export function probe(): Observation {
  const nav = navigator as Navigator & { userAgentData?: NavigatorUAData };
  const touch = navigator.maxTouchPoints || 0;
  const gpu = readGpu();
  const model = modelFromUserAgent(navigator.userAgent);
  return {
    platform: detectPlatform(navigator.userAgent, nav.userAgentData?.platform, touch),
    userAgent: navigator.userAgent,
    cssWidth: window.screen.width,
    cssHeight: window.screen.height,
    availHeight: window.screen.availHeight,
    dpr: window.devicePixelRatio,
    ...(gpu !== undefined ? { gpu } : {}),
    ...(model !== undefined ? { model } : {}),
    maxTouchPoints: touch,
    cameras: [],
  };
}

/** The UA-data model (Android Chrome), without a prompt. */
export async function probeModel(): Promise<string | undefined> {
  const nav = navigator as Navigator & { userAgentData?: NavigatorUAData };
  try {
    const v = await nav.userAgentData?.getHighEntropyValues?.(['model']);
    const model = v?.model ?? '';
    return model === '' ? undefined : model;
  } catch {
    return undefined;
  }
}

/** A short signature that changes when the window moves to another display. */
export function screenSignature(obs: Pick<Observation, 'cssWidth' | 'cssHeight' | 'dpr'>): string {
  return `${obs.cssWidth}x${obs.cssHeight}@${obs.dpr}`;
}

interface InputDeviceInfoLike extends MediaDeviceInfo {
  getCapabilities?: () => MediaTrackCapabilities;
}

/** Enumerates cameras, opening one briefly if labels are hidden behind permission. */
export async function probeCameras(): Promise<CameraObservation[]> {
  let devices = await navigator.mediaDevices.enumerateDevices();
  if (devices.filter((d) => d.kind === 'videoinput').every((d) => d.label === '')) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true });
      stream.getTracks().forEach((t) => t.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {
      return [];
    }
  }
  return devices
    .filter((d): d is InputDeviceInfoLike => d.kind === 'videoinput')
    .map((d) => {
      const caps = d.getCapabilities?.();
      const maxH = caps?.height?.max;
      return {
        label: d.label,
        deviceId: d.deviceId,
        ...(typeof maxH === 'number' ? { maxHeightPx: maxH } : {}),
      };
    });
}

interface ScreenDetailedLike {
  label: string;
  isInternal: boolean;
  isPrimary: boolean;
  devicePixelRatio: number;
}

interface ScreenDetailsLike {
  currentScreen: ScreenDetailedLike;
}

/** Window Management API (Chromium, permission prompt). Returns the current screen's label. */
export async function probeScreenDetails(): Promise<
  Pick<Observation, 'screenLabel' | 'isInternal'> | undefined
> {
  const w = window as Window & { getScreenDetails?: () => Promise<ScreenDetailsLike> };
  if (!w.getScreenDetails) return undefined;
  try {
    const details = await w.getScreenDetails();
    return {
      screenLabel: details.currentScreen.label,
      isInternal: details.currentScreen.isInternal,
    };
  } catch {
    return undefined;
  }
}
