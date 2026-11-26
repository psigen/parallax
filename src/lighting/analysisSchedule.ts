/** Whether a lighting analysis is due, given the last one and the configured rate. */
export function dueForAnalysis(nowMs: number, lastMs: number, updateHz: number): boolean {
  if (!(updateHz > 0)) return false;
  return nowMs - lastMs >= 1000 / updateHz;
}
