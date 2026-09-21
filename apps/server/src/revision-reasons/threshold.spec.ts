import { describe, expect, it } from 'vitest';
import { reasonPromptThreshold } from './threshold.js';

describe('reasonPromptThreshold', () => {
  it('is twenty percent of the assignment in the ordinary case', () => {
    expect(reasonPromptThreshold(40)).toBe(8);
    expect(reasonPromptThreshold(50)).toBe(10);
  });

  it('never drops below three, so tiny classes are not nagged on the first override', () => {
    expect(reasonPromptThreshold(0)).toBe(3);
    expect(reasonPromptThreshold(5)).toBe(3);
    expect(reasonPromptThreshold(14)).toBe(3);
  });

  it('never rises above fifteen, so reasons are not asked for hours late', () => {
    expect(reasonPromptThreshold(200)).toBe(15);
    expect(reasonPromptThreshold(1000)).toBe(15);
  });
});
