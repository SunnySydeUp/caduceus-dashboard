// What Today reads from Caduceus (M8 #03): what is ready for review, and the visit. Everything else on the screen is what the page already holds (the Inbox's
// stream, the crew) or reads for itself (Hermes's cron jobs, `work/schedules-data.ts`). Nothing is kept beyond what is on screen (D1); the markers of what the
// owner opened are the server's, and telling it is `markOpened` in `ready-feed.ts`.
import type { ReadyItem, ReadyState, TodayVisit } from '@caduceus/contracts/today';

/** The words Caduceus answered with, or what the status says when it said none. */
export async function failure(res: Response): Promise<Error> {
  const body: unknown = await res.json().catch(() => undefined);
  const message = typeof body === 'object' && body !== null && 'message' in body && typeof body.message === 'string' ? body.message : undefined;
  return new Error(message ?? `Caduceus answered HTTP ${res.status}.`);
}

/** The finished work still to review, newest first. */
export async function readReady(): Promise<ReadyItem[]> {
  const res = await fetch('/_caduceus/api/today/ready');
  if (!res.ok) throw await failure(res);
  return ((await res.json()) as ReadyState).items;
}

/** Says the owner opened Today, and when they were away since. */
export async function recordVisit(): Promise<TodayVisit> {
  const res = await fetch('/_caduceus/api/today/visit', { method: 'POST' });
  if (!res.ok) throw await failure(res);
  return (await res.json()) as TodayVisit;
}
