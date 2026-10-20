import { useId, useState, type ReactNode } from 'react';
import { Icon } from '../../icons.tsx';
import { Layer } from '../../overlays/Layer.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { ActionLogSheet, type LogRun, type LogVerdict } from '../skills/ActionLogSheet.tsx';
import { chooseModel, chooseProvider, judgeSetup, saveToolsetKeys, startToolsetSetup } from './tools-actions.ts';
import { useToolsetDetail } from './tools-data.ts';
import { SETUP_ACTION, type ProviderStatus, type Toolset, type ToolsetProvider } from './tools-model.ts';

const STATUS_WORDS: Record<ProviderStatus, string> = { ready: 'Ready', 'needs-keys': 'Needs keys', 'needs-auth': 'Needs sign-in', 'needs-setup': 'Needs setup' };

function ProviderBadge({ status }: { status: ProviderStatus }) {
  return status === 'ready' ? <StatusBadge state="succeeded" label={STATUS_WORDS[status]} variant="plain" /> : <StatusBadge state="blocked" label={STATUS_WORDS[status]} variant="plain" />;
}

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

function KeyField({ provider, keyName, value, onChange }: { provider: ToolsetProvider; keyName: string; value: string; onChange(next: string): void }) {
  const id = useId();
  const variable = provider.env.find((entry) => entry.key === keyName)!;
  const link = webAddress(variable.url);
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {variable.prompt}
      </label>
      <input
        id={id}
        className="input input--mono"
        // A key is typed into a password box and is never shown again: Hermes only ever says whether it is set.
        type="password"
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={value}
        placeholder={variable.isSet ? 'Set · type to replace' : 'Not set'}
        aria-describedby={`${id}-help`}
        onChange={(event) => onChange(event.target.value)}
      />
      <p className="field__help" id={`${id}-help`}>
        <span className="mono">{variable.key}</span>
        {link && (
          <>
            {' · '}
            <a href={link} target="_blank" rel="noreferrer noopener">
              Where to find it
            </a>
          </>
        )}
      </p>
    </div>
  );
}

/** The configure panel of a toolset: a full-screen sheet on a phone, a drawer from the end on larger windows. It reads Hermes each time it opens. */
export function ToolsetDrawer({ toolset, profile, onClose, reload }: { toolset: Toolset; profile: string; onClose(): void; reload(): Promise<void> }) {
  const compact = useSizeClass() === 'compact';
  const keysForm = useId();
  const detail = useToolsetDetail(profile, toolset.name);
  const [viewing, setViewing] = useState<string>();
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [model, setModel] = useState<string>();
  const [busy, setBusy] = useState<string>();
  const [run, setRun] = useState<LogRun>();
  const [portalNote, setPortalNote] = useState<string>();

  const config = detail.value?.config;
  const models = detail.value?.models;
  const provider = config?.providers.find((candidate) => candidate.name === (viewing ?? config.activeProvider)) ?? config?.providers.find((candidate) => candidate.name === config.activeProvider) ?? config?.providers[0];
  const chosen = model ?? models?.current ?? models?.default;
  const pickedModel = models?.models.find((candidate) => candidate.id === chosen);
  const typedKeys = provider ? provider.env.filter((variable) => (typed[variable.key] ?? '').trim() !== '') : [];

  const afterChange = async () => {
    await Promise.all([detail.reload(), reload()]);
  };
  const failed = (outcome: { kind: string; message?: string }) => {
    if (outcome.kind === 'failed') toast(outcome.message ?? 'Hermes did not accept that.', { tone: 'danger' });
  };

  const useProvider = async (name: string) => {
    setBusy('provider');
    const outcome = await chooseProvider(toolset, profile, name);
    setBusy(undefined);
    failed(outcome);
    if (outcome.kind !== 'done') return;
    setPortalNote(outcome.body.needsNousAuth ? `Hermes saved ${name}, but it cannot work until the Nous Portal is signed in. Run “hermes -p ${profile} portal” on this computer.` : undefined);
    toast(`${name} is now the provider of ${toolset.label} for ${profile}`);
    setModel(undefined);
    await afterChange();
  };

  const saveKeys = async () => {
    if (!provider) return;
    setBusy('keys');
    const outcome = await saveToolsetKeys(toolset, profile, typed);
    setBusy(undefined);
    failed(outcome);
    if (outcome.kind !== 'done') return;
    toast(`Saved ${outcome.body.saved.length === 1 ? 'a key' : `${outcome.body.saved.length} keys`} for ${toolset.label}`, { detail: 'Hermes keeps them in the profile’s .env file.' });
    setTyped({});
    await afterChange();
  };

  const useModel = async () => {
    if (!pickedModel) return;
    setBusy('model');
    const outcome = await chooseModel(toolset, profile, pickedModel, models?.provider);
    setBusy(undefined);
    failed(outcome);
    if (outcome.kind !== 'done') return;
    toast(`${pickedModel.display} is now the model of ${toolset.label} for ${profile}`);
    setModel(undefined);
    await afterChange();
  };

  const setup = async (target: ToolsetProvider) => {
    if (!target.postSetup) return;
    setBusy('setup');
    const outcome = await startToolsetSetup(toolset, profile, target.name, target.postSetup);
    setBusy(undefined);
    failed(outcome);
    if (outcome.kind !== 'done') return;
    setRun({ action: SETUP_ACTION, title: `Setup of ${target.name}`, doneTitle: `${target.name} is set up`, judge: judgeSetup });
  };

  const setupFinished = (verdict: LogVerdict) => {
    toast(verdict.ok ? (verdict.message ?? 'Setup finished.') : verdict.message, { tone: verdict.ok ? undefined : 'danger' });
    void afterChange();
  };

  let body: ReactNode;
  if (!detail.value) {
    body = detail.failed ? (
      <div className="banner" data-tone="danger" role="alert">
        <Icon name="alert" />
        <span className="banner__content">Hermes did not give the settings of {toolset.label}.</span>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => void detail.reload()}>
          <Icon name="refresh" />
          Retry
        </button>
      </div>
    ) : (
      <p role="status">Loading the settings…</p>
    );
  } else if (!config?.hasCategory) {
    body = <p className="tl-note">{toolset.label} has no provider or keys to set: Hermes only switches it on or off. The switch is on its card.</p>;
  } else {
    body = (
      <div className="tl-form">
        {detail.failed && (
          <div className="banner" data-tone="warning" role="status">
            <Icon name="alert" />
            <span className="banner__content">Hermes did not answer just now: this is what it said a moment ago.</span>
          </div>
        )}
        {portalNote && (
          <div className="banner" data-tone="warning" role="status">
            <Icon name="info" />
            <span className="banner__content">{portalNote}</span>
          </div>
        )}
        <fieldset className="tl-section">
          <legend>Provider</legend>
          <ul className="tl-providers">
            {config.providers.map((candidate) => (
              <li key={candidate.name}>
                <label className="tl-provider">
                  <input type="radio" name={`provider-${toolset.name}`} checked={provider?.name === candidate.name} onChange={() => setViewing(candidate.name)} />
                  <span className="tl-provider__dot" aria-hidden="true" />
                  <span className="tl-provider__main">
                    <span className="tl-provider__name">{candidate.name}</span>
                    {candidate.tag && <span className="tl-provider__tag">{candidate.tag}</span>}
                    <span className="tl-provider__badges">
                      <ProviderBadge status={candidate.status} />
                      {candidate.active && <span className="tag" data-tone="accent">In use</span>}
                      {candidate.badge && <span className="tag">{candidate.badge}</span>}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
          {config.activeBackends && (
            <p className="tl-note">
              Search uses {config.activeBackends.search ?? 'nothing yet'}; extract uses {config.activeBackends.extract ?? 'nothing yet'}.
            </p>
          )}
          {provider && !provider.active && (
            <div className="tl-actions">
              <WriteButton type="button" className="btn btn--secondary" disabled={busy !== undefined} aria-busy={busy === 'provider'} onClick={() => void useProvider(provider.name)}>
                <Icon name="check" />
                Use {provider.name}…
              </WriteButton>
            </div>
          )}
        </fieldset>
        {provider && provider.env.length > 0 && (
          <form
            id={keysForm}
            className="tl-section"
            onSubmit={(event) => {
              event.preventDefault();
              void saveKeys();
            }}
          >
            <h3>Keys for {provider.name}</h3>
            <p className="tl-note">Hermes never sends a saved key back. A key shows only as set or not set, and an empty field keeps it as it is.</p>
            <div className="tl-keys">
              {provider.env.map((variable) => (
                <KeyField key={variable.key} provider={provider} keyName={variable.key} value={typed[variable.key] ?? ''} onChange={(next) => setTyped((current) => ({ ...current, [variable.key]: next }))} />
              ))}
            </div>
            <div className="tl-actions">
              <WriteButton type="submit" className="btn btn--primary" disabled={typedKeys.length === 0 || busy !== undefined} aria-busy={busy === 'keys'}>
                <Icon name="lock" />
                Save {typedKeys.length > 1 ? `${typedKeys.length} keys` : 'key'}…
              </WriteButton>
            </div>
          </form>
        )}
        {provider && provider.env.length === 0 && provider.status === 'needs-auth' && (
          <p className="tl-note">
            {provider.name} needs a Nous Portal sign-in, and Hermes has no sign-in here. Run <code>hermes -p {profile} portal</code> on this computer, then come back: this panel asks Hermes again each time it opens.
          </p>
        )}
        {provider && provider.postSetup && (
          <section className="tl-section" aria-label={`Setup of ${provider.name}`}>
            <h3>Setup</h3>
            <p className="tl-note">{provider.status === 'ready' ? 'Hermes reports this provider ready. You can run its setup again.' : 'Hermes runs this provider’s own install or sign-in step, and the log shows as it goes.'}</p>
            <div className="tl-actions">
              <WriteButton type="button" className={`btn ${provider.status === 'ready' ? 'btn--secondary' : 'btn--primary'}`} disabled={busy !== undefined} aria-busy={busy === 'setup'} onClick={() => void setup(provider)}>
                <Icon name="play" />
                Run setup…
              </WriteButton>
            </div>
          </section>
        )}
        {models?.hasModels && (
          <section className="tl-section" aria-label={`Model of ${toolset.label}`}>
            <h3>Model</h3>
            <div className="field tl-models">
              <label className="field__label" htmlFor={`${keysForm}-model`}>
                Model of {models.provider ?? 'the provider'}
              </label>
              <select id={`${keysForm}-model`} className="input" value={chosen ?? ''} onChange={(event) => setModel(event.target.value)}>
                {chosen === undefined && <option value="">Hermes default</option>}
                {models.models.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.display}
                    {candidate.price ? ` · ${candidate.price}` : ''}
                  </option>
                ))}
              </select>
              {pickedModel && (pickedModel.strengths || pickedModel.speed) && <p className="field__help">{[pickedModel.strengths, pickedModel.speed].filter(Boolean).join(' · ')}</p>}
            </div>
            <div className="tl-actions">
              <WriteButton type="button" className="btn btn--secondary" disabled={busy !== undefined || chosen === undefined || chosen === models.current} aria-busy={busy === 'model'} onClick={() => void useModel()}>
                <Icon name="check" />
                Use this model…
              </WriteButton>
            </div>
          </section>
        )}
      </div>
    );
  }

  const header = (
    <div className="tl-drawer__head">
      {toolset.setup === 'ready' ? <StatusBadge state="succeeded" label="Ready" variant="plain" /> : <StatusBadge state="blocked" label="Needs keys" variant="plain" />}
      <span className="subtle">{toolset.enabled ? 'On' : 'Off'} for {profile}</span>
    </div>
  );
  const content = (
    <>
      {header}
      {body}
    </>
  );
  const sheets = run && <ActionLogSheet run={run} onFinished={setupFinished} onClose={() => setRun(undefined)} />;

  if (compact) {
    return (
      <>
        <Sheet title={`${toolset.label} · ${profile}`} detents={['full']} className="tl-sheet" onClose={onClose}>
          {content}
        </Sheet>
        {sheets}
      </>
    );
  }
  return (
    <>
      <Layer kind="drawer" panelClassName="drawer drawer--end tl-drawer" label={`${toolset.label} · ${profile}`} initialFocus="[data-close]" onClose={onClose}>
        <header className="overlay__head">
          <h2>
            {toolset.label} <span className="subtle">· {profile}</span>
          </h2>
          <button type="button" className="btn btn--ghost btn--icon" aria-label={`Close ${toolset.label}`} onClick={onClose} data-close>
            <Icon name="x" />
          </button>
        </header>
        <div className="overlay__body drawer__body" data-body>
          {content}
        </div>
      </Layer>
      {sheets}
    </>
  );
}
