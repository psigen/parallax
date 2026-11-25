# Documentation index

These docs describe the implementation well enough for a person or an agent to adapt or
reimplement it. They describe the current state only; superseded designs are not kept, except
for surprising dead-ends recorded in [lessons-learned.md](lessons-learned.md).

| Doc                                            | Read it for                                                       |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| [architecture.md](architecture.md)             | Repo layout, data flow, which thread does what                    |
| [coordinate-systems.md](coordinate-systems.md) | The one frame everything is expressed in, units, sign rules       |
| [projection-math.md](projection-math.md)       | The off-axis projection and the tests that prove it correct       |
| [tracking-pipeline.md](tracking-pipeline.md)   | Camera capture, MediaPipe worker, eye estimate, filter, predictor |
| [calibration.md](calibration.md)               | Getting real numbers for your display and camera                  |
| [scene-authoring.md](scene-authoring.md)       | Invariants a glTF scene must satisfy                              |
| [latency.md](latency.md)                       | Latency budget, how it is measured, measured results              |
| [lessons-learned.md](lessons-learned.md)       | Dead-ends worth not repeating                                     |
