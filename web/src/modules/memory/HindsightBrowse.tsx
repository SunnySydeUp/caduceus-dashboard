import { useId, useState, type ReactNode } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { useRead, type ListView } from './hindsight-data.ts';
import {
  directivesPath,
  KIND_WORDS,
  memoriesPath,
  MEMORY_KINDS,
  mentalModelsPath,
  PAGE_SIZE,
  parseDirectives,
  parseMemories,
  parseMentalModels,
  type DirectiveRow,
  type MemoriesQuery,
  type MemoryKind,
  type MemoryRow,
  type MentalModelRow,
  type Page,
} from './hindsight-model.ts';
import './memory.css';

/** A failed or empty look at a list, in words, with the way to try again. */
function ListState<Value>({ view, empty, children }: { view: ListView<Page<Value>>; empty: string; children: (page: Page<Value>) => ReactNode }) {
  if (view.error !== undefined && view.value === undefined) {
    return (
      <div className="banner" data-tone="warning" role="alert">
        <Icon name="alert" />
        <span className="banner__content">{view.error}</span>
        <button type="button" className="btn btn--secondary btn--sm" onClick={view.reload}>
          <Icon name="refresh" />
          Retry
        </button>
      </div>
    );
  }
  if (view.value === undefined) return <p role="status">Asking Hindsight…</p>;
  if (view.value.rows.length === 0) {
    return (
      <div className="empty">
        <span className="empty__icon">
          <Icon name="database" />
        </span>
        <p>{empty}</p>
      </div>
    );
  }
  return <>{children(view.value)}</>;
}

/** One row of a list the owner opens: its title, a clipped line of text and what it is. */
function Row({ title, preview, tags, onOpen }: { title: string; preview: string; tags: readonly string[]; onOpen(): void }) {
  return (
    <li>
      <button type="button" className="mm-row" onClick={onOpen}>
        <span className="mm-row__label">{title}</span>
        <span className="mm-row__preview">{preview}</span>
        {tags.length > 0 && <span className="mm-row__links">{tags.join(' · ')}</span>}
      </button>
    </li>
  );
}

function Detail({ title, onClose, rows, text }: { title: string; onClose(): void; rows: readonly (readonly [string, string])[]; text: string }) {
  return (
    <Sheet title={title} detents={['full']} className="mm-sheet" onClose={onClose}>
      <div className="mm-form">
        <dl className="mm-facts">
          {rows
            .filter(([, value]) => value !== '')
            .map(([name, value]) => (
              <div key={name} className="mm-facts__row">
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
        </dl>
        <p className="mm-text">{text}</p>
      </div>
    </Sheet>
  );
}

const when = (stamp: string) => (stamp === '' ? '' : new Date(stamp).toLocaleString());

function Memories({ profile, bank }: { profile: string; bank: string }) {
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState<MemoriesQuery>({ q: '', kind: '', offset: 0 });
  const [open, setOpen] = useState<MemoryRow>();
  const searchId = useId();
  const kindId = useId();
  const view = useRead(memoriesPath(bank, profile, query), parseMemories);

  return (
    <div className="mm-panel">
      <form
        className="mm-bar"
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery({ ...query, q: typed, offset: 0 });
        }}
      >
        <input id={searchId} className="input mm-search" type="search" aria-label="Search memories" placeholder="Search memories" value={typed} onChange={(event) => setTyped(event.target.value)} />
        <select id={kindId} className="input mm-kind" aria-label="Kind of memory" value={query.kind} onChange={(event) => setQuery({ ...query, kind: event.target.value as MemoryKind | '', offset: 0 })}>
          <option value="">All kinds</option>
          {MEMORY_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_WORDS[kind]}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn--secondary">
          <Icon name="search" small />
          Search
        </button>
      </form>
      <ListState view={view} empty={query.q || query.kind ? 'No memory matches. Try other words, or all kinds.' : 'This bank has no memories yet.'}>
        {({ rows, total }) => (
          <>
            <ul className="mm-group-list" aria-label="Memories">
              {rows.map((row) => (
                <Row key={row.id} title={row.text} preview={[KIND_WORDS[row.kind as MemoryKind] ?? row.kind, when(row.date)].filter(Boolean).join(' · ')} tags={row.tags} onOpen={() => setOpen(row)} />
              ))}
            </ul>
            <div className="mm-bar">
              <span className="mm-note" role="status">
                {query.offset + 1}–{query.offset + rows.length} of {total}
              </span>
              <button type="button" className="btn btn--secondary btn--sm" disabled={query.offset === 0} onClick={() => setQuery({ ...query, offset: Math.max(0, query.offset - PAGE_SIZE) })}>
                Previous
              </button>
              <button type="button" className="btn btn--secondary btn--sm" disabled={query.offset + rows.length >= total} onClick={() => setQuery({ ...query, offset: query.offset + PAGE_SIZE })}>
                Next
              </button>
            </div>
          </>
        )}
      </ListState>
      {open && (
        <Detail
          title={KIND_WORDS[open.kind as MemoryKind] ?? 'Memory'}
          onClose={() => setOpen(undefined)}
          text={open.text}
          rows={[
            ['Kind', KIND_WORDS[open.kind as MemoryKind] ?? open.kind],
            ['Remembered', when(open.date)],
            ['Context', open.context],
            ['Tags', open.tags.join(', ')],
          ]}
        />
      )}
    </div>
  );
}

function Directives({ profile, bank }: { profile: string; bank: string }) {
  const [open, setOpen] = useState<DirectiveRow>();
  const view = useRead(directivesPath(bank, profile), parseDirectives);
  return (
    <div className="mm-panel">
      <p className="mm-note">Directives are rules Hindsight applies every time it reflects. They are shown here as Hindsight holds them; change them in Hindsight itself.</p>
      <ListState view={view} empty="This bank has no directives.">
        {({ rows }) => (
          <ul className="mm-group-list" aria-label="Directives">
            {rows.map((row) => (
              <Row key={row.id} title={row.name} preview={`${row.active ? 'Active' : 'Off'} · priority ${row.priority} · ${row.content}`} tags={row.tags} onOpen={() => setOpen(row)} />
            ))}
          </ul>
        )}
      </ListState>
      {open && (
        <Detail
          title={open.name}
          onClose={() => setOpen(undefined)}
          text={open.content}
          rows={[
            ['State', open.active ? 'Active' : 'Off'],
            ['Priority', String(open.priority)],
            ['Tags', open.tags.join(', ')],
          ]}
        />
      )}
    </div>
  );
}

function MentalModels({ profile, bank }: { profile: string; bank: string }) {
  const [open, setOpen] = useState<MentalModelRow>();
  const view = useRead(mentalModelsPath(bank, profile), parseMentalModels);
  return (
    <div className="mm-panel">
      <p className="mm-note">A mental model is a summary Hindsight keeps up to date about a topic, from a question it re-asks. They are shown as Hindsight holds them.</p>
      <ListState view={view} empty="This bank has no mental models.">
        {({ rows }) => (
          <ul className="mm-group-list" aria-label="Mental models">
            {rows.map((row) => (
              <Row key={row.id} title={row.name} preview={`${row.stale ? 'Needs a refresh · ' : ''}${row.content || row.sourceQuery}`} tags={row.tags} onOpen={() => setOpen(row)} />
            ))}
          </ul>
        )}
      </ListState>
      {open && (
        <Detail
          title={open.name}
          onClose={() => setOpen(undefined)}
          text={open.content || 'Hindsight has not written this model yet.'}
          rows={[
            ['Question', open.sourceQuery],
            ['Refreshed', when(open.refreshedAt)],
            ['State', open.stale ? 'Needs a refresh' : 'Up to date'],
            ['Tags', open.tags.join(', ')],
          ]}
        />
      )}
    </div>
  );
}

/** A bank's memories, directives or mental models: a list, and a sheet that opens one. */
export function HindsightBrowse({ profile, bank, kind }: { profile: string; bank: string; kind: 'memories' | 'directives' | 'models' }) {
  if (kind === 'memories') return <Memories profile={profile} bank={bank} />;
  if (kind === 'directives') return <Directives profile={profile} bank={bank} />;
  return <MentalModels profile={profile} bank={bank} />;
}
