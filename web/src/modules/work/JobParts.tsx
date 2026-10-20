// The small pieces both Schedules screens draw: the type badge, the next run and last result of a job, the scheduler warning.
import { useEffect, useState } from 'react';
import { Icon, type IconName } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { plainDuration } from '../../plain-duration.ts';
import { JOB_TYPES, relativeTime, type Job, type JobType, type SchedulerStatus } from './schedules-model.ts';

/** The time now, in milliseconds, refreshed so "in 5 min" does not go stale on a screen that stays open. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(timer);
  }, [everyMs]);
  return now;
}

const instantFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const formatInstant = (at: number): string => instantFormat.format(at);

export const jobHref = (job: Job): string => `/work/schedules/${encodeURIComponent(job.id)}`;

const TYPE_LOOK: Record<JobType, { icon: IconName; tone: string }> = {
  agent: { icon: 'chat', tone: 'accent' },
  script: { icon: 'terminal', tone: 'neutral' },
  task: { icon: 'tasks', tone: 'info' },
  blueprint: { icon: 'package', tone: 'success' },
};

export function TypeBadge({ type }: { type: JobType }) {
  const { icon, tone } = TYPE_LOOK[type];
  return (
    <span className="tag jtype" data-tone={tone === 'neutral' ? undefined : tone} title={JOB_TYPES[type].detail}>
      <Icon name={icon} small />
      {JOB_TYPES[type].label}
    </span>
  );
}

/** When the job runs next, or why it does not. */
export function NextRun({ job, now }: { job: Job; now: number }) {
  if (job.state === 'completed') return <StatusBadge state="done" label="Finished" variant="plain" />;
  if (!job.enabled) return <StatusBadge state="paused" variant="plain" />;
  if (job.nextRunAt === undefined) return <span className="subtle">—</span>;
  const overdue = job.nextRunAt < now - 60_000;
  return (
    <time dateTime={new Date(job.nextRunAt).toISOString()} title={formatInstant(job.nextRunAt)} className={overdue ? 'jnext is-overdue' : 'jnext'}>
      {overdue ? `Was due ${relativeTime(job.nextRunAt, now)}` : relativeTime(job.nextRunAt, now)}
    </time>
  );
}

/** How the job last went, from Hermes's record of it. A failure carries Hermes's error as its tooltip. */
export function LastResult({ job, now }: { job: Job; now: number }) {
  if (job.lastRunAt === undefined || job.lastStatus === undefined) return <span className="subtle">Not run yet</span>;
  const ago = relativeTime(job.lastRunAt, now);
  const failed = job.lastStatus === 'error';
  const label = failed ? 'Failed' : job.lastStatus === 'ok' ? 'Succeeded' : job.lastStatus;
  return (
    <span className="tag" data-tone={failed ? 'danger' : job.lastStatus === 'ok' ? 'success' : undefined} title={job.lastError ?? formatInstant(job.lastRunAt)}>
      {label}
      <span className="mono">{ago}</span>
    </span>
  );
}

/** The warning above the list and the job: shown only while the scheduler is not known to be ticking. */
export function SchedulerNotice({ status }: { status: SchedulerStatus | undefined }) {
  if (status?.state === 'stale') {
    return (
      <div className="banner wb-repair" data-tone="warning" role="status">
        <Icon name="alert" />
        <div className="banner__content">
          <strong>The scheduler is not ticking, so scheduled jobs are not running</strong>
          <p>
            Hermes’s scheduler last ticked {plainDuration(status.ageSeconds)} ago, though it ticks every minute. Whatever a job’s next run says, it will not run until the scheduler is back: this is a <Term id="stale-scheduler">stale scheduler</Term>. The scheduler lives in the messaging gateway, so check <AppLink to="/observe/health">Health</AppLink> and start the gateway if it is down.
          </p>
        </div>
      </div>
    );
  }
  if (status?.state === 'unknown') {
    return (
      <div className="banner wb-repair" data-tone="info" role="status">
        <Icon name="info" />
        <div className="banner__content">
          <strong>Hermes has not recorded a scheduler tick yet</strong>
          <p>
            {status.waiting === 1 ? '1 job is' : `${status.waiting} jobs are`} waiting to run, but the scheduler, which lives in the messaging gateway, has not ticked. <AppLink to="/observe/health">Health</AppLink> shows whether the gateway is running.
          </p>
        </div>
      </div>
    );
  }
  return null;
}
