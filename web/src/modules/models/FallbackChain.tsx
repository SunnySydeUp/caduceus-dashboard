import { useId, useState, type DragEvent } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { addEntry, entryProblems, moveEntry, removeEntry, turnOffEntry, turnOnEntry, type Fallback, type FallbackEntry, type FallbackSettings } from './fallback.ts';
import { saveFallbackChain, saveFallbackSettings } from './model-actions.ts';
import { useFallback } from './model-data.ts';
import { ModelPickerSheet } from './ModelPicker.tsx';
import './models.css';

/** What the entry sheet is for: a custom provider, or the endpoint of an entry that is already in the chain. */
type EntryTarget = { kind: 'custom' } | { kind: 'catalogue'; provider: string; model: string } | { kind: 'endpoint'; list: 'chain' | 'parked'; index: number };

function EntrySheet({ target, state, current, onSubmit, onClose }: { target: EntryTarget; state: Fallback; current: FallbackEntry | undefined; onSubmit(entry: Pick<FallbackEntry, 'provider' | 'model' | 'baseUrl'>): void; onClose(): void }) {
  const id = useId();
  const [provider, setProvider] = useState(target.kind === 'catalogue' ? target.provider : (current?.provider ?? ''));
  const [model, setModel] = useState(target.kind === 'catalogue' ? target.model : (current?.model ?? ''));
  const [baseUrl, setBaseUrl] = useState(current?.baseUrl ?? '');
  const [attempted, setAttempted] = useState(false);
  const editing = target.kind === 'endpoint';
  const fixed = target.kind !== 'custom';
  // Changing only the endpoint of an entry must not count as a repeat of itself.
  const others: Fallback = editing ? { ...state, chain: state.chain.filter((entry) => entry !== current) } : state;
  const problems = attempted ? entryProblems(others, { provider, model, baseUrl }) : [];

  return (
    <Sheet
      title={editing ? 'Endpoint of this entry' : target.kind === 'custom' ? 'Add a custom provider' : 'Add to the chain'}
      detents={['auto']}
      initialFocus="[data-first]"
      onClose={onClose}
      footer={
        <div className="md-actions">
          <button type="submit" form={id} className="btn btn--primary">
            <Icon name="check" />
            {editing ? 'Use this endpoint' : 'Add to the chain'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
        </div>
      }
    >
      <form
        id={id}
        className="md-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          setAttempted(true);
          if (entryProblems(others, { provider, model, baseUrl }).length === 0) onSubmit({ provider, model, baseUrl });
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor={`${id}-provider`}>
            Provider
          </label>
          <input id={`${id}-provider`} data-first={fixed ? undefined : ''} className="input input--mono" autoComplete="off" autoCapitalize="off" spellCheck={false} readOnly={fixed} value={provider} placeholder="custom, or a provider name from the catalogue" onChange={(event) => setProvider(event.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-model`}>
            Model
          </label>
          <input id={`${id}-model`} className="input input--mono" autoComplete="off" autoCapitalize="off" spellCheck={false} readOnly={fixed} value={model} placeholder="the model’s id at that provider" onChange={(event) => setModel(event.target.value)} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-url`}>
            Endpoint (optional)
          </label>
          <input id={`${id}-url`} data-first={fixed ? '' : undefined} className="input input--mono" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false} value={baseUrl} placeholder="https://gateway.example.com/v1" onChange={(event) => setBaseUrl(event.target.value)} />
          <p className="field__help">Leave it empty to use the provider’s usual address. Set it to send this entry through a gateway or a server of your own. Hermes keeps credentials out of the chain: it finds the key the way it does for the provider.</p>
        </div>
        {problems.length > 0 && (
          <div className="field__error md-problems" role="alert">
            {problems.map((problem) => (
              <p key={problem}>
                <Icon name="alert" small />
                {problem}
              </p>
            ))}
          </div>
        )}
      </form>
    </Sheet>
  );
}

function EntryRow({
  entry,
  position,
  count,
  drag,
  actions,
}: {
  entry: FallbackEntry;
  position: number | undefined;
  count: number;
  drag?: { onStart(event: DragEvent<HTMLLIElement>): void; onOver(event: DragEvent<HTMLLIElement>): void; onDrop(event: DragEvent<HTMLLIElement>): void };
  actions: { label: string; icon: 'chev-u' | 'chev-d' | 'sliders' | 'trash' | 'check' | 'stop'; text?: string; disabled?: boolean; onClick(): void }[];
}) {
  const label = `${entry.model} via ${entry.provider}`;
  return (
    <li draggable={drag !== undefined} onDragStart={drag?.onStart} onDragOver={drag?.onOver} onDrop={drag?.onDrop}>
      <div className="list-row md-entry">
        {position !== undefined && (
          <span className="md-entry__pos tag" aria-label={`Position ${position + 1} of ${count}`}>
            {position + 1}
          </span>
        )}
        <span className="list-row__main">
          <span className="list-row__title mono">{entry.model}</span>
          <span className="md-entry__meta">
            <span className="subtle">{entry.provider}</span>
            {entry.baseUrl && <span className="tag mono md-entry__url">{entry.baseUrl}</span>}
          </span>
        </span>
        <span className="md-entry__actions">
          {actions.map((action) => (
            <WriteButton key={action.label} type="button" className="btn btn--ghost btn--sm" aria-label={`${action.label}: ${label}`} disabled={action.disabled} title={action.label} onClick={action.onClick}>
              <Icon name={action.icon} small />
              {action.text && <span>{action.text}</span>}
            </WriteButton>
          ))}
        </span>
      </div>
    </li>
  );
}

const SETTING_FIELDS: { key: keyof FallbackSettings; label: string; help: string; max: number }[] = [
  { key: 'apiMaxRetries', label: 'Retries before failing over', help: 'How many times Hermes retries an API error (a dropped connection, a timeout, a 5xx) before it moves to the next entry. Set 1 to fail over quickly.', max: 20 },
  { key: 'autoRecoveryCycles', label: 'Waiting cycles when everything is down', help: 'When the chain is spent on an outage, Hermes waits and tries again this many more times (15 to 60 seconds apart). 0 stops at the first failure.', max: 20 },
  { key: 'minSwitchResetSeconds', label: 'Stay on a rate-limited main model if it resets within (seconds)', help: 'When the main model is rate limited and says it will reset sooner than this, Hermes waits for it instead of switching. 0 turns this off.', max: 3600 },
];

function Settings({ profile, saved, reload }: { profile: string; saved: FallbackSettings; reload(): Promise<void> }) {
  const id = useId();
  const [draft, setDraft] = useState<Record<keyof FallbackSettings, string>>({
    apiMaxRetries: String(saved.apiMaxRetries),
    autoRecoveryCycles: String(saved.autoRecoveryCycles),
    minSwitchResetSeconds: String(saved.minSwitchResetSeconds),
  });
  const [busy, setBusy] = useState(false);
  const parsed: FallbackSettings = { apiMaxRetries: Number(draft.apiMaxRetries), autoRecoveryCycles: Number(draft.autoRecoveryCycles), minSwitchResetSeconds: Number(draft.minSwitchResetSeconds) };
  const valid = SETTING_FIELDS.every((field) => draft[field.key].trim() !== '' && Number.isInteger(parsed[field.key]) && parsed[field.key] >= 0 && parsed[field.key] <= field.max);
  const changed = SETTING_FIELDS.some((field) => parsed[field.key] !== saved[field.key]);

  const save = async () => {
    setBusy(true);
    const outcome = await saveFallbackSettings(profile, parsed);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast(`Failing-over settings of ${profile} saved`, { tone: 'info', detail: 'New sessions use them.' });
    await reload();
  };

  return (
    <div className="panel panel--pad md-box">
      <h3>Failing over</h3>
      <div className="md-settings">
        {SETTING_FIELDS.map((field) => (
          <div className="field" key={field.key}>
            <label className="field__label" htmlFor={`${id}-${field.key}`}>
              {field.label}
            </label>
            <input id={`${id}-${field.key}`} className="input input--mono" inputMode="numeric" autoComplete="off" value={draft[field.key]} aria-describedby={`${id}-${field.key}-help`} onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))} />
            <p className="field__help" id={`${id}-${field.key}-help`}>
              {field.help}
            </p>
          </div>
        ))}
      </div>
      <p className="subtle md-note">Hermes has no setting for going back to the main model: it tries the main model again at the start of every turn.</p>
      <div className="row">
        <WriteButton type="button" className="btn btn--primary" disabled={busy || !changed || !valid} aria-busy={busy} onClick={() => void save()}>
          <Icon name="lock" />
          Save settings…
        </WriteButton>
        <span className="subtle md-note">Writes config.yaml · needs your passkey and the profile name</span>
      </div>
    </div>
  );
}

/**
 * The fallback chain of one profile: the models Hermes tries, in order, when the main model fails. It is the profile's `fallback_providers`,
 * edited here as a draft and written by Save (a config write, Tier 3). Reorder with the arrows (a drag is there for a mouse as well).
 */
export function FallbackChain({ profile }: { profile: string }) {
  const { value, failed, reload } = useFallback(profile);
  const compact = useSizeClass() === 'compact';
  const [draft, setDraft] = useState<Fallback>();
  const [picking, setPicking] = useState(false);
  const [entry, setEntry] = useState<EntryTarget>();
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState<number>();

  if (!value) {
    return failed ? (
      <div className="banner md-error" data-tone="danger" role="alert">
        <Icon name="alert" />
        <span className="banner__content">Hermes did not answer, so the fallback chain of {profile} could not be loaded.</span>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => void reload()}>
          <Icon name="refresh" />
          Retry
        </button>
      </div>
    ) : (
      <p role="status">Loading…</p>
    );
  }

  const state: Fallback = draft ?? value;
  const dirty = draft !== undefined && JSON.stringify([draft.chain, draft.parked]) !== JSON.stringify([value.chain, value.parked]);
  const edit = (next: Fallback) => setDraft(next);

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    const outcome = await saveFallbackChain(profile, draft, {
      title: `Save the fallback chain of ${profile}?`,
      text: draft.chain.length === 0 ? 'The chain becomes empty: when the main model fails, Hermes has nothing to switch to.' : `Hermes writes ${draft.chain.length} ${draft.chain.length === 1 ? 'entry' : 'entries'} to the profile’s config, in this order: ${draft.chain.map((item) => item.model).join(', then ')}.`,
    });
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast(`Fallback chain of ${profile} saved`, { tone: 'info', detail: 'New sessions use it.' });
    setDraft(undefined);
    await reload();
  };

  const chainDrag = (index: number) =>
    compact
      ? undefined
      : {
          onStart: (event: DragEvent<HTMLLIElement>) => {
            setDragging(index);
            event.dataTransfer.effectAllowed = 'move';
          },
          onOver: (event: DragEvent<HTMLLIElement>) => {
            if (dragging !== undefined) event.preventDefault();
          },
          onDrop: (event: DragEvent<HTMLLIElement>) => {
            event.preventDefault();
            if (dragging === undefined || dragging === index) return;
            // The same moves as the buttons, one step at a time, so the drag and the arrows can never disagree.
            let next = state;
            for (let at = dragging; at !== index; at += index > dragging ? 1 : -1) next = moveEntry(next, at, index > dragging ? 1 : -1);
            setDragging(undefined);
            edit(next);
          },
        };

  const submitEntry = (target: EntryTarget, picked: Pick<FallbackEntry, 'provider' | 'model' | 'baseUrl'>) => {
    if (target.kind === 'endpoint') {
      const baseUrl = picked.baseUrl.trim().replace(/\/+$/, '');
      edit({ ...state, [target.list]: state[target.list].map((item, at) => (at === target.index ? { ...item, baseUrl } : item)) });
    } else edit(addEntry(state, picked));
    setEntry(undefined);
  };

  return (
    <div className="md-chain">
      <p className="muted md-lead">
        The <Term id="fallback-chain">fallback chain</Term> is the list of models Hermes tries, in order, when the main model of <strong>{profile}</strong> fails or is rate limited. Change the list below, then save it. Hermes keeps it in the profile’s config.
      </p>
      {failed && (
        <div className="banner" data-tone="warning" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer just now, so this may be out of date.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {value.legacy.length > 0 && (
        <div className="banner" data-tone="info">
          <Icon name="info" />
          <div className="banner__content">
            <div className="banner__title">The config also has an older single fallback</div>
            <div className="banner__body">
              Hermes tries {value.legacy.map((item) => `${item.model} via ${item.provider}`).join(', ')} after the chain below (<span className="mono">fallback_model</span>). It is not edited here. Hermes’s own command <span className="mono">hermes fallback</span> moves it into the chain.
            </div>
          </div>
        </div>
      )}

      <section className="md-box" aria-labelledby="md-chain-title">
        <div className="md-box__head">
          <h3 id="md-chain-title">In order of use</h3>
          <span className="md-actions">
            <button type="button" className="btn btn--secondary btn--sm" aria-haspopup="dialog" onClick={() => setPicking(true)}>
              <Icon name="plus" small />
              Add from the catalogue
            </button>
            <button type="button" className="btn btn--secondary btn--sm" aria-haspopup="dialog" onClick={() => setEntry({ kind: 'custom' })}>
              <Icon name="plus" small />
              Add a custom provider
            </button>
          </span>
        </div>
        {state.chain.length === 0 ? (
          <div className="empty">
            <span className="empty__icon">
              <Icon name="stack" />
            </span>
            <p>The chain is empty. When the main model fails, Hermes has nothing to switch to.</p>
          </div>
        ) : (
          <ol className="list panel md-entries" aria-label="Fallback chain">
            {state.chain.map((item, index) => (
              <EntryRow
                key={`${item.provider}/${item.model}/${item.baseUrl}`}
                entry={item}
                position={index}
                count={state.chain.length}
                drag={chainDrag(index)}
                actions={[
                  { label: 'Move up', icon: 'chev-u', disabled: index === 0, onClick: () => edit(moveEntry(state, index, -1)) },
                  { label: 'Move down', icon: 'chev-d', disabled: index === state.chain.length - 1, onClick: () => edit(moveEntry(state, index, 1)) },
                  { label: 'Set the endpoint', icon: 'sliders', onClick: () => setEntry({ kind: 'endpoint', list: 'chain', index }) },
                  { label: 'Turn off', icon: 'stop', onClick: () => edit(turnOffEntry(state, index)) },
                  { label: 'Remove', icon: 'trash', onClick: () => edit(removeEntry(state, 'chain', index)) },
                ]}
              />
            ))}
          </ol>
        )}
        {state.parked.length > 0 && (
          <>
            <h3>Turned off</h3>
            <p className="subtle md-note">Hermes does not try these. They stay in the config with their endpoint, so turning one on brings it back at the end of the chain.</p>
            <ul className="list panel md-entries" aria-label="Entries turned off">
              {state.parked.map((item, index) => (
                <EntryRow
                  key={`${item.provider}/${item.model}/${item.baseUrl}`}
                  entry={item}
                  position={undefined}
                  count={0}
                  actions={[
                    { label: 'Turn on', icon: 'check', onClick: () => edit(turnOnEntry(state, index)) },
                    { label: 'Set the endpoint', icon: 'sliders', onClick: () => setEntry({ kind: 'endpoint', list: 'parked', index }) },
                    { label: 'Remove', icon: 'trash', onClick: () => edit(removeEntry(state, 'parked', index)) },
                  ]}
                />
              ))}
            </ul>
          </>
        )}
        <div className="row">
          <WriteButton type="button" className="btn btn--primary" disabled={!dirty || busy} aria-busy={busy} onClick={() => void save()}>
            <Icon name="lock" />
            Save chain…
          </WriteButton>
          <button type="button" className="btn btn--ghost" disabled={!dirty || busy} onClick={() => setDraft(undefined)}>
            Discard changes
          </button>
          <span className="subtle md-note">{dirty ? 'You have changes that are not saved.' : 'Writes config.yaml · needs your passkey and the profile name'}</span>
        </div>
      </section>

      <Settings key={JSON.stringify(value.settings)} profile={profile} saved={value.settings} reload={reload} />

      {picking && (
        <ModelPickerSheet
          title={`Add a fallback model for ${profile}`}
          profile={profile}
          hideProviders={['moa']}
          onPick={(choice) => {
            setPicking(false);
            setEntry({ kind: 'catalogue', provider: choice.provider, model: choice.model });
          }}
          onClose={() => setPicking(false)}
        />
      )}
      {entry && <EntrySheet target={entry} state={state} current={entry.kind === 'endpoint' ? state[entry.list][entry.index] : undefined} onSubmit={(picked) => submitEntry(entry, picked)} onClose={() => setEntry(undefined)} />}
    </div>
  );
}
