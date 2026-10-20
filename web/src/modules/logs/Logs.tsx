import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useSearch } from '@tanstack/react-router';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { useAppNavigate } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { StatusBadge, type StatusState } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { LogList } from './LogList.tsx';
import { saveAsFile, truncateLog } from './logs-actions.ts';
import {
  LINE_CHOICES,
  LOG_COMPONENTS,
  LOG_FILE_CHOICES,
  LOG_LEVELS,
  downloadName,
  emptyBuffer,
  heldCount,
  parseQuery,
  readLogsView,
  receive,
  release,
  selectedText,
  streamPath,
  viewText,
  type LogBuffer,
  type LogComponent,
  type LogFileName,
  type LogLevel,
  type LogUpdate,
  type LogsView,
} from './logs-model.ts';
import { logsSearch } from './logs-query.ts';
import { useLogStream } from './logs-stream.ts';
import './logs.css';

/** The filters Hermes can apply itself, as form fields: inline on a wide screen, in a sheet on a phone. */
function FilterFields({ view, onChange }: { view: LogsView; onChange(next: LogsView): void }) {
  const id = useId();
  return (
    <>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-file`}>
          File
        </label>
        <select id={`${id}-file`} className="input" value={view.file} onChange={(event) => onChange({ ...view, file: event.target.value as LogFileName })}>
          {LOG_FILE_CHOICES.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-level`}>
          Level
        </label>
        <select id={`${id}-level`} className="input" value={view.level ?? ''} onChange={(event) => onChange({ ...view, level: (event.target.value || undefined) as LogLevel | undefined })}>
          <option value="">All levels</option>
          {LOG_LEVELS.map((level) => (
            <option key={level} value={level}>
              {level === 'DEBUG' ? 'Debug' : `${level.charAt(0)}${level.slice(1).toLowerCase()} and above`}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-component`}>
          Component
        </label>
        <select id={`${id}-component`} className="input" value={view.component ?? ''} onChange={(event) => onChange({ ...view, component: (event.target.value || undefined) as LogComponent | undefined })}>
          <option value="">All components</option>
          {LOG_COMPONENTS.map((component) => (
            <option key={component} value={component}>
              {component}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field__label" htmlFor={`${id}-lines`}>
          Lines
        </label>
        <select id={`${id}-lines`} className="input" value={view.lines} onChange={(event) => onChange({ ...view, lines: Number(event.target.value) })}>
          {[...new Set<number>([...LINE_CHOICES, view.lines])].sort((a, b) => a - b).map((lines) => (
            <option key={lines} value={lines}>
              Last {lines}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

const STATUS: Record<LogBuffer['phase'], { state: StatusState; label: string }> = {
  connecting: { state: 'reconnecting', label: 'Connecting' },
  live: { state: 'online', label: 'Live' },
  unavailable: { state: 'offline', label: 'Not reachable' },
  rejected: { state: 'failed', label: 'Refused' },
};

export function Logs() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const view = readLogsView(search);
  const navigate = useAppNavigate();
  const { effective } = useProfileScope();
  const profile = effective?.name ?? 'default';
  const compact = useSizeClass() === 'compact';
  const searchId = useId();

  const [buffer, setBuffer] = useState<LogBuffer>(emptyBuffer);
  const [paused, setPaused] = useState(false);
  const [following, setFollowing] = useState(true);
  const [jump, setJump] = useState(0);
  const [picked, setPicked] = useState<ReadonlySet<number>>(new Set());
  const [filtering, setFiltering] = useState(false);
  const [signedOut, setSignedOut] = useState(false);
  const [draft, setDraft] = useState(view.search);

  const go = (next: LogsView, replace = false) => {
    const query = new URLSearchParams(logsSearch(next)).toString();
    void navigate(`/observe/logs${query ? `?${query}` : ''}`, { replace });
  };

  // Paused by the reader, or scrolled away from the end: either way the screen waits and the lines are counted.
  const holding = paused || !following;
  const holdingNow = useRef(holding);
  holdingNow.current = holding;
  const path = streamPath(view, profile);

  useEffect(() => {
    // Another view is another log: nothing of the last one stays, and the reader starts at the end of the new one.
    setBuffer(emptyBuffer);
    setPicked(new Set());
    setFollowing(true);
    setSignedOut(false);
  }, [path]);
  useEffect(() => {
    if (!holding) setBuffer((current) => (heldCount(current) === 0 ? current : release(current)));
  }, [holding]);
  useEffect(() => setDraft(view.search), [view.search]);

  useLogStream(
    path,
    (update: LogUpdate) => setBuffer((current) => receive(current, update, holdingNow.current)),
    () => setSignedOut(true),
  );

  const applyQuery = (text: string) => {
    const query = parseQuery(text);
    go({ ...view, ...(query.file ? { file: query.file } : {}), ...(query.level ? { level: query.level } : {}), ...(query.component ? { component: query.component } : {}), search: query.search }, true);
  };
  // Typing is applied once it pauses, so every letter is not a new view; Enter applies it at once.
  useEffect(() => {
    if (draft.trim() === view.search) return;
    const timer = setTimeout(() => applyQuery(draft), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `applyQuery` reads the view this effect lists
  }, [draft, view.search, view.file, view.level, view.component, view.lines]);
  const submit = (event: FormEvent) => {
    event.preventDefault();
    applyQuery(draft);
  };

  const held = heldCount(buffer);
  const status = paused ? { state: 'paused' as const, label: held > 0 ? `Paused · ${held} new` : 'Paused' } : !following && buffer.phase === 'live' ? { state: 'paused' as const, label: held > 0 ? `Behind live · ${held} new` : 'Behind live' } : STATUS[buffer.phase];
  const fileLabel = LOG_FILE_CHOICES.find((choice) => choice.value === view.file)!;
  const disk = fileLabel.disk;
  const narrowed = view.level !== undefined || view.component !== undefined || view.search !== '';
  const filterCount = [view.level, view.component, view.lines !== 200 ? view.lines : undefined].filter((value) => value !== undefined).length + (view.file === 'agent' ? 0 : 1);

  const copyPicked = async () => {
    const text = selectedText(buffer, picked);
    const count = picked.size;
    try {
      await navigator.clipboard.writeText(text);
      toast(count === 1 ? 'Copied the line' : `Copied ${count} lines`);
      setPicked(new Set());
    } catch {
      toast('Could not copy. Select the text by hand instead.', { tone: 'danger' });
    }
  };
  const togglePick = (id: number) =>
    setPicked((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const truncate = async () => {
    const outcome = await truncateLog(view.file, profile);
    if (outcome.kind === 'done') toast(`${disk} emptied`, { detail: `${outcome.body.bytes.toLocaleString()} bytes deleted. Hermes keeps writing to it.` });
    else if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
  };

  const catchUp = () => {
    setPaused(false);
    setFollowing(true);
    setJump((n) => n + 1);
  };

  return (
    <div className="lg">
      <PageHeader overline="Observe" title="Logs" subtitle={`${fileLabel.label} · last ${view.lines} lines${narrowed ? ', filtered' : ''}`} actions={<StatusBadge state={status.state} label={status.label} />} />
      <p className="help-text">
        What Hermes writes to its log files, read from Hermes and kept up to date as a <Term id="live-tail">live tail</Term>. Filter by <Term id="log-level">level</Term> or <Term id="log-component">component</Term>; the search is Hermes’s own.
      </p>

      <div className="lg-tools" role="search" aria-label="Filter the log">
        <form className="lg-search" onSubmit={submit}>
          <label className="sr-only" htmlFor={searchId}>
            Search the log, or type level:error or component:gateway
          </label>
          <div className="input-wrap">
            <Icon name="search" />
            <input id={searchId} className="input input--mono" type="search" value={draft} placeholder="Search, or level:error component:gateway" autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(event) => setDraft(event.target.value)} />
          </div>
        </form>
        {compact ? (
          <button type="button" className="btn btn--secondary" aria-haspopup="dialog" onClick={() => setFiltering(true)}>
            <Icon name="filter" />
            Filters{filterCount > 0 ? ` (${filterCount})` : ''}
          </button>
        ) : (
          <div className="lg-fields">
            <FilterFields view={view} onChange={(next) => go(next)} />
          </div>
        )}
      </div>

      {compact && (view.level || view.component || view.file !== 'agent') && (
        <div className="chips-scroll" role="group" aria-label="Active filters">
          {view.file !== 'agent' && (
            <button type="button" className="chip" onClick={() => go({ ...view, file: 'agent' })} aria-label={`file: ${view.file}, remove this filter`}>
              file: {view.file}
              <Icon name="x" small />
            </button>
          )}
          {view.level && (
            <button type="button" className="chip" onClick={() => go({ ...view, level: undefined })} aria-label={`level: ${view.level.toLowerCase()}, remove this filter`}>
              level: {view.level.toLowerCase()}
              <Icon name="x" small />
            </button>
          )}
          {view.component && (
            <button type="button" className="chip" onClick={() => go({ ...view, component: undefined })} aria-label={`component: ${view.component}, remove this filter`}>
              component: {view.component}
              <Icon name="x" small />
            </button>
          )}
        </div>
      )}

      <div className="lg-bar" role="toolbar" aria-label="Log actions">
        <button type="button" className="btn btn--secondary" aria-pressed={paused} onClick={() => (paused ? catchUp() : setPaused(true))}>
          <Icon name={paused ? 'play' : 'paused'} />
          {paused ? 'Resume' : 'Pause'}
        </button>
        {(held > 0 || !following) && (
          <button type="button" className="btn btn--primary" onClick={catchUp}>
            <Icon name="chev-d" />
            Jump to live{held > 0 ? ` (${held} new)` : ''}
          </button>
        )}
        <button type="button" className="btn btn--secondary" disabled={buffer.rows.length + held === 0} onClick={() => (saveAsFile(downloadName(view, new Date()), viewText(buffer)), toast(`Saved ${downloadName(view, new Date())}`))}>
          <Icon name="download" />
          Download
        </button>
        <WriteButton type="button" className="btn btn--secondary lg-bar__danger" onClick={() => void truncate()}>
          <Icon name="trash" />
          Truncate file
        </WriteButton>
      </div>

      {picked.size > 0 && (
        <div className="lg-picked" role="group" aria-label="Selected lines">
          <span>
            {picked.size} {picked.size === 1 ? 'line' : 'lines'} selected
          </span>
          <button type="button" className="btn btn--primary btn--sm" onClick={() => void copyPicked()}>
            <Icon name="copy" small />
            {picked.size === 1 ? 'Copy line' : `Copy ${picked.size} lines`}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setPicked(new Set())}>
            Clear
          </button>
        </div>
      )}

      {signedOut && (
        <div className="banner" data-tone="warning" role="alert">
          <Icon name="alert" />
          <div className="banner__content">
            <strong>The live tail stopped</strong>
            <p>Caduceus closed the connection, most likely because you were signed out. Reload the page to sign in again.</p>
          </div>
        </div>
      )}
      {buffer.phase === 'unavailable' && (
        <div className="banner" data-tone="warning" role="status">
          <Icon name="alert" />
          <div className="banner__content">
            <strong>Hermes is not answering</strong>
            <p>{buffer.message} The lines below are the last ones read, and Caduceus keeps trying.</p>
          </div>
        </div>
      )}
      {buffer.phase === 'rejected' && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <div className="banner__content">
            <strong>Hermes did not accept this view</strong>
            <p>{buffer.message}</p>
          </div>
        </div>
      )}

      <p className="sr-only" role="status">
        {buffer.phase === 'live' ? `${buffer.rows.length} lines` : ''}
      </p>
      <div className="lg-box">
        {buffer.rows.length === 0 ? (
          <div className="empty">
            <Icon name="log" />
            <h2>{buffer.phase === 'connecting' ? 'Reading the log…' : narrowed ? 'No line matches' : `${disk} is empty`}</h2>
            <p>
              {buffer.phase === 'connecting'
                ? 'Asking Hermes for the last lines.'
                : narrowed
                  ? 'Hermes has no line in the last lines of this file that fits the filters. New lines that fit appear here as they are written.'
                  : 'Nothing is written to this file yet. New lines appear here as they are written.'}
            </p>
          </div>
        ) : (
          <LogList rows={buffer.rows} search={view.search} picked={picked} onPick={togglePick} jump={jump} onFollowing={setFollowing} />
        )}
      </div>

      {filtering && (
        <Sheet title="Filters" detents={['half', 'full']} onClose={() => setFiltering(false)}>
          <div className="stack">
            <FilterFields view={view} onChange={(next) => go(next)} />
            <button type="button" className="btn btn--primary" onClick={() => setFiltering(false)}>
              Show the log
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
