# Coordinate systems

There is one frame that everything is ultimately expressed in: the **screen frame**.

## Screen frame (= world frame of the rendered scene)

- Origin: the centre of the physical display's active area.
- +x: the viewer's right. +y: up. +z: out of the screen, toward the viewer.
- The display surface is the plane z = 0. Scene content "behind the window" has z < 0.
- Right-handed. The rendering camera sits at the viewer's eye (z > 0) and looks down −z.

The Three.js scene uses this frame directly in **metres** (glTF's unit). A glTF may use a
different origin for authoring convenience by including a camera node named `window`; the loader
re-roots the scene so that node's pose becomes the screen frame (see
[scene-authoring.md](scene-authoring.md)).

## Units

- `config/default.yaml`: millimetres (`*_mm`), pixels (`*_px`), degrees (`*_deg`). Hardware specs
  and calibration numbers are naturally in these units.
- Everything after `src/config/load.ts`: the tracking code works in mm (it is a physical
  measurement), the renderer in metres. The conversion is `mmToM` in `src/config/load.ts`, applied
  at the point the eye position and viewport rectangle are handed to the renderer.

## Camera image frame

- Pixels, origin top-left, x right, y down, as delivered by `getUserMedia`. MediaPipe landmarks
  are the same but normalized to [0, 1].
- The webcam faces the viewer. A viewer moving to **their** right therefore moves toward the
  **left** of a raw image. `src/math/eyeEstimator.ts` applies this flip; the per-camera
  `mirrored: true` flag undoes it for sources that already mirror.
- The camera's nominal pose is "in the screen plane looking straight at the viewer". A camera
  point (X, Y, Z) with Z the distance in front of the lens maps to screen frame
  `position_mm + R · (X, Y, Z)` where R is built from `rotation_deg` (pitch, yaw, roll).

## MediaPipe landmark conventions

- Iris centres: index **468** is the subject's **right** iris, **473** the subject's **left**
  iris (rings 469–472 and 474–477). "Left/right" are anatomical, so in an un-mirrored frame the
  left iris has the larger x.
- Landmark `z` is relative and not metric; it is not used.
- `facialTransformationMatrixes` provides rotation in a right-handed camera frame (−z forward).
  Only its yaw magnitude is used (to undo foreshortening of the iris separation); its translation
  is not trusted for depth because it assumes a virtual camera FOV that is not ours.

## The eye point

The rendered view is for a single eye point: the midpoint of the two iris centres. A flat display
cannot show different images to the two eyes, and the midpoint minimises the error for both.
