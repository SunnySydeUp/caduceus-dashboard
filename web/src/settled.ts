// "The first screen is done": a moment after the page's `load`, once the browser is idle. Chores that nothing on the first screen waits for
// (update checks, syncing the look with Caduceus's record, Today's setup offer below the first screen) wait for it, so that on a slow network their
// requests are not queued in front of what is being painted (`npm run perf`, LCP).

const { promise, resolve } = Promise.withResolvers<void>();

/** Settles a second after `load`, when idle (and at most a second later still). */
export const settled: Promise<void> = promise;

const settleWhenIdle = () =>
  setTimeout(() => {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => resolve(), { timeout: 1000 });
    else resolve();
  }, 1000);

// Not in a browser (the pure modules are run by tests): there is no first screen to wait for.
if (typeof document === 'undefined') resolve();
else if (document.readyState === 'complete') settleWhenIdle();
else addEventListener('load', settleWhenIdle, { once: true });

/**
 * Resolves once the browser reports that the first screen has been painted (its `first-contentful-paint`, which comes a few frames after the render
 * that made it). What is asked for here is not in the way of that paint, which on a slow network a request made in the same breath is (`npm run
 * perf`, LCP). A page that never paints (it is in a background tab) or a browser that does not say does not wait for one longer than 1.5 seconds.
 */
export function afterPaint(): Promise<void> {
  if (typeof PerformanceObserver !== 'function') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => setTimeout(resolve, 0);
    const give = setTimeout(done, 1500);
    try {
      new PerformanceObserver((list, observer) => {
        if (!list.getEntriesByName('first-contentful-paint').length) return;
        observer.disconnect();
        clearTimeout(give);
        done();
      }).observe({ type: 'paint', buffered: true });
    } catch {
      // A browser without paint timing: the timer above stands in for it.
    }
  });
}
