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

- Open `http://localhost:5173/?tracker=mouse` to drive the eye position with the mouse (no camera).
- Press `f` for fullscreen (the physical-size math assumes the browser knows where it sits on the
  display; fullscreen makes that exact). Press `h` for the latency HUD, `d` for the camera debug view.
- On macOS, turn **Center Stage off** and zoom to **1x** in the Video menu (menu-bar camera icon
  while the page uses the camera); otherwise the camera intrinsics drift at runtime.

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
