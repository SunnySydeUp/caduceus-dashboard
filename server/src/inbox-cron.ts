// The Inbox's cron source (M2 #02): a scheduled job whose last run failed, one whose result Hermes could deliver nowhere, and one that is overdue. All come from
// Hermes's list of jobs (`GET /api/cron/jobs?profile=all`), read again when Hermes says its jobs moved (`cron.changed` on the observer connection) and now and then
// (overdue is a matter of time). A job that runs well again, or is paused or deleted, simply stops being in the list, and so stops being an item. The list it read
// is also handed on (`onJobs`): the reminders an agent set are in it, and the push watcher sends them (`push-news.ts`).
import type { InboxAction } from '@caduceus/contracts/inbox';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { isOneTimeJob, SCHEDULER_STALE_AFTER_S } from '@caduceus/contracts/scheduler';
import type { GatewayObserver } from './gateway-observer.ts';
import type { HermesBackend } from './hermes-backend.ts';
import type { JobMutes } from './job-notifications.ts';
import { createPolledSource, type InboxSource, type NoticeDraft } from './inbox-source.ts';

/** How late a job must be before it is worth saying: the scheduler ticks every minute, so a few minutes is only a slow run. */
export const OVERDUE_AFTER_MS = 10 * 60_000;

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

/** When Hermes says a job last ran or runs next: an ISO time, or seconds since the epoch. */
function instant(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value < 1e12 ? value * 1000 : value;
  const at = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isNaN(at) ? undefined : at;
}

/** What is wrong with the jobs in Hermes's list, as notices. Pure. */
export function cronNotices(jobs: unknown, now: number, muted: (profile: string, jobId: string) => boolean = () => false): NoticeDraft[] {
  if (!Array.isArray(jobs)) return [];
  return jobs.flatMap((job): NoticeDraft[] => {
    if (!isRecord(job)) return [];
    const id = text(job.id);
    if (id === undefined) return [];
    const state = text(job.state) ?? 'scheduled';
    const enabled = job.enabled !== false && state !== 'paused' && state !== 'completed';
    // A job that is off needs nothing from the owner: paused after a failure is the owner having dealt with it.
    if (!enabled) return [];
    const profile = text(job.profile) ?? text(job.profile_name) ?? 'default';
    if (muted(profile, id)) return [];
    const name = text(job.name) ?? text(job.prompt)?.slice(0, 50) ?? id;
    const query = `?profile=${encodeURIComponent(profile)}`;
    const base = `/api/cron/jobs/${encodeURIComponent(id)}`;
    const runNow: InboxAction = {
      id: 'run-now',
      label: 'Run now',
      request: { method: 'POST', path: `${base}/trigger${query}` },
      confirm: { title: `Run “${name}” now?`, text: `Hermes runs the job of ${profile} once, now, outside its schedule.`, object: name, confirmLabel: 'Run now' },
      primary: true,
    };
    const pause: InboxAction = {
      id: 'pause',
      label: 'Pause',
      request: { method: 'POST', path: `${base}/pause${query}` },
      confirm: { title: `Pause “${name}”?`, text: `The job of ${profile} stops running on its schedule until you resume it.`, object: name, confirmLabel: 'Pause job' },
    };
    const open = { label: 'Open output', to: `/work/schedules/${encodeURIComponent(id)}${query}` };
    const common = { ref: `cron:${profile}:${id}`, group: 'failed', category: 'automation', profile } as const;
    if (text(job.last_status) === 'error') {
      return [{ ...common, id: `cron-failed:${profile}:${id}`, stamp: `failed:${String(job.last_run_at ?? '')}`, title: `“${name}” failed`, detail: text(job.last_error)?.slice(0, 400) ?? 'Its last run ended with an error.', actions: [runNow, pause], link: open }];
    }
    // The run went well and Hermes had nowhere to send its result (no messaging platform for `all`, a target gone). A reminder is sent by Caduceus itself, so it is
    // never this; a routine's result is then only in its output, and the owner should know.
    if (text(job.last_status) === 'delivery_failed' && !isOneTimeJob(job)) {
      return [{ ...common, id: `cron-undelivered:${profile}:${id}`, stamp: `undelivered:${String(job.last_run_at ?? '')}`, title: `“${name}” ran but was not delivered`, detail: text(job.last_delivery_error)?.slice(0, 400) ?? 'Hermes could not send its result anywhere.', actions: [runNow, pause], link: open }];
    }
    const next = instant(job.next_run_at);
    const age = job.scheduler_heartbeat_age_s;
    // A scheduler that is not ticking is the reason jobs are late, and the system source says so once: not once for every job.
    const ticking = typeof age !== 'number' || age <= SCHEDULER_STALE_AFTER_S;
    if (next !== undefined && next < now - OVERDUE_AFTER_MS && ticking) {
      return [{ ...common, id: `cron-overdue:${profile}:${id}`, stamp: `overdue:${next}`, title: `“${name}” is overdue`, detail: `It was due ${new Date(next).toISOString().slice(0, 16).replace('T', ' ')} UTC and has not run.`, actions: [runNow], link: open }];
    }
    return [];
  });
}

export interface CronSourceDeps {
  backend: HermesBackend;
  observer: GatewayObserver;
  now: () => number;
  pollMs: number;
  /** The owner's per-job notification switch (`job-notifications.ts`): a job it silences is no item. */
  mutes?: JobMutes;
  /** Told the list of jobs after every read that got one. */
  onJobs?: (jobs: unknown) => void;
}

export function createCronSource({ backend, observer, now, pollMs, mutes, onJobs }: CronSourceDeps): InboxSource {
  return createPolledSource({
    now,
    pollMs,
    async read() {
      const res = await backend.fetch('/api/cron/jobs?profile=all');
      if (!res.ok) throw new Error(`Hermes answered HTTP ${res.status}`);
      const jobs: unknown = await res.json();
      onJobs?.(jobs);
      return cronNotices(jobs, now(), mutes ? (profile, id) => mutes.muted(profile, id) : undefined);
    },
    wake(refresh) {
      const stopObserving = observer.onEvent((type) => type === 'cron.changed' && refresh());
      const stopMutes = mutes?.subscribe(refresh);
      return () => {
        stopObserving();
        stopMutes?.();
      };
    },
  });
}
