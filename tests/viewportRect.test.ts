import { describe, expect, it } from 'vitest';
import {
  fullScreenRectMm,
  rectHeight,
  rectWidth,
  viewportRectMm,
  type BrowserMetrics,
} from '../src/math/viewportRect';

const mbp14 = { width_mm: 302.4, height_mm: 196.4 };

const fullscreen: BrowserMetrics = {
  screenWidth: 1512,
  screenHeight: 982,
  screenX: 0,
  screenY: 0,
  outerWidth: 1512,
  outerHeight: 982,
  innerWidth: 1512,
  innerHeight: 982,
};

describe('viewportRectMm', () => {
  it('covers the whole display in fullscreen', () => {
    const r = viewportRectMm(fullscreen, mbp14);
    expect(r.left).toBeCloseTo(-151.2);
    expect(r.right).toBeCloseTo(151.2);
    expect(r.top).toBeCloseTo(98.2);
    expect(r.bottom).toBeCloseTo(-98.2);
  });

  it('accounts for window position and browser chrome', () => {
    const windowed: BrowserMetrics = {
      ...fullscreen,
      screenX: 100,
      screenY: 50,
      outerWidth: 1000,
      outerHeight: 700,
      innerWidth: 1000, // no side borders
      innerHeight: 620, // 80 px of tabs/toolbar at the top
    };
    const r = viewportRectMm(windowed, mbp14);
    const mmPerPx = 0.2;
    expect(r.left).toBeCloseTo(100 * mmPerPx - 151.2);
    expect(rectWidth(r)).toBeCloseTo(1000 * mmPerPx);
    expect(r.top).toBeCloseTo(98.2 - (50 + 80) * mmPerPx);
    expect(rectHeight(r)).toBeCloseTo(620 * mmPerPx);
  });

  it('splits side chrome evenly', () => {
    const r = viewportRectMm({ ...fullscreen, outerWidth: 1512, innerWidth: 1500 }, mbp14);
    expect(r.left).toBeCloseTo(-151.2 + 6 * 0.2);
    expect(r.right).toBeCloseTo(151.2 - 6 * 0.2);
  });

  it('uses the display width, not height, to set the pixel pitch', () => {
    // macOS reports the full panel height incl. the notch rows; width is the reliable axis.
    const r = viewportRectMm(
      { ...fullscreen, screenHeight: 945, outerHeight: 945, innerHeight: 945 },
      mbp14,
    );
    expect(rectWidth(r)).toBeCloseTo(302.4);
    expect(rectHeight(r)).toBeCloseTo(945 * 0.2);
  });
});

describe('fullScreenRectMm', () => {
  it('is the display rectangle centred on the origin', () => {
    const r = fullScreenRectMm(mbp14);
    expect(r.left).toBeCloseTo(-151.2);
    expect(r.right).toBeCloseTo(151.2);
    expect(r.top).toBeCloseTo(98.2);
    expect(r.bottom).toBeCloseTo(-98.2);
  });
});
