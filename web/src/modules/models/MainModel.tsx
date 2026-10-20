import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import type { ModelChoice } from './model-catalogue.ts';
import { setMainModel, setReasoningDefault } from './model-actions.ts';
import { useMainModel } from './model-data.ts';
import { REASONING_LEVELS } from './model-settings.ts';
import { ModelPickerSheet } from './ModelPicker.tsx';
import './models.css';

const tokens = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });

function Reasoning({ profile, saved, reload }: { profile: string; saved: string; reload(): Promise<void> }) {
  const id = useId();
  const [draft, setDraft] = useState<string>();
  const [busy, setBusy] = useState(false);
  const value = draft ?? saved;
  // A level Hermes holds that the list does not know (YAML `false` is "none") still shows, rather than reading as unset.
  const levels = REASONING_LEVELS.some((level) => level.value === saved) ? REASONING_LEVELS : [...REASONING_LEVELS, { value: saved, label: saved }];

  const save = async () => {
    setBusy(true);
    const outcome = await setReasoningDefault(profile, saved, value);
    setBusy(false);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast(`Default reasoning for ${profile} saved`, { tone: 'info', detail: 'New sessions use it.' });
    setDraft(undefined);
    await reload();
  };

  return (
    <div className="panel panel--pad md-box">
      <div className="field">
        <label className="field__label" htmlFor={id}>
          Reasoning default
        </label>
        <select id={id} className="input" value={value} aria-describedby={`${id}-help`} onChange={(event) => setDraft(event.target.value)}>
          {levels.map((level) => (
            <option key={level.value} value={level.value}>
              {level.label}
            </option>
          ))}
        </select>
        <p className="field__help" id={`${id}-help`}>
          How hard the <Term id="main-model">main model</Term> thinks before it answers, for models that can reason. A chat can still choose its own. Hermes keeps it in this profile’s config.
        </p>
      </div>
      <div className="row">
        <WriteButton type="button" className="btn btn--primary" disabled={busy || value === saved} aria-busy={busy} onClick={() => void save()}>
          <Icon name="lock" />
          Save reasoning default…
        </WriteButton>
        <span className="subtle md-note">Writes config.yaml · Tier 3</span>
      </div>
    </div>
  );
}

/**
 * The main model of one profile: what Hermes says it is and can do, Change through the shared picker, the reasoning default and a
 * note about output limits. Every value is read from Hermes for this profile; a reload shows Hermes's own.
 */
export function MainModel({ profile }: { profile: string }) {
  const { value, failed, reload } = useMainModel(profile);
  const [picking, setPicking] = useState(false);

  if (!value) {
    return failed ? (
      <div className="banner md-error" data-tone="danger" role="alert">
        <Icon name="alert" />
        <span className="banner__content">Hermes did not answer, so the model settings of {profile} could not be loaded.</span>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => void reload()}>
          <Icon name="refresh" />
          Retry
        </button>
      </div>
    ) : (
      <p role="status">Loading…</p>
    );
  }

  const { main, info, reasoning, recommended } = value;
  const choose = async (choice: ModelChoice): Promise<void> => {
    const outcome = await setMainModel(profile, choice);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    setPicking(false);
    toast(`${profile} now uses ${choice.model}`, { tone: 'info', detail: 'New sessions use it.' });
    await reload();
  };

  return (
    <div className="md-main">
      <div className="panel panel--pad md-box">
        <div className="md-box__head">
          <h3>Model in use</h3>
          <button type="button" className="btn btn--secondary" aria-haspopup="dialog" onClick={() => setPicking(true)}>
            <Icon name="cpu" />
            {main.model ? 'Change model' : 'Choose a model'}
          </button>
        </div>
        {main.model ? (
          <>
            <p className="md-model">
              <span className="mono">{main.model}</span>
              <span className="subtle">{main.provider || 'no provider named'}</span>
            </p>
            {info && (
              <ul className="md-facts" aria-label="What Hermes knows about this model">
                {info.badges.map((badge) => (
                  <li key={badge.id} className="tag" data-tone="neutral">
                    {badge.label}
                  </li>
                ))}
                {info.contextWindow > 0 && <li className="tag">{tokens.format(info.contextWindow)} token context</li>}
                {info.maxOutput > 0 && <li className="tag">writes up to {tokens.format(info.maxOutput)} tokens</li>}
              </ul>
            )}
          </>
        ) : (
          <p className="muted">
            This profile has no <Term id="main-model">main model</Term> set.
            {recommended ? ' Hermes recommends one for a provider it can use.' : ' Choose one from Hermes’s catalogue.'}
          </p>
        )}
        {!main.model && recommended && (
          <div className="md-recommend">
            <p>
              <span className="mono">{recommended.model}</span> <span className="subtle">on {recommended.provider}</span>
              <span className="tag" data-tone="accent">
                Recommended by Hermes
              </span>
            </p>
            <WriteButton type="button" className="btn btn--primary" onClick={() => void choose(recommended)}>
              Use {recommended.model}
            </WriteButton>
          </div>
        )}
        <p className="field__help">Changing the model applies to new sessions. Hermes writes it to this profile’s config; Caduceus keeps no copy.</p>
      </div>
      <Reasoning key={reasoning} profile={profile} saved={reasoning} reload={reload} />
      <div className="panel panel--pad md-box">
        <h3>Max output tokens</h3>
        <p className="muted">
          Hermes no longer has a setting for how long one reply may be: it uses each provider’s own default{info && info.maxOutput > 0 ? `, and ${info.model} can write up to ${tokens.format(info.maxOutput)} tokens` : ''}. There is nothing to save here.
        </p>
      </div>
      {picking && <ModelPickerSheet title={`Main model for ${profile}`} profile={profile} value={main.model ? main : undefined} onPick={choose} onClose={() => setPicking(false)} />}
    </div>
  );
}
