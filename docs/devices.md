# Device detection

The display's physical size and the camera's position and field of view are not observable from
a browser, yet the projection depends on them. `src/device/` fills `device.screen`,
`device.cameras` and `device.default_camera` from what _is_ observable plus an index of known
hardware, and says how confident it is. Nothing in the code names a particular device; the
index (`config/devices.yaml`) holds the data and the heuristics module decides.

## Structure (one rule: heuristics live in one file)

| File             | Role                                                                                                                                                                                                                                                                                                                                                       | Heuristic?          |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `observation.ts` | `probe()` collects facts: platform (UA data / UA string / touch points), CSS screen size, `devicePixelRatio`, `availHeight`, WebGL renderer string, Android model string; `probeCameras()` lists camera labels and max heights; `probeScreenDetails()` (key `D`) asks the Window Management API for the current screen's label and whether it is internal. | No: raw facts only. |
| `index.ts`       | zod schema and loader for `config/devices.yaml`.                                                                                                                                                                                                                                                                                                           | No: data.           |
| `heuristics.ts`  | Scoring weights, the macOS notch tell, model/label matching, pixel-pitch tables for extrapolation, FOV → intrinsics, camera placement guesses, capture policy (phones: front camera at widest zoom), the zoom fallback schedule, and the default-camera rule. Constants are at the top with comments.                                                      | **Yes, all of it.** |
| `resolve.ts`     | Precedence only: explicit config → forced device (`?device=`, stored) → heuristics. Produces `ScreenConfig`, `CameraConfig[]`, the default camera id and a `Provenance` per item.                                                                                                                                                                          | No.                 |

`main.ts` calls `probe()` → `probeCameras()` → `resolveDevice()` once, then runs on the resolved
values exactly as it did on the hand-written config. If the window moves to a display with a
different `css size @ dpr` signature it re-resolves and logs a warning.

## What is observable, per platform

| Platform                   | Strong signals                                                                                                                                                                               | Notes                                                                                                                                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS                      | CSS size equals one of the device's scaled modes (`css_modes`); notch tell: `screen.height − availHeight` is 37 px with a notch, 25 without; GPU string names the chip family (`gpu_hints`). | The CSS size is the _scaled_ mode, not native, so `css × dpr` is not usable; the mode list is device-specific and separates the 14-inch from the 16-inch at any scaling.                                      |
| Windows / Linux / ChromeOS | `css × dpr` equals the native resolution.                                                                                                                                                    | No model in the UA. Laptop panels share native resolutions with monitors; see `external` below.                                                                                                               |
| iOS                        | Logical size + dpr identifies the model (`css_modes`, `dpr`), in either orientation.                                                                                                         | iPadOS Safari presents a Macintosh UA; more than one touch point marks it as iOS.                                                                                                                             |
| Android                    | Model string from the UA (`Build/` token) or `userAgentData.getHighEntropyValues(['model'])` (`model_hints`).                                                                                | Chrome's reduced UA may give only `K`; then the high-entropy call is tried.                                                                                                                                   |
| Any (monitors)             | Window Management label (`labels`), after the `D` prompt.                                                                                                                                    | Entries marked `external: true` only count a native-resolution match as strong when the display is known to be external or runs unscaled (`dpr ≤ 1`), so a scaled laptop panel is not mistaken for a monitor. |

Confidence: **exact** = two strong signals, **nearest** = one, otherwise **guessed** and the size is
extrapolated. The HUD `device` line shows the name, source, confidence and reasons.

## Extrapolation (when nothing matches)

- macOS: 254 ppi if the notch tell is positive, 227 for other laptops, 218 for desktops, at 2x
  default scaling.
- iOS: 460 ppi for 3x panels, 326 for 2x.
- Android: a CSS px is 1/160 inch by definition (density buckets make this ±10 %).
- Windows/Linux: size class from native width and scaling (≤1600: 14-inch; 1920: 15.6-inch if
  scaled ≥ 125 % else 24-inch; 2560/3840: 16-inch if scaled else 27-inch).
- A monitor label with an embedded diagonal ("U2720Q", "27GL850", "S32B800") beats the size class.

Cameras: label substring match in the index (`label_match`, disambiguated by `max_height_px`),
else the `generic-uvc` entry with a slug of the label as id. Built-in cameras take the screen
entry's `builtin_camera.position_mm`; otherwise 3.5 mm below the top edge (notched panels),
6 mm above it (bezels), 6 mm below it (phones). External cameras use the entry's `mount` guess
relative to the display's top centre. Intrinsics come from `hfov_deg`: `fx = (W/2)/tan(hfov/2)`,
principal point at the centre. Every FOV in the index is an estimate unless `estimate: false`;
calibrate (`c`) to refine.

## Phones

The capture policy asks for `facingMode: user` and the camera's **widest** zoom (largest field
of view, most room to move). Digital zoom crops the sensor, so the tracker scales the focal
length by the zoom in effect. If the detector finds no face for 90 consecutive frames at a
wide zoom, the zoom is stepped toward 1x (×1.25 per step) until it does: the largest FOV with
good detection wins. The HUD `camera` line shows the zoom.

## Overrides and persistence

- `config/default.yaml`: `screen: { ref: <id>, width_mm?: … }` merges fields over an index
  entry; `screen: { name, width_mm, height_mm }` is explicit; `cameras: [{ ref, position_mm? }]`;
  `default_camera: <id>`.
- URL: `?device=<screen id>` forces an entry (remembered per screen signature in
  `localStorage`), `?screen_mm=WxH` pins the size, `?camera=<id>` picks a camera.
- Calibration overrides (`c`, `o`, arrow nudges) stay keyed by camera id, which is the index id
  (or `generic-<slug>`), so they survive re-detection.

## Adding a device

1. Add an entry to `config/devices.yaml`. Screens: native resolution, ppi (from the spec sheet)
   and the width/height they imply, the scaled-mode list (macOS: System Settings → Displays;
   phones: the logical size), `notch`, `gpu_hints` or `model_hints`, and the built-in camera
   with its lens position in the screen frame. Cameras: label substrings and a nominal horizontal
   FOV (convert a diagonal FOV with the 16:9 aspect).
2. `npm test`: `tests/deviceIndex.test.ts` checks ids are unique, sizes agree with native/ppi
   within 0.5 mm, css modes keep the aspect ratio, and camera references exist.
3. Add a case to `tests/deviceHeuristics.test.ts` with the observation the device produces
   (take it from the `p` snapshot on that machine) and the expected match.

Numbers in the index come from manufacturer specifications where published (Apple: resolution
and ppi; phones: diagonal and resolution) and are marked where estimated (camera FOVs, lens
positions).
