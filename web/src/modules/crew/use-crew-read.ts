// How the first read of the crew stands, for the nav and the agent switcher: still on its way (draw the last known crew as a skeleton), still on its way after a long
// wait (the same, and it says so), done, or failed (Hermes said no, or the wait passed the ladder's longer bound: `read-ladder.ts`). The names are kept on this device
// for the next load (`crew-memory.ts`).
import { useEffect, useState } from 'react';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { useReadLadder } from '../../use-read-ladder.ts';
import { readKnownCrew, rememberCrew } from './crew-memory.ts';

export interface CrewRead {
  status: 'loading' | 'slow' | 'ready' | 'failed';
  /** The names the crew had at the last load; empty when none is known. */
  known: readonly string[];
  /** Asks Hermes for the crew again, and starts the wait over. */
  retry(): void;
}

export function useCrewRead(): CrewRead {
  const { hermes, unavailable, reload } = useProfileScope();
  const [known] = useState(() => readKnownCrew(localStorage));
  const [tries, setTries] = useState(0);
  const stage = useReadLadder(hermes === undefined, unavailable, tries);
  useEffect(() => {
    if (hermes) rememberCrew(localStorage, hermes.profiles.map((profile) => profile.name));
  }, [hermes]);

  return {
    status: hermes ? 'ready' : stage === 'failed' ? 'failed' : stage === 'still-reading' ? 'slow' : 'loading',
    known,
    retry() {
      setTries((count) => count + 1);
      reload();
    },
  };
}
