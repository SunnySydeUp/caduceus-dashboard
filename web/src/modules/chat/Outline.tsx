// The conversation outline (M1 #04): the owner's prompts and the headings of the replies, each a jump to where it is. Desktop only; the
// phone has no room for it and does not offer it. What it lists is `outline.ts`.
import type { OutlineEntry } from './outline.ts';

export function Outline({ entries, onJump, layout }: { entries: readonly OutlineEntry[]; onJump(entry: OutlineEntry): void; /** `side`: its own column; `fold`: a collapsed list above the transcript, when the conversation has no room for a column. */ layout: 'side' | 'fold' }) {
  const list =
    entries.length === 0 ? (
      <p className="subtle">Prompts and headings appear here.</p>
    ) : (
      <ol className="chat__outline-list">
        {entries.map((entry, index) => (
          <li key={`${entry.key}-${entry.anchor ?? index}`} data-kind={entry.kind} data-level={entry.level}>
            <button type="button" className="chat__outline-link" onClick={() => onJump(entry)}>
              {entry.label}
            </button>
          </li>
        ))}
      </ol>
    );
  if (layout === 'fold') {
    return (
      <details className="chat__outline chat__outline--fold">
        <summary className="chat__outline-title">Outline ({entries.length})</summary>
        <nav aria-label="Conversation outline">{list}</nav>
      </details>
    );
  }
  return (
    <nav className="chat__outline" aria-label="Conversation outline">
      <h2 className="chat__outline-title">Outline</h2>
      {list}
    </nav>
  );
}
