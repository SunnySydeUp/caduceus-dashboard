// Page-resume signals (visibilitychange, pageshow, online) arrive in bursts: a phone that wakes fires all three within the
// same moment, and a flaky link fires them again and again. A reconnect for each would storm the server (architecture §4).
// Pure: no DOM. It reads the page's clock and timers, so a test drives it with fake ones.

/** The most often a reconnect may run. */
export const RECONNECT_MIN_INTERVAL_MS = 1_000;

export interface ReconnectCoalescerOptions {
  /** Reconnects. Called at most once per `minIntervalMs`. */
  run: () => void;
  minIntervalMs?: number;
}

export interface ReconnectCoalescer {
  /** A signal that the page may have come back: reconnects now, or, if one just ran, once the interval since it has passed. */
  request(): void;
}

export function createReconnectCoalescer({ run, minIntervalMs = RECONNECT_MIN_INTERVAL_MS }: ReconnectCoalescerOptions): ReconnectCoalescer {
  let lastRunAt = -Infinity;
  let pending: ReturnType<typeof setTimeout> | undefined;

  const runNow = () => {
    pending = undefined;
    lastRunAt = Date.now();
    run();
  };

  return {
    request() {
      // A signal that arrives while one is waiting is part of the same burst.
      if (pending !== undefined) return;
      const wait = lastRunAt + minIntervalMs - Date.now();
      if (wait <= 0) runNow();
      else pending = setTimeout(runNow, wait);
    },
  };
}
