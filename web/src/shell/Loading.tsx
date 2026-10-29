import { useEffect, useState } from 'react';
import { Icon } from '../icons.tsx';

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
 * The one loading state for a block that waits on Hermes. It holds the room of about `lines` rows as a skeleton (so the page does not jump when the
 * answer arrives), says `label` to a screen reader, and after about five seconds says it is taking longer than usual, with a Retry button when the
 * screen gives `onRetry`. Render it only while the load is running; when the load fails, show the screen's own error, not this.
 */
export function Loading({ label = 'Loading…', lines = 3, onRetry }: { label?: string; lines?: number; onRetry?: () => void }) {
  const late = useTakingLonger(true);
  return (
    <div className="loading" role="status" aria-busy="true">
      <span className="sr-only">{late ? `${label} This is taking longer than usual.` : label}</span>
      <div className="loading__lines" aria-hidden="true">
        {Array.from({ length: lines }, (_, index) => (
          <span key={index} className="skel loading__line" />
        ))}
      </div>
      {late && (
        <p className="loading__late">
          <span className="muted">Taking longer than usual.</span>
          {onRetry && (
            <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry}>
              <Icon name="refresh" />
              <span>Retry</span>
            </button>
          )}
        </p>
      )}
    </div>
  );
}
