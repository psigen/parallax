# parallax

A browser demo where the screen behaves like a physical window into a 3D scene. A webcam tracks
the viewer's eyes; the renderer uses an off-axis perspective projection so the scene shows the
geometrically correct parallax for the viewer's actual eye position relative to the display.

Priorities, in order: **projection correctness**, then **tracking latency**, then everything else.

Live build: **https://parallax.pras.ai** (deployed from `main` by GitHub Pages; needs a browser
with webcam access, Chrome or Safari).

## Quick start

```sh
fnm install            # Node 26 from .node-version (or any Node >= 26)
npm install
npm run dev            # http://localhost:5173
```

The page asks for the webcam and starts tracking. Sit about half a metre from the screen.

- On macOS, turn **Center Stage off** and zoom to **1x** in the Video menu (menu-bar camera icon
  while the page uses the camera); otherwise the camera intrinsics drift at runtime.
- Press `F` for fullscreen: the physical-size math is exact there. Press `c` once to calibrate
  the focal length at a measured distance (see [docs/calibration.md](docs/calibration.md)).

| Key             | Action                                                                                |
| --------------- | ------------------------------------------------------------------------------------- |
| `h`             | latency HUD (hidden by default)                                                       |
| `d`             | camera debug view (mirrored feed, iris landmarks, depth)                              |
| `s`             | tracking scope: raw samples vs rendered eye over 3 s (lag, jitter, dropouts)          |
| `g`             | glass frame: lines drawn in the screen plane; must never move on screen               |
| `l`             | camera lighting: off → environment map → environment + key lights with shadows        |
| `t`             | live tuning panel (filter, prediction)                                                |
| `r`             | 100 mm ruler square to verify the physical mapping                                    |
| `F`             | fullscreen                                                                            |
| `c`             | calibrate focal length at a prompted distance                                         |
| `C`             | clear the stored calibration                                                          |
| `o`             | re-zero the vertical view: offset tracking so the current y reads 0                   |
| `O`             | revert the eye offset to the config value                                             |
| arrows, `[` `]` | nudge the eye point by 1 mm (Shift 10) / depth by 10 mm (Shift 50); stored per camera |
| `f`             | freeze the tracked eye position for alignment tests                                   |
| `p`             | copy a diagnostic snapshot to the clipboard                                           |
| `D`             | ask the browser for the display's label (Window Management permission) and re-detect  |
| `R`             | reset the filter                                                                      |

URL parameters: `?tracker=mouse` (drive the eye with the mouse, wheel for distance),
`?tracker=static&eye=250,0,550` (fixed eye), `?camera=mx-brio` (a camera id from the config),
`?viewport=full` (assume the viewport is the whole display), `?hud=1` (show the HUD at load), `?device=<screen id>` (force an index entry), `?screen_mm=WxH` (pin the display size), `?eye_offset=0,0,0` (override the eye offset; zero = strict window), `?lighting=off|environment|full` (camera lighting mode at start), `?scene=racoon` (a Gaussian splat from the manifest; `?scene_scale=`, `?scene_pos=x,y,z`, `?scene_rot=` place it), `?scene=reference` (depth markers
out to 30 m for checking parallax against real objects) or `?scene=<url>` (another glTF).

The display and camera are detected at startup (screen size, pixel ratio, platform, GPU and
camera labels matched against [`config/devices.yaml`](config/devices.yaml), rounding to the
nearest known device or extrapolating); the HUD `device` line says what was chosen. Overrides
and tuning live in [`config/default.yaml`](config/default.yaml); see
[docs/devices.md](docs/devices.md).

## Commands

| Command                | What it does                                                                  |
| ---------------------- | ----------------------------------------------------------------------------- |
| `npm run dev`          | Vite dev server                                                               |
| `npm run check`        | typecheck + lint + prettier check + unit tests (run before commits)           |
| `npm test`             | Vitest unit tests (pure math, no browser needed)                              |
| `npm run build`        | Production build to `dist/`                                                   |
| `npm run build:room`   | Regenerate `public/scenes/room.glb` from `scripts/build-room.ts`              |
| `npm run fetch:scenes` | Download external scene assets from `config/scenes.yaml` (run before `build`) |
| `npm run fetch:models` | Re-download the MediaPipe face landmarker model                               |

## Documentation

See [`docs/README.md`](docs/README.md) for the architecture, coordinate conventions, projection
math, tracking pipeline, calibration procedure and scene-authoring rules.
