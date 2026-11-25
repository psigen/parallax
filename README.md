# parallax-demo

A browser demo where the screen behaves like a physical window into a 3D scene. A webcam tracks
the viewer's eyes; the renderer uses an off-axis perspective projection so the scene shows the
geometrically correct parallax for the viewer's actual eye position relative to the display.

Priorities, in order: **projection correctness**, then **tracking latency**, then everything else.

## Quick start

```sh
fnm install            # Node 26 from .node-version (or any Node >= 26)
npm install
npm run dev            # http://localhost:5173
```

The page asks for the webcam and starts tracking. Sit about half a metre from the screen.

- On macOS, turn **Center Stage off** and zoom to **1x** in the Video menu (menu-bar camera icon
  while the page uses the camera); otherwise the camera intrinsics drift at runtime.
- Press `f` for fullscreen: the physical-size math is exact there. Press `c` once to calibrate
  the focal length at a measured distance (see [docs/calibration.md](docs/calibration.md)).

| Key | Action                                                                        |
| --- | ----------------------------------------------------------------------------- |
| `h` | latency HUD                                                                   |
| `d` | camera debug view (mirrored feed, iris landmarks, depth)                      |
| `g` | live tuning panel (filter, prediction)                                        |
| `m` | 100 mm ruler square to verify the physical mapping                            |
| `f` | fullscreen                                                                    |
| `c` | calibrate focal length at a prompted distance                                 |
| `x` | clear the stored calibration                                                  |
| `o` | set the rest eye position (fallback when the face is lost) to the current one |
| `O` | clear the stored rest position                                                |
| `p` | copy a diagnostic snapshot to the clipboard                                   |
| `r` | reset the filter                                                              |

URL parameters: `?tracker=mouse` (drive the eye with the mouse, wheel for distance),
`?tracker=static&eye=250,0,550` (fixed eye), `?camera=mx-brio` (a camera id from the config),
`?viewport=full` (assume the viewport is the whole display), `?scene=reference` (depth markers
out to 30 m for checking parallax against real objects) or `?scene=<url>` (another glTF).

All physical parameters (display size, camera intrinsics and position, interpupillary distance,
filter tuning) live in [`config/default.yaml`](config/default.yaml).

## Commands

| Command                | What it does                                                        |
| ---------------------- | ------------------------------------------------------------------- |
| `npm run dev`          | Vite dev server                                                     |
| `npm run check`        | typecheck + lint + prettier check + unit tests (run before commits) |
| `npm test`             | Vitest unit tests (pure math, no browser needed)                    |
| `npm run build`        | Production build to `dist/`                                         |
| `npm run build:room`   | Regenerate `public/scenes/room.glb` from `scripts/build-room.ts`    |
| `npm run fetch:models` | Re-download the MediaPipe face landmarker model                     |

## Documentation

See [`docs/README.md`](docs/README.md) for the architecture, coordinate conventions, projection
math, tracking pipeline, calibration procedure and scene-authoring rules.
