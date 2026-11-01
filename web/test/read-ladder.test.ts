import { describe, expect, it } from 'vitest';
import { GIVE_UP_MS, READ_STAGE_STEPS_MS, readStage, STILL_READING_MS } from '../src/read-ladder.ts';

describe('the read ladder', () => {
  it('is a skeleton with no words until the wait is long', () => {
    expect(readStage({ failed: false, waitedMs: 0 })).toBe('reading');
    expect(readStage({ failed: false, waitedMs: STILL_READING_MS - 1 })).toBe('reading');
  });

  it('says it is still reading, and not that it failed, for a slow read', () => {
    expect(readStage({ failed: false, waitedMs: STILL_READING_MS })).toBe('still-reading');
    expect(readStage({ failed: false, waitedMs: GIVE_UP_MS - 1 })).toBe('still-reading');
  });

  it('gives a read up only past the longer bound', () => {
    expect(readStage({ failed: false, waitedMs: GIVE_UP_MS })).toBe('failed');
  });

  it('puts a read that really failed on the last step at once', () => {
    expect(readStage({ failed: true, waitedMs: 0 })).toBe('failed');
    expect(readStage({ failed: true, waitedMs: STILL_READING_MS })).toBe('failed');
  });

  it('gives the clock the moments at which the step can change, in order', () => {
    expect(READ_STAGE_STEPS_MS).toEqual([STILL_READING_MS, GIVE_UP_MS]);
    expect(STILL_READING_MS).toBeLessThan(GIVE_UP_MS);
  });
});
