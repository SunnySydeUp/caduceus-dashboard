// How a read that is on its way is told to the owner, everywhere the same (the crew, Today's blocks, Talk's skeleton, the agent switcher's list): a skeleton with no words,
// then, once the wait is long, "Still reading Hermes…" (not an alarm, nothing to press yet), and "Couldn't be read" with a Retry only when the read has failed for real or has
// passed the longer bound. A slow read must never say "couldn't be read" and then heal. Pure: `use-read-ladder.ts` keeps the clock.

/** How long a read may take before the screen says it is still reading. */
export const STILL_READING_MS = 8_000;
/** How long a read may take before the screen gives it up as one that could not be read, and offers a Retry. */
export const GIVE_UP_MS = 30_000;

/** The ladder's steps, in the order a wait climbs them. */
export type ReadStage = 'reading' | 'still-reading' | 'failed';

/** What the screen says on the middle step. The last step names what could not be read ("Crew couldn’t be read"), so each screen words it for itself. */
export const STILL_READING_WORDS = 'Still reading Hermes…';

/** The moments, after a read starts, at which its stage can change: where the clock sets its timers. */
export const READ_STAGE_STEPS_MS: readonly number[] = [STILL_READING_MS, GIVE_UP_MS];

/** The stage of a read that has waited `waitedMs`. A read that has failed is at the last stage at once, however little it waited. */
export function readStage({ failed, waitedMs }: { failed: boolean; waitedMs: number }): ReadStage {
  if (failed || waitedMs >= GIVE_UP_MS) return 'failed';
  return waitedMs >= STILL_READING_MS ? 'still-reading' : 'reading';
}

/**
 * Whether a block's wait is a read on its way, the only kind the ladder may time. A block that has not asked yet (it waits for the first paint or for the answer above it)
 * is waiting, not reading: it must never be called slow. A block that does not say whether it has asked is taken to have asked.
 */
export function isReading({ status, asked }: { status: 'loading' | 'ready' | 'error'; asked?: boolean }): boolean {
  return status === 'loading' && asked !== false;
}
