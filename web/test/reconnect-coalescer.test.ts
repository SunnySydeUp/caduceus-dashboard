import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createReconnectCoalescer } from '../src/reconnect-coalescer.ts';

// A phone that wakes fires visibilitychange, pageshow and online within the same moment, and a flaky link fires them again
// and again (architecture §4, "PWA resume storms"). Time is the fake clock: no test waits for real.
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

/** A coalescer whose reconnects are counted. */
function counted() {
  const run = vi.fn();
  return { coalescer: createReconnectCoalescer({ run }), run };
}

describe('coalescing page-resume signals into reconnects', () => {
  test('a burst of visibility, page-show and online signals in the same moment reconnects once, at once', () => {
    const { coalescer, run } = counted();

    coalescer.request();
    coalescer.request();
    coalescer.request();

    expect(run).toHaveBeenCalledTimes(1);
  });

  test('signals within the next second wait for the second to pass, and then reconnect once between them', () => {
    const { coalescer, run } = counted();
    coalescer.request();

    vi.advanceTimersByTime(300);
    coalescer.request();
    coalescer.request();
    vi.advanceTimersByTime(699);
    expect(run).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);

    expect(run).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(10_000);
    expect(run).toHaveBeenCalledTimes(2);
  });

  test('after a quiet second the next signal reconnects at once, and a long storm never exceeds one reconnect per second', () => {
    const { coalescer, run } = counted();
    coalescer.request();

    vi.advanceTimersByTime(1_000);
    coalescer.request();
    expect(run).toHaveBeenCalledTimes(2);

    // A flaky link: a signal every 100 ms for ten seconds, with every reconnect at least a second after the one before.
    const runAt: number[] = [];
    run.mockImplementation(() => runAt.push(Date.now()));
    for (let i = 0; i < 100; i++) {
      coalescer.request();
      vi.advanceTimersByTime(100);
    }
    vi.advanceTimersByTime(1_000);

    expect(runAt.length).toBeGreaterThanOrEqual(10);
    runAt.forEach((at, i) => i > 0 && expect(at - runAt[i - 1]).toBeGreaterThanOrEqual(1_000));
  });
});
