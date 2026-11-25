# Lessons learned

Only surprising results that would save someone from repeating a dead-end belong here. Routine
refactors are not recorded.

- **Parallax direction intuition is easy to get backwards.** Stepping right in front of a window,
  objects _behind_ the glass slide right on the glass (a distant object stays straight ahead),
  and objects _in front_ of the glass slide left. The first version of the direction test
  asserted the opposite and failed against correct math. Trace a ray to the z = 0 plane before
  trusting intuition.
- **MediaPipe's `facialTransformationMatrixes` data is column-major** (translation in elements
  12..14, in cm; a frontal portrait fed through the fake camera gave (−0.4, 22.5, −65.4)). The
  third column is the face's forward axis. Confirmed with `FAKE_VIDEO=face.y4m npm run smoke -- "?diag=1"`.
- **One Euro velocity must difference raw samples, not raw-vs-filtered.** Using the filtered
  value as the "previous sample" biases the derivative upward during motion (about +25 % on a
  constant-velocity ramp), which would over-extrapolate in the predictor.
- **Correct geometry still "feels wrong" with two eyes open.** Measured on the glass with a
  ruler (2025-11-25, room scene, Z ≈ 550 mm, 100 mm head move): the sphere 450 mm behind moved
  ~50 mm right (predicted 45), the sphere 60 mm in front moved ~10 mm left (predicted 12). Yet
  far objects _felt_ like they moved with the head. A flat display tells both eyes everything is
  at screen distance, and the bezel is the dominant reference, so on-glass motion reads as object
  motion. Verify with a ruler and the one-eye test before suspecting the projection. Content
  near or in front of the glass sells the effect; deep content reads as sliding.
