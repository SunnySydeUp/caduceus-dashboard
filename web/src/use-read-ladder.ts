// The clock of the read ladder (`read-ladder.ts`): how long the read that `reading` says is on its way has waited, as the step it has reached.
import { useEffect, useState } from 'react';
import { READ_STAGE_STEPS_MS, readStage, type ReadStage } from './read-ladder.ts';

/**
 * The step of the ladder a read is on. `reading` is true while the read is on its way; `failed` is true once it has answered no. The wait starts over when `reading` turns true
 * again and whenever `restart` changes (a Retry). When the read is not on its way and has not failed, the stage is `reading`: there is nothing to tell.
 */
export function useReadLadder(reading: boolean, failed: boolean, restart?: unknown): ReadStage {
  // The wait is kept with the read it belongs to, so a new read never starts from the last one's time, not even for the render before the timers are set.
  const [mark, setMark] = useState({ reading, restart, ms: 0 });
  useEffect(() => {
    if (!reading) return;
    const timers = READ_STAGE_STEPS_MS.map((ms) => setTimeout(() => setMark({ reading, restart, ms }), ms));
    return () => timers.forEach(clearTimeout);
  }, [reading, restart]);
  const waitedMs = reading && mark.reading && Object.is(mark.restart, restart) ? mark.ms : 0;
  return readStage({ failed, waitedMs });
}
