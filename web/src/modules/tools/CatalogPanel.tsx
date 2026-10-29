import { useId, useMemo, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Loading } from '../../shell/Loading.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { Rich } from '../chat/Rich.tsx';
import { wrapProse } from '../skills/prose.ts';
import { ActionLogSheet, type LogRun, type LogVerdict } from '../skills/ActionLogSheet.tsx';
import { installEntry } from './mcp-actions.ts';
import { useMcpCatalog } from './mcp-data.ts';
import { commandLine, filterCatalog, installProblems, needsHermesComputer, type CatalogEntry, type CatalogFilter } from './mcp-model.ts';
import './tools.css';

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'available', label: 'Not installed' },
  { value: 'installed', label: 'Installed' },
] as const satisfies readonly { value: CatalogFilter; label: string }[];

/** A web address is safe to link to only when it is a web address. */
function webAddress(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
}

/** What the entry runs or reaches, and what it asks for, before anything is installed: the trust model asks the owner to read it. */
function InstallSheet({ entry, profile, onInstalled, onClose }: { entry: CatalogEntry; profile: string; onInstalled(entry: CatalogEntry, background: string | undefined): void; onClose(): void }) {
  const id = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const problems = installProblems(entry, values);
  const source = webAddress(entry.source);

  const submit = async () => {
    setAttempted(true);
    if (Object.keys(problems).length > 0) return;
    setBusy(true);
    const outcome = await installEntry(entry, values, profile);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    onInstalled(entry, outcome.body.background ? outcome.body.action : undefined);
    onClose();
  };

  return (
    <Sheet
      title={`Install ${entry.name} · ${profile}`}
      detents={['full']}
      className="tl-sheet"
      initialFocus="[data-first]"
      onClose={onClose}
      footer={
        <div className="tl-actions tl-foot">
          <WriteButton type="submit" form={id} className="btn btn--primary" disabled={busy} aria-busy={busy}>
            <Icon name="download" />
            Install…
          </WriteButton>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      }
    >
      <form
        id={id}
        className="tl-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p className="tl-note">{entry.description}</p>
        <dl className="tl-facts">
          {entry.command ? (
            <>
              <dt>Runs</dt>
              <dd>
                <code className="tl-code">{commandLine(entry.command, entry.args)}</code>
              </dd>
            </>
          ) : (
            <>
              <dt>Address</dt>
              <dd>
                <code className="tl-code">{entry.url ?? 'none'}</code>
              </dd>
            </>
          )}
          <dt>Transport</dt>
          <dd>{entry.transport === 'stdio' ? 'Command (stdio)' : entry.transport.toUpperCase()}</dd>
          <dt>Sign-in</dt>
          <dd>{entry.authType === 'oauth' ? 'OAuth: sign in from the server after installing' : entry.authType === 'none' ? 'None' : entry.authType}</dd>
          {entry.installUrl && (
            <>
              <dt>Builds from</dt>
              <dd>
                <code className="tl-code">{entry.installUrl}</code>
              </dd>
            </>
          )}
          {entry.bootstrap.length > 0 && (
            <>
              <dt>Build steps</dt>
              <dd>
                <code className="tl-code">{entry.bootstrap.join(' && ')}</code>
              </dd>
            </>
          )}
          {source && (
            <>
              <dt>Documentation</dt>
              <dd>
                <a href={source} target="_blank" rel="noreferrer noopener">
                  {new URL(source).host}
                </a>
              </dd>
            </>
          )}
        </dl>
        {entry.requiredEnv.length > 0 && (
          <fieldset className="tl-section">
            <legend>Values it needs</legend>
            <p className="tl-note">Hermes keeps secrets in the profile’s .env file and never sends them back.</p>
            {entry.requiredEnv.map((spec, index) => (
              <div className="field" key={spec.name}>
                <label className="field__label" htmlFor={`${id}-${spec.name}`}>
                  {spec.prompt}
                </label>
                <input
                  id={`${id}-${spec.name}`}
                  data-first={index === 0 ? true : undefined}
                  className="input input--mono"
                  type="password"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  value={values[spec.name] ?? ''}
                  aria-invalid={attempted && problems[spec.name] ? true : undefined}
                  aria-describedby={`${id}-${spec.name}-help`}
                  onChange={(event) => setValues((current) => ({ ...current, [spec.name]: event.target.value }))}
                />
                <p className={attempted && problems[spec.name] ? 'field__error' : 'field__help'} id={`${id}-${spec.name}-help`} role={attempted && problems[spec.name] ? 'alert' : undefined}>
                  <span className="mono">{spec.name}</span>
                  {attempted && problems[spec.name] ? ` · ${problems[spec.name]}` : spec.required ? ' · required' : ' · optional'}
                </p>
              </div>
            ))}
          </fieldset>
        )}
        {entry.postInstall && (
          <div className="tl-after">
            <h3 className="tl-after__title">After you install</h3>
            {needsHermesComputer(entry.postInstall) && (
              <p className="banner" data-tone="info" role="note">
                <Icon name="info" />
                <span className="banner__content">One of these steps needs the computer that runs Hermes. A link to localhost does not open from this device.</span>
              </p>
            )}
            <div className="tl-note">
              <Rich text={wrapProse(entry.postInstall)} anchor={`mcp-after-${entry.name}`} />
            </div>
          </div>
        )}
      </form>
    </Sheet>
  );
}

/** Judges the log of an install by its last line: Hermes's own words. */
const judgeInstall: LogRun['judge'] = async (log) => {
  const failed = log.exitCode !== null && log.exitCode !== 0;
  return failed ? { ok: false, message: log.lines.at(-1) ?? 'The install failed.' } : { ok: true, message: 'Installed.' };
};

/** Hermes's MCP catalogue: searchable, with each entry's install and a mark on the ones the profile already has. */
export function CatalogPanel({ profile }: { profile: string }) {
  const view = useMcpCatalog(profile);
  const compact = useSizeClass() === 'compact';
  const [query, setQuery] = useState('');
  const [show, setShow] = useState<CatalogFilter>('all');
  const [installing, setInstalling] = useState<string>();
  const [run, setRun] = useState<LogRun>();
  const filterLabel = useId();
  const catalog = view.value;
  const shown = useMemo(() => (catalog ? filterCatalog(catalog.entries, { query, show }) : undefined), [catalog, query, show]);
  const entry = catalog?.entries.find((candidate) => candidate.name === installing);

  const installed = (done: CatalogEntry, action: string | undefined) => {
    if (action) setRun({ action, title: `Installing ${done.name}`, doneTitle: `${done.name} is installed`, judge: judgeInstall });
    else toast(`${done.name} is installed for ${profile}`, { detail: done.postInstall ? 'Open it in MCP servers to test it.' : 'Test it in MCP servers.' });
    void view.reload();
  };
  const finished = (verdict: LogVerdict) => {
    toast(verdict.ok ? (verdict.message ?? 'Installed.') : verdict.message, { tone: verdict.ok ? undefined : 'danger' });
    void view.reload();
  };

  return (
    <div className="tl-panel">
      <p className="help-text">
        Hermes’s curated list of <Term id="mcp-server">MCP servers</Term>. Installing one adds it to <strong>{profile}</strong> and asks for the values it needs. Read what an entry runs or reaches before you install it.
      </p>
      {view.failed && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer, so its catalogue could not be listed{catalog ? ': this is the list from a moment ago' : ''}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void view.reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {!catalog && !view.failed && <Loading label="Loading the catalogue…" lines={4} onRetry={() => void view.reload()} />}
      {catalog && catalog.diagnostics.length > 0 && (
        <div className="banner" data-tone="warning" role="status">
          <Icon name="info" />
          <span className="banner__content">Hermes found {catalog.diagnostics.length === 1 ? 'a problem' : `${catalog.diagnostics.length} problems`} in the catalogue: {catalog.diagnostics.map((item) => `${item.name} ${item.message}`.trim()).join('; ')}</span>
        </div>
      )}
      {catalog && catalog.entries.length > 0 && (
        <div className="tl-bar">
          <div className="input-wrap tl-search">
            <Icon name="search" />
            <input className="input" type="search" placeholder="Search the catalogue" aria-label="Search the catalogue" value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <span id={filterLabel} className="sr-only">
            Show
          </span>
          <RadioGroup labelledBy={filterLabel} value={show} options={FILTERS} onChange={setShow} className="seg" />
          <span className="subtle" role="status">
            {shown?.length} of {catalog.entries.length}
          </span>
        </div>
      )}
      {shown && shown.length > 0 && (
        <ul className="tl-cards" aria-label="Catalogue" data-layout={compact ? 'list' : 'grid'}>
          {shown.map((item) => (
            <li className="tl-card" key={item.name} data-entry={item.name}>
              <div className="tl-card__top">
                <div className="tl-card__id">
                  <h3 className="tl-card__name">{item.name}</h3>
                  <span className="tl-card__key mono" data-clamp>{item.command ? commandLine(item.command, item.args) : (item.url ?? '')}</span>
                </div>
              </div>
              <div className="tl-card__tags">
                {item.installed ? <StatusBadge state="succeeded" label={item.enabled ? 'Installed' : 'Installed · off'} variant="plain" /> : <span className="subtle">Not installed</span>}
                <span className="tag">{item.transport === 'stdio' ? 'Command' : item.transport.toUpperCase()}</span>
                {item.requiredEnv.length > 0 && <span className="tag">{item.requiredEnv.length === 1 ? '1 value' : `${item.requiredEnv.length} values`}</span>}
              </div>
              <p className="tl-card__desc">{item.description}</p>
              <div className="tl-card__actions">
                <WriteButton type="button" className={`btn btn--sm ${item.installed ? 'btn--secondary' : 'btn--primary'}`} aria-label={`${item.installed ? 'Reinstall' : 'Install'} ${item.name}`} onClick={() => setInstalling(item.name)}>
                  <Icon name="download" small />
                  {item.installed ? 'Reinstall…' : 'Install…'}
                </WriteButton>
              </div>
            </li>
          ))}
        </ul>
      )}
      {catalog && shown && shown.length === 0 && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="search" />
          </span>
          <p>{catalog.entries.length === 0 ? 'Hermes lists no catalogue entries.' : 'No entry matches.'}</p>
          {catalog.entries.length > 0 && (
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => {
                setQuery('');
                setShow('all');
              }}
            >
              Show every entry
            </button>
          )}
        </div>
      )}
      {entry && <InstallSheet key={entry.name} entry={entry} profile={profile} onInstalled={installed} onClose={() => setInstalling(undefined)} />}
      {run && <ActionLogSheet run={run} onFinished={finished} onClose={() => setRun(undefined)} />}
    </div>
  );
}
