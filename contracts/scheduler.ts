/** The scheduler ticks every 60 s; Hermes's own dashboard and CLI call it stale after three missed ticks and some slack. Health (server) and Work › Schedules (web) both judge a heartbeat by this. */
export const SCHEDULER_STALE_AFTER_S = 3 * 60 + 20;

/**
 * Whether a Hermes cron job (as `GET /api/cron/jobs` lists it) runs once: what an agent makes when asked to "remind me". Caduceus treats one as a reminder: it lists
 * it on Today's Reminders and, when it runs, sends what the agent said to the owner's devices itself (server `push-news.ts`), so it is never "not delivered".
 */
export function isOneTimeJob(job: Record<string, unknown>): boolean {
  const { schedule } = job;
  return typeof schedule === 'object' && schedule !== null && 'kind' in schedule && schedule.kind === 'once';
}
