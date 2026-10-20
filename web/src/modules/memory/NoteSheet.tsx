import type { NoteHit, NotePreview } from '@caduceus/contracts/hindsight-api';
import { useEffect, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { previewNote } from './hindsight-actions.ts';
import './memory.css';

/** One note of a notes source, opened read-only: its text as the server's read tool gave it, never editable and never kept. */
export function NoteSheet({ server, profile, hit, onClose }: { server: string; profile: string; hit: NoteHit; onClose(): void }) {
  const [note, setNote] = useState<NotePreview>();
  const [problem, setProblem] = useState<string>();
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    previewNote(server, profile, hit.ref).then((outcome) => {
      if (!current) return;
      if (outcome.kind === 'done') setNote(outcome.body);
      else if (outcome.kind === 'failed') setProblem(outcome.message);
    });
    return () => {
      current = false;
    };
  }, [server, profile, hit.ref, attempt]);

  return (
    <Sheet title={hit.title} detents={['full']} className="mm-sheet" onClose={onClose}>
      <div className="mm-form">
        <p className="mm-note">
          From {server}. Read-only: change the note in the app it belongs to.
        </p>
        {problem && (
          <div className="banner" data-tone="warning" role="alert">
            <Icon name="alert" />
            <span className="banner__content">{problem}</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => (setProblem(undefined), setAttempt((count) => count + 1))}>
              <Icon name="refresh" />
              Retry
            </button>
          </div>
        )}
        {!note && !problem && <p role="status">Opening the note…</p>}
        {note && <p className="mm-text mm-text--note">{note.text || 'The server gave no text for this note.'}</p>}
        {note?.truncated && <p className="mm-note">The note is longer than what is shown.</p>}
      </div>
    </Sheet>
  );
}
