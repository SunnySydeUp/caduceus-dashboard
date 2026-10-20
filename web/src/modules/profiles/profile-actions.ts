// The changes Agents › Profiles makes in Hermes, each through `fetchTiered` with the tier the policy map gives it (a new profile is made by
// the builder, `builder-apply.ts`; rename T0, description T0, Auto-describe T1, delete T3; Make default T2 is in `make-default.ts`). The caller shows toasts and
// reloads; this says what happened. Caduceus keeps nothing of what it sends.
import { forgetProfilePreferences, moveProfilePreferences } from '../../profile-preferences.ts';
import { fetchTiered } from '../../tiered.ts';
import type { TieredResult } from '../../tiered-fetch.ts';
import type { ProfileCard } from './profiles-model.ts';

/** What came of an action: it worked (with Hermes's answer), the owner declined, or it was refused or failed (with the reason, in words). */
export type ActionOutcome<Body = unknown> = { kind: 'done'; body: Body } | { kind: 'cancelled' } | { kind: 'failed'; message: string };

/** Hermes's FastAPI errors are `{ detail }`; the policy's refusals are `{ message }`. */
function messageOf(body: unknown, status: number): string {
  if (typeof body === 'object' && body !== null) {
    const { detail, message } = body as { detail?: unknown; message?: unknown };
    if (typeof detail === 'string') return detail;
    if (typeof message === 'string') return message;
  }
  return `Hermes answered HTTP ${status}.`;
}

/** Turns what `fetchTiered` says into an outcome. */
export async function runTiered<Body = unknown>(sending: Promise<TieredResult>): Promise<ActionOutcome<Body>> {
  const result = await sending;
  if (result.kind === 'cancelled') return { kind: 'cancelled' };
  if (result.kind === 'refused') return { kind: 'failed', message: result.refusal.message };
  const text = await result.response.text();
  const body: unknown = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : undefined;
  return result.response.ok ? { kind: 'done', body: body as Body } : { kind: 'failed', message: messageOf(body, result.response.status) };
}

/** Renames in Hermes (Tier 0: no dialog; the toast offers the undo). The assistant name follows the new name. */
export async function renameProfile(from: string, to: string): Promise<ActionOutcome<{ name: string }>> {
  const outcome = await runTiered<{ name?: string }>(fetchTiered({ method: 'PATCH', path: `/api/profiles/${encodeURIComponent(from)}`, body: { new_name: to } }));
  if (outcome.kind !== 'done') return outcome;
  // Hermes answers with the canonical name (lowercase; the root profile keeps `default`).
  const name = outcome.body.name ?? to;
  // The root profile keeps its id, so there is nothing to move.
  if (name !== from) await moveProfilePreferences(from, name).catch(() => undefined);
  return { kind: 'done', body: { name } };
}

/** T3: the typed name, and the words that it cannot be undone. Caduceus forgets what it kept about the profile afterwards. */
export async function deleteProfile(profile: ProfileCard): Promise<ActionOutcome> {
  const outcome = await runTiered(
    fetchTiered({
      method: 'DELETE',
      path: `/api/profiles/${encodeURIComponent(profile.name)}`,
      confirm: {
        title: `Delete ${profile.name}?`,
        text: `Hermes deletes the profile’s folder: its settings, memory, skills, sessions and keys. Its gateway is stopped first.`,
        object: profile.name,
        profile: profile.name,
        confirmLabel: 'Delete profile',
        recoverability: { undoable: false, note: 'Only a Hermes backup can bring it back.' },
      },
    }),
  );
  if (outcome.kind === 'done') await forgetProfilePreferences(profile.name).catch(() => undefined);
  return outcome;
}

/** Saves the owner's own description through Hermes (Tier 0); an empty text clears it. */
export function saveDescription(name: string, description: string): Promise<ActionOutcome<{ description: string }>> {
  return runTiered(fetchTiered({ method: 'PUT', path: `/api/profiles/${encodeURIComponent(name)}/description`, body: { description } }));
}

export interface Described {
  ok: boolean;
  reason: string | null;
  description: string | null;
}

/**
 * Auto-describe (Tier 1): Hermes asks its model for a description and writes it as it answers; there is no way to ask for one
 * without saving it. The page therefore shows what came back and lets the owner keep it, edit it or put the old text back.
 * `overwrite` is sent only when the profile already has a description of the owner's own, and the confirmation says so.
 */
export function autoDescribe(profile: ProfileCard): Promise<ActionOutcome<Described>> {
  const replaces = profile.description !== '' && !profile.descriptionAuto;
  return runTiered(
    fetchTiered({
      method: 'POST',
      path: `/api/profiles/${encodeURIComponent(profile.name)}/describe-auto`,
      body: { overwrite: replaces },
      confirm: {
        title: `Describe ${profile.name} automatically?`,
        text: `Hermes asks its model to write a short description from the profile’s model and skills. It saves what it writes${replaces ? ', replacing the description you wrote' : ''}; you can then keep it, edit it or put the old text back.`,
        object: profile.name,
        profile: profile.name,
        confirmLabel: 'Describe',
      },
    }),
  );
}
