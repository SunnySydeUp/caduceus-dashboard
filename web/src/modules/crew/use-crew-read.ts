// How the first read of the crew stands, for the nav: still on its way (draw the last known crew as a skeleton), done, or failed (it said no, or took longer than
// `CREW_PATIENCE_MS`). The names are kept on this device for the next load (`crew-memory.ts`).
import { useEffect, useState } from 'react';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { readKnownCrew, rememberCrew } from './crew-memory.ts';

/** How long the first read of the crew may take before the nav says it could not be read. */
export const CREW_PATIENCE_MS = 8_000;

export interface CrewRead {
  status: 'loading' | 'ready' | 'failed';
  /** The names the crew had at the last load; empty when none is known. */
  known: readonly string[];
  /** Asks Hermes for the crew again, and starts the wait over. */
  retry(): void;
}

export function useCrewRead(): CrewRead {
  const { hermes, unavailable, reload } = useProfileScope();
  const [known] = useState(() => readKnownCrew(localStorage));
  const [tries, setTries] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const waiting = hermes === undefined;

  useEffect(() => {
    setTimedOut(false);
    if (!waiting) return;
    const timer = setTimeout(() => setTimedOut(true), CREW_PATIENCE_MS);
    return () => clearTimeout(timer);
  }, [waiting, tries]);
  useEffect(() => {
    if (hermes) rememberCrew(localStorage, hermes.profiles.map((profile) => profile.name));
  }, [hermes]);

  return {
    status: hermes ? 'ready' : unavailable || timedOut ? 'failed' : 'loading',
    known,
    retry() {
      setTries((count) => count + 1);
      reload();
    },
  };
}
