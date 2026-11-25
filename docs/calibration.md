# Calibration

All numbers live in `config/default.yaml`. The ones that matter most, in order:

1. **Display size** (`screen.width_mm`, `height_mm`). Exact from the panel spec. For the
   14-inch MacBook Pro: 3024 x 1964 px at 254 ppi → 302.4 x 196.4 mm.
2. **Focal length** (`cameras[].intrinsics.fx_px`, `fy_px`). Sets the absolute depth scale.
   Not published by Apple; calibrate (below).
3. **Camera position** (`cameras[].extrinsics.position_mm`). Shifts every eye estimate by a
   constant; a few mm of error is harmless. The MacBook camera is in the notch, top centre:
   `(0, 94.7, 0)`.
4. **IPD** (`viewer.ipd_mm`). Scales depth linearly. 63 mm is the adult average; measure yours
   with a ruler in a mirror if you want better than ~5 % depth accuracy.

## Before anything else: macOS Center Stage

The 12 MP camera in M4 MacBooks crops and zooms the sensor digitally. With Center Stage on, the
effective focal length changes _continuously_ as it reframes you, and no calibration can hold.
While a page is using the camera, open the green camera icon in the menu bar (the Video menu)
and set **Center Stage: off**, zoom **1x**. The setting is system-wide and persists.

## Focal length

Sit with your eyes a measured distance from the screen surface (a tape measure to the bridge of
the nose; 500 mm is convenient), look straight at the camera, and press `c`. Enter the distance
in mm. The app solves `fx = d_px · distance / IPD` from the current iris separation, applies it
immediately, stores it in `localStorage` for this camera id, and prints the values to paste into
the YAML. `x` clears the stored value. Repeat at two distances; if the results differ by more
than a few percent, the camera is probably reframing (see above) or the IPD is off.

A sanity check: after calibration the `depth` in the debug view (`d`) should track a tape measure
to within a few cm from 300 to 900 mm.

## Viewport placement

Press `m` to draw a 100 mm square. Measure it. If it is wrong, the browser's reported screen
metrics do not match the config's `width_mm`; in fullscreen use `?viewport=full`, windowed use
`screen.viewport_override_mm`.

## Another camera

Add an entry under `cameras:` with a `label_match` substring of the device name (see
`navigator.mediaDevices.enumerateDevices()` in devtools, or the HUD log line after start),
measure its lens position relative to the display centre, then calibrate the focal length as
above. Select it with `?camera=<id>` or make it `default_camera`. The MX Brio profile in the
default config is a starting point (1080p60; its FOV setting in Logi Options+ changes the
focal length, so recalibrate after changing it).
