// The changes System › Keys makes to a provider key, each through `fetchTiered` with the tier the policy map gives the route (replace and
// remove T2, reveal T3, test T1). The caller shows toasts and reloads; this says what happened. A key the owner types goes to Hermes and
// nowhere else: no confirmation, toast or message here ever holds a value, and a revealed value is returned to the one component that shows
// it and is kept by nothing here.
import { isRecord } from '@caduceus/contracts/policy/guards';
import { raiseRestartNeeded } from '../../restart-to-apply.ts';
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { keyRemove, keyReplace, keyReveal, keyTest, parseKeyTest, providerCheck, type KeyRow, type KeyTestResult } from './keys-model.ts';

/** Saves a key's value (a new key, or a replacement): T2. A gateway that is running holds the old value until it restarts, so the restart-to-apply banner is raised. */
export async function saveKey(key: KeyRow, value: string, profile: string): Promise<ActionOutcome> {
  const replacing = key.isSet;
  const outcome = await runTiered(
    fetchTiered({
      ...keyReplace(key.name, value, profile),
      confirm: {
        title: `${replacing ? 'Replace' : 'Save'} ${key.name} for ${profile}?`,
        text: `Hermes writes ${key.name} to this profile’s .env file${replacing ? ' and drops every copy it kept of the old value' : ''}. The value is not shown again.`,
        object: key.name,
        profile,
        confirmLabel: replacing ? 'Replace key' : 'Save key',
      },
    }),
  );
  if (outcome.kind === 'done') await raiseRestartNeeded(profile, `${key.name} ${replacing ? 'replaced' : 'saved'}`);
  return outcome;
}

/** Removes a key from the profile's `.env` and every mirror Hermes keeps of it: T2. */
export async function removeKey(key: KeyRow, profile: string): Promise<ActionOutcome> {
  const outcome = await runTiered(
    fetchTiered({
      ...keyRemove(key.name, profile),
      confirm: {
        title: `Remove ${key.name} from ${profile}?`,
        text: `Hermes deletes the value from this profile’s .env file and from the pooled credentials and config copies it made of it. ${key.provider ? `${profile} cannot use ${key.providerLabel || key.provider} with this key until a new one is added.` : ''}`.trim(),
        object: key.name,
        profile,
        confirmLabel: 'Remove key',
        recoverability: { undoable: false, note: 'Add the key again to put it back. Nothing here keeps its value.' },
      },
    }),
  );
  if (outcome.kind === 'done') await raiseRestartNeeded(profile, `${key.name} removed`);
  return outcome;
}

/** Asks Hermes for a key's value (T3: a passkey and the typed name; audited by Hermes and by Caduceus). The answer is the secret, so it is only handed back. */
export async function revealKey(key: KeyRow, profile: string, seconds: number): Promise<ActionOutcome<string>> {
  const outcome = await runTiered<unknown>(
    fetchTiered({
      ...keyReveal(key.name, profile),
      confirm: {
        title: `Reveal ${key.name} for ${profile}?`,
        text: `Shows the full value for ${seconds} seconds and then hides it again. The reveal is written to the audit log with this device and the time.`,
        object: key.name,
        profile,
        confirmLabel: `Reveal for ${seconds} s`,
        recoverability: { undoable: false, note: 'Anyone who can see this screen while it is shown can copy the key. If it leaks, replace it here and revoke it at the provider.' },
      },
    }),
  );
  if (outcome.kind !== 'done') return outcome;
  const value = isRecord(outcome.body) ? outcome.body.value : undefined;
  return typeof value === 'string' ? { kind: 'done', body: value } : { kind: 'failed', message: 'Hermes did not give the value.' };
}

/** Checks the key Hermes holds, with Hermes's own validation (T1: Hermes sends the key to its provider). */
export async function testKey(key: KeyRow, profile: string): Promise<ActionOutcome<KeyTestResult>> {
  const where = key.providerLabel || key.provider || 'its provider';
  const outcome = await runTiered<unknown>(
    fetchTiered({
      ...keyTest(key.name, profile),
      confirm: {
        title: `Test ${key.name} for ${profile}?`,
        text: `Hermes sends the key to ${where} to see whether it is accepted. Nothing is changed. Some providers have no live check, and the result says so.`,
        object: key.name,
        profile,
        confirmLabel: 'Test connection',
      },
    }),
  );
  return outcome.kind === 'done' ? { kind: 'done', body: parseKeyTest(outcome.body) } : outcome;
}

/** Checks a key the owner has typed and not yet saved (Hermes's validation, a plain read of the provider): nothing is stored. */
export async function checkTypedKey(name: string, value: string): Promise<ActionOutcome<KeyTestResult>> {
  const request = providerCheck(name, value);
  const outcome = await runTiered<unknown>(fetchTiered(request));
  return outcome.kind === 'done' ? { kind: 'done', body: parseKeyTest(outcome.body) } : outcome;
}
