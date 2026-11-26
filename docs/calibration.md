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

## Diagnosing "the scale feels wrong"

Press `p` to copy a diagnostic snapshot (HUD, browser metrics, camera settings, the last
tracker reading and the tracking config) to the clipboard; paste it into an issue or a chat.
Then work through these, in order; each isolates one factor.

1. **Is the depth right?** Open the debug view (`d`). Calibrate (`c`) at 500 mm, then move to
   a measured 300 mm and 700 mm. The `depth` readout should match within ~5 %. If it drifts
   more, suspect: Center Stage/zoom reframing (watch the preview: does the crop change?), an IPD
   that is not yours, or large head yaw (the `yaw` readout should be near 0° when facing the
   camera; toggle `yaw correction` in the tuning panel (`g`) and see if depth becomes stable).
2. **Is the viewport mapping right?** `m` draws a 100 mm square; measure it. Compare the
   `browser` HUD line in fullscreen: on a 14-inch MacBook Pro at default scaling, `inner` should
   be 1512 wide. If the browser leaves a band for the notch, `inner` height is less than
   `screen` height and the window is shifted down; the mapping handles that only if
   `screenY`/`outerHeight` report it. `?viewport=full` ignores all of that and assumes the
   viewport is the whole panel.
3. **Is it geometry or perception?** The projection is exact for _one_ eye. Close one eye and
   set `render for` in the tuning panel to that eye. If the window illusion is now convincing
   (objects on the glass stay put, the room edges are rigid), the math is right and what felt
   wrong with both eyes open is the stereo conflict: a flat display shows both eyes the same
   image, which the brain reads as "flat", and it fights the motion parallax. That is inherent to
   a monocular display.
4. **Quantify the residual.** `parallax gain` scales the eye's lateral offset. If some gain other
   than 1.0 "feels right" with one eye closed, the depth scale is off by roughly that factor:
   objects behind the glass move by `Δx · d / (Z + d)`, so an under-estimated `Z` exaggerates
   motion (you would prefer gain < 1). Re-check step 1.
5. **Iris centres move with gaze.** The iris centre shifts a couple of mm as you look around the
   screen, which is ~3–5 % of the separation: expect a few percent of depth wobble that follows
   where you look. That is a limitation of the measurement, not the calibration.

## "Far objects move with me"

Relative to your line of sight, nothing behind the glass should ever move _with_ you; an object
at depth `d` behind the glass moves on the glass by `Δx · d / (Z + d)`, always less than your
own `Δx`, so it swings against you, by less the farther it is, and infinity stays put. If far
content follows you, either the lateral estimate is exaggerated or both eyes are open and the
flat display's stereo cue is winning. Separate them objectively:

1. Put a ruler on the desk. Move your head a measured 100 mm sideways and watch the HUD
   `eye mm` x. It must change by ~100. If it changes by much more, the lateral estimate is
   wrong: check the `browser` line (`screen` must be the panel the config describes, 1512 wide on
   the 14-inch MacBook at default scaling; on an external monitor the config's `width_mm` is
   wrong for it) and the `viewport` line (302.4 mm wide in fullscreen).
2. Open `?scene=reference`: posts at 0.3, 1, 3, 10 and 30 m. Line up the 30 m bar with a real
   object a few metres behind the laptop (a door frame, a wall corner) and move your head. The
   two should stay together; the 0.3 m post should swing against you. If the 30 m bar outruns
   the real object, the scale is exaggerated; measure step 1.
3. Close one eye (and set `render for` to that eye in `g`). If far markers now hold still,
   the geometry is right and the two-eyed impression was the stereo conflict.

## The parallels test (vanishing point)

Stand the display vertical on a flat table and lay real straight edges on the table running
straight into the screen (parallel to its normal). Lines parallel to the screen normal, real or
virtual, converge to one point on the glass: the foot of the eye, (eye x, eye y). With one eye
closed, the box's floor lines and the real edges must therefore appear to converge to the same
point. The convergence does **not** depend on eye distance, so this test isolates the eye's
lateral position.

- Virtual lines converge more sharply than the real ones: the renderer places the eye lower
  (or closer to the lines) than it is. The usual cause is the eye offset: it is a deliberate
  lie and must be zero for any comparison with the real world. Press `O`, then use
  `?eye_offset=0,0,0` (or set `viewer.eye_offset_mm: [0, 0, 0]`).
- Press `w`: the diamond on the glass-plane frame marks the vanishing point the renderer is
  using. Sight along a real edge; it should point at the diamond. If it misses by a constant
  amount with the offset at zero, adjust `extrinsics.position_mm` (the vanishing point moves 1:1
  with the eye estimate).

## The ruler-on-screen test (objective)

Mark where an object appears on the screen, move your head a measured `Δx` sideways, mark again,
and measure the shift with a ruler on the glass. With the eye `Z` from the screen:

- object `d` behind the glass: shifts `Δx · d / (Z + d)` in the **same** direction as your head
  (the room's back wall, 300 mm behind, at Z = 550 mm: 35 mm per 100 mm of head travel);
- object `d` in front of the glass: shifts `Δx · d / (Z − d)` in the **opposite** direction
  (the room's yellow sphere, 50 mm in front: 10 mm; the reference scene's, 100 mm in front:
  22 mm).

Lateral tracking does not depend on the focal length (it cancels between depth and lateral
position), so `eye mm` x can be right while z is wrong. If the measured shifts are too small by
a constant factor, `Z` is overestimated by about that factor: compare `eye mm` z with a tape
measure and calibrate (`c`). A factor near 2 means the camera is in its wide (0.5x) mode.

## "Looking at the screen centre looks down into the scene"

Expected for a true window below eye level, and the scene is deliberately never tilted to hide
it (the screen is a flat plate; see [scene-authoring.md](scene-authoring.md)). The sanctioned
adjustment is `viewer.eye_offset_mm`, a constant added to every tracked eye position. It
defaults (`null`) to the negated camera position, so an eye centred in the camera image reads
x 0, y 0: the view is "straight in" when you are on the camera's axis. Press `o` while sitting
normally to re-zero only the Y component at your current height (x and z are never touched;
the value is stored per camera and the console prints the YAML line). `O` reverts to the
default. Set `[0, 0, 0]` for a strictly correct window measured from the display centre.
Parallax from head _motion_ is unaffected by any of this.

Checking the camera extrinsic: with `[0, 0, 0]` and your eyes level with the camera, the HUD
`eye mm` y should read about +95 (the camera's height above the display centre). A consistent
offset points at `extrinsics.position_mm`; an offset that grows with distance points at
`extrinsics.rotation_deg` (camera pitch).

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
