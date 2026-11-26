# Architecture

## Stack

TypeScript, Vite, Three.js (`WebGLRenderer`), MediaPipe Tasks Vision `FaceLandmarker`, Vitest.
Chosen because the latency budget is dominated by camera capture (33 ms frame interval on a
30 fps webcam plus sensor/USB delivery) and GPU inference, neither of which a different
application language improves. The tracker sits behind a small interface so a different
implementation (ONNX Runtime Web, a Rust/WASM module) can be swapped in and judged by the
latency HUD.

## Data flow

```
getUserMedia ─▶ <video> ─▶ requestVideoFrameCallback ─▶ ImageBitmap ──(transfer)──▶ Worker
                                                                                     │ FaceLandmarker (GPU)
 main thread ◀───────────────── TrackerSample {iris L/R, yaw, tCapture, timings} ◀──┘
     │
     ├─ eyeEstimator  : iris px + intrinsics + IPD  → eye position (mm, screen frame)
     ├─ OneEuroVec3   : smooth, estimate velocity    (timestamped by capture time)
     └─ rAF loop      : predictor → eye at display time (+ eye_offset_mm, or frozen by `f`)
                        viewportRect → physical rect of the viewport
                        CameraLighting.tick → environment map (optional, `l`)
                        OffAxisCamera.setEye/setScreen → render (+ glass frame, HUD, scope)
```

The render loop runs at display refresh independent of the camera rate; prediction fills the gap
between camera samples and hides capture latency.

## Repository layout

```
config/default.yaml       all physical + tuning parameters (see docs/calibration.md)
src/config/               zod schema + YAML loader
src/math/                 pure, renderer-independent math (fully unit tested)
  offAxisProjection.ts    off-axis frustum + Kooima general form
  viewportRect.ts         browser viewport → physical rectangle
  eyeEstimator.ts         iris landmarks → eye position; focal-length calibration
  oneEuro.ts, predictor.ts
src/tracking/             camera source, MediaPipe worker, Tracker interface, mouse tracker
src/render/               OffAxisCamera, glTF scene loader, render loop
src/lighting/             webcam -> environment map + key lights (docs/lighting.md)
src/ui/                   HUD, debug overlay, key bindings
scripts/build-room.ts     generates public/scenes/room.glb
scripts/smoke.ts          headless Chrome end-to-end boot check with a fake camera (npm run smoke)
public/models/            vendored face_landmarker.task (Apache-2.0)
tests/                    Vitest suites (Node, no browser)
docs/                     this documentation
```

## Quality gates

`npm run check` = typecheck (three tsconfigs: app, tests, node scripts) + eslint (type-aware,
zero warnings) + prettier + vitest. CI runs it plus a production build on every push and PR.
