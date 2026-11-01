// The clock of the read ladder (`read-ladder.ts`): how long the read that `reading` says is on its way has waited, as the step it has reached.
import { useEffect, useState } from 'react';
import { useOnline } from './shell/connection.ts';
import { READ_STAGE_STEPS_MS, readStage, type ReadStage } from './read-ladder.ts';

/**
 * The step of the ladder a read is on. `reading` is true while the read is on its way; `failed` is true once it has answered no. The wait starts over when `reading` turns true
 * again and whenever `restart` changes (a Retry). When the read is not on its way and has not failed, the stage is `reading`: there is nothing to tell. While the device is
 * offline, a read on its way or one that failed is `offline`.
 */
export function useReadLadder(reading: boolean, failed: boolean, restart?: unknown): ReadStage {
  const online = useOnline();
  // The wait is timed only while the device has a network, and kept with the read it belongs to: a new read, and a read that waited through a drop, start from no time, not
  // even for the render before the timers are set.
  const timing = reading && online;
  const [mark, setMark] = useState({ timing, restart, ms: 0 });
  useEffect(() => {
    if (!timing) {
      setMark((last) => (last.ms === 0 ? last : { timing, restart, ms: 0 }));
      return;
    }
    const timers = READ_STAGE_STEPS_MS.map((ms) => setTimeout(() => setMark({ timing, restart, ms }), ms));
    return () => timers.forEach(clearTimeout);
  }, [timing, restart]);
  const waitedMs = timing && mark.timing && Object.is(mark.restart, restart) ? mark.ms : 0;
  return readStage({ failed, waitedMs, online: online || (!reading && !failed) });
}
