import type { NoteHit, NotesSourceRow } from '@caduceus/contracts/hindsight-api';
import { useEffect, useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { useReadOnly } from '../../policy-state.ts';
import { AppLink } from '../../shell/navigation.tsx';
import { StatusBadge, type StatusState } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { approveSource, markSource, searchNotes } from './hindsight-actions.ts';
import { useNotesSources } from './hindsight-data.ts';
import { readiness, type SourceReadiness } from './hindsight-model.ts';
import { NoteSheet } from './NoteSheet.tsx';
import './memory.css';

const READINESS_WORDS: Record<SourceReadiness, { state: StatusState; label: string }> = {
  ready: { state: 'online', label: 'Ready to search' },
  'needs-approval': { state: 'degraded', label: 'Needs your approval' },
  'not-source': { state: 'offline', label: 'Not a notes source' },
  disabled: { state: 'offline', label: 'Turned off in Hermes' },
  unsupported: { state: 'offline', label: 'Cannot be used' },
};

interface Found {
  server: string;
  query: string;
  hits: NoteHit[];
  text: string | undefined;
}

/** External notes: the MCP servers of the profile's Hermes config, which of them are notes sources, and a search over the ones that are. Search comes first, as on a phone it is what the owner came for. */
export function NotesPanel({ profile }: { profile: string }) {
  const view = useNotesSources(profile);
  const readOnly = useReadOnly();
  const [server, setServer] = useState<string>();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [found, setFound] = useState<Found>();
  const [open, setOpen] = useState<{ server: string; hit: NoteHit }>();
  const searchId = useId();
  const serverId = useId();
  const sources = view.value ?? [];
  const ready = sources.filter((row) => readiness(row) === 'ready');
  const searching = ready.find((row) => row.name === server) ?? ready[0];

  useEffect(() => {
    setFound(undefined);
    setProblem(undefined);
  }, [searching?.name]);

  const search = async () => {
    if (!searching) return;
    if (query.trim() === '') return setProblem('Type what to look for first.');
    setProblem(undefined);
    setBusy('search');
    const outcome = await searchNotes(searching.name, profile, query);
    setBusy(undefined);
    if (outcome.kind === 'failed') return setProblem(outcome.message);
    if (outcome.kind === 'done') setFound({ server: searching.name, query: query.trim(), hits: outcome.body.hits, text: outcome.body.text });
  };

  const mark = async (row: NotesSourceRow, source: boolean) => {
    setBusy(row.name);
    const outcome = await markSource(row.name, profile, source);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') await view.reload();
  };

  const approve = async (row: NotesSourceRow) => {
    setBusy(row.name);
    const outcome = await approveSource(row.name, profile, row.command);
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') {
      toast(`${row.name} can be searched`, { detail: 'Caduceus runs its command for each search and only calls its read and search tools.' });
      await view.reload();
    }
  };

  return (
    <div className="mm-panel">
      <p className="help-text">
        <Term id="external-notes">External notes</Term> are notes kept in another app that has an <Term id="mcp-server">MCP server</Term>. The servers below are the ones in <strong>{profile}</strong>’s Hermes settings. Mark one as a notes source and you can search it and read its notes here. Caduceus only calls a server’s read and search tools, and keeps nothing it finds.
      </p>
      {view.failed && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Caduceus could not read Hermes’s MCP servers{view.value ? ': this is the last list' : ''}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void view.reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {!view.value && !view.failed && <p role="status">Reading the MCP servers…</p>}
      {view.value && ready.length > 0 && searching && (
        <section className="mm-box" aria-label="Search notes">
          <h3>Search your notes</h3>
          <form
            className="mm-bar"
            role="search"
            onSubmit={(event) => {
              event.preventDefault();
              void search();
            }}
          >
            <input id={searchId} className="input mm-search" type="search" aria-label="Search notes" placeholder="Search notes" value={query} onChange={(event) => setQuery(event.target.value)} />
            {ready.length > 1 && (
              <select id={serverId} className="input mm-kind" aria-label="Notes source" value={searching.name} onChange={(event) => setServer(event.target.value)}>
                {ready.map((row) => (
                  <option key={row.name} value={row.name}>
                    {row.name}
                  </option>
                ))}
              </select>
            )}
            <button type="submit" className="btn btn--primary" disabled={busy === 'search'} aria-busy={busy === 'search'}>
              <Icon name="search" small />
              Search
            </button>
          </form>
          {problem && (
            <div className="banner" data-tone="warning" role="alert">
              <Icon name="alert" />
              <span className="banner__content">{problem}</span>
            </div>
          )}
          {busy === 'search' && <p role="status">Searching {searching.name}…</p>}
          {found && found.hits.length === 0 && !found.text && <p className="mm-note" role="status">No note matches “{found.query}”.</p>}
          {found && found.hits.length > 0 && (
            <ul className="mm-group-list" aria-label="Notes found">
              {found.hits.map((hit) => (
                <li key={hit.ref}>
                  <button type="button" className="mm-row" onClick={() => setOpen({ server: found.server, hit })}>
                    <span className="mm-row__label">{hit.title}</span>
                    {hit.snippet && <span className="mm-row__preview">{hit.snippet}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {found && found.hits.length === 0 && found.text && (
            <div>
              <p className="mm-note">{found.server} answered in words, so there is nothing to open:</p>
              <p className="mm-text">{found.text}</p>
            </div>
          )}
        </section>
      )}
      {view.value && sources.length === 0 && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="plug" />
          </span>
          <p>This profile has no MCP servers. Add the server of your notes app first.</p>
          <div className="mm-actions">
            <AppLink className="btn btn--primary" to="/agents/tools/mcp">
              Open MCP servers
            </AppLink>
          </div>
        </div>
      )}
      {sources.length > 0 && (
        <section aria-label="MCP servers">
          <h3 className="mm-group-title">MCP servers</h3>
          <ul className="mm-cards" aria-label="MCP servers" data-layout="list">
            {sources.map((row) => {
              const status = readiness(row);
              const words = READINESS_WORDS[status];
              return (
                <li className="mm-card" key={row.name} data-source={row.source}>
                  <h4 className="mm-card__name">{row.name}</h4>
                  <p className="mm-card__desc">{row.transport === 'stdio' ? 'Runs a command on this computer' : row.transport === 'http' ? 'Web address' : 'Not supported'}</p>
                  {row.command && <p className="mm-code">{row.command}</p>}
                  {row.note && <p className="mm-note">{row.note}</p>}
                  <div className="mm-card__tags">
                    <StatusBadge state={words.state} label={words.label} variant="plain" />
                  </div>
                  <div className="mm-card__actions">
                    {status === 'not-source' && (
                      <WriteButton type="button" className="btn btn--secondary btn--sm" aria-label={`Use for notes: ${row.name}`} disabled={readOnly || busy !== undefined} aria-busy={busy === row.name} onClick={() => void mark(row, true)}>
                        Use for notes
                      </WriteButton>
                    )}
                    {status === 'needs-approval' && (
                      <WriteButton type="button" className="btn btn--primary btn--sm" aria-label={`Approve command for ${row.name}`} disabled={readOnly || busy !== undefined} aria-busy={busy === row.name} onClick={() => void approve(row)}>
                        Approve command…
                      </WriteButton>
                    )}
                    {(status === 'ready' || status === 'needs-approval') && (
                      <WriteButton type="button" className="btn btn--ghost btn--sm" aria-label={`Stop using ${row.name} for notes`} disabled={readOnly || busy !== undefined} onClick={() => void mark(row, false)}>
                        Stop using
                      </WriteButton>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {open && <NoteSheet key={`${open.server}:${open.hit.ref}`} server={open.server} profile={profile} hit={open.hit} onClose={() => setOpen(undefined)} />}
    </div>
  );
}
