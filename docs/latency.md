# Latency

## Budget (what the viewer perceives)

```
camera exposure + readout + USB/ISP delivery  : 30–80 ms   (not ours; 60 fps cameras help)
frame → ImageBitmap → worker                  : 1–3 ms
inference (GPU delegate, Apple Silicon)       : 3–8 ms
result → main thread → estimate → filter      : < 1 ms
wait for next rAF + render                    : 0–16 ms (8 at 120 Hz)
display scan-out                              : 8–16 ms
```

The renderer cannot shorten the camera's part; it **hides** it with prediction: the eye is
extrapolated from its filtered velocity to the moment the frame will be shown. Prediction lead
= `(rAF time + frame interval + extra_lead_ms) − capture time`, clamped to `max_lead_ms`.

## What the HUD shows (`h`)

- `samples Hz`: tracker output rate (camera rate minus dropped frames).
- `capture→main`: `captureTime` of the frame to the sample being on the main thread, i.e.
  transfer + inference + messaging. Chrome's `captureTime` for local cameras is when it received
  the frame from the OS, so sensor latency is **not** included; Safari's is closer to the sensor.
- `inference`: worker-side `detectForVideo` duration.
- `capture→display`: age of the newest sample at the moment this frame is expected on screen.
  This is the latency prediction is trying to cancel.
- `predicted lead`: the extrapolation actually applied this frame.

Tuning (`t`): lower `min_cutoff_hz` for less jitter at rest, raise `beta` for less lag in motion,
raise `extra_lead_ms` if the scene still feels like it trails your head.

## Measured

To be filled in from a real session (press `h`, hold still, then move; note the numbers for the
built-in camera at 30 fps and the MX Brio at 60 fps).

| Camera               | fps | inference | capture→main | capture→display | notes |
| -------------------- | --- | --------- | ------------ | --------------- | ----- |
| MacBook Pro built-in |     |           |              |                 |       |
| MX Brio 1080p60      |     |           |              |                 |       |
