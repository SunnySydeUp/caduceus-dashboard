// The changes Agents › Models makes in Hermes, each through `fetchTiered` with the tier the policy map gives the route (model set
// T1, config write T3, which is blocked in read-only mode). The caller shows toasts and reloads; this says what happened. Caduceus
// keeps nothing of what it sends.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import type { ModelChoice } from './model-catalogue.ts';
import { fallbackWriteRequest, settingsWriteRequest, type Fallback, type FallbackSettings } from './fallback.ts';
import { moaSaveRequest, type Moa } from './moa.ts';
import { auxiliaryModelRequest, mainModelRequest, readSetAnswer, reasoningRequest, resetAuxiliaryRequest, REASONING_LEVELS, type HermesRequest } from './model-settings.ts';

/** What the confirmation says it is about to do. */
interface Words {
  title: string;
  text: string;
  confirmLabel: string;
}

/**
 * Assigns a model: the owner confirms (Tier 1), Hermes answers. When Hermes warns that the model is expensive it assigns nothing and
 * says why; the owner then confirms Hermes's warning itself, and only that sends the request again with the flag.
 */
async function assign(profile: string, build: (options: { confirmExpensive: boolean }) => HermesRequest, words: Words): Promise<ActionOutcome> {
  const send = async (confirmExpensive: boolean, confirm: Words) => {
    const request = build({ confirmExpensive });
    return runTiered<unknown>(fetchTiered({ ...request, confirm: { ...confirm, object: profile, profile } }));
  };
  const first = await send(false, words);
  if (first.kind !== 'done') return first;
  const answer = readSetAnswer(first.body);
  if (answer.kind === 'saved') return first;
  return send(true, { title: 'Hermes warns about this model', text: answer.message, confirmLabel: 'Use it anyway' });
}

/** Sets the profile's main model. */
export function setMainModel(profile: string, choice: ModelChoice): Promise<ActionOutcome> {
  return assign(profile, (options) => mainModelRequest(profile, choice, options), {
    title: `Use ${choice.model} as the main model of ${profile}?`,
    text: 'Hermes writes it to the profile’s config. New sessions use it; a chat that is already open keeps the model it has.',
    confirmLabel: 'Use this model',
  });
}

/** Pins one auxiliary slot to a model, or puts it back on auto (`AUTO`). Only that slot changes. */
export function setAuxiliaryModel(profile: string, task: string, label: string, choice: ModelChoice): Promise<ActionOutcome> {
  const auto = choice.model === '';
  return assign(profile, (options) => auxiliaryModelRequest(profile, task, choice, options), {
    title: auto ? `Put the ${label} slot of ${profile} back on auto?` : `Use ${choice.model} for the ${label} slot of ${profile}?`,
    text: auto ? 'Hermes chooses the model for this side task again.' : 'Only this slot changes. Hermes writes it to the profile’s config.',
    confirmLabel: auto ? 'Back to auto' : 'Use this model',
  });
}

/** "Reset all to auto": every slot of the profile back on auto. The main model is not touched. */
export function resetAuxiliaryModels(profile: string): Promise<ActionOutcome> {
  const request = resetAuxiliaryRequest(profile);
  return runTiered(
    fetchTiered({
      ...request,
      confirm: {
        title: `Put every auxiliary slot of ${profile} back on auto?`,
        text: 'Each slot loses the model, endpoint and reasoning effort pinned to it, and Hermes chooses again. The main model is not touched.',
        object: profile,
        profile,
        confirmLabel: 'Reset all to auto',
      },
    }),
  );
}

/** Sets the profile's default reasoning effort: a config write (Tier 3), so the profile's name is typed to confirm. */
export function setReasoningDefault(profile: string, previous: string, effort: string): Promise<ActionOutcome> {
  const request = reasoningRequest(profile, effort);
  const named = (value: string) => REASONING_LEVELS.find((level) => level.value === value)?.label ?? value;
  return runTiered(
    fetchTiered({
      ...request,
      confirm: {
        title: `Set the default reasoning of ${profile} to ${named(effort)}?`,
        text: 'Hermes writes it to the profile’s config. New sessions think at this level unless a chat says otherwise.',
        object: profile,
        profile,
        confirmLabel: 'Save',
        recoverability: { undoable: true, note: `Set it back to ${named(previous)} to undo.` },
      },
    }),
  );
}

/** Saves a set of Mixture-of-Agents presets in Hermes (Tier 1): `what` says what the owner did, in the confirmation's words. */
export function saveMoaPresets(profile: string, moa: Moa, what: { title: string; text: string; confirmLabel: string }): Promise<ActionOutcome> {
  return runTiered(fetchTiered({ ...moaSaveRequest(profile, moa), confirm: { ...what, object: profile, profile } }));
}

/** Writes the fallback chain (and the entries turned off) to the profile's config: a config write (Tier 3), so the profile's name is typed. */
export function saveFallbackChain(profile: string, state: Pick<Fallback, 'chain' | 'parked'>, what: { title: string; text: string }): Promise<ActionOutcome> {
  return runTiered(fetchTiered({ ...fallbackWriteRequest(profile, state), confirm: { ...what, object: profile, profile, confirmLabel: 'Save chain', recoverability: { undoable: true, note: 'Put the entries back as they were and save again to undo.' } } }));
}

/** Writes Hermes's failing-over settings to the profile's config (Tier 3). */
export function saveFallbackSettings(profile: string, settings: FallbackSettings): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      ...settingsWriteRequest(profile, settings),
      confirm: {
        title: `Save the failing-over settings of ${profile}?`,
        text: 'Hermes writes them to the profile’s config. New sessions use them.',
        object: profile,
        profile,
        confirmLabel: 'Save settings',
      },
    }),
  );
}
