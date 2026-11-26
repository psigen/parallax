import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  builtinCameraPositionGuess,
  capturePolicy,
  nextZoomStep,
  confidenceOf,
  extrapolateScreen,
  inchesFromLabel,
  intrinsicsFromHfov,
  matchCamera,
  notchTell,
  rankScreens,
} from '../src/device/heuristics';
import { parseDeviceIndex } from '../src/device/index';
import { detectPlatform, modelFromUserAgent, type Observation } from '../src/device/observation';

const index = parseDeviceIndex(
  readFileSync(new URL('../config/devices.yaml', import.meta.url), 'utf8'),
);

function obs(o: Partial<Observation>): Observation {
  return {
    platform: 'macos',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    cssWidth: 1512,
    cssHeight: 982,
    availHeight: 945,
    dpr: 2,
    maxTouchPoints: 0,
    cameras: [],
    ...o,
  };
}

describe('detectPlatform / modelFromUserAgent', () => {
  it('classifies desktop and mobile user agents', () => {
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'macOS')).toBe(
      'macos',
    );
    expect(detectPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', undefined, 5)).toBe(
      'ios',
    );
    expect(detectPlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios');
    expect(
      detectPlatform('Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A) Chrome/120', 'Android'),
    ).toBe('android');
    expect(detectPlatform('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Windows')).toBe('windows');
    expect(detectPlatform('Mozilla/5.0 (X11; Linux x86_64)')).toBe('linux');
  });
  it('extracts the Android model and ignores the reduced-UA placeholder', () => {
    expect(
      modelFromUserAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240405) Chrome/124'),
    ).toBe('Pixel 8');
    expect(modelFromUserAgent('Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36')).toBe(
      'SM-S918B',
    );
    expect(modelFromUserAgent('Mozilla/5.0 (Linux; Android 10; K) Chrome/124')).toBeUndefined();
  });
});

describe('rankScreens on Macs', () => {
  it('finds the 14-inch MacBook Pro M4 exactly at default scaling', () => {
    const [best] = rankScreens(
      obs({ gpu: 'ANGLE (Apple, ANGLE Metal Renderer: Apple M4 Max, Unspecified Version)' }),
      index,
    );
    expect(best?.entry.id).toBe('apple-mbp-14-m4');
    expect(confidenceOf(best)).toBe('exact');
    expect(best?.reasons).toContain('css mode 1512x982');
  });

  it('still finds it at "More Space" scaling', () => {
    const [best] = rankScreens(
      obs({ cssWidth: 1800, cssHeight: 1169, gpu: 'Apple M4 Max' }),
      index,
    );
    expect(best?.entry.id).toBe('apple-mbp-14-m4');
  });

  it('does not confuse the 16-inch with the 14-inch', () => {
    const [best] = rankScreens(
      obs({ cssWidth: 1728, cssHeight: 1117, gpu: 'Apple M4 Pro' }),
      index,
    );
    expect(best?.entry.id).toBe('apple-mbp-16-m4');
    expect(confidenceOf(best)).toBe('exact');
  });

  it('separates the M1 Air (no notch) from the M2 Air (notch)', () => {
    const m1 = rankScreens(
      obs({ cssWidth: 1440, cssHeight: 900, availHeight: 875, gpu: 'Apple M1' }),
      index,
    )[0];
    const m2 = rankScreens(
      obs({ cssWidth: 1280, cssHeight: 832, availHeight: 795, gpu: 'Apple M2' }),
      index,
    )[0];
    expect(m1?.entry.id).toBe('apple-mbp-13-m1');
    expect(m2?.entry.id).toBe('apple-mba-13');
  });

  it('uses the chip to pick the M4 generation when the panel is shared', () => {
    const [best] = rankScreens(obs({ gpu: 'Apple M3 Pro' }), index);
    expect(best?.entry.id).toBe('apple-mbp-14');
  });

  it('reads the notch tell from the menu bar height', () => {
    expect(notchTell(obs({}))).toBe(true);
    expect(notchTell(obs({ availHeight: 957 }))).toBe(false);
    expect(notchTell(obs({ availHeight: 900 }))).toBeUndefined();
    expect(notchTell(obs({ platform: 'windows' }))).toBeUndefined();
  });
});

describe('rankScreens on phones', () => {
  it('finds an iPhone from its logical size in either orientation', () => {
    const portrait = rankScreens(
      obs({ platform: 'ios', cssWidth: 393, cssHeight: 852, dpr: 3, availHeight: 852 }),
      index,
    )[0];
    const landscape = rankScreens(
      obs({ platform: 'ios', cssWidth: 852, cssHeight: 393, dpr: 3, availHeight: 393 }),
      index,
    )[0];
    expect(portrait?.entry.id).toBe('apple-iphone-14-pro');
    expect(landscape?.entry.id).toBe('apple-iphone-14-pro');
    expect(confidenceOf(portrait)).toBe('exact');
  });

  it('finds an Android phone from its model string', () => {
    const [best] = rankScreens(
      obs({
        platform: 'android',
        cssWidth: 412,
        cssHeight: 915,
        dpr: 2.625,
        availHeight: 915,
        model: 'Pixel 8',
      }),
      index,
    );
    expect(best?.entry.id).toBe('google-pixel-8');
    expect(best?.reasons.some((r) => r.startsWith('model'))).toBe(true);
    const pro = rankScreens(
      obs({
        platform: 'android',
        cssWidth: 412,
        cssHeight: 915,
        dpr: 3.5,
        availHeight: 915,
        model: 'Pixel 8 Pro',
      }),
      index,
    )[0];
    expect(pro?.entry.id).toBe('google-pixel-8-pro');
  });
});

describe('extrapolateScreen', () => {
  it('guesses a 15.6-inch laptop for 1920x1080 at dpr 1.25 on Windows', () => {
    const g = extrapolateScreen(
      obs({ platform: 'windows', cssWidth: 1536, cssHeight: 864, dpr: 1.25, availHeight: 824 }),
    );
    expect(g.width_mm).toBeCloseTo(345.2, 0);
    expect(g.height_mm).toBeCloseTo(194.2, 0);
    expect(g.reasons[0]).toContain('15.6-inch');
  });

  it('guesses a 27-inch monitor for 4K at dpr 2 on macOS without a notch', () => {
    const g = extrapolateScreen(
      obs({ cssWidth: 1920, cssHeight: 1080, dpr: 2, availHeight: 1055 }),
    );
    expect(g.width_mm).toBeGreaterThan(400);
    expect(g.notch).toBe(false);
  });

  it('uses a monitor label with an embedded diagonal', () => {
    const g = extrapolateScreen(
      obs({
        platform: 'windows',
        cssWidth: 2560,
        cssHeight: 1440,
        dpr: 1.5,
        availHeight: 1400,
        screenLabel: 'DELL U2720Q',
        isInternal: false,
      }),
    );
    expect(g.reasons[0]).toContain('27-inch');
    expect(g.width_mm).toBeCloseTo(597.7, 0);
  });

  it('uses the Android 160 dp/inch definition and the iOS ppi by dpr', () => {
    const a = extrapolateScreen(
      obs({ platform: 'android', cssWidth: 412, cssHeight: 915, dpr: 2.625, availHeight: 915 }),
    );
    expect(a.width_mm).toBeCloseTo(65.4, 0);
    const i = extrapolateScreen(
      obs({ platform: 'ios', cssWidth: 390, cssHeight: 844, dpr: 3, availHeight: 844 }),
    );
    expect(i.width_mm).toBeCloseTo(64.6, 0);
  });
});

describe('inchesFromLabel', () => {
  it('reads common monitor model numbers', () => {
    expect(inchesFromLabel('DELL U2720Q')).toBe(27);
    expect(inchesFromLabel('LG 27GL850')).toBe(27);
    expect(inchesFromLabel('Samsung S32B800')).toBe(32);
    expect(inchesFromLabel('BenQ PD3220U')).toBe(32);
    expect(inchesFromLabel('Built-in Retina Display')).toBeUndefined();
  });
});

describe('cameras', () => {
  it('matches labels and disambiguates FaceTime HD by max height', () => {
    expect(matchCamera({ label: 'MacBook Pro Camera', deviceId: 'a' }, index).entry.id).toBe(
      'apple-12mp-center-stage',
    );
    expect(
      matchCamera({ label: 'FaceTime HD Camera', deviceId: 'b', maxHeightPx: 1080 }, index).entry
        .id,
    ).toBe('apple-facetime-hd-1080p');
    expect(
      matchCamera({ label: 'FaceTime HD Camera', deviceId: 'b', maxHeightPx: 720 }, index).entry.id,
    ).toBe('apple-facetime-hd-720p');
    expect(matchCamera({ label: 'MX Brio', deviceId: 'c' }, index).entry.id).toBe(
      'logitech-mx-brio',
    );
    expect(matchCamera({ label: 'camera2 1, facing front', deviceId: 'd' }, index).entry.id).toBe(
      'android-front-generic',
    );
  });

  it('falls back to the generic entry for unknown labels', () => {
    const m = matchCamera({ label: 'USB2.0 PC CAMERA', deviceId: 'e' }, index);
    expect(m.generic).toBe(true);
    expect(m.entry.id).toBe('generic-uvc');
  });

  it('derives intrinsics from a horizontal FOV', () => {
    const k = intrinsicsFromHfov(90, 1280, 720);
    expect(k.fx_px).toBeCloseTo(640, 6);
    expect(k.cx_px).toBe(640);
    expect(intrinsicsFromHfov(72, 1280, 720).fx_px).toBeCloseTo(880.9, 0);
  });

  it('places built-in cameras by panel type', () => {
    expect(builtinCameraPositionGuess(196.4, true)[1]).toBeCloseTo(94.7);
    expect(builtinCameraPositionGuess(179.1, false)[1]).toBeCloseTo(95.55);
    expect(builtinCameraPositionGuess(141.1, false, 'ios')[1]).toBeCloseTo(64.55);
  });
});

describe('capture policy and zoom fallback', () => {
  it('asks phones for the front camera at the widest zoom; desktops get no extra constraints', () => {
    expect(capturePolicy('ios')).toEqual({ facing_mode: 'user', zoom: 'widest' });
    expect(capturePolicy('android')).toEqual({ facing_mode: 'user', zoom: 'widest' });
    expect(capturePolicy('macos')).toEqual({});
  });

  it('steps zoom toward 1x and stops there', () => {
    expect(nextZoomStep(0.5)).toBeCloseTo(0.625);
    expect(nextZoomStep(0.9)).toBe(1);
    expect(nextZoomStep(1)).toBeUndefined();
  });
});
