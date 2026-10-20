// What the reminders calendar reads from Caduceus: the owner's dated Apple Reminders, which the server reads from `remindctl` on every ask. Nothing is kept here.
import type { Reminder, RemindersState } from '@caduceus/contracts/today';
import { failure } from './today-data.ts';

/** The dated reminders, soonest first. Rejects with the words Caduceus gave when `remindctl` is missing or fails. */
export async function readReminders(): Promise<Reminder[]> {
  const res = await fetch('/_caduceus/api/today/reminders');
  if (!res.ok) throw await failure(res);
  return ((await res.json()) as RemindersState).reminders;
}
