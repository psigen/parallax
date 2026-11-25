# Tracking pipeline

Code: `src/tracking/`. Pure helpers in `src/math/eyeEstimator.ts`, `src/math/oneEuro.ts`,
`src/math/predictor.ts`.

## Stages

| Stage         | Where                                     | What                                                                                                                                                                                                                                                                                                                                          |
| ------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Capture       | `cameraSource.ts`, main thread            | `getUserMedia` on the device whose label contains `label_match`, with the configured resolution and frame rate as _ideal_ constraints. Frames are pulled with `requestVideoFrameCallback`, which fires once per new camera frame and carries `captureTime`. Each frame becomes an `ImageBitmap` and is transferred (zero-copy) to the worker. |
| Inference     | `faceLandmarker.worker.ts`, module Worker | MediaPipe `FaceLandmarker` (GPU delegate on an `OffscreenCanvas`, CPU fallback), `runningMode: VIDEO`, one face, transformation matrix on. Returns all 478 landmarks (for the debug view), yaw/pitch, and the inference time.                                                                                                                 |
| Back-pressure | `mediapipeTracker.ts`                     | Exactly one frame in flight. A frame that arrives while the worker is busy is **dropped**, never queued: a queued frame would only add latency. The HUD does not count drops yet; `MediapipeTracker.droppedFrames` does.                                                                                                                      |
| Eye estimate  | `eyeEstimator.ts`                         | Iris centres (landmarks 468/473) → pixel separation → depth `Z = fx · IPD · cos(yaw) / d_px`; midpoint back-projected at that depth; camera frame → screen frame via `extrinsics`.                                                                                                                                                            |
| Filter        | `eyeState.ts` + `oneEuro.ts`              | One Euro per axis, on the _capture-time_ clock, with the derivative kept as a velocity. The filter resets after a gap longer than `loss_timeout_ms`.                                                                                                                                                                                          |
| Predict       | `predictor.ts`                            | Each rendered frame asks for the eye at `tDisplay = rAF time + frame interval (+ extra_lead_ms)`. Position is extrapolated along the velocity, lead clamped to `max_lead_ms`.                                                                                                                                                                 |
| Loss          | `eyeState.ts`                             | No sample for `loss_timeout_ms`: ease (5 %/frame) back to `rest_eye_mm`.                                                                                                                                                                                                                                                                      |

## Why depth comes from the irises

MediaPipe's transformation matrix contains a translation, but it is computed by fitting a
canonical face under an assumed virtual-camera FOV, so its scale is not ours. The iris
separation is a direct measurement of a known physical length (the IPD) through _our_ camera
model, so with a calibrated focal length its depth is correct in absolute terms. Yaw from the
matrix is still used, because only its magnitude matters (`cos(yaw)`), which is the same whether
the matrix is read row- or column-major.

## Clocks

Everything on the main thread uses `performance.now()`. The worker's `performance.now()` has a
different origin, so the worker reports only _durations_ (inference ms) and the main thread
attaches capture and receipt times. `detectForVideo` requires strictly increasing timestamps;
the worker enforces that.

## Which point is rendered

`tracking.eye` picks the midpoint of the irises (`cyclopean`, default) or one eye. The
projection is only exact for a single centre of projection, so the one-eye modes exist to judge
correctness with the other eye closed. `tracking.parallax_gain` scales the eye's lateral offset
(1.0 = correct); it is a diagnostic knob.

## Trackers

`Tracker` (`types.ts`) is "something that emits timestamped `EyeSample`s". Implementations:
`MediapipeTracker` (default), `MouseTracker` (`?tracker=mouse`), `StaticTracker`
(`?tracker=static&eye=x,y,z`). A new tracker (ONNX, a Rust/WASM module) implements the same
interface and is compared on the HUD.

## Checking the sign conventions on real hardware

With the camera running and the debug view (`d`) open:

1. Move your head to **your right**: the HUD eye x must increase, and the scene must show more of
   the **left** wall. If x decreases, the stream is mirrored relative to the assumption: set
   `mirrored: true` for that camera.
2. Move **up**: eye y increases; you see more of the floor.
3. Move **closer**: eye z decreases; the HUD depth should match a tape measure after calibration.
