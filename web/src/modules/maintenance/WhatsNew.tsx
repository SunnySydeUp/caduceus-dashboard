// What's New (M5 #12): what each update changed, newest first. Caduceus keeps this record: Hermes's own receipt holds only the latest update, and does not list the changes.
import type { UpdateCommit, WhatsNewEntry } from '@caduceus/contracts/caduceus-api';
import { Icon } from '../../icons.tsx';
import { whatsNewTitle } from './updates-model.ts';
import './maintenance.css';

export function ChangeList({ changes }: { changes: readonly UpdateCommit[] }) {
  return (
    <ul className="mt-list">
      {changes.map((change) => (
        <li key={`${change.sha}${change.summary}`}>
          {change.summary}
          {change.author ? <span className="subtle"> · {change.author}</span> : null}
        </li>
      ))}
    </ul>
  );
}

export function WhatsNew({ entries }: { entries?: readonly WhatsNewEntry[] }) {
  return (
    <section className="mt-news" aria-labelledby="mt-news-title">
      <h2 id="mt-news-title" className="mt-section__title">
        What’s New
      </h2>
      {!entries || entries.length === 0 ? (
        <p className="mt-note">Nothing yet. After an update, what it changed is listed here.</p>
      ) : (
        <ol className="mt-news__list">
          {entries.map((entry) => (
            <li key={entry.id} className="mt-card" data-ok={entry.ok}>
              <div className="mt-card__top">
                <h3 className="mt-card__name">{whatsNewTitle(entry)}</h3>
                <span className="mt-badge" data-tone={entry.ok ? 'success' : 'danger'}>
                  <Icon name={entry.ok ? 'succeeded' : 'failed'} small />
                  {entry.ok ? 'Updated' : 'Did not finish'}
                </span>
              </div>
              <p className="mt-note">
                <time dateTime={new Date(entry.at).toISOString()}>{new Date(entry.at).toLocaleString()}</time> · {entry.message}
              </p>
              {entry.changes.length > 0 ? (
                <details className="mt-changes" open={entry === entries[0]}>
                  <summary>
                    {entry.changes.length} {entry.changes.length === 1 ? 'change' : 'changes'}
                  </summary>
                  <ChangeList changes={entry.changes} />
                </details>
              ) : (
                <p className="mt-note">{entry.ok ? 'The source did not list the changes.' : 'Nothing changed.'}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
