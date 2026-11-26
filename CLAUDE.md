# parallax-demo: guidance for AI tooling

This file is for Claude Code and other agents working in this repository. Humans: the same
rules apply; see `docs/` for the technical documentation.

## What this is

A browser demo (TypeScript, Vite, Three.js, MediaPipe) where the display behaves as a window
into a 3D scene: a webcam tracks the viewer's eye and an off-axis projection renders the
geometrically correct view. Priorities: projection correctness, then tracking latency.
`docs/README.md` indexes the design docs; `docs/lessons-learned.md` records dead-ends.

## Workflow rules

- **Branches and PRs.** Never commit to `main`. Work on a topic branch, open a draft PR while in
  progress (`gh pr create --draft`), mark it ready when done, squash-merge
  (`gh pr merge --squash --delete-branch`). The repo allows only squash merges.
- **Quality gate.** Before every commit run `npm run check` (typecheck, eslint with zero
  warnings, prettier, vitest) and gate on its **exit code**, not on grepping its output. Fix
  errors; do not suppress them. Tests are written in the same step as the module they cover and
  are pure (Node, no browser). `npm run build` must pass too.
- **Commits.** Author/committer identity for this repo is set in its local git config
  (`Pras Velagapudi <psigen@gmail.com>`); do not change it. Plain messages; a `Co-Authored-By`
  trailer is acceptable.
- **Docs.** Keep `docs/` describing the current design only. On a change of direction, do not
  record the superseded design; add to `docs/lessons-learned.md` only a surprising result that
  would stop someone repeating a dead-end. Update README key/URL tables when bindings change.
- **Verification.** `npm run smoke` boots the production build in headless Chrome with a fake
  camera (`FAKE_VIDEO=face.y4m` feeds a face) and prints console output plus the HUD. It
  validates boot and plumbing only; headless software GL cannot validate lighting or latency.
  Geometry claims are checked with the ruler/parallels tests in `docs/calibration.md`.

- **Deployment.** Merging to `main` deploys to https://parallax.pras.ai via
  `.github/workflows/pages.yml`; the workflow runs `npm run check` first, so a red check blocks
  the deploy. Do not add a base path: the site lives at the domain root.

## Architecture rules

- **The screen is a flat plate.** The scene is axis-aligned with the display and is never
  rotated toward the viewer. The only sanctioned adjustment is `viewer.eye_offset_mm`.
- **Heuristics live in one place.** All guessing (device detection, extrapolation,
  nearest-known rounding, default choices) is in `src/device/heuristics.ts`. Everything else
  consumes resolved, typed structures and applies only deterministic precedence
  (`src/device/resolve.ts`). Known hardware is data in `config/devices.yaml`, validated by
  `src/device/index.ts`. **No specific device is hardcoded anywhere**; `config/default.yaml`
  says `auto`. To support a new machine, add an index entry and a test case
  (`docs/devices.md`, "Adding a device"); do not special-case it in code.
- **Scenes and assets.** Scenes are manifest entries in `config/scenes.yaml` (glTF or Gaussian
  splat via Spark). External assets are never committed: host them as GitHub release assets,
  record URL, `sha256`, `license`, `credit`, `source_url` and a `placement`; `npm run
fetch:scenes` downloads them before a build. Only redistributable licences; CC BY scenes must
  keep their `credit` (shown on screen). A scene without a `window` node is positioned by its
  placement (uniform scale, rotation, position), never by editing the asset in code.
- **Pure math is renderer-independent.** `src/math/` has no Three.js imports and is fully unit
  tested; `src/render/` adapts it. The off-axis projection must keep the properties listed in
  `docs/projection-math.md`.
- **Latency.** One frame in flight to the tracking worker; drop, never queue. The lighting
  analysis runs in that worker on the same bitmap. The environment map stays on the main thread
  (it needs the renderer's GL context).
- **Config.** Physical quantities in `config/*.yaml` are millimetres (`_mm`), pixels (`_px`),
  degrees (`_deg`); the renderer converts to metres once. Runtime overrides live in
  `localStorage` keyed by camera id and are printed as YAML lines to paste back.

## Where things are

```
config/default.yaml   tuning + device section (auto)      config/devices.yaml  known hardware
src/device/           observation → heuristics → resolve  src/math/            projection, estimator, filters
src/tracking/         camera source, MediaPipe worker      src/lighting/        env map + key lights
src/render/           OffAxisCamera, scene loader          src/ui/              HUD, scope, tuning, debug
scripts/              build-room (glTF), smoke (headless)  tests/               vitest, pure
```
