import { useEffect, useState } from 'react';
import { Icon } from '../icons.tsx';
import { STILL_READING_WORDS } from '../read-ladder.ts';
import { useReadLadder } from '../use-read-ladder.ts';

/** How long a load may take before the screen says it is taking longer than usual. */
export const LOADING_PATIENCE_MS = 5000;

/** Whether `active` has been true for `ms` without a break: the "taking longer than usual" state of a load. It resets when the load ends. */
export function useTakingLonger(active: boolean, ms = LOADING_PATIENCE_MS): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!active) {
      setLate(false);
      return;
    }
    const timer = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(timer);
  }, [active, ms]);
  return late;
}

/**
 * The one loading state for a block that waits on Hermes, on the read ladder (`read-ladder.ts`). It holds the room of about `lines` rows as a skeleton (so the page does not
 * jump when the answer arrives) and says `label` to a screen reader. After about eight seconds it says "Still reading Hermes…", with nothing to press; only when the read has
 * failed (`failed`) or has passed the longer bound does it say it could not be read, with a Retry when the screen gives `onRetry`. Render it only while the load is running;
 * when the load fails, show the screen's own error, not this.
 */
export function Loading({ label = 'Loading…', lines = 3, failed = false, onRetry }: { label?: string; lines?: number; failed?: boolean; onRetry?: () => void }) {
  const [tries, setTries] = useState(0);
  const stage = useReadLadder(true, failed, tries);
  return (
    <div className="loading" role="status" aria-busy="true">
      <span className="sr-only">{stage === 'still-reading' ? `${label} ${STILL_READING_WORDS}` : label}</span>
      <div className="loading__lines" aria-hidden="true">
        {Array.from({ length: lines }, (_, index) => (
          <span key={index} className="skel loading__line" />
        ))}
      </div>
      {stage === 'still-reading' && (
        <p className="loading__late" aria-hidden="true">
          <span className="muted">{STILL_READING_WORDS}</span>
        </p>
      )}
      {stage === 'failed' && (
        <p className="loading__late">
          <span className="muted">Couldn’t be read</span>
          {onRetry && (
            <button
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => {
                setTries((count) => count + 1);
                onRetry();
              }}
            >
              <Icon name="refresh" />
              <span>Retry</span>
            </button>
          )}
        </p>
      )}
    </div>
  );
}
