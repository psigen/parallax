# Projection math

Implementation: `src/math/offAxisProjection.ts`. Tests: `tests/offAxisProjection.test.ts`.

## The problem

A normal perspective camera assumes the viewer sits on the display's normal through its centre.
For a window, the viewer is wherever they are, and the display rectangle is fixed in the world.
The correct image is the one formed by the pyramid from the eye through the display rectangle:
an **asymmetric (off-axis) frustum** whose near-plane extents move as the eye moves.

## Screen-aligned form (what the renderer uses)

Screen rectangle `[xl, xr] × [yb, yt]` at z = 0, eye `pe = (ex, ey, ez)` with `ez > 0`, near `n`:

```
s = n / ez
l = (xl − ex) · s      r = (xr − ex) · s
b = (yb − ey) · s      t = (yt − ey) · s
P = frustum(l, r, b, t, n, f)          # the standard OpenGL asymmetric frustum matrix
V = translate(−pe)                     # camera axes coincide with the screen frame
```

The camera object in Three.js is positioned at `pe` with identity rotation and `P` installed
as its projection matrix (`src/render/OffAxisCamera.ts` overrides `updateProjectionMatrix` so
nothing else can overwrite it).

## General form (Kooima)

`generalizedViewProjection` implements Kooima's "Generalized Perspective Projection" for a
screen given by three corners in arbitrary pose. It exists so the tests can prove the fast path
above is exactly the special case where the screen basis is the world basis.

## Properties the tests check (and why they are sufficient)

1. **Corner mapping**: the four screen corners map to NDC (±1, ±1) for random eye positions.
   This pins the frustum to the physical rectangle.
2. **Screen-plane invariance**: any point _on_ the glass maps to the same NDC regardless of the
   eye. This is the defining property of a window. Together with (1) it fixes the projection on
   the z = 0 plane for all eyes.
3. **Depth mapping**: a point at `near` maps to NDC z = −1 and `far` to +1.
4. **Agreement with Kooima** element-by-element for random eyes.
5. **Parallax direction**: stepping right, a distant object stays straight ahead, so on the glass
   it slides _right with you_ (approaching 1:1 at infinity); content between you and the glass
   slides the other way. This is the sanity check that catches sign mistakes early.

Since a projective transform is determined by its action on the screen plane plus the eye (centre
of projection) and the depth mapping, (1)–(3) fully determine the correct matrix.

## Where the numbers come from at runtime

- Screen rectangle: `src/math/viewportRect.ts` converts the browser viewport's position and size
  (CSS px, from `window.screenX/Y`, outer/inner sizes, `screen.width`) into screen-frame mm using
  the display's physical width from the config. In fullscreen this is exact; windowed, it assumes
  the browser chrome is at the top with equal side borders. A config override exists.
- Eye: from the tracking pipeline, filtered and extrapolated to the frame's display time.
