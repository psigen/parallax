/**
 * The device index: typed, validated data about known displays and cameras. No logic lives
 * here beyond validation; which entry applies is decided in heuristics.ts.
 */
import { parse } from 'yaml';
import { z } from 'zod';

const vec3 = z.tuple([z.number(), z.number(), z.number()]);
const px2 = z.tuple([z.number().int().positive(), z.number().int().positive()]);

export const platformSchema = z.enum([
  'macos',
  'windows',
  'linux',
  'chromeos',
  'ios',
  'android',
  'other',
]);
export type Platform = z.infer<typeof platformSchema>;
/** Index entries may apply to any platform (external monitors). */
export const entryPlatformSchema = z.union([platformSchema, z.literal('any')]);

export const screenEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  platform: entryPlatformSchema,
  panel: z.object({
    native_px: px2,
    ppi: z.number().positive(),
    width_mm: z.number().positive(),
    height_mm: z.number().positive(),
    notch: z.boolean(),
  }),
  /** CSS-pixel sizes this display can report (macOS scaled modes; phone logical sizes, portrait). */
  css_modes: z.array(px2).default([]),
  /** Expected devicePixelRatio, when it identifies the panel (phones). */
  dpr: z.number().positive().optional(),
  /** Substrings of the device model string (Android UA / UA-data model). */
  model_hints: z.array(z.string()).default([]),
  /** Substrings of the WebGL renderer string that identify the machine family. */
  gpu_hints: z.array(z.string()).default([]),
  /** Substrings of the Window Management API screen label. */
  labels: z.array(z.string()).default([]),
  /** External monitor: only matched when the display is known to be external or runs at 100 % scaling. */
  external: z.boolean().default(false),
  builtin_camera: z
    .object({
      camera: z.string().min(1),
      position_mm: vec3,
      rotation_deg: vec3.default([0, 0, 0]),
    })
    .optional(),
});
export type ScreenEntry = z.infer<typeof screenEntrySchema>;

export const cameraEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Substrings of MediaDeviceInfo.label; empty for the generic fallback. */
  label_match: z.array(z.string()).default([]),
  /** Disambiguates same-label models by the stream's maximum height. */
  max_height_px: z.number().int().positive().optional(),
  hfov_deg: z.number().positive().max(179),
  estimate: z.boolean().default(true),
  capture: z.object({
    width_px: z.number().int().positive(),
    height_px: z.number().int().positive(),
    frame_rate: z.number().positive(),
  }),
  mirrored: z.boolean().default(false),
  /** External cameras: where they usually sit relative to the display's top centre (mm). */
  mount: z.object({ position_mm_from_top_centre: vec3 }).optional(),
});
export type CameraEntry = z.infer<typeof cameraEntrySchema>;

export const deviceIndexSchema = z.object({
  screens: z.array(screenEntrySchema),
  cameras: z.array(cameraEntrySchema),
});
export type DeviceIndex = z.infer<typeof deviceIndexSchema>;

export function parseDeviceIndex(yamlText: string): DeviceIndex {
  const raw: unknown = parse(yamlText);
  return deviceIndexSchema.parse(raw);
}

export function findScreenEntry(index: DeviceIndex, id: string): ScreenEntry | undefined {
  return index.screens.find((s) => s.id === id);
}

export function findCameraEntry(index: DeviceIndex, id: string): CameraEntry | undefined {
  return index.cameras.find((c) => c.id === id);
}
