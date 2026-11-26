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

A landing dialog explains the demo, lets you pick a scene and starts tracking (the webcam is
requested only when you press Start). Sit about half a metre from the screen. The dropdown in
the top-right corner switches scenes later (the checkerboard box is the default; the raccoon
family is a Gaussian splat). `?intro=0` skips the dialog.

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

### URL parameters

| Parameter                                               | Effect                                                                                                                             |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `?scene=<id>`                                           | Scene from `config/scenes.yaml` (`room`, `racoon`), `reference` (depth posts out to 30 m), or a URL/path to a `.glb` or splat file |
| `?scene_scale=`, `?scene_pos=x,y,z`, `?scene_rot=p,y,r` | Placement of a scene without a `window` node: uniform scale, position (mm), rotation (deg)                                         |
| `?tracker=mouse`                                        | Drive the eye with the mouse (wheel for distance) instead of the camera                                                            |
| `?tracker=static&eye=x,y,z`                             | Fixed eye position (mm), for screenshots and tests                                                                                 |
| `?camera=<id>`                                          | Camera id from the resolved device (e.g. `logitech-mx-brio`)                                                                       |
| `?device=<screen id>`                                   | Force a display entry from `config/devices.yaml` (remembered per screen)                                                           |
| `?screen_mm=WxH`                                        | Pin the physical display size (mm)                                                                                                 |
| `?viewport=full`                                        | Assume the viewport covers the whole display (exact in fullscreen)                                                                 |
| `?eye_offset=x,y,z`                                     | Override the eye offset (mm); `0,0,0` is the strict window                                                                         |
| `?blink=0`                                              | Disable blink holding and the separation guard (for comparison)                                                                    |
| `?lighting=off\|environment\|full`                      | Camera-based lighting mode at start                                                                                                |
| `?intro=0`                                              | Skip the landing dialog                                                                                                            |
| `?hud=1`                                                | Show the HUD at load                                                                                                               |
| `?glass=1`                                              | Show the screen-plane frame and vanishing-point marker at load                                                                     |
| `?diag=1`                                               | Log the first tracker results in full (matrix included)                                                                            |

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

## Privacy

The webcam video is processed entirely in the browser tab by a face-tracking model running on
your machine. No frame is stored, uploaded, or shared, and nothing derived from the camera is
sent anywhere. The only persisted data are calibration numbers (display, camera focal length,
eye offset) in the browser's local storage, which contain no images. The landing dialog says
the same and links to a short privacy note.

## Documentation

See [`docs/README.md`](docs/README.md) for the architecture, coordinate conventions, projection
math, tracking pipeline, calibration procedure and scene-authoring rules.

## License

MIT. See [LICENSE](LICENSE). Scene assets carry their own licences and credits, listed in
[`config/scenes.yaml`](config/scenes.yaml) and shown on screen.
