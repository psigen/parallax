# Scene authoring

The app renders a glTF 2.0 scene (`.glb`/`.gltf`) or a Gaussian splat (`.spz`, `.sog`, `.ply`,
`.splat`, `.ksplat`). Scenes are listed in `config/scenes.yaml` and selected by id with
`rendering.scene` in `config/default.yaml` or `?scene=<id>` (a URL or path works too). The
dispatcher is `src/render/sceneLoader.ts` (`loadSceneEntry`).

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

## Placement (scenes without a `window` node, and every splat)

Splat files carry no units, no up axis and no origin, and a glTF may lack a `window` node. Such
scenes are positioned by a **placement**: uniform `scale`, `rotation_deg` (pitch, yaw, roll)
and `position_mm` of the scene origin in the screen frame, applied in that order by
`src/scenes/placement.ts`. Defaults come from the manifest entry, `rendering.placement` in
`config/default.yaml` overrides fields, and `?scene_scale=`, `?scene_pos=x,y,z`,
`?scene_rot=p,y,r` override per session. The tuning panel (`t`, "scene placement") adjusts
live and logs the YAML line to paste into the manifest.

The scale is how a room-sized capture becomes a diorama: `scale: 0.1667` shows a 3 m room as
0.5 m behind the glass, viewed from one side like a window. Set `position_mm` so the
interesting volume sits behind z = 0 (negative z), typically with the nearest surface 50 to
100 mm behind the glass.

## Gaussian splat scenes

Rendered with [Spark](https://sparkjs.dev) (`@sparkjsdev/spark`, MIT), loaded lazily only when
a splat scene is selected (about 3 MB). Splats are fill-rate bound: `rendering.splat_pixel_ratio`
(default 1) caps the device pixel ratio for splat scenes, and MSAA is off; expect a 2–3 M splat
scene to cost far more than the glTF box, especially with tracking running (a 2.6 M-splat
apartment was dropped for that reason; the ~1 M-splat raccoon family runs well). The box stays
the default and the dropdown (top-right) selects the others. Spark projects splat centres with the camera's full
projection matrix and takes the splat footprint from its diagonal terms; for our off-axis
`frustum()` matrix the shear terms are constants that vanish in the Jacobian, so the window
projection is exact and `OffAxisCamera` needs no changes. Sorting is radial (by distance from
the eye) and lags the render by about a frame, invisible under head-tracked motion. Splats
are unlit: the camera lighting affects only glTF materials. MSAA is disabled for splat scenes.

Workflow for a new capture:

1. Prefer `.spz` or `.sog` (10 to 20x smaller than PLY). Keep it to roughly 2 M splats or
   fewer for 60 fps on a laptop; reduce in [SuperSplat](https://superspl.at/editor) if needed.
2. Orientation and scale: SuperSplat's **Orient to Grid** and **Measure** fix the up axis and
   real-world scale once; or leave the file alone and use `rotation_deg`/`scale` in the
   placement. `.spz` is Y-up; PLY/SOG use the COLMAP frame, which Spark rotates on load.
3. Hosting: assets are never committed. Upload the file as a GitHub release asset
   (`gh release create assets-v1 file.sog` or `gh release upload assets-v1 file.sog`), add a
   manifest entry with the download URL, `sha256` (printed by `npm run fetch:scenes` on first
   download), `license`, `credit` and `source_url`. `npm run fetch:scenes` downloads into
   `public/scenes/` before every build (CI does this too).
4. Licence: only redistributable scenes (CC BY, CC0, MIT, Apache). CC BY requires visible
   credit: the `credit` line is shown bottom-left whenever the scene is on screen, linking to
   `source_url`.

## The screen is a flat plate

The scene is never rotated to suit the viewer. The display is a flat plate at z = 0 and the
scene's axes stay aligned with it, so a checkerboard floor is level with the desk no matter where
the viewer sits. A laptop display sits below eye level, so a faithful window shows the room from
slightly above; that is correct. The one sanctioned adjustment is `viewer.eye_offset_mm`, which
shifts the _tracked eye_ (not the scene) and defaults to zero; see
[calibration.md](calibration.md).

## The bundled room

`scripts/build-room.ts` generates `public/scenes/room.glb` with `@gltf-transform/core`: a box
the size of the display, attached to the back of the screen. Interior 300 mm wide x 200 mm high
x 300 mm deep (the 14-inch panel is 302.4 x 196.4 mm), 50 mm vertex-coloured checkerboard on
every wall (6 x 4 tiles on the back wall, 6 tiles deep), and a 20 mm dark frame in the glass
plane around the opening so the 1-2 mm mismatch with the display never shows as a gap.

Size references, all round numbers and axis-aligned, in the screen frame (mm):

| Object        | Size                  | Position (centre)                                |
| ------------- | --------------------- | ------------------------------------------------ |
| Blue cube     | 100                   | x −100, on the floor (y −100..0), z −300..−200   |
| Red cube      | 50                    | x +100, on the floor, z −125..−75                |
| Green sphere  | 20 diameter           | (0, 0, −150)                                     |
| Beige post    | 10 diameter, 200 tall | x +50, z −100, floor to ceiling                  |
| Yellow sphere | 20 diameter           | (−60, +50, **+50**): 50 mm in front of the glass |

Two point lights and a soft directional fill. It is authored with its origin on the floor under
the opening (a "natural" origin for a room) and a `window` camera node at (0, 0.1, 0); the
loader's re-rooting makes that node the display centre. Regenerate with `npm run build:room`.

Expected on-screen sizes for an eye straight ahead at distance Z (mm), object at depth d behind
the glass: size x Z / (Z + d). At Z = 550: a back-wall tile (d = 300) is 32 mm, the 100 mm cube's
front face (d = 200) is 73 mm, the 50 mm cube's front face (d = 75) is 44 mm.

## Checking a scene

Open `?tracker=mouse` and move the mouse: edges of the opening at z = 0 must stay glued to the
viewport edges (if the opening is exactly the viewport size) or move rigidly with the glass;
objects behind the glass slide with the mouse, objects in front slide against it. Use
`?tracker=static&eye=250,0,550&viewport=full` for a reproducible off-axis view.
