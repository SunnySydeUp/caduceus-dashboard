// Says that a reply is being read aloud, and always has Stop (M7 #07): playback can be ended from the bar whichever message started it, and a reply
// that could not be spoken says why.
import { useState } from 'react';
import { Icon } from '../../icons.tsx';
import { readAloud, useReadAloud } from './read-aloud-store.ts';

export function ReadAloudBar() {
  const reading = useReadAloud();
  const [dismissed, setDismissed] = useState<string>();
  if (reading.phase === 'idle') {
    if (reading.error === undefined || dismissed === reading.error) return null;
    return (
      <p className="voice-note voice-note--problem" role="alert">
        <Icon name="info" small />
        <span>{reading.error}</span>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDismissed(reading.error)}>
          Dismiss
        </button>
      </p>
    );
  }
  return (
    <div className="voice-note voice-note--reading" role="status">
      <Icon name="speaker" small />
      <span>{reading.phase === 'loading' ? 'Getting the voice…' : 'Reading aloud'}</span>
      <button type="button" className="btn btn--secondary btn--sm" onClick={readAloud.stop}>
        <Icon name="stop" small />
        Stop reading
      </button>
    </div>
  );
}
