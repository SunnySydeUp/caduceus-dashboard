// What Work › Schedules asks Hermes to do with a job, as requests: pure, so the policy can be asked about them (the tier of each comes
// from the policy map: run now, pause, resume and delete are T1; creating a job is T1, or T3 when it runs a script) and a test can send them.
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { Job } from './schedules-model.ts';

export interface JobRequest {
  method: 'POST' | 'PUT' | 'DELETE';
  /** The Hermes path with its query, exactly as it is sent. */
  path: string;
  body?: Record<string, unknown>;
}

export type JobAction = 'trigger' | 'pause' | 'resume' | 'delete';

/** A job's own route. The job's profile goes along: Hermes resolves a job by id in that profile first. */
const jobPath = (job: Job) => `/api/cron/jobs/${encodeURIComponent(job.id)}`;
const profileQuery = (job: Job) => `?profile=${encodeURIComponent(job.profile)}`;

export function actionRequest(job: Job, action: JobAction): JobRequest {
  if (action === 'delete') return { method: 'DELETE', path: `${jobPath(job)}${profileQuery(job)}` };
  return { method: 'POST', path: `${jobPath(job)}/${action}${profileQuery(job)}` };
}

/** The schedule as the text Hermes's create endpoint takes, from the record it stores. */
function scheduleText(job: Job): string | undefined {
  const schedule = job.config.schedule;
  if (!isRecord(schedule)) return undefined;
  if (schedule.kind === 'interval' && typeof schedule.minutes === 'number') return `every ${schedule.minutes}m`;
  if (schedule.kind === 'cron' && typeof schedule.expr === 'string') return schedule.expr;
  if (schedule.kind === 'once' && typeof schedule.run_at === 'string') return schedule.run_at;
  return undefined;
}

/** The options Hermes's create endpoint has no field for: a copy or a restored job would not have them. */
const NOT_CREATABLE: [key: string, label: string][] = [
  ['monitor_script', 'a monitor script'],
  ['monitor_url', 'a monitor address'],
  ['failure_deliver', 'a separate target for failures'],
  ['attach_to_session', 'attaching to a session'],
  ['reasoning_effort', 'a reasoning effort'],
];

/** What a copy of the job would leave behind, in words: the options Hermes cannot set when it creates a job, and a run limit. */
export function droppedOptions(job: Job): string[] {
  const dropped = NOT_CREATABLE.filter(([key]) => job.config[key] !== null && job.config[key] !== undefined && job.config[key] !== '').map(([, label]) => label);
  const repeat = job.config.repeat;
  if (isRecord(repeat) && typeof repeat.times === 'number') dropped.push('its run limit');
  return dropped;
}

const present = (value: unknown): boolean => value !== null && value !== undefined && value !== '' && !(Array.isArray(value) && value.length === 0);

/** The body that creates a job like `job`, under `name`. */
function createBody(job: Job, name: string, paused: boolean): Record<string, unknown> {
  const config = job.config;
  const body: Record<string, unknown> = { name, schedule: scheduleText(job), prompt: typeof config.prompt === 'string' ? config.prompt : '', paused };
  for (const key of ['deliver', 'skills', 'model', 'provider', 'base_url', 'script', 'context_from', 'enabled_toolsets', 'workdir'] as const) {
    if (present(config[key])) body[key] = config[key];
  }
  if (config.no_agent === true) body.no_agent = true;
  return body;
}

const createPath = (job: Job) => `/api/cron/jobs?profile=${encodeURIComponent(job.profile)}`;

/** Duplicate: a copy that is paused, so it does nothing until it is switched on. It runs a script exactly when the original does, which makes it a T3 as the original was. */
export function duplicateRequest(job: Job): JobRequest {
  return { method: 'POST', path: createPath(job), body: createBody(job, `${job.name} (copy)`, true) };
}

/** Whether a deleted job can be put back by creating it again: it runs no script (that would be a T3 to create), needs no option Hermes cannot set, and is not a one-shot. */
export function canRestore(job: Job): boolean {
  const schedule = job.config.schedule;
  return !present(job.config.script) && droppedOptions(job).length === 0 && isRecord(schedule) && (schedule.kind === 'interval' || schedule.kind === 'cron');
}

/** Puts a deleted job back: the same name, schedule and settings, and paused if it was. It is a new job to Hermes, with a new id and no run history of its own. */
export function restoreRequest(job: Job): JobRequest {
  return { method: 'POST', path: createPath(job), body: createBody(job, job.name, !job.enabled) };
}
