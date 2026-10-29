import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import type { ModelChoice } from './model-catalogue.ts';
import { saveMoaPresets } from './model-actions.ts';
import { useMoa } from './model-data.ts';
import { fanoutValue, parseFanout, presetProblems, removePreset, savePreset, type FanoutMode, type Moa, type MoaPreset, type MoaSlot } from './moa.ts';
import { ModelPickerSheet } from './ModelPicker.tsx';
import './models.css';

const FANOUTS: { value: FanoutMode; label: string; help: string }[] = [
  { value: 'user_turn', label: 'Once per message', help: 'The reference models advise once, at the start of each of your messages. The cheapest choice.' },
  { value: 'per_iteration', label: 'At every step', help: 'They advise again whenever the agent takes a tool step. Advice follows the task, and the cost grows with the length of the work.' },
  { value: 'every_n', label: 'Every few steps', help: 'They advise on the first step and then every Nth step.' },
];

const blank = (): MoaPreset => ({
  name: '',
  enabled: true,
  references: [],
  aggregator: { provider: '', model: '', enabled: true },
  referenceTemperature: undefined,
  aggregatorTemperature: undefined,
  referenceTimeout: undefined,
  degradedPolicy: 'loud',
  fanout: 'user_turn',
});

const slotText = (slot: MoaSlot) => (slot.model ? `${slot.model} · ${slot.provider}` : 'No model chosen');
const numberText = (value: number | undefined) => (value === undefined ? '' : String(value));
/** An empty box is "not set" (Hermes then sends nothing and the provider decides); anything else is read as a number, and what is not one stays NaN so it is named. */
const numberOf = (text: string): number | undefined => (text.trim() === '' ? undefined : Number(text));

type Picking = { kind: 'reference'; index: number | 'new' } | { kind: 'aggregator' };

function PresetSheet({ profile, moa, original, onSave, onClose }: { profile: string; moa: Moa; original: MoaPreset | undefined; onSave(preset: MoaPreset, makeDefault: boolean): Promise<boolean>; onClose(): void }) {
  const id = useId();
  const [draft, setDraft] = useState<MoaPreset>(original ?? blank());
  const [numbers, setNumbers] = useState({ reference: numberText(original?.referenceTemperature), aggregator: numberText(original?.aggregatorTemperature), timeout: numberText(original?.referenceTimeout) });
  const [fanout, setFanout] = useState(parseFanout(original?.fanout ?? 'user_turn'));
  const [makeDefault, setMakeDefault] = useState(false);
  const [picking, setPicking] = useState<Picking>();
  const [attempted, setAttempted] = useState(false);
  const [busy, setBusy] = useState(false);
  const isNew = original === undefined;
  const set = (change: Partial<MoaPreset>) => setDraft((current) => ({ ...current, ...change }));

  const assembled = (): MoaPreset => ({
    ...draft,
    name: draft.name.trim(),
    referenceTemperature: numberOf(numbers.reference),
    aggregatorTemperature: numberOf(numbers.aggregator),
    referenceTimeout: numberOf(numbers.timeout),
    fanout: fanoutValue(fanout),
  });
  const problems = attempted ? presetProblems(moa, assembled(), { isNew }) : [];

  const submit = async () => {
    setAttempted(true);
    const preset = assembled();
    if (presetProblems(moa, preset, { isNew }).length > 0) return;
    setBusy(true);
    const done = await onSave(preset, makeDefault);
    setBusy(false);
    if (done) onClose();
  };

  const pick = (choice: ModelChoice) => {
    if (!picking) return;
    if (picking.kind === 'aggregator') set({ aggregator: { ...draft.aggregator, ...choice } });
    else if (picking.index === 'new') set({ references: [...draft.references, { ...choice, enabled: true }] });
    else set({ references: draft.references.map((slot, at) => (at === picking.index ? { ...slot, ...choice } : slot)) });
    setPicking(undefined);
  };

  return (
    <Sheet
      title={isNew ? `New preset · ${profile}` : `Preset ${original.name} · ${profile}`}
      detents={['full']}
      initialFocus="[data-first]"
      onClose={onClose}
      footer={
        <div className="md-actions">
          <WriteButton type="submit" form={id} className="btn btn--primary" disabled={busy} aria-busy={busy}>
            <Icon name="check" />
            Save preset…
          </WriteButton>
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
          void submit();
        }}
      >
        <div className="field">
          <label className="field__label" htmlFor={`${id}-name`}>
            Name
          </label>
          <input id={`${id}-name`} data-first className="input input--mono" autoComplete="off" autoCapitalize="off" spellCheck={false} readOnly={!isNew} value={draft.name} placeholder="deep-review" onChange={(event) => set({ name: event.target.value })} />
          <p className="field__help">{isNew ? 'The name you pick the preset by, in the model picker or with /model.' : 'A preset keeps its name: Hermes cannot rename one.'}</p>
        </div>

        <fieldset className="md-fieldset">
          <legend>Reference models</legend>
          <p className="field__help">
            Each reference model gives its own answer. The <Term id="aggregator">aggregator</Term> reads them all and writes the reply. Turn one off to keep it in the preset without asking it.
          </p>
          <ul className="list panel md-entries" aria-label="Reference models">
            {draft.references.map((slot, index) => (
              <li key={index}>
                <div className="list-row md-entry">
                  <span className="list-row__main">
                    <span className="list-row__title mono">{slot.model || 'No model chosen'}</span>
                    <span className="subtle">{slot.provider}</span>
                  </span>
                  <span className="md-entry__actions">
                    <button type="button" role="switch" className="switch" aria-checked={slot.enabled} aria-label={`Ask ${slotText(slot)}`} onClick={() => set({ references: draft.references.map((item, at) => (at === index ? { ...item, enabled: !item.enabled } : item)) })} />
                    <button type="button" className="btn btn--secondary btn--sm" aria-haspopup="dialog" aria-label={`Change reference model ${index + 1}`} onClick={() => setPicking({ kind: 'reference', index })}>
                      Change
                    </button>
                    <button type="button" className="btn btn--ghost btn--sm" aria-label={`Remove reference model ${index + 1}`} onClick={() => set({ references: draft.references.filter((_, at) => at !== index) })}>
                      <Icon name="trash" small />
                    </button>
                  </span>
                </div>
              </li>
            ))}
          </ul>
          <button type="button" className="btn btn--secondary btn--sm" aria-haspopup="dialog" onClick={() => setPicking({ kind: 'reference', index: 'new' })}>
            <Icon name="plus" small />
            Add a reference model
          </button>
        </fieldset>

        <fieldset className="md-fieldset">
          <legend>Aggregator</legend>
          <div className="list-row md-entry">
            <span className="list-row__main">
              <span className="list-row__title mono">{draft.aggregator.model || 'No model chosen'}</span>
              <span className="subtle">{draft.aggregator.provider}</span>
            </span>
            <span className="md-entry__actions">
              <button type="button" className="btn btn--secondary btn--sm" aria-haspopup="dialog" aria-label="Change the aggregator" onClick={() => setPicking({ kind: 'aggregator' })}>
                Change
              </button>
            </span>
          </div>
        </fieldset>

        <div className="field">
          <label className="field__label" htmlFor={`${id}-fanout`}>
            When the reference models run
          </label>
          <select id={`${id}-fanout`} className="input" value={fanout.mode} aria-describedby={`${id}-fanout-help`} onChange={(event) => setFanout({ ...fanout, mode: event.target.value as FanoutMode })}>
            {FANOUTS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="field__help" id={`${id}-fanout-help`}>
            {FANOUTS.find((option) => option.value === fanout.mode)?.help}
          </p>
        </div>
        {fanout.mode === 'every_n' && (
          <div className="field">
            <label className="field__label" htmlFor={`${id}-every`}>
              Every how many steps
            </label>
            <input id={`${id}-every`} className="input input--mono" inputMode="numeric" autoComplete="off" value={fanout.every} onChange={(event) => setFanout({ ...fanout, every: Math.max(2, Math.floor(Number(event.target.value)) || 2) })} />
          </div>
        )}

        <div className="field">
          <label className="field__label" htmlFor={`${id}-rt`}>
            Reference temperature (optional)
          </label>
          <input id={`${id}-rt`} className="input input--mono" inputMode="decimal" autoComplete="off" value={numbers.reference} placeholder="the provider’s own" onChange={(event) => setNumbers({ ...numbers, reference: event.target.value })} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-at`}>
            Aggregator temperature (optional)
          </label>
          <input id={`${id}-at`} className="input input--mono" inputMode="decimal" autoComplete="off" value={numbers.aggregator} placeholder="the provider’s own" onChange={(event) => setNumbers({ ...numbers, aggregator: event.target.value })} />
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-to`}>
            Reference timeout in seconds (optional)
          </label>
          <input id={`${id}-to`} className="input input--mono" inputMode="decimal" autoComplete="off" value={numbers.timeout} placeholder="Hermes’s own" onChange={(event) => setNumbers({ ...numbers, timeout: event.target.value })} />
          <p className="field__help">How long one reference model may take. Empty uses the timeout Hermes sets for its reference slot.</p>
        </div>
        <div className="field">
          <label className="field__label" htmlFor={`${id}-policy`}>
            When a reference model fails
          </label>
          <select id={`${id}-policy`} className="input" value={draft.degradedPolicy} onChange={(event) => set({ degradedPolicy: event.target.value === 'silent' ? 'silent' : 'loud' })}>
            <option value="loud">Say so in the reply</option>
            <option value="silent">Carry on without saying</option>
          </select>
        </div>
        <div className="switch-row">
          <span id={`${id}-on`}>Use this preset</span>
          <button type="button" role="switch" className="switch" aria-checked={draft.enabled} aria-labelledby={`${id}-on`} onClick={() => set({ enabled: !draft.enabled })} />
        </div>
        {original?.name === moa.defaultPreset ? (
          <p className="subtle md-note">This is the default preset.</p>
        ) : (
          <div className="switch-row">
            <span id={`${id}-default`}>Make this the default preset</span>
            <button type="button" role="switch" className="switch" aria-checked={makeDefault} aria-labelledby={`${id}-default`} onClick={() => setMakeDefault(!makeDefault)} />
          </div>
        )}
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
      {picking && (
        <ModelPickerSheet
          title={picking.kind === 'aggregator' ? 'Aggregator model' : 'Reference model'}
          profile={profile}
          value={picking.kind === 'aggregator' ? draft.aggregator : picking.index === 'new' ? undefined : draft.references[picking.index]}
          hideProviders={['moa']}
          onPick={pick}
          onClose={() => setPicking(undefined)}
        />
      )}
    </Sheet>
  );
}

/** Hermes's Mixture-of-Agents presets for one profile: reference models, aggregator and which preset is the default. */
export function MixtureOfAgents({ profile }: { profile: string }) {
  const { value, failed, reload } = useMoa(profile);
  const [editing, setEditing] = useState<MoaPreset | 'new'>();

  if (!value) {
    return failed ? (
      <div className="banner md-error" data-tone="danger" role="alert">
        <Icon name="alert" />
        <span className="banner__content">Hermes did not answer, so the Mixture-of-Agents presets of {profile} could not be loaded.</span>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => void reload()}>
          <Icon name="refresh" />
          Retry
        </button>
      </div>
    ) : (
      <p role="status">Loading…</p>
    );
  }

  const send = async (moa: Moa, what: { title: string; text: string; confirmLabel: string }, done: string): Promise<boolean> => {
    const outcome = await saveMoaPresets(profile, moa, what);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return false;
    toast(done, { tone: 'info' });
    await reload();
    return true;
  };

  const save = (preset: MoaPreset, makeDefault: boolean) => {
    const asked = preset.references.filter((slot) => slot.enabled).length;
    return send(
      savePreset(value, preset, { makeDefault }),
      {
        title: `Save the preset ${preset.name} for ${profile}?`,
        text: `Hermes writes the preset to the profile’s config: ${asked} reference ${asked === 1 ? 'model' : 'models'} and ${preset.aggregator.model} as the aggregator${makeDefault ? '. It becomes the default preset' : ''}.`,
        confirmLabel: 'Save preset',
      },
      `Preset ${preset.name} saved`,
    );
  };

  const makeDefault = (preset: MoaPreset) =>
    send(
      { ...value, defaultPreset: preset.name },
      { title: `Make ${preset.name} the default preset of ${profile}?`, text: 'The default preset is the one /moa runs a prompt through.', confirmLabel: 'Make default' },
      `${preset.name} is the default preset`,
    );

  const remove = async (preset: MoaPreset) => {
    const removed = removePreset(value, preset.name);
    if (!removed.ok) {
      toast(removed.reason, { tone: 'warning' });
      return;
    }
    await send(
      removed.moa,
      {
        title: `Delete the preset ${preset.name} from ${profile}?`,
        text: `Hermes removes ${preset.name} from the profile’s config${removed.moa.defaultPreset !== value.defaultPreset ? `. ${removed.moa.defaultPreset} becomes the default preset` : ''}.`,
        confirmLabel: 'Delete preset',
      },
      `${preset.name} deleted`,
    );
  };

  return (
    <div className="md-moa">
      <p className="muted md-lead">
        A <Term id="mixture-of-agents">Mixture-of-Agents</Term> preset asks several reference models and lets one <Term id="aggregator">aggregator</Term> model write the reply. These are the presets in the config of <strong>{profile}</strong>, as Hermes lists them. Pick a preset as a model in a chat to use it.
      </p>
      <div className="md-actions">
        <WriteButton type="button" className="btn btn--primary" onClick={() => setEditing('new')}>
          <Icon name="plus" />
          New preset
        </WriteButton>
      </div>
      <ul className="list panel md-entries" aria-label="Mixture-of-Agents presets">
        {value.presets.map((preset) => {
          const asked = preset.references.filter((slot) => slot.enabled);
          return (
            <li key={preset.name}>
              <div className="list-row md-preset">
                <span className="list-row__main">
                  <span className="list-row__title md-preset__name">
                    <span className="mono">{preset.name}</span>
                    {preset.name === value.defaultPreset && (
                      <span className="tag" data-tone="accent">
                        Default
                      </span>
                    )}
                    {!preset.enabled && <span className="tag">Off</span>}
                  </span>
                  <span className="subtle md-preset__line">
                    Asks {asked.map((slot) => slot.model).join(', ') || 'no one'}
                    {asked.length < preset.references.length ? ` (${preset.references.length - asked.length} turned off)` : ''}
                  </span>
                  <span className="subtle md-preset__line">Aggregator: {slotText(preset.aggregator)}</span>
                </span>
                <span className="md-entry__actions">
                  <button type="button" className="btn btn--secondary btn--sm" aria-haspopup="dialog" aria-label={`Edit the preset ${preset.name}`} onClick={() => setEditing(preset)}>
                    Edit
                  </button>
                  {preset.name !== value.defaultPreset && preset.enabled && (
                    <WriteButton type="button" className="btn btn--ghost btn--sm" aria-label={`Make default: ${preset.name}`} onClick={() => void makeDefault(preset)}>
                      Make default
                    </WriteButton>
                  )}
                  {preset.enabled && (
                    <WriteButton type="button" className="btn btn--ghost btn--sm" aria-label={`Delete the preset ${preset.name}`} onClick={() => void remove(preset)}>
                      <Icon name="trash" small />
                      Delete
                    </WriteButton>
                  )}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
      {value.presets.some((preset) => !preset.enabled) && (
        <p className="subtle md-note">
          A preset that is off stays in the config. Edit it and turn it on to use it again, or delete it.
        </p>
      )}
      {editing && <PresetSheet profile={profile} moa={value} original={editing === 'new' ? undefined : editing} onSave={save} onClose={() => setEditing(undefined)} />}
    </div>
  );
}
