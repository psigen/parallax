import { describe, expect, it } from 'vitest';
import { EyeState } from '../src/tracking/eyeState';
import { v3 } from '../src/math/vec';

const tracking = {
  depth_method: 'iris_ipd' as const,
  yaw_correction: true,
  eye: 'cyclopean' as const,
  parallax_gain: 1,
  filter: { min_cutoff_hz: 1, beta: 0.05, d_cutoff_hz: 1 },
  prediction: { enabled: true, extra_lead_ms: 0, max_lead_ms: 80 },
  loss_timeout_ms: 500,
  blink: {
    enabled: true,
    enter_ratio: 0.6,
    exit_ratio: 0.75,
    baseline_tau_s: 2,
    warmup_frames: 10,
    hold_frames_after: 1,
  },
  guard: { enabled: true, max_jump_ratio: 0.12, window_ms: 150, max_reject_frames: 6 },
};

describe('EyeState with held samples', () => {
  it('stops predicting forward while a position is held', () => {
    const s = new EyeState(tracking, v3(0, 0, 550));
    for (let i = 0; i <= 30; i++) {
      s.push({ eyeMm: v3(10 * i, 0, 550), tCaptureMs: i * 33, tReadyMs: i * 33, confidence: 1 });
    }
    const moving = s.eyeAt(30 * 33 + 50);
    expect(moving.x).toBeGreaterThan(s.raw?.position.x ?? 0); // extrapolating
    const heldPos = s.raw?.position ?? v3(0, 0, 0);
    s.push({
      eyeMm: heldPos,
      tCaptureMs: 31 * 33,
      tReadyMs: 31 * 33,
      confidence: 0.5,
      held: 'blink',
    });
    expect(s.raw?.velocity.x).toBe(0);
    const held = s.eyeAt(31 * 33 + 50);
    expect(held.x).toBeCloseTo(s.raw?.position.x ?? NaN, 6);
  });
});
