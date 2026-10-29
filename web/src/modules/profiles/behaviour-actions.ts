// The changes the profile file editors make in Hermes, each through `fetchTiered` with the tier the policy map gives the route (a
// save is a Tier 3 write; so is a reset). Caduceus keeps nothing of what it sends but the snapshot the server takes before a write.
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from './profile-actions.ts';
import { fingerprint, memoryReset, saveRequest, type BehaviourFile, type FileRef, type ResetTarget } from './behaviour-files.ts';

export type SaveOutcome = { kind: 'saved' } | { kind: 'cancelled' } | { kind: 'failed'; message: string } | { kind: 'conflict'; current: string };

/**
 * Saves `text` as the whole file. `base` is the text the editor was made from: when the file is no longer that text the server
 * refuses (`conflict`, with the text now there) and nothing is written. The owner confirms first (typing the profile's name for a Tier 3).
 */
export async function saveFile(profile: string, file: BehaviourFile, ref: FileRef, text: string, base: string, onConfirmed?: () => void): Promise<SaveOutcome> {
  const request = saveRequest(ref, text, await fingerprint(base));
  const result = await fetchTiered({
    ...request,
    onConfirmed,
    confirm: {
      title: `Save ${file.label} of ${profile}?`,
      text: `Hermes replaces the file with this text, exactly as you see it. Caduceus keeps the text it replaces as a snapshot, so you can restore it from History.`,
      object: profile,
      profile,
      confirmLabel: `Save ${file.label}`,
      recoverability: { undoable: true, note: 'The previous text stays in History.' },
    },
  });
  if (result.kind === 'cancelled') return result;
  if (result.kind === 'refused') return { kind: 'failed', message: result.refusal.message };
  const body: unknown = await result.response.json().catch(() => undefined);
  if (result.response.ok) return { kind: 'saved' };
  const answer = (typeof body === 'object' && body !== null ? body : {}) as { error?: unknown; current?: unknown; message?: unknown; detail?: unknown };
  if (result.response.status === 409 && answer.error === 'conflict' && typeof answer.current === 'string') return { kind: 'conflict', current: answer.current };
  const reason = typeof answer.message === 'string' ? answer.message : typeof answer.detail === 'string' ? answer.detail : `Hermes answered HTTP ${result.response.status}.`;
  return { kind: 'failed', message: reason };
}

const RESET_WORDS: Record<ResetTarget, string> = { memory: 'MEMORY.md', user: 'USER.md', all: 'MEMORY.md and USER.md' };

/** Empties the built-in memory (Tier 3: the profile's name typed). Caduceus snapshots each file first, so History can put the text back. */
export function resetMemory(profile: string, target: ResetTarget): Promise<ActionOutcome> {
  return runTiered(
    fetchTiered({
      ...memoryReset(profile, target),
      confirm: {
        title: `Reset ${RESET_WORDS[target]} of ${profile}?`,
        text: `Hermes deletes ${RESET_WORDS[target]}: what the agent has remembered is gone from the next session on. Caduceus keeps the text as a snapshot, so History can put it back.`,
        object: profile,
        profile,
        confirmLabel: 'Reset',
        recoverability: { undoable: true, note: 'The text stays in History, from where you can restore it.' },
      },
    }),
  );
}
