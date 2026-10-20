// The changes System › Keys › Credential pools makes in Hermes, each through `fetchTiered` (add and remove are Tier 2). The caller shows toasts
// and reloads; this says what happened. An API key goes to Hermes and nowhere else: no confirmation, message or toast here ever has one.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { read } from './keys-data.ts';
import { parsePool, poolAdd, poolRemove, type PoolEntry } from './keys-model.ts';

/** Pools an API key for a provider (T2). The confirmation names the provider and the profile, never the key. */
export function addCredential(provider: string, apiKey: string, label: string, profile: string): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      ...poolAdd(provider, apiKey, label, profile),
      confirm: {
        title: `Pool a key for ${provider} in ${profile}?`,
        text: 'Hermes keeps the key in the profile’s auth store and rotates between this provider’s credentials. The key is not shown again.',
        object: provider,
        profile,
        confirmLabel: 'Add credential',
      },
    }),
  );
}

/**
 * Removes a credential from a provider's pool (T2). Hermes names it by its position, which moves when an earlier entry goes, so the pool is read
 * again first and the removal goes ahead only if the same credential is still at that position.
 */
export async function removeCredential(provider: string, entry: PoolEntry, profile: string): Promise<ActionOutcome> {
  const current = await read(`/api/credentials/pool?profile=${encodeURIComponent(profile)}`).then(parsePool, () => undefined);
  if (!current) return { kind: 'failed', message: 'Hermes did not answer, so the pool could not be checked before removing. Nothing was removed.' };
  const still = current.find((candidate) => candidate.provider === provider)?.entries.find((candidate) => candidate.index === entry.index);
  if (still?.id !== entry.id) return { kind: 'failed', message: 'The pool changed since this page loaded. It is being reloaded: look again and remove the one you mean.' };
  return runTiered(
    fetchTiered({
      ...poolRemove(provider, entry.index, profile),
      confirm: {
        title: `Remove ${entry.label} from the ${provider} pool of ${profile}?`,
        text: entry.source.startsWith('env:')
          ? `Hermes made this entry from ${entry.source.slice(4)} in the profile’s environment, so removing it also clears that variable and stops Hermes reading it again.`
          : 'Hermes deletes this credential from the pool. If it is the only one, the provider has no credential until you add another.',
        object: provider,
        profile,
        confirmLabel: 'Remove credential',
      },
    }),
  );
}
