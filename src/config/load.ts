import { parse } from 'yaml';
import { configSchema, type Config, type CameraConfig } from './schema';

/** Parse and validate a YAML config document. Throws a ZodError with a readable path on failure. */
export function parseConfig(yamlText: string): Config {
  const raw: unknown = parse(yamlText);
  return configSchema.parse(raw);
}

export function findCamera(config: Config, id: string): CameraConfig {
  const cam = config.cameras.find((c) => c.id === id);
  if (!cam) {
    throw new Error(
      `No camera with id "${id}" in config (have: ${config.cameras.map((c) => c.id).join(', ')})`,
    );
  }
  return cam;
}

export const MM_PER_M = 1000;
export const mmToM = (mm: number): number => mm / MM_PER_M;
export const mToMm = (m: number): number => m * MM_PER_M;
