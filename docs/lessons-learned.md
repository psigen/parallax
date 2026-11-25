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
