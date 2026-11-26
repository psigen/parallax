import { z } from 'zod';

const vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const rectMmSchema = z.object({
  left_mm: z.number(),
  right_mm: z.number(),
  bottom_mm: z.number(),
  top_mm: z.number(),
});

export const screenSchema = z.object({
  name: z.string(),
  width_mm: z.number().positive(),
  height_mm: z.number().positive(),
  viewport_override_mm: rectMmSchema.nullable().default(null),
});

export const intrinsicsSchema = z.object({
  width_px: z.number().positive(),
  height_px: z.number().positive(),
  fx_px: z.number().positive(),
  fy_px: z.number().positive(),
  cx_px: z.number(),
  cy_px: z.number(),
});

export const extrinsicsSchema = z.object({
  position_mm: vec3,
  rotation_deg: vec3.default([0, 0, 0]),
});

export const captureSchema = z.object({
  width_px: z.number().int().positive(),
  height_px: z.number().int().positive(),
  frame_rate: z.number().positive(),
  /** Phones: which camera to ask for. */
  facing_mode: z.enum(['user', 'environment']).optional(),
  /** 'widest' asks for the camera's minimum zoom (largest field of view); a number pins it. */
  zoom: z.union([z.literal('widest'), z.number().positive()]).optional(),
});
export type CaptureConfig = z.infer<typeof captureSchema>;

export const cameraSchema = z.object({
  id: z.string().min(1),
  label_match: z.string().min(1),
  capture: captureSchema,
  mirrored: z.boolean().default(false),
  intrinsics: intrinsicsSchema,
  extrinsics: extrinsicsSchema,
});

export const trackingSchema = z.object({
  depth_method: z.enum(['iris_ipd', 'face_matrix']).default('iris_ipd'),
  yaw_correction: z.boolean().default(true),
  eye: z.enum(['cyclopean', 'left', 'right']).default('cyclopean'),
  parallax_gain: z.number().positive().default(1),
  filter: z.object({
    min_cutoff_hz: z.number().positive(),
    beta: z.number().nonnegative(),
    d_cutoff_hz: z.number().positive(),
  }),
  prediction: z.object({
    enabled: z.boolean(),
    extra_lead_ms: z.number(),
    max_lead_ms: z.number().nonnegative(),
  }),
  loss_timeout_ms: z.number().nonnegative(),
});

export const lightingSchema = z.object({
  enabled: z.boolean().default(false),
  scene_lights_scale: z.number().nonnegative().default(1),
  environment: z
    .object({
      enabled: z.boolean().default(true),
      intensity: z.number().nonnegative().default(1),
      resolution_px: z.number().int().min(32).max(2048).default(256),
      update_hz: z.number().positive().default(10),
      fade_deg: z.number().nonnegative().default(20),
    })
    .prefault({}),
  key_lights: z
    .object({
      enabled: z.boolean().default(true),
      analysis_width_px: z.number().int().min(16).max(512).default(96),
      threshold: z.number().min(0).max(1).default(0.8),
      min_area_px: z.number().int().positive().default(3),
      max_lights: z.number().int().min(0).max(8).default(4),
      merge_radius_px: z.number().nonnegative().default(3),
      brightness: z
        .object({
          gain: z.number().nonnegative().default(150),
          saturation_boost: z.number().positive().default(2),
        })
        .prefault({}),
      smoothing_hz: z.number().positive().default(3),
      hold_frames: z.number().int().nonnegative().default(3),
      shadows: z.boolean().default(true),
      shadow_map_px: z.number().int().min(128).max(4096).default(1024),
    })
    .prefault({}),
});

const screenSpecSchema = z.object({
  ref: z.string().min(1).optional(),
  name: z.string().optional(),
  width_mm: z.number().positive().optional(),
  height_mm: z.number().positive().optional(),
  viewport_override_mm: rectMmSchema.nullable().optional(),
});
const cameraSpecSchema = z.object({
  ref: z.string().min(1).optional(),
  id: z.string().min(1).optional(),
  label_match: z.string().min(1).optional(),
  hfov_deg: z.number().positive().max(179).optional(),
  intrinsics: intrinsicsSchema.optional(),
  capture: captureSchema.optional(),
  mirrored: z.boolean().optional(),
  position_mm: vec3.optional(),
  rotation_deg: vec3.optional(),
});
export const deviceSectionSchema = z.object({
  screen: z.union([z.literal('auto'), screenSpecSchema]).default('auto'),
  cameras: z.union([z.literal('auto'), z.array(cameraSpecSchema)]).default('auto'),
  default_camera: z.union([z.literal('auto'), z.string().min(1)]).default('auto'),
});
export type DeviceSection = z.infer<typeof deviceSectionSchema>;
export type ScreenSpec = z.infer<typeof screenSpecSchema>;
export type CameraSpec = z.infer<typeof cameraSpecSchema>;

export const configSchema = z
  .object({
    device: deviceSectionSchema.prefault({}),
    viewer: z.object({
      ipd_mm: z.number().positive(),
      rest_eye_mm: vec3,
      /** Constant added to every tracked eye position; zero is the strict window. */
      eye_offset_mm: vec3.default([0, 0, 0]),
    }),
    tracking: trackingSchema,
    rendering: z.object({
      scene_url: z.string().min(1),
      near_mm: z.number().positive(),
      far_mm: z.number().positive(),
    }),
    lighting: lightingSchema.prefault({}),
  })
  .refine((c) => c.rendering.far_mm > c.rendering.near_mm, {
    message: 'rendering.far_mm must exceed rendering.near_mm',
    path: ['rendering', 'far_mm'],
  });

export type Config = z.infer<typeof configSchema>;
export type ScreenConfig = z.infer<typeof screenSchema>;
export type CameraConfig = z.infer<typeof cameraSchema>;
export type Intrinsics = CameraConfig['intrinsics'];
export type Extrinsics = CameraConfig['extrinsics'];
export type TrackingConfig = Config['tracking'];
export type LightingConfig = Config['lighting'];
