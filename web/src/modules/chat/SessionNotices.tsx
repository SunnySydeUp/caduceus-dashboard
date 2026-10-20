// What a session from another surface says about itself (M1 #16): the bar that takes the message box's place when Caduceus may not continue it (with
// Branch, which does), the segments of a conversation Hermes carried on in new sessions, the source badge, and the handoff note.
import type { Ref } from 'react';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { readOnlyNote, type Access } from './session-access.ts';
import type { Lineage } from './session-lineage.ts';
import { sourceIcon, sourceLabel } from './sessions-model.ts';

/** Where the session came from, as a tag with the words for a screen reader as well as the eye. */
export function SourceTag({ source }: { source: string }) {
  return (
    <span className="tag chat__source" data-source={source}>
      <Icon name={sourceIcon(source)} small />
      <span className="sr-only">Source: </span>
      {sourceLabel(source)}
    </span>
  );
}

/**
 * Where the message box would be, for a session Caduceus may not continue: why, and Branch. The bar keeps to the bottom of the screen on a phone, so
 * the action is always in reach. `check` is for a session another process had open: it asks Hermes again whether that is still so.
 */
export function ReadOnlyBar({ access, barRef, branching, onBranch, onCheck }: { access: Extract<Access, { mode: 'read-only' }>; barRef: Ref<HTMLElement>; branching: boolean; onBranch(): void; onCheck: (() => void) | undefined }) {
  return (
    <section ref={barRef} className="chat__readonly" aria-label="Read-only session" data-reason={access.reason}>
      <p className="chat__readonly-text">
        <Icon name="lock" small />
        <span>{readOnlyNote(access)}</span>
      </p>
      <div className="chat__readonly-actions">
        <button type="button" className="btn btn--primary" aria-busy={branching} disabled={branching} onClick={onBranch}>
          <Icon name="git" small />
          {branching ? 'Branching…' : 'Branch to continue'}
        </button>
        {onCheck && (
          <button type="button" className="btn btn--secondary" onClick={onCheck}>
            <Icon name="refresh" small />
            Check again
          </button>
        )}
      </div>
    </section>
  );
}

/** The segments of a conversation Hermes carried on in new sessions, oldest first, each a link; the open one is marked. Nothing when the conversation is one segment. */
export function SegmentsBar({ lineage }: { lineage: Lineage | undefined }) {
  if (!lineage || lineage.segments.length < 2) return null;
  const { segments, index } = lineage;
  return (
    <nav className="chat__segments" aria-label="Segments of this conversation">
      <p className="chat__segments-label">
        Part {index + 1} of {segments.length}
      </p>
      <ol className="chat__segments-list">
        {segments.map((segment, at) => (
          <li key={segment.id}>
            {at === index ? (
              <span className="chat__segment" aria-current="page">
                {at + 1}
                <span className="sr-only"> (this part)</span>
              </span>
            ) : (
              <AppLink className="chat__segment" to={`/chat/${encodeURIComponent(segment.id)}`} title={segment.title || undefined}>
                {at + 1}
                <span className="sr-only">{`: ${at < index ? 'earlier' : 'later'} part${segment.title ? `, ${segment.title}` : ''}`}</span>
              </AppLink>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/** A handoff note: shown here, on the owner's request, and kept nowhere (Copy and Dismiss are all it has). */
export function HandoffNote({ note, truncated, working, onCopy, onDismiss }: { note: string | undefined; truncated: boolean; working: boolean; onCopy(): void; onDismiss(): void }) {
  if (note === undefined && !working) return null;
  return (
    <section className="banner chat__handoff" data-tone="info" aria-label="Handoff summary" aria-busy={working}>
      <Icon name={working ? 'running' : 'book'} />
      <div className="banner__content">
        <strong>{working ? 'Writing the handoff summary…' : 'Handoff summary'}</strong>
        {note !== undefined && <p className="chat__handoff-text">{note}</p>}
        {note !== undefined && truncated && <p className="subtle">The chat was too long for one request: this covers its newest part.</p>}
        {note !== undefined && <p className="subtle">Written for you now. Neither Caduceus nor Hermes keeps it.</p>}
      </div>
      {note !== undefined && (
        <>
          <button type="button" className="btn btn--secondary btn--sm" onClick={onCopy}>
            <Icon name="copy" small />
            Copy
          </button>
          <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label="Dismiss the handoff summary" onClick={onDismiss}>
            <Icon name="x" />
          </button>
        </>
      )}
    </section>
  );
}
