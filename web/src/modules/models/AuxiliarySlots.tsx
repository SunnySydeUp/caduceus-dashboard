import { useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import type { ActionOutcome } from '../profiles/profile-actions.ts';
import type { ModelChoice } from './model-catalogue.ts';
import { resetAuxiliaryModels, setAuxiliaryModel } from './model-actions.ts';
import { useAuxiliary } from './model-data.ts';
import { AUTO, slotWords, type AuxiliarySlot } from './model-settings.ts';
import { ModelPickerSheet } from './ModelPicker.tsx';
import './models.css';

/** The auxiliary slots of one profile: every slot Hermes reports, each on auto or pinned to a model, and Reset all to auto. */
export function AuxiliarySlots({ profile }: { profile: string }) {
  const { value, failed, reload } = useAuxiliary(profile);
  const [picking, setPicking] = useState<AuxiliarySlot>();

  if (!value) {
    return failed ? (
      <div className="banner md-error" data-tone="danger" role="alert">
        <Icon name="alert" />
        <span className="banner__content">Hermes did not answer, so the auxiliary slots of {profile} could not be loaded.</span>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => void reload()}>
          <Icon name="refresh" />
          Retry
        </button>
      </div>
    ) : (
      <p role="status">Loading…</p>
    );
  }

  const { slots, main } = value;
  const pinned = slots.filter((slot) => !slot.isAuto);

  const report = async (outcome: ActionOutcome, done: string): Promise<boolean> => {
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind !== 'done') return false;
    toast(done, { tone: 'info' });
    await reload();
    return true;
  };
  const choose = async (slot: AuxiliarySlot, choice: ModelChoice): Promise<boolean> => {
    const { label } = slotWords(slot.task);
    return report(await setAuxiliaryModel(profile, slot.task, label, choice), choice.model === '' ? `The ${label} slot is back on auto` : `The ${label} slot now uses ${choice.model}`);
  };
  const resetAll = async () => {
    await report(await resetAuxiliaryModels(profile), `Every auxiliary slot of ${profile} is back on auto`);
  };

  return (
    <div className="md-aux">
      <div className="md-aux__head">
        <p className="muted">
          An <Term id="auxiliary-slot">auxiliary slot</Term> is a model for a side task. On auto, Hermes uses {main.model ? <span className="mono">{main.model}</span> : 'the main model'}, or its own choice where that suits the task. Pin a slot to a cheaper or faster model to save time and money.
        </p>
        <WriteButton type="button" className="btn btn--secondary" disabled={pinned.length === 0} onClick={() => void resetAll()}>
          <Icon name="refresh" />
          Reset all to auto
        </WriteButton>
      </div>
      {slots.length === 0 ? (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="cpu" />
          </span>
          <p>Hermes reported no auxiliary slots for this profile.</p>
        </div>
      ) : (
        <ul className="list panel md-slots" aria-label="Auxiliary slots">
          {slots.map((slot) => {
            const words = slotWords(slot.task);
            return (
              <li key={slot.task}>
                <div className="list-row md-slot">
                  <span className="list-row__main">
                    <span className="list-row__title">{words.label}</span>
                    {words.summary && <span className="subtle md-slot__summary">{words.summary}</span>}
                    <span className="md-slot__now">
                      {slot.isAuto ? (
                        <span className="tag">Auto</span>
                      ) : (
                        <>
                          <span className="mono">{slot.model || 'provider default'}</span>
                          <span className="subtle">{slot.provider}</span>
                        </>
                      )}
                      {slot.reasoningEffort && <span className="tag">reasoning {slot.reasoningEffort}</span>}
                    </span>
                  </span>
                  <span className="md-slot__actions">
                    <button type="button" className="btn btn--secondary btn--sm" aria-haspopup="dialog" aria-label={`Change the model of the ${words.label} slot`} onClick={() => setPicking(slot)}>
                      Change
                    </button>
                    {!slot.isAuto && (
                      <WriteButton type="button" className="btn btn--ghost btn--sm" aria-label={`Put the ${words.label} slot back on auto`} onClick={() => void choose(slot, AUTO)}>
                        Auto
                      </WriteButton>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {picking && (
        <ModelPickerSheet
          title={`${slotWords(picking.task).label} model for ${profile}`}
          profile={profile}
          value={picking.isAuto ? undefined : { provider: picking.provider, model: picking.model }}
          auto={{ label: 'Auto', selected: picking.isAuto, choice: AUTO }}
          hideProviders={['moa']}
          onPick={async (choice) => {
            if (await choose(picking, choice)) setPicking(undefined);
          }}
          onClose={() => setPicking(undefined)}
        />
      )}
    </div>
  );
}
