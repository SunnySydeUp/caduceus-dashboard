// Hermes tells the log of `hermes update` as a window: the last lines it printed, asked for again and again. The page wants each line once, as it
// comes, so what is new is what follows the longest tail of the previous window that starts the new one.

/** The lines of `window` that `before` has not shown: `before`'s end is found at the start of `window` (the window has slid on), or the window is all new. */
export function linesAfter(before: readonly string[], window: readonly string[]): string[] {
  for (let overlap = Math.min(before.length, window.length); overlap > 0; overlap--) {
    let same = true;
    for (let i = 0; i < overlap && same; i++) same = before[before.length - overlap + i] === window[i];
    if (same) return window.slice(overlap);
  }
  return [...window];
}
