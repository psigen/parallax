# Camera-based lighting

The webcam looks out through the window into the viewer's room. For the scene behind the glass
that image is the light arriving through the window, so it is used as the scene's lighting in
two ways. Code: `src/lighting/`. Key `l` cycles off → environment → full. Tuning panel (`t`)
has live controls; `config/default.yaml` section `lighting` has the defaults (off by default;
`?lighting=full` or `l` turns it on).

## 1. Environment map (`environmentMap.ts`)

Every `environment.update_hz`, a fullscreen shader renders a `resolution_px` x `resolution_px/2`
equirectangular map: for each texel, the world direction (Three's `equirectUv` convention,
inverse in `envProjection.ts`) is rotated into the camera frame and projected with the camera's
pinhole intrinsics (`mirrored` flips x). Directions inside the camera's field of view sample the
video frame; directions outside it take the frame's edge colour, fading to the frame's mean over
`fade_deg`; directions behind the camera (z < 0, i.e. inside the scene) get the mean. The map
is prefiltered with `PMREMGenerator` and set as `scene.environment` with
`environmentIntensity`. All materials in the glTF are `MeshStandardMaterial`, so this gives
diffuse and specular image-based lighting: a warm lamp on your desk warms the room's walls.

Limits: the webcam covers ~70° of the 180° hemisphere; the rest is extrapolated. The camera
auto-exposes, so the map's absolute brightness floats; `intensity` is the knob.

## 2. Key lights (`cameraLighting.ts` orchestrating the modules below)

Detection runs in the tracking worker: parameters go over in a `lighting` message (re-sent when
the tuning panel changes them, null when key lights are off) and detected sources ride along in
the worker's result message. Mapping, brightness, tracking and the rig stay on the main thread:
microseconds, and they need the scene. The environment map also stays on the main thread because
it renders in the main WebGL context.

| Step       | Module                                                                                              | What                                                                                                                                                                                                                                                  |
| ---------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Downsample | tracking worker: `OffscreenCanvas.drawImage` of the frame's ImageBitmap to `analysis_width_px` wide | Runs in `faceLandmarker.worker.ts` on the bitmap the landmarker just used, throttled to `update_hz`, so the pixel readback never stalls the render loop.                                                                                              |
| Luminance  | `luminanceImage.ts` (worker)                                                                        | sRGB → linear (LUT), Rec. 709 weights.                                                                                                                                                                                                                |
| Detect     | `sourceDetector.ts` (worker)                                                                        | Pixels above `threshold` → 4-connected components → luminance-weighted centroid, area, mean/peak luminance, saturation flag; blobs within `merge_radius_px` merge; ranked by flux = mean × area; top `max_lights`.                                    |
| Map        | `sourceMapping.ts`                                                                                  | Centroid back-projected through the camera model (`imageToCamera` + `cameraToScreen` from `eyeEstimator.ts`) → unit direction in the screen frame. Area → solid angle = area_px(reference res) / (fx · fy); angular diameter = 2·√(Ω/π).              |
| Brightness | `brightnessModel.ts`                                                                                | `LinearSolidAngleModel`: intensity = gain · mean_linear_luminance · (saturated ? saturation_boost : 1) · Ω. A small bright lamp and a large dim panel of equal flux get equal intensity. Swappable via the `BrightnessModel` interface.               |
| Track      | `lightAssignment.ts`                                                                                | Greedy nearest-direction matching to the previous update's lights (within 0.15 rad) so each light keeps its identity; exponential smoothing at `smoothing_hz`; a source must be seen `hold_frames` times to appear and survives `hold_frames` misses. |
| Rig        | `keyLightRig.ts`                                                                                    | Pool of `max_lights` `DirectionalLight`s placed outside the scene bounds along their directions, aimed at the bounds centre; VSM shadows, blur radius from the angular diameter (a point lamp is crisp, a window is soft).                            |

### Brightness model: what it is and is not

The webcam's pixel values are relative, auto-exposed, gamma-encoded and clipped. The model
assumes radiance is proportional to linear pixel luminance (true below clipping for a fixed
exposure), treats clipped blobs as `saturation_boost` times brighter than they read, and
multiplies by solid angle so that intensity behaves like irradiance at the window. `gain`
sets the overall scale and was chosen by eye so that a desk lamp gives a visible shadow next
to the environment term. Expect it to need adjusting per room; expect exposure changes to
modulate everything together.

### Why directional lights

Sources are in the viewer's room at unknown distance (a lamp at 1 m, the sun through a window
at infinity). Only their direction and angular size are observable, which is exactly what a
directional light with a soft-shadow radius represents. Point/spot lights would need a distance.

## Interaction with authored lights

glTF lights are kept and multiplied by `scene_lights_scale`. The loader also marks every mesh
to cast and receive shadows when `key_lights.shadows` is on; the renderer uses `VSMShadowMap`.

## Checking it

Press `d` (camera preview) and `l` until the HUD says `full`. Detected sources are drawn as
circles on the preview with their estimated intensity. Hold a phone flashlight to your right: a
circle appears, the HUD's `lighting` line lists a light with direction ≈ (+x, +z), and the
room's −x side darkens with a shadow that follows the torch. Cover the camera: lights fade
after `hold_frames` updates and the environment goes to the mean (dark).
