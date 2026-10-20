// The text a bug report about a schedule carries: the job's configuration, its latest runs with their output, and the scheduler's state.
// It is redacted before it is built into a bundle, never after: a secret in the prompt, an error or a run's output must not reach the clipboard.
import { plainDuration } from '../../plain-duration.ts';
import type { Run } from './job-runs.ts';
import { JOB_TYPES, schedulerSummary, type Job, type SchedulerStatus } from './schedules-model.ts';

const MASK = '[redacted]';

/** Secrets by what they look like: the prefixes of the well-known providers, a JWT, a long hex digest. */
const SECRET_SHAPES = [
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g,
  /\b[A-Fa-f0-9]{40,}\b/g,
];

/**
 * `text` without what looks like a secret: a value named like one (`API_KEY=…`, `"client_secret": "…"`, `password: …`), a bearer
 * token, the password in an address, and the shapes of the well-known keys. The words around a secret stay, so the report still reads.
 */
export function redactText(text: string): string {
  let redacted = text
    .replace(/(:\/\/[^\s:@/]+:)[^\s@/]+(@)/g, `$1${MASK}$2`)
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, `$1${MASK}`)
    .replace(/([A-Za-z0-9_.-]*(?:key|token|secret|password|passwd|pwd|authorization|credential|cookie)[A-Za-z0-9_.-]*["']?\s*[:=]\s*["']?)(?!Bearer\s)([^\s"',;]+)/gi, `$1${MASK}`);
  for (const shape of SECRET_SHAPES) redacted = redacted.replace(shape, MASK);
  return redacted;
}

export interface RunReport {
  run: Run;
  /** What the run produced, when it was read. */
  output?: string;
}

/** How many runs the bundle holds, and how much of each run's output. */
const RUNS_SHOWN = 3;
const OUTPUT_CHARS = 1500;

const present = (value: unknown): value is string | number => (typeof value === 'string' && value !== '') || typeof value === 'number';
const list = (value: unknown): string => (Array.isArray(value) ? value.filter(present).join(', ') : '');
const when = (at: number | undefined) => (at === undefined ? 'never' : new Date(at).toISOString());

/** The bundle, as text for the clipboard. Only the fields that describe the job are included; where it came from (chat ids) and where Hermes keeps it (directories) are not. */
export function diagnosticsText({ job, runs, scheduler, now }: { job: Job; runs: readonly RunReport[]; scheduler: SchedulerStatus; now: number }): string {
  const config = job.config;
  const repeat = config.repeat as { times?: number | null; completed?: number } | undefined;
  const lines: (string | undefined)[] = [
    'Caduceus diagnostics: schedule',
    `Made: ${new Date(now).toISOString()}`,
    '',
    `Job: ${job.name} (${job.id})`,
    `Profile: ${job.profile}`,
    `Type: ${JOB_TYPES[job.type].label}`,
    `Schedule: ${job.schedule}${job.scheduleExpression ? ` (${job.scheduleExpression})` : ''}`,
    `State: ${job.state}, ${job.enabled ? 'enabled' : 'paused'}`,
    `Next run: ${when(job.nextRunAt)}`,
    `Last run: ${when(job.lastRunAt)}`,
    `Last result: ${job.lastStatus ?? 'none yet'}`,
    job.lastError ? `Last error: ${job.lastError}` : undefined,
    typeof config.failure_streak === 'number' ? `Failure streak: ${config.failure_streak}` : undefined,
    repeat && typeof repeat.completed === 'number' ? `Runs completed: ${repeat.completed}${typeof repeat.times === 'number' ? ` of ${repeat.times}` : ''}` : undefined,
    present(config.deliver) ? `Deliver to: ${config.deliver}` : undefined,
    present(config.model) ? `Model: ${config.model}${present(config.provider) ? ` (${config.provider})` : ''}` : undefined,
    present(config.script) ? `Script: ${config.script}${config.no_agent === true ? ' (no agent)' : ''}` : undefined,
    list(config.skills) ? `Skills: ${list(config.skills)}` : undefined,
    list(config.enabled_toolsets) ? `Toolsets: ${list(config.enabled_toolsets)}` : undefined,
    present(config.paused_reason) ? `Paused because: ${config.paused_reason}` : undefined,
    present(config.prompt) ? `Prompt:\n${config.prompt}` : undefined,
    '',
    `Scheduler: ${schedulerSummary(scheduler)}`,
    '',
    runs.length === 0 ? 'Runs: none recorded' : undefined,
    ...runs.slice(0, RUNS_SHOWN).flatMap(({ run, output }, index) => [
      `Run ${index + 1}: ${run.statusLabel}${run.durationMs === undefined ? '' : `, ${plainDuration(run.durationMs / 1000)}`}, ${run.id}, started ${when(run.startedAt)}`,
      output === undefined ? undefined : output.length > OUTPUT_CHARS ? `${output.slice(0, OUTPUT_CHARS)}…` : output,
      '',
    ]),
  ];
  return redactText(lines.filter((line): line is string => line !== undefined).join('\n')).trimEnd();
}
