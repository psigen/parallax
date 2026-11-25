/**
 * Messages between the main thread and the face-landmarker worker, plus the pure helpers that
 * turn a landmarker result into what the eye estimator needs. Kept free of worker/DOM globals so
 * the helpers are unit-testable.
 */
import type { Vec2 } from '../math/vec';

export const LANDMARK_COUNT = 478;
/** MediaPipe indices of the iris centres (anatomical left/right of the subject). */
export const RIGHT_IRIS_CENTRE = 468;
export const LEFT_IRIS_CENTRE = 473;

export type WorkerRequest =
  | { type: 'init'; wasmPath: string; modelPath: string; delegate: 'GPU' | 'CPU' }
  | { type: 'frame'; id: number; bitmap: ImageBitmap; timestampMs: number };

export type WorkerResponse =
  | { type: 'ready'; delegate: 'GPU' | 'CPU' }
  | { type: 'error'; message: string }
  | { type: 'log'; message: string }
  | {
      type: 'result';
      id: number;
      timestampMs: number;
      inferenceMs: number;
      found: boolean;
      /** x, y, z per landmark, normalized image coordinates; empty when not found. */
      landmarks: Float32Array;
      yawRad: number;
      pitchRad: number;
    };

export function landmarkAt(landmarks: Float32Array, index: number): Vec2 {
  return { x: landmarks[index * 3] ?? 0, y: landmarks[index * 3 + 1] ?? 0 };
}

export function irisCentres(landmarks: Float32Array): { left: Vec2; right: Vec2 } {
  return {
    left: landmarkAt(landmarks, LEFT_IRIS_CENTRE),
    right: landmarkAt(landmarks, RIGHT_IRIS_CENTRE),
  };
}

/**
 * Head yaw and pitch (radians) from MediaPipe's 4x4 facial transformation matrix (16 numbers).
 * The matrix maps the canonical face (nose along +z) into the camera frame; the face's forward
 * axis is the third basis column. Yaw sign depends on whether the data is row- or column-major,
 * which is why only magnitudes are relied on downstream (foreshortening is even in yaw).
 */
export function headAnglesFromMatrix(data: ArrayLike<number>): {
  yawRad: number;
  pitchRad: number;
} {
  if (data.length < 16) return { yawRad: 0, pitchRad: 0 };
  const fx = data[8] ?? 0;
  const fy = data[9] ?? 0;
  const fz = data[10] ?? 1;
  return { yawRad: Math.atan2(fx, fz), pitchRad: Math.atan2(-fy, Math.hypot(fx, fz)) };
}
