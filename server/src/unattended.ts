// What counts as unattended work (M6 #06; work model §2.6), in one place. Unattended work is what runs without the owner in front of it: Kanban dispatcher
// runs and scheduled (cron) jobs, except a job the owner exempted in Schedules. A chat session and its tool runs are attended, whatever started them, and are
// never paused or blocked: the guard has no function that touches one, and the only things it calls are the dispatcher's claim list and a cron job's pause.
import { isRecord } from '@caduceus/contracts/policy/guards';

/** A scheduled job as the guard reads it from `GET /api/cron/jobs?profile=all`. */
export interface CronJob {
  id: string;
  profile: string;
  name: string;
  /** Hermes holds the job as paused (by anyone) or disabled. */
  paused: boolean;
  pausedAt: string | undefined;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/** The jobs in Hermes's list, with nothing else. */
export function cronJobsOf(listed: unknown): CronJob[] {
  return (Array.isArray(listed) ? listed : []).flatMap((entry): CronJob[] => {
    if (!isRecord(entry)) return [];
    const id = text(entry.id);
    if (id === undefined) return [];
    return [{ id, profile: text(entry.profile) ?? text(entry.profile_name) ?? 'default', name: text(entry.name) ?? text(entry.prompt)?.slice(0, 50) ?? id, paused: entry.enabled === false || entry.state === 'paused', pausedAt: text(entry.paused_at) }];
  });
}

/** Whether the guard pauses this job: it is running on its schedule (not already stopped by the owner or anyone) and the owner did not exempt it. */
export const isUnattendedJob = (job: CronJob, exempt: (profile: string, jobId: string) => boolean): boolean => !job.paused && !exempt(job.profile, job.id);
