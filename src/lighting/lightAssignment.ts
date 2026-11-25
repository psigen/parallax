import { add, dot, normalize, scale, type Vec3 } from '../math/vec';

export interface LightCandidate {
  direction: Vec3;
  intensity: number;
  angularDiameterRad: number;
}

export interface TrackedLight extends LightCandidate {
  id: number;
  /** Consecutive updates in which a source matched this light. */
  seen: number;
  /** Consecutive updates without a match. */
  missing: number;
  /** True once seen >= holdFrames; the rig only shows active lights. */
  active: boolean;
}

export interface AssignParams {
  /** Max angle (rad) between a tracked light and a candidate to count as the same source. */
  maxAngleRad: number;
  holdFrames: number;
  smoothingHz: number;
}

function angleBetween(a: Vec3, b: Vec3): number {
  return Math.acos(Math.min(1, Math.max(-1, dot(a, b))));
}

/**
 * Matches this update's candidates to the lights tracked so far, so a light keeps its identity
 * (and its shadow does not jump) while a source wobbles, and so that momentary detections do
 * not flash: a light must be seen `holdFrames` times to appear and survives `holdFrames`
 * misses before removal. Matched lights are exponentially smoothed.
 */
export function assignSources(
  prev: readonly TrackedLight[],
  candidates: readonly LightCandidate[],
  dtS: number,
  p: AssignParams,
  nextId: () => number,
): TrackedLight[] {
  const alpha = 1 - Math.exp(-2 * Math.PI * p.smoothingHz * Math.max(dtS, 0));
  const unmatched = new Set(candidates.map((_, i) => i));
  const out: TrackedLight[] = [];

  // Greedy: strongest tracked lights pick first.
  const ordered = [...prev].sort((a, b) => b.intensity - a.intensity);
  for (const light of ordered) {
    let best = -1;
    let bestAngle = p.maxAngleRad;
    for (const i of unmatched) {
      const c = candidates[i];
      if (!c) continue;
      const ang = angleBetween(light.direction, c.direction);
      if (ang < bestAngle) {
        bestAngle = ang;
        best = i;
      }
    }
    if (best >= 0) {
      const c = candidates[best]!;
      unmatched.delete(best);
      const seen = light.seen + 1;
      out.push({
        id: light.id,
        direction: normalize(add(scale(light.direction, 1 - alpha), scale(c.direction, alpha))),
        intensity: light.intensity + (c.intensity - light.intensity) * alpha,
        angularDiameterRad:
          light.angularDiameterRad + (c.angularDiameterRad - light.angularDiameterRad) * alpha,
        seen,
        missing: 0,
        active: seen >= p.holdFrames,
      });
    } else if (light.missing + 1 <= p.holdFrames) {
      out.push({ ...light, missing: light.missing + 1 });
    }
  }
  for (const i of unmatched) {
    const c = candidates[i];
    if (!c) continue;
    out.push({
      ...c,
      direction: normalize(c.direction),
      id: nextId(),
      seen: 1,
      missing: 0,
      active: 1 >= p.holdFrames,
    });
  }
  return out;
}
