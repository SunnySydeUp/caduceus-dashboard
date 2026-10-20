// What the slash commands answered (M1 #09), at the end of the transcript where the owner typed them: Hermes's own words for each, which the page keeps only
// until they are dismissed or the chat is left. A refusal says why in the policy's words.
import { Icon } from '../../icons.tsx';
import type { CommandNote } from './chat-session.ts';

export function CommandNotes({ notes, onDismiss }: { notes: readonly CommandNote[]; onDismiss(id: string): void }) {
  if (notes.length === 0) return null;
  return (
    <ul className="cnotes" aria-label="Answers to commands">
      {notes.map((note) => (
        <li key={note.id}>
          <div className="cnote" data-tone={note.tone} role={note.tone === 'danger' ? 'alert' : 'status'}>
            <code className="cnote__command">{note.command}</code>
            <pre className="cnote__text">{note.text}</pre>
            <button type="button" className="btn btn--ghost btn--icon" aria-label={`Dismiss the answer to ${note.command}`} onClick={() => onDismiss(note.id)}>
              <Icon name="x" />
            </button>
          </div>
        </li>
      ))}
    </ul>
  );
}
