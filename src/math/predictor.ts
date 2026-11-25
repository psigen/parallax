import { add, scale, type Vec3 } from './vec';

export interface MotionState {
  position: Vec3;
  /** Units per second. */
  velocity: Vec3;
  /** Time (seconds) the position was valid for, i.e. the camera capture time of the sample. */
  tS: number;
}

/**
 * Extrapolate a motion state to `tTargetS` (the time the next frame will be shown), so the
 * rendered view corresponds to where the eye is *now* rather than where it was when the camera
 * frame was captured. Lead time is clamped to [0, maxLeadS] so a stalled tracker never flings
 * the view away.
 */
export function predictPosition(state: MotionState, tTargetS: number, maxLeadS: number): Vec3 {
  const lead = Math.min(Math.max(tTargetS - state.tS, 0), maxLeadS);
  return add(state.position, scale(state.velocity, lead));
}
