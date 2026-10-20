// Shared helper for tests of the grace hold (`gateway-proxy.ts`): the timers the proxy measures the grace period with, wound by
// hand, so that a test fires "ten minutes later" without waiting for them.
import type { GraceTimers } from '../../src/gateway-proxy.ts';

export interface GraceTimer {
  /** How long the proxy asked for. */
  readonly ms: number;
  /** The proxy cancelled it (the device came back in time). */
  readonly cancelled: boolean;
  /** The grace is over: runs what the proxy wanted done then. */
  fire(): void;
}

export interface GraceClock {
  timers: GraceTimers;
  /** Every timer the proxy has started, in order. */
  readonly started: readonly GraceTimer[];
  /** Resolves with the next timer the proxy starts (the one after the last that was handed out), now or later. */
  nextStart(): Promise<GraceTimer>;
}

export function graceClock(): GraceClock {
  const started: (GraceTimer & { cancel(): void })[] = [];
  const waiting: ((timer: GraceTimer) => void)[] = [];
  let handedOut = 0;
  return {
    started,
    timers: {
      start(run, ms) {
        let cancelled = false;
        const timer = {
          ms,
          get cancelled() {
            return cancelled;
          },
          fire: () => !cancelled && run(),
          cancel: () => {
            cancelled = true;
          },
        };
        started.push(timer);
        waiting.shift()?.(timer);
        return timer.cancel;
      },
    },
    nextStart() {
      if (started.length > handedOut) return Promise.resolve(started[handedOut++]);
      const { promise, resolve } = Promise.withResolvers<GraceTimer>();
      waiting.push((timer) => {
        handedOut++;
        resolve(timer);
      });
      return promise;
    },
  };
}
