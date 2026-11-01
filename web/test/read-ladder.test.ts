import { describe, expect, it } from 'vitest';
import { GIVE_UP_MS, isReading, READ_STAGE_STEPS_MS, readStage, STILL_READING_MS } from '../src/read-ladder.ts';

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

  it('does not climb at all while the device is offline: a read on its way and one that failed are both offline, however long the wait', () => {
    expect(readStage({ failed: false, waitedMs: 0, online: false })).toBe('offline');
    expect(readStage({ failed: false, waitedMs: GIVE_UP_MS, online: false })).toBe('offline');
    expect(readStage({ failed: true, waitedMs: 0, online: false })).toBe('offline');
  });

  it('gives the clock the moments at which the step can change, in order', () => {
    expect(READ_STAGE_STEPS_MS).toEqual([STILL_READING_MS, GIVE_UP_MS]);
    expect(STILL_READING_MS).toBeLessThan(GIVE_UP_MS);
  });

  it('times only a read that has been asked: a block still waiting to ask is never slow', () => {
    expect(isReading({ status: 'loading', asked: false })).toBe(false);
    expect(isReading({ status: 'loading', asked: true })).toBe(true);
    // A block that does not say is one that asked as soon as it was drawn.
    expect(isReading({ status: 'loading' })).toBe(true);
    expect(isReading({ status: 'ready', asked: true })).toBe(false);
    expect(isReading({ status: 'error', asked: true })).toBe(false);
  });
});
