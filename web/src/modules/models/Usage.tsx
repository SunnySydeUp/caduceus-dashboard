import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Loading } from '../../shell/Loading.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import type { ActionOutcome } from '../profiles/profile-actions.ts';
import { setAuxiliaryModel, setMainModel } from './model-actions.ts';
import { useAuxiliary, useUsage } from './model-data.ts';
import { slotWords } from './model-settings.ts';
import { USAGE_PERIODS, type UsageCard, type UsageDays } from './usage.ts';
import './models.css';

const count = new Intl.NumberFormat('en');
const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const dollars = (usd: number) => `$${usd < 0.01 ? usd.toFixed(4) : usd.toFixed(2)}`;

/** "Use as…": the slots of the profile a model can be put in: the main model, or any auxiliary slot Hermes reports. Each choice asks the Tier 1 confirmation that names the slot and the profile. */
function UseAsSheet({ profile, card, onDone, onClose }: { profile: string; card: UsageCard; onDone(): void; onClose(): void }) {
  const aux = useAuxiliary(profile);
  const [busy, setBusy] = useState<string>();
  const choice = { provider: card.provider, model: card.model };

  const apply = async (key: string, label: string, run: () => Promise<ActionOutcome>) => {
    setBusy(key);
    const outcome = await run();
    setBusy(undefined);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return;
    toast(`${card.model} is now the ${label} of ${profile}`, { tone: 'info' });
    onDone();
    onClose();
  };

  return (
    <Sheet title={`Use ${card.model} as…`} detents={['auto']} onClose={onClose}>
      <div className="md-form">
        <p className="muted">Put this model in one slot of <strong>{profile}</strong>. You confirm first, and only that slot changes.</p>
        <ul className="md-slotlist" aria-label={`Slots for ${card.model}`}>
          <li>
            <WriteButton type="button" className="btn btn--secondary" disabled={busy !== undefined} aria-busy={busy === 'main'} onClick={() => void apply('main', 'main model', () => setMainModel(profile, choice))}>
              <Icon name="cpu" />
              Main model
            </WriteButton>
          </li>
          {aux.value?.slots.map((slot) => {
            const { label } = slotWords(slot.task);
            return (
              <li key={slot.task}>
                <WriteButton type="button" className="btn btn--secondary" disabled={busy !== undefined} aria-busy={busy === slot.task} onClick={() => void apply(slot.task, `${label} slot`, () => setAuxiliaryModel(profile, slot.task, label, choice))}>
                  <Icon name="sliders" />
                  {label} slot
                </WriteButton>
              </li>
            );
          })}
        </ul>
        {!aux.value && !aux.failed && <p role="status">Loading the slots…</p>}
        {aux.failed && (
          <div className="banner" data-tone="warning" role="alert">
            <Icon name="alert" />
            <span className="banner__content">Hermes did not list the auxiliary slots, so only the main model is offered.</span>
          </div>
        )}
      </div>
    </Sheet>
  );
}

function Card({ card, onUse }: { card: UsageCard; onUse(): void }) {
  const canUse = card.provider !== '';
  return (
    <li className="panel panel--pad md-card">
      <h3 className="mono">{card.model}</h3>
      <p className="subtle md-note">{card.provider || 'Provider not recorded'}</p>
      {card.badges.length > 0 && (
        <ul className="md-facts" aria-label="Capabilities">
          {card.badges.map((badge) => (
            <li key={badge.id} className="tag">
              {badge.label}
            </li>
          ))}
        </ul>
      )}
      <dl className="md-card__facts">
        <dt>Requests</dt>
        <dd>{count.format(card.requests)}</dd>
        <dt>Tokens</dt>
        <dd>
          {compact.format(card.inputTokens + card.outputTokens)} <span className="subtle">({compact.format(card.inputTokens)} in · {compact.format(card.outputTokens)} out)</span>
        </dd>
        {card.cost && (
          <>
            <dt>Cost</dt>
            <dd>
              {dollars(card.cost.usd)} {card.cost.kind === 'estimated' && <span className="tag" title="Hermes estimates this from its price table; the provider did not bill it">estimated</span>}
            </dd>
          </>
        )}
        {card.contextWindow > 0 && (
          <>
            <dt>Context window</dt>
            <dd>{compact.format(card.contextWindow)} tokens</dd>
          </>
        )}
      </dl>
      <div>
        <WriteButton type="button" className="btn btn--secondary btn--sm" aria-haspopup="dialog" aria-label={`Use as… ${card.model}`} disabled={!canUse} title={canUse ? undefined : 'Hermes did not record which provider served this model'} onClick={onUse}>
          Use as…
        </WriteButton>
      </div>
    </li>
  );
}

/** What each model of the profile did over the last 7, 30 or 90 days, as Hermes's model analytics count it, with "Use as…" on each card. */
export function Usage({ profile }: { profile: string }) {
  const [days, setDays] = useState<UsageDays>(30);
  const { value, failed, unavailable, reload } = useUsage(profile, days);
  const [using, setUsing] = useState<UsageCard>();
  const labelled = useId();

  return (
    <div className="md-usage">
      <div className="md-usage__bar">
        <p className="muted md-lead">What each model did for <strong>{profile}</strong>, from Hermes’s own accounting. Cost is shown only where Hermes has one, and marked when it is an estimate.</p>
        <div>
          <span id={labelled} className="sr-only">
            Period
          </span>
          <RadioGroup
            labelledBy={labelled}
            className="seg"
            value={String(days) as '7' | '30' | '90'}
            options={USAGE_PERIODS.map((period) => ({ value: String(period) as '7' | '30' | '90', label: `${period} days` }))}
            onChange={(next) => setDays(Number(next) as UsageDays)}
          />
        </div>
      </div>
      {failed && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer, so the usage could not be loaded{value ? ': these are the numbers from a moment ago' : ''}.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {unavailable && (
        <div className="banner" data-tone="info" role="status">
          <Icon name="info" />
          <span className="banner__content">This Hermes does not offer usage numbers, so there is nothing to show here. Updating Hermes may add them.</span>
        </div>
      )}
      {!value && !failed && !unavailable && <Loading label="Loading usage…" lines={3} onRetry={() => void reload()} />}
      {value && !unavailable && value.cards.length === 0 && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="chart" />
          </span>
          <p>No model was used by {profile} in the last {days} days.</p>
        </div>
      )}
      {value && value.cards.length > 0 && (
        <ul className="md-cards" aria-label={`Models used in the last ${days} days`}>
          {value.cards.map((card) => (
            <Card key={`${card.provider}/${card.model}`} card={card} onUse={() => setUsing(card)} />
          ))}
        </ul>
      )}
      {using && <UseAsSheet profile={profile} card={using} onDone={() => void reload()} onClose={() => setUsing(undefined)} />}
    </div>
  );
}
