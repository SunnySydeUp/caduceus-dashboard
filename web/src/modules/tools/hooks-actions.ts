// The changes Agents › Tools & MCP › Hooks makes in Hermes, each through `fetchTiered` with the tier the policy map gives the request
// (create T3, remove T2, both blocked in read-only mode and offline). The caller shows toasts and reloads; this says what happened.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { hookCreate, hookRemove, type Hook, type HookForm } from './hooks-model.ts';

/** Creates a hook (T3). The confirmation shows the whole command, and the owner types it: Hermes runs it with the access of the owner's account. */
export function createHook(form: HookForm, profile: string): Promise<ActionOutcome> {
  const command = form.command.trim();
  return runTiered(
    fetchTiered({
      ...hookCreate(form, profile),
      confirm: {
        title: `Run this command on ${form.event.trim()} in ${profile}?`,
        text: 'Hermes records your consent for this exact command and runs it, on this computer and with the access of your account, whenever the event happens in a new session of this profile. Read the command before you confirm.',
        object: command,
        profile,
        confirmLabel: 'Create hook',
        recoverability: { undoable: true, note: 'Remove the hook to stop it and withdraw the consent.' },
      },
    }),
  );
}

/** Removes a hook (T2: a passkey step-up). Hermes takes it out of the profile's config and withdraws its consent. */
export function removeHook(hook: Hook, profile: string): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      ...hookRemove(hook, profile),
      confirm: {
        title: `Remove the ${hook.event} hook from ${profile}?`,
        text: `Hermes stops running ${hook.command} for this event in new sessions, and withdraws its consent for that command.`,
        object: hook.command,
        profile,
        confirmLabel: 'Remove hook',
      },
    }),
  );
}
