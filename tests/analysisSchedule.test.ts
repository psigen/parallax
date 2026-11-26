import { describe, expect, it } from 'vitest';
import { dueForAnalysis } from '../src/lighting/analysisSchedule';

describe('dueForAnalysis', () => {
  it('is due immediately on the first call and then at the configured period', () => {
    expect(dueForAnalysis(1000, -Infinity, 10)).toBe(true);
    expect(dueForAnalysis(1050, 1000, 10)).toBe(false);
    expect(dueForAnalysis(1100, 1000, 10)).toBe(true);
  });

  it('never runs at a non-positive rate', () => {
    expect(dueForAnalysis(1000, -Infinity, 0)).toBe(false);
  });
});
