// Install a plugin: from a git address the owner types, or from a catalogue entry (the entry's own facts are shown first, because installing
// runs its code). The sheet only collects the choice; `installPlugin` asks for the confirmation (Tier 3: a passkey, then the typed address or
// name) and starts Hermes's install, and the screen then follows its log.
import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { installPlugin } from './plugin-actions.ts';
import { classifySource, withoutCredentials, type CatalogueEntry, type Source, type ValidSource } from './plugins-model.ts';
import './plugins.css';

const COMMIT = /^[0-9a-f]{40}$/i;

/** What a catalogue plugin adds and asks for, in words. */
export function capabilityWords({ tools, hooks, middleware, requiresEnv }: CatalogueEntry['capabilities']): string {
  const part = (items: readonly string[], one: string, many: string) => (items.length === 0 ? [] : [`${items.length} ${items.length === 1 ? one : many}`]);
  const words = [...part(tools, 'tool', 'tools'), ...part(hooks, 'hook', 'hooks'), ...part(middleware, 'middleware', 'middleware'), ...part(requiresEnv, 'variable it needs', 'variables it needs')];
  return words.join(' · ');
}

function EntryFacts({ entry }: { entry: CatalogueEntry }) {
  const { capabilities } = entry;
  return (
    <>
      <p className="pl-note">{entry.description}</p>
      <dl className="pl-facts">
        <dt>Maintainer</dt>
        <dd>{entry.maintainer || 'Not stated'}</dd>
        <dt>Listed as</dt>
        <dd>{entry.tier === 'official' ? 'Official: maintained by Nous Research' : 'Community: reviewed and pinned by Hermes'}</dd>
        <dt>Pinned to</dt>
        <dd>
          <code className="pl-code">{entry.pin || 'a commit'}</code>
          {entry.version ? ` (version ${entry.version})` : ''}
        </dd>
        <dt>Code</dt>
        <dd>
          <code className="pl-code">{entry.repo}</code>
        </dd>
        {capabilities.tools.length > 0 && (
          <>
            <dt>Adds tools</dt>
            <dd>{capabilities.tools.join(', ')}</dd>
          </>
        )}
        {capabilities.hooks.length > 0 && (
          <>
            <dt>Adds hooks</dt>
            <dd>{capabilities.hooks.join(', ')}</dd>
          </>
        )}
        {capabilities.middleware.length > 0 && (
          <>
            <dt>Adds middleware</dt>
            <dd>{capabilities.middleware.join(', ')}</dd>
          </>
        )}
        {capabilities.requiresEnv.length > 0 && (
          <>
            <dt>Needs variables</dt>
            <dd>{capabilities.requiresEnv.join(', ')}. Add them in Keys.</dd>
          </>
        )}
        {entry.requiresHermes && (
          <>
            <dt>Needs Hermes</dt>
            <dd>{entry.requiresHermes}</dd>
          </>
        )}
        {entry.docs && (
          <>
            <dt>Documentation</dt>
            <dd>
              <a href={entry.docs} target="_blank" rel="noreferrer noopener">
                {new URL(entry.docs).host}
              </a>
            </dd>
          </>
        )}
      </dl>
    </>
  );
}

export function InstallSheet({ entry, onStarted, onClose }: { entry?: CatalogueEntry; onStarted(started: { id: string; title: string }): void; onClose(): void }) {
  const id = useId();
  const [typed, setTyped] = useState('');
  const [enable, setEnable] = useState(true);
  const [force, setForce] = useState(false);
  const [ref, setRef] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);

  const source: Source = entry ? { kind: 'catalogue', identifier: entry.name, warnings: [] } : classifySource(typed);
  const refProblem = ref.trim() !== '' && !COMMIT.test(ref.trim()) ? 'A commit is 40 hexadecimal characters (0 to 9, a to f).' : undefined;
  const showProblem = source.kind === 'invalid' && (attempted || typed.trim() !== '');

  const submit = async () => {
    setAttempted(true);
    if (source.kind === 'invalid' || refProblem) return;
    const valid: ValidSource = source;
    setBusy(true);
    const outcome = await installPlugin(valid, { enable, force, ...(valid.kind === 'git' ? { ref } : {}) });
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    // The screen swaps this sheet for the log of what was started.
    onStarted({ id: outcome.body.id, title: `Install ${withoutCredentials(valid.identifier)}` });
  };

  return (
    <Sheet
      title={entry ? `Install ${entry.name}` : 'Install a plugin'}
      detents={['full']}
      className="pl-sheet"
      initialFocus="[data-first]"
      onClose={onClose}
      footer={
        <div className="pl-actions pl-foot">
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
        className="pl-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {entry ? (
          <EntryFacts entry={entry} />
        ) : (
          <div className="field">
            <label className="field__label" htmlFor={`${id}-source`}>
              Git address or catalogue name
            </label>
            <input
              id={`${id}-source`}
              data-first
              className="input input--mono"
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="https://github.com/owner/repo"
              value={typed}
              aria-invalid={showProblem ? true : undefined}
              aria-describedby={`${id}-source-help`}
              onChange={(event) => setTyped(event.target.value)}
            />
            <div className="field__help" id={`${id}-source-help`} aria-live="polite">
              {source.kind === 'invalid' && !showProblem && 'An address such as https://github.com/owner/repo, a short owner/repo, or the name of a catalogue plugin.'}
              {source.kind === 'invalid' && showProblem && <span className="pl-error">{source.problem}</span>}
              {source.kind === 'catalogue' && 'A catalogue plugin: Hermes installs it at the commit its catalogue pins. Read what it adds in the Catalogue first.'}
              {source.kind === 'git' && 'A git address: Hermes has not reviewed it. It is Python that runs on this Mac.'}
              {source.kind !== 'invalid' && source.warnings.map((warning) => (
                <span key={warning} className="pl-warn">
                  <Icon name="alert" small /> {warning}
                </span>
              ))}
            </div>
          </div>
        )}
        <label className="check">
          <input type="checkbox" checked={enable} onChange={(event) => setEnable(event.target.checked)} />
          <span>Turn it on after installing</span>
        </label>
        {source.kind === 'git' && (
          <fieldset className="pl-section">
            <legend>Options</legend>
            <div className="field">
              <label className="field__label" htmlFor={`${id}-ref`}>
                Pin to one commit (optional)
              </label>
              <input id={`${id}-ref`} className="input input--mono" autoCapitalize="none" autoComplete="off" spellCheck={false} maxLength={40} value={ref} aria-invalid={refProblem ? true : undefined} aria-describedby={`${id}-ref-help`} onChange={(event) => setRef(event.target.value)} />
              <p className="field__help" id={`${id}-ref-help`}>
                {refProblem ? <span className="pl-error">{refProblem}</span> : 'A pinned plugin stays on that commit: Update will not move it.'}
              </p>
            </div>
            <label className="check">
              <input type="checkbox" checked={force} onChange={(event) => setForce(event.target.checked)} />
              <span>Replace it if it is already installed</span>
            </label>
          </fieldset>
        )}
      </form>
    </Sheet>
  );
}
