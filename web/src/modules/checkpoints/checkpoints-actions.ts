// Restoring a checkpoint (`rollback.restore`, T3): the owner passes the passkey step-up and types the workspace's name, Caduceus mints the one-use confirmation for
// `rpc rollback.restore`, and the call goes over the page's own gateway connection with it in the frame. Hermes does the restore; Caduceus touches no file.
import { gatewayConnection } from '../../gateway.ts';
import { isReadOnly } from '../../policy-state.ts';
import { fetchWithStepUp } from '../../passkeys.ts';
import { getTierConfirmer } from '../../shell/tier-confirmation.ts';
import { READ_ONLY_MESSAGE } from '../../tiered-fetch.ts';
import type { CheckpointItem } from './checkpoints-model.ts';

export type RestoreOutcome = { kind: 'done'; restoredTo: string | undefined; rewound: number } | { kind: 'cancelled' } | { kind: 'failed'; message: string };

const baseName = (path: string) => path.replace(/\/+$/, '').slice(path.replace(/\/+$/, '').lastIndexOf('/') + 1) || path;

/** Restores the whole workspace to the checkpoint. A full restore also takes the live session's history back to before its last turn (Hermes's own behaviour). */
export async function restoreCheckpoint(sessionId: string, folder: string, checkpoint: CheckpointItem, profile: string | undefined): Promise<RestoreOutcome> {
  if (isReadOnly()) return { kind: 'failed', message: READ_ONLY_MESSAGE };
  if (!navigator.onLine) return { kind: 'failed', message: 'You are offline. This action is never queued: do it when you are back online.' };
  const ask = getTierConfirmer();
  if (!ask) return { kind: 'failed', message: 'The confirmation dialog is not available.' };
  const name = baseName(folder);
  const answer = await ask({
    tier: 'T3',
    moduleId: 'checkpoints',
    action: 'rpc rollback.restore',
    label: `Restore ${name} to checkpoint ${checkpoint.short}?`,
    text: `Hermes puts back the files of ${folder} as they were at this checkpoint: files changed since are overwritten and files created since are removed.`,
    object: name,
    profile,
    confirmLabel: 'Restore',
    recoverability: { undoable: false, note: 'It can be reversed only by restoring another checkpoint: the state before this restore is not kept unless Hermes has taken a checkpoint of it.' },
  });
  if (!answer) return { kind: 'cancelled' };
  const minted = await fetchWithStepUp(() =>
    fetch('/_caduceus/api/policy/confirmations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ operation: 'rpc rollback.restore', target: name, typed: answer.typed ?? name }) }),
  );
  if (!minted.ok) return { kind: 'failed', message: ((await minted.json().catch(() => ({}))) as { message?: string }).message ?? `Caduceus could not confirm this (HTTP ${minted.status}).` };
  const { token } = (await minted.json()) as { token: string };
  try {
    const result = await gatewayConnection().requestConfirmed<{ success?: boolean; restored_to?: string | null; error?: string; reason?: string; history_removed?: number }>(
      'rollback.restore',
      { session_id: sessionId, hash: checkpoint.hash, ...(profile ? { profile } : {}) },
      token,
    );
    if (result.success !== true) return { kind: 'failed', message: result.error ?? result.reason ?? 'Hermes did not restore the checkpoint.' };
    return { kind: 'done', restoredTo: result.restored_to ?? undefined, rewound: result.history_removed ?? 0 };
  } catch (error) {
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}
