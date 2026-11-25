# Scene authoring

The app renders any glTF 2.0 scene (`.glb` or `.gltf`) given by `rendering.scene_url` in
`config/default.yaml`. The loader is `src/render/sceneLoader.ts`.

## Invariants

1. **Units are metres at real-world scale.** The display is a physical window about 0.30 x 0.20 m;
   a 1 m object in the scene is meant to look 1 m large. The loader warns if the scene spans more
   than 50 units in any axis.
2. **The window pose is given by a camera node named `window`** (case-insensitive). The node's
   position is the centre of the display, its local −z points _into_ the scene (away from the
   viewer), its +y is up and +x is the viewer's right. The camera's own projection parameters
   (fov, aspect, near, far) are ignored: the app always owns the projection. If the file has
   exactly one camera and none is named `window`, that one is used. If there is no camera, the
   scene origin is taken to be the display centre with +z toward the viewer.

   The window node should have unit world scale. Non-unit scale is applied to the scene (so a
   node scaled 2x shrinks the scene by half) and a warning is logged.

3. **Content behind the window has z < 0 in the window's frame.** The scene must cross the
   window plane (the loader warns otherwise). Content in front of the window (z > 0) is allowed
   and is what makes objects "pop out"; keep it within ~0.15 m of the glass because the viewer
   sits about 0.5 m away and anything closer than the near plane (10 mm from the eye) is
   clipped.
4. **The opening should be larger than the display.** A room whose opening at the window plane
   is at least 0.36 x 0.24 m fits any viewport, including windowed browsers that cover only part
   of the display, and leaves side walls visible when the viewer moves off-axis.
5. **Lights are optional.** `KHR_lights_punctual` lights are used when present (physical units:
   candela for point/spot, lux for directional; the renderer uses ACES tone mapping, so a lamp in
   a half-metre room wants ~0.1 cd). Without lights the loader adds a directional light; it
   always adds a faint ambient.
6. **Anything else is up to you**: materials, textures, vertex colours, animations (not played
   yet), nested nodes. Cameras other than `window` are ignored.

## The screen is a flat plate

The scene is never rotated to suit the viewer. The display is a flat plate at z = 0 and the
scene's axes stay aligned with it, so a checkerboard floor is level with the desk no matter where
the viewer sits. A laptop display sits below eye level, so a faithful window shows the room from
slightly above; that is correct. The one sanctioned adjustment is `viewer.eye_offset_mm`, which
shifts the _tracked eye_ (not the scene) and is zero by default; see
[calibration.md](calibration.md).

## The bundled room

`scripts/build-room.ts` generates `public/scenes/room.glb` with `@gltf-transform/core`:
a 0.40 x 0.28 m opening, a 0.5 m deep room with a 50 mm vertex-coloured checkerboard on every
wall, several objects at different depths, a column, a sphere protruding 60 mm in front of the
glass, two point lights and a soft directional fill. It is authored with its origin on the floor
under the opening (a "natural" origin for a room) and a `window` camera node at
(0, 0.14, 0); the loader's re-rooting makes that node the display centre. Regenerate with
`npm run build:room`.

## Checking a scene

Open `?tracker=mouse` and move the mouse: edges of the opening at z = 0 must stay glued to the
viewport edges (if the opening is exactly the viewport size) or move rigidly with the glass;
objects behind the glass slide with the mouse, objects in front slide against it. Use
`?tracker=static&eye=250,0,550&viewport=full` for a reproducible off-axis view.
