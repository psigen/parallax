import type { ScreenRect } from './offAxisProjection';

/** The browser metrics needed to locate the viewport on the physical display (all CSS px). */
export interface BrowserMetrics {
  /** window.screen.width / height */
  screenWidth: number;
  screenHeight: number;
  /** window.screenX / screenY: position of the window's outer top-left on the screen. */
  screenX: number;
  screenY: number;
  outerWidth: number;
  outerHeight: number;
  innerWidth: number;
  innerHeight: number;
}

export interface PhysicalScreen {
  width_mm: number;
  height_mm: number;
}

/**
 * Physical rectangle (screen-frame mm, origin at the display centre, y up) covered by the browser
 * viewport. Assumes square pixels, that `screen.width` spans the full active-area width, and that
 * the window chrome is at the top with side borders of equal width (true for every current
 * desktop browser; exact in fullscreen where chrome is zero).
 */
export function viewportRectMm(m: BrowserMetrics, screen: PhysicalScreen): ScreenRect {
  const mmPerPx = screen.width_mm / m.screenWidth;
  const chromeW = Math.max(0, m.outerWidth - m.innerWidth);
  const chromeH = Math.max(0, m.outerHeight - m.innerHeight);
  const vxPx = m.screenX + chromeW / 2;
  const vyPx = m.screenY + chromeH;

  const left = vxPx * mmPerPx - screen.width_mm / 2;
  const top = screen.height_mm / 2 - vyPx * mmPerPx;
  return {
    left,
    right: left + m.innerWidth * mmPerPx,
    top,
    bottom: top - m.innerHeight * mmPerPx,
  };
}

export function readBrowserMetrics(w: Window): BrowserMetrics {
  return {
    screenWidth: w.screen.width,
    screenHeight: w.screen.height,
    screenX: w.screenX,
    screenY: w.screenY,
    outerWidth: w.outerWidth,
    outerHeight: w.outerHeight,
    innerWidth: w.innerWidth,
    innerHeight: w.innerHeight,
  };
}

export const rectWidth = (r: ScreenRect): number => r.right - r.left;
export const rectHeight = (r: ScreenRect): number => r.top - r.bottom;
export const scaleRect = (r: ScreenRect, s: number): ScreenRect => ({
  left: r.left * s,
  right: r.right * s,
  bottom: r.bottom * s,
  top: r.top * s,
});
