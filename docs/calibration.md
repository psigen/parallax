# Calibration and verification

The display and camera parameters are resolved at startup by device detection
([devices.md](devices.md)); the HUD `device` line shows what was chosen and how confident the
match is, and `config/default.yaml` can override any of it. Calibration overrides made at
runtime (`c`, `o`, arrow nudges) are stored per camera id in `localStorage` and printed as YAML
lines to paste back into the config; `C` and `O` clear them. Keys referenced below are listed
in the README.

## 1. What matters, in order

1. **Display size** (`device.screen`, from the index or `width_mm`/`height_mm`). Exact when the
   device is matched; an extrapolated size is flagged `guessed` on the HUD and should be pinned
   with `?screen_mm=WxH` or a config entry after measuring.
2. **Focal length** (from the camera entry's nominal FOV, or `intrinsics`). Sets the absolute
   depth scale. Nominal FOVs are estimates; calibrate (section 3).
3. **Camera position** (from the index, or `position_mm`). Shifts every eye estimate by a
   constant. Built-in cameras are placed from the screen entry; external ones from a mount guess.
4. **IPD** (`viewer.ipd_mm`). Scales depth linearly. 63 mm is the adult average; measure yours
   in a mirror with a ruler for better than ~5 % depth accuracy.
5. **Eye offset** (`viewer.eye_offset_mm`, default `[0, 0, 0]`). A constant added to the tracked
   eye. Zero is the strict window; anything else is a deliberate shift (section 5).

## 2. Before anything else: macOS Center Stage

The 12 MP camera in M4 MacBooks crops and zooms the sensor digitally. With Center Stage on, the
effective focal length changes _continuously_ as it reframes you, and no calibration can hold.
While a page is using the camera, open the green camera icon in the menu bar (the Video menu)
and set **Center Stage: off**, zoom **1x**. The setting is system-wide and persists.

## 3. Focal length (depth scale)

Sit with your eyes a measured distance from the screen surface (tape measure to the bridge of
the nose; 500 mm is convenient), look straight at the camera, press `c` and enter the distance.
The app solves `fx = d_px · distance / IPD` from the current iris separation and applies it.
Repeat at two distances; if the results differ by more than a few percent, the camera is
reframing (section 2) or the IPD is off.

Check: the `depth` readout in the debug view (`d`) should track a tape measure within a few cm
from 300 to 900 mm. Lateral tracking does **not** depend on the focal length (it cancels
between depth and lateral position), so `eye mm` x can be right while z is wrong.

## 4. Viewport placement (physical mapping)

Press `r` to draw a 100 mm square and measure it in both directions. If it is not 100 mm, the
browser's screen metrics do not match the config's `width_mm`: in fullscreen use
`?viewport=full`, windowed set `screen.viewport_override_mm`. The HUD `browser` line shows the
raw metrics; on the 14-inch panel at default scaling `screen` is 1512 wide, and in fullscreen
`inner` may be 945 tall if the browser leaves a band for the notch (the mapping accounts for it
when `screenY`/`outerHeight` report it). If the square is right but the picture is not square,
nothing else can be.

## 5. Eye offset and the centre of projection

The renderer's eye point is the tracked iris centre plus `eye_offset_mm`. The true centre of
projection is the eye's entrance pupil, which should coincide with the tracked point to about a
millimetre; that is a claim to measure (section 6), not assume.

- **Zero** is the geometrically exact window. A laptop display sits below eye level, so the
  correct view looks slightly down into the scene (floor-heavy); that is right, and the scene is
  never tilted to hide it (the screen is a flat plate, see
  [scene-authoring.md](scene-authoring.md)).
- **`o`** re-zeroes only the Y component at your current height, so looking at the screen
  centre looks straight into the scene. It is a lie by exactly that amount and invalidates
  every comparison with real-world geometry below. `O` reverts to the config value.
- **Arrow keys** nudge the offset by 1 mm (Shift: 10 mm); `[` and `]` nudge depth by 10 mm
  (Shift: 50 mm). The HUD `eye` line shows the offset in force.
- With the offset at zero and your eyes level with the camera, `eye mm` y should read about
  +95 (the camera's height above the display centre). A constant error points at
  `extrinsics.position_mm`; one that grows with distance points at `extrinsics.rotation_deg`.

## 6. The parallels test (vanishing point)

Stand the display vertical on a flat table and lay real straight edges on the table running
straight into the screen (parallel to its normal). Lines parallel to the screen normal, real or
virtual, converge to one point on the glass: the foot of the eye, (eye x, eye y). With one eye
closed, the box's floor lines and the real edges must appear to converge to the same point. The
convergence does **not** depend on eye distance, so this test isolates the eye's lateral
position. Press `g`: the diamond on the glass-plane frame marks the vanishing point the
renderer is using; sight along a real edge and it should point there.

Before judging, set up for one eye: offset zero (`O`, or `?eye_offset=0,0,0`) and, in the
tuning panel (`t`), "render for" set to the open eye. The default is the midpoint of both
irises, 31 mm from either eye, which puts the vanishing point 31 mm off sideways, an error no
screen tilt can cancel.

**Measuring the effective centre of projection.** Press `f` to freeze the tracked eye so jitter
does not move the vanishing point. Nudge with the arrows (and `[` `]` for depth) until the
virtual floor lines run into the real edges; read the offset off the HUD. Unfreeze (`f`), move
to a clearly different distance, repeat.

- Same offset at both distances: a real bias between the tracked point and the effective pupil
  (or in `position_mm`). Keep it in the config.
- Offset grows with distance: angular, so `rotation_deg`, or perception rather than geometry.
- A depth nudge changes foreshortening (how fast tiles shrink), never the vanishing point.

**Geometry or perception?** Photograph the screen with a phone lens at the eye's position, or
look through a ~1.5 mm pinhole. A camera has no surface awareness and no accommodation; if the
photo shows both families converging together, the geometry is correct and what the eye sees is
the picture-surface effect ([lessons-learned.md](lessons-learned.md)).

## 7. The ruler-on-screen test (parallax magnitude)

Mark where an object appears on the screen, move your head a measured `Δx` sideways, mark again,
and measure the shift with a ruler on the glass. With the eye `Z` from the screen:

- object `d` behind the glass: shifts `Δx · d / (Z + d)` in the **same** direction as your head
  (the room's back wall, 300 mm behind, at Z = 550 mm: 35 mm per 100 mm of head travel);
- object `d` in front of the glass: shifts `Δx · d / (Z − d)` in the **opposite** direction
  (the room's yellow sphere, 50 mm in front: 10 mm; the reference scene's, 100 mm in front:
  22 mm).

Nothing behind the glass ever moves _with_ you relative to your line of sight; infinity stays
put. If measured shifts are too small by a constant factor, `Z` is overestimated by about that
factor (section 3; a factor near 2 means the camera is in its wide 0.5x mode). If the shifts
are right but far objects still _feel_ like they follow you, both eyes are open: a flat display
tells both eyes everything is at screen distance, and the bezel is the dominant reference.
`?scene=reference` (posts out to 30 m) lets you compare against a real object behind the laptop.

## 8. Other checks

- **Lateral tracking**: move your head a measured 100 mm sideways; HUD `eye mm` x must change by
  ~100. Much more means the `browser`/`viewport` lines describe a different panel than the config.
- **Depth wobble with gaze**: the iris centre shifts a couple of mm as you look around, 3–5 % of
  the separation, so expect a few percent of depth wobble that follows your gaze. A measurement
  limit, not a calibration error.
- **Blinks**: open the scope (`s`) and blink a few times. Raw dots during the blink are drawn
  hollow (held) and the z trace shows no dip; the HUD `tracker` line reports `held: blink` and
  a `holds/min` count. Compare with `?blink=0`. Slow left-right sweeps without blinking must
  show no holds; if they do, the baseline does not fit your eyes: lower `enter_ratio` in `t` → blink hold.
- **Snapshot**: `p` copies the HUD, browser metrics, camera settings, last tracker reading and
  config to the clipboard for sharing.

## 9. Another camera or display

Plug it in and look at the HUD `device` line: recognised cameras get their index entry
(nominal FOV, mount guess), unknown ones a generic entry with a slug id. To make it exact, add
an entry to `config/devices.yaml` (see [devices.md](devices.md), "Adding a device"), or override
in `config/default.yaml` (`cameras: [{ ref: <id>, position_mm: [...] }]`), then calibrate the
focal length as in section 3. Select a camera with `?camera=<id>` or `default_camera`. For a
monitor, press `D` to let the browser report its label, or pin the size with `?screen_mm=WxH`.
