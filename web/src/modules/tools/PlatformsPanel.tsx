import { useId, useMemo, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { savePlatformToolsets } from './tools-actions.ts';
import { usePlatformsData, type PlatformsData } from './tools-data.ts';
import { parsePlatformJson, platformGrid, platformJson, platformToolsetsUpdate, setCell, type PlatformToolsets } from './tools-model.ts';
import './tools.css';

/** The editor, made once Hermes has answered: the draft is the one value both the grid and the advanced JSON edit. */
function Editor({ profile, data, reload }: { profile: string; data: PlatformsData; reload(): Promise<void> }) {
  const compact = useSizeClass() === 'compact';
  const addLabel = useId();
  const jsonId = useId();
  const { source, toolsets, platforms } = data;
  const [draft, setDraft] = useState<PlatformToolsets>(source.value);
  const [jsonText, setJsonText] = useState(() => platformJson(source.value));
  const [jsonError, setJsonError] = useState<string>();
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);

  const grid = useMemo(() => platformGrid(draft, toolsets, platforms), [draft, toolsets, platforms]);
  const columns = grid.columns.map((column) => column.name);
  const request = platformToolsetsUpdate(profile, source.value, draft, columns, source);
  const changed = request ? Object.keys((request.body as { config: { platform_toolsets: object } }).config.platform_toolsets) : [];
  const addable = platforms.filter((platform) => !grid.rows.some((row) => row.platform === platform.id));

  const change = (next: PlatformToolsets) => {
    setDraft(next);
    setJsonText(platformJson(next));
    setJsonError(undefined);
  };

  const edit = (text: string) => {
    setJsonText(text);
    const parsed = parsePlatformJson(text);
    if (parsed.ok) {
      setDraft(parsed.value);
      setJsonError(undefined);
    } else {
      setJsonError(parsed.message);
    }
  };

  const add = () => {
    // A new list starts from what the CLI has on, which Hermes reports: the owner adjusts it, and nothing is written until Save.
    const cli = grid.rows.find((row) => row.platform === 'cli')!;
    const enabled = Object.entries(cli.cells).flatMap(([name, state]) => (state === 'on' ? [name] : []));
    const allowed = new Set(toolsets.filter((toolset) => toolset.platform === 'cli' || toolset.platform === adding).map((toolset) => toolset.name));
    change({ ...draft, [adding]: enabled.filter((name) => allowed.has(name)).sort() });
    setAdding('');
  };

  const save = async () => {
    if (!request || jsonError) return;
    setBusy(true);
    const outcome = await savePlatformToolsets(profile, request, changed);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast(`Toolsets saved for ${profile}`, { detail: 'New sessions use them.' });
    await reload();
  };

  return (
    <>
      <div className="tl-grid-wrap">
        <table className="tl-grid">
          <caption className="sr-only">Toolsets by platform</caption>
          <thead>
            <tr>
              <th scope="col">Toolset</th>
              {grid.rows.map((row) => (
                <th key={row.platform} scope="col">
                  <span className="tl-grid__platform">
                    {row.label}
                    {row.saved ? (
                      <button type="button" className="btn btn--ghost btn--sm" aria-label={`Use default for ${row.label}`} onClick={() => change(Object.fromEntries(Object.entries(draft).filter(([platform]) => platform !== row.platform)))}>
                        Use default
                      </button>
                    ) : (
                      <span className="tag">Hermes default</span>
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.columns.map((column) => (
              <tr key={column.name}>
                <th scope="row">
                  {column.label}
                  <span className="tl-grid__key subtle mono">
                    {column.name}
                  </span>
                </th>
                {grid.rows.map((row) => {
                  const state = row.cells[column.name];
                  return (
                    <td key={row.platform}>
                      {state === 'unavailable' ? (
                        <span className="tl-grid__na" title={`${column.label} belongs to one platform`}>
                          <span aria-hidden="true">–</span>
                          <span className="sr-only">
                            {column.label} is not available on {row.label}
                          </span>
                        </span>
                      ) : (
                        <label className="tl-cell">
                          <input type="checkbox" checked={state === 'on'} aria-label={`${column.label} on ${row.label}`} onChange={(event) => change(setCell(draft, row, column.name, event.target.checked))} />
                          <span className="tl-cell__box" aria-hidden="true" />
                        </label>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {grid.rows.filter((row) => row.other.length > 0).map((row) => (
        <p key={row.platform} className="tl-other">
          {row.label} also lists <span className="mono">{row.other.join(', ')}</span>: bundles or servers that are not toolsets of this grid. They are kept as they are, and a bundle may switch on more than the boxes show.
        </p>
      ))}
      {addable.length > 0 && (
        <div className="tl-add">
          <div className="field">
            <label className="field__label" htmlFor={addLabel}>
              Give a platform a list of its own
            </label>
            <select id={addLabel} className="input" value={adding} onChange={(event) => setAdding(event.target.value)}>
              <option value="">Choose a platform</option>
              {addable.map((platform) => (
                <option key={platform.id} value={platform.id}>
                  {platform.name}
                </option>
              ))}
            </select>
          </div>
          <button type="button" className="btn btn--secondary" disabled={adding === ''} onClick={add}>
            <Icon name="plus" />
            Add platform
          </button>
        </div>
      )}
      <details className="tl-advanced">
        <summary>Advanced: the same value as JSON</summary>
        <div className="field">
          <label className="field__label" htmlFor={jsonId}>
            platform_toolsets
          </label>
          {compact && <p className="field__help">Editing JSON is for a larger screen. This shows the value Hermes holds; change it in the grid above, or open Caduceus on a computer.</p>}
          <textarea
            id={jsonId}
            className="input tl-json"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            readOnly={compact}
            value={jsonText}
            aria-invalid={jsonError ? true : undefined}
            aria-describedby={jsonError ? `${jsonId}-error` : undefined}
            onChange={(event) => edit(event.target.value)}
          />
          {jsonError && (
            <p className="field__error" id={`${jsonId}-error`} role="alert">
              <Icon name="alert" small />
              {jsonError} Saving is off until it is valid.
            </p>
          )}
        </div>
      </details>
      <div className="tl-save">
        <WriteButton type="button" className="btn btn--primary" disabled={!request || jsonError !== undefined || busy} aria-busy={busy} onClick={() => void save()}>
          <Icon name="lock" />
          Save…
        </WriteButton>
        {request ? <span className="subtle">Changes to {changed.length === 1 ? 'one platform' : `${changed.length} platforms`}, not saved yet.</span> : <span className="subtle">Nothing to save.</span>}
        {request && (
          <button type="button" className="btn btn--ghost" onClick={() => change(source.value)}>
            Discard changes
          </button>
        )}
      </div>
    </>
  );
}

/** Per-platform toolsets: a grid of toolset × platform and the same value as JSON, one Save (a config write). */
export function PlatformsPanel({ profile }: { profile: string }) {
  const view = usePlatformsData(profile);
  const [version, setVersion] = useState(0);
  const { value } = view;

  return (
    <div className="tl-panel">
      <p className="help-text">
        <Term id="per-platform-toolsets">Per-platform toolsets</Term> say which toolsets each platform gets: the command line, Telegram, Discord and the rest. A platform with no list of its own gets Hermes’s default for it. This edits the <span className="mono">platform_toolsets</span> of <strong>{profile}</strong>.
      </p>
      {view.failed && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer, so the toolsets could not be read{value ? ': this is what it said a moment ago' : ''}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void view.reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {!value && !view.failed && <p role="status">Loading toolsets…</p>}
      {value && (
        <Editor
          key={`${profile}:${version}`}
          profile={profile}
          data={value}
          reload={async () => {
            await view.reload();
            setVersion((current) => current + 1);
          }}
        />
      )}
    </div>
  );
}
