// What the reminders calendar reads from Caduceus: the owner's dated Apple Reminders, which the server reads from `remindctl` on every ask, and the reminders an
// agent set (Hermes's one-time jobs). Nothing is kept here. Overdue Apple Reminders can be marked done from Today, and the undo marks them not done again.
import type { Reminder, RemindersState } from '@caduceus/contracts/today';
import { fetchTiered } from '../../tiered.ts';
import { failure } from './today-data.ts';

/** The dated reminders, soonest first. Rejects with the words Caduceus gave when `remindctl` is missing or fails. */
export async function readReminders(): Promise<Reminder[]> {
  const res = await fetch('/_caduceus/api/today/reminders');
  if (!res.ok) throw await failure(res);
  return ((await res.json()) as RemindersState).reminders;
}

/**
 * Marks Apple Reminders done (`done`), or not done again (the undo). A T0: it goes at once, and the caller's toast offers the undo. Resolves `false` when the owner
 * declined; rejects with Caduceus's words when the change was refused (read-only mode, offline) or Reminders did not take it.
 */
export async function markReminders(ids: readonly string[], done: boolean): Promise<boolean> {
  const result = await fetchTiered({ method: 'POST', path: `/_caduceus/api/today/reminders/${done ? 'complete' : 'reopen'}`, body: { ids: [...ids] } });
  if (result.kind === 'refused') throw new Error(result.refusal.message);
  if (result.kind === 'cancelled') return false;
  if (!result.response.ok) throw await failure(result.response);
  return true;
}
