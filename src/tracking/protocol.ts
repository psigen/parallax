/**
 * Messages between the main thread and the face-landmarker worker, plus the pure helpers that
 * turn a landmarker result into what the eye estimator needs. Kept free of worker/DOM globals so
 * the helpers are unit-testable.
 */
import type { LightSource } from '../lighting/sourceDetector';
import type { Vec2 } from '../math/vec';

/** Parameters for the bright-source analysis the worker runs on tracked frames (null = off). */
export interface LightingAnalysisParams {
  analysisWidthPx: number;
  threshold: number;
  minAreaPx: number;
  maxLights: number;
  mergeRadiusPx: number;
  updateHz: number;
}

export interface LightingAnalysisResult {
  sources: LightSource[];
  width: number;
  height: number;
  analysisMs: number;
  /** Main-thread capture time of the analysed frame, ms. */
  tCaptureMs: number;
}

export const LANDMARK_COUNT = 478;
/** MediaPipe indices of the iris centres (anatomical left/right of the subject). */
export const RIGHT_IRIS_CENTRE = 468;
export const LEFT_IRIS_CENTRE = 473;

export type WorkerRequest =
  | { type: 'init'; wasmPath: string; modelPath: string; delegate: 'GPU' | 'CPU' }
  | { type: 'frame'; id: number; bitmap: ImageBitmap; timestampMs: number }
  | { type: 'lighting'; params: LightingAnalysisParams | null };

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
      /** MediaPipe's 4x4 facial transformation matrix (16 numbers) or empty if unavailable. */
      matrix: number[];
      /** Present when a lighting analysis ran on this frame. */
      lighting?: Omit<LightingAnalysisResult, 'tCaptureMs'>;
      /** Eye aspect ratios (lid gap / eye width) per eye, for blink detection. */
      ears?: { left: number; right: number };
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
/**
 * Translation of MediaPipe's face matrix, in cm, assuming column-major storage (translation in
 * elements 12..14). If it were row-major the translation would be in 3, 7, 11; we pick whichever
 * triple has the larger magnitude, since a face is tens of cm away and the other triple is ~0.
 */
export function faceTranslationCm(
  data: ArrayLike<number>,
): { x: number; y: number; z: number } | undefined {
  if (data.length < 16) return undefined;
  const cm = { x: data[12] ?? 0, y: data[13] ?? 0, z: data[14] ?? 0 };
  const rm = { x: data[3] ?? 0, y: data[7] ?? 0, z: data[11] ?? 0 };
  const mag = (v: { x: number; y: number; z: number }) => Math.hypot(v.x, v.y, v.z);
  return mag(cm) >= mag(rm) ? cm : rm;
}

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
