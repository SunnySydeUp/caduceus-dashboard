import { useMemo, useState, type ReactNode } from 'react';
import { useParams } from '@tanstack/react-router';
import { Icon } from '../../icons.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { StatusBadge, type StatusState } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { plainDuration } from '../../plain-duration.ts';
import { canRestore } from './job-actions.ts';
import { diagnosticsText, type RunReport } from './job-diagnostics.ts';
import type { RunStatus } from './job-runs.ts';
import { formatInstant, LastResult, NextRun, SchedulerNotice, TypeBadge, useNow } from './JobParts.tsx';
import { JobGuardExemption, JobNotifications } from './JobNotifications.tsx';
import { RunOutput } from './RunOutput.tsx';
import { ScriptSection } from './ScriptSection.tsx';
import { deleteJob, duplicateJob, pauseJob, restoreJob, resumeJob, runNow } from './schedules-actions.ts';
import { loadRunOutput, useJobRuns, useJobs, type RunEntry } from './schedules-data.ts';
import { relativeTime, schedulerStatus, type Job } from './schedules-model.ts';
import type { ActionOutcome } from '../profiles/profile-actions.ts';
import './work.css';

const RUN_BADGE: Record<RunStatus, StatusState> = { ok: 'succeeded', failed: 'failed', running: 'running', incomplete: 'stale' };

/** A run of the job: one line that opens to what the run produced. An agent's output is read from its session when it is first opened. */
function RunItem({ job, entry, now }: { job: Job; entry: RunEntry; now: number }) {
  const { run } = entry;
  const [loaded, setLoaded] = useState<{ output: string | undefined } | 'loading' | 'failed'>();
  const output = entry.output !== undefined ? { output: entry.output } : loaded;
  const open = (event: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (!event.currentTarget.open || entry.output !== undefined || loaded !== undefined) return;
    setLoaded('loading');
    loadRunOutput(job, run).then(
      (text) => setLoaded({ output: text }),
      () => setLoaded('failed'),
    );
  };
  return (
    <li>
      <details className="tool jrun" onToggle={open}>
        <summary>
          <Icon name="chev-r" small className="chev" />
          <StatusBadge state={RUN_BADGE[run.status]} label={run.statusLabel} variant="plain" />
          <time className="jrun__at" dateTime={new Date(run.startedAt).toISOString()} title={formatInstant(run.startedAt)}>
            {relativeTime(run.startedAt, now)}
          </time>
          <span className="jrun__meta mono">{run.durationMs === undefined ? '' : plainDuration(run.durationMs / 1000)}</span>
        </summary>
        <div className="tool__body jrun__body">
          <p className="jrun__id mono subtle">{run.id}</p>
          {output === 'loading' && <p role="status">Reading the output…</p>}
          {output === 'failed' && <p className="error-text">Hermes did not give this run’s output. Try opening it again later.</p>}
          {typeof output === 'object' && (output.output === undefined || output.output.trim() === '' ? <p className="subtle">This run left no output.</p> : <RunOutput text={output.output} truncated={entry.truncated} />)}
        </div>
      </details>
    </li>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);
const names = (value: unknown): string | undefined => (Array.isArray(value) && value.length > 0 ? value.filter((item) => typeof item === 'string').join(', ') : undefined);

/** The settings of the job, as Hermes holds them. A setting the job does not have is not listed. */
function Settings({ job, now }: { job: Job; now: number }) {
  const config = job.config;
  const repeat = config.repeat as { times?: number | null; completed?: number } | undefined;
  const prompt = text(config.prompt);
  const rows: [string, ReactNode][] = [
    ['Type', <TypeBadge key="type" type={job.type} />],
    ['Profile', job.profile],
    ['Schedule', <>{job.schedule}{job.scheduleExpression && <span className="mono subtle"> · {job.scheduleExpression}</span>}</>],
    ['Next run', <NextRun key="next" job={job} now={now} />],
    ['Last result', <LastResult key="last" job={job} now={now} />],
  ];
  const add = (label: string, value: ReactNode | undefined) => value !== undefined && rows.push([label, value]);
  if (job.lastRunAt !== undefined) add('Last run', formatInstant(job.lastRunAt));
  add('Last error', job.lastError && <span className="jd__error">{job.lastError}</span>);
  add('Paused because', text(config.paused_reason));
  add('Script', text(config.script) && <><span className="mono">{text(config.script)}</span> <span className="subtle">{config.no_agent === true ? '(runs without an agent: its output is the result)' : '(its output goes to the agent as context)'}</span></>);
  add('Deliver to', text(config.deliver));
  add('Failures go to', text(config.failure_deliver));
  add('Attach to session', typeof config.attach_to_session === 'boolean' ? (config.attach_to_session ? 'Each run is attached' : 'Never attached') : undefined);
  add('Model', text(config.model) && `${text(config.model)}${text(config.provider) ? ` (${text(config.provider)})` : ''}`);
  add('Skills', names(config.skills));
  add('Toolsets', names(config.enabled_toolsets));
  add('Working folder', text(config.workdir) && <span className="mono">{text(config.workdir)}</span>);
  add('Context from', names(config.context_from));
  add('Monitor', text(config.monitor_script) ?? text(config.monitor_url));
  add('Runs so far', typeof repeat?.completed === 'number' ? `${repeat.completed}${typeof repeat.times === 'number' ? ` of ${repeat.times}` : ''}` : undefined);
  return (
    <section className="jd__def" aria-labelledby="jd-settings">
      <h2 id="jd-settings">Settings</h2>
      <dl className="kv">
        {rows.map(([label, value]) => (
          <Row key={label} label={label}>
            {value}
          </Row>
        ))}
      </dl>
      {prompt && (
        <>
          <h3>Prompt</h3>
          <pre className="jd__prompt log">{prompt}</pre>
        </>
      )}
    </section>
  );
}

export function Schedule() {
  const { jobId = '' } = useParams({ strict: false }) as { jobId?: string };
  const navigate = useAppNavigate();
  const now = useNow();
  const { jobs, failed, reload } = useJobs();
  const job = jobs?.find((candidate) => candidate.id === jobId);
  const { runs, failed: runsFailed } = useJobRuns(job, job?.lastRunAt);
  const scheduler = useMemo(() => (jobs ? schedulerStatus(jobs) : undefined), [jobs]);
  const [busy, setBusy] = useState<string>();

  /** Runs an action: the owner may decline, Hermes may refuse; what is left is `done`. */
  const act = async <Body,>(name: string, what: () => Promise<ActionOutcome<Body>>): Promise<Body | undefined> => {
    setBusy(name);
    try {
      const outcome = await what();
      if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
      return outcome.kind === 'done' ? outcome.body : undefined;
    } finally {
      setBusy(undefined);
    }
  };

  const run = async (target: Job) => {
    const body = await act('run', () => runNow(target));
    if (body === undefined) return;
    await reload();
    const result = (body as { last_status?: unknown; last_error?: unknown }) ?? {};
    if (result.last_status === 'error') toast(`“${target.name}” ran and failed`, { tone: 'danger', detail: typeof result.last_error === 'string' ? result.last_error.slice(0, 160) : undefined });
    else toast(`“${target.name}” ran`, { tone: 'success' });
  };

  const toggle = async (target: Job) => {
    const resuming = !target.enabled;
    if ((await act(resuming ? 'resume' : 'pause', () => (resuming ? resumeJob(target) : pauseJob(target)))) === undefined) return;
    await reload();
    toast(resuming ? `Resumed “${target.name}”` : `Paused “${target.name}”`, { tone: 'info' });
  };

  const duplicate = async (target: Job) => {
    const copy = await act('duplicate', () => duplicateJob(target));
    if (copy?.id === undefined) return;
    await reload();
    toast(`Made “${copy.name ?? target.name}”, paused`, { tone: 'success', detail: 'Switch it on when it is ready.' });
    void navigate(`/work/schedules/${encodeURIComponent(copy.id)}`);
  };

  const remove = async (target: Job) => {
    if ((await act('delete', () => deleteJob(target))) === undefined) return;
    void navigate('/work/schedules', { replace: true });
    await reload();
    if (canRestore(target)) {
      toast(`Deleted “${target.name}”`, {
        undo: () =>
          void restoreJob(target).then(async (outcome) => {
            if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
            else if (outcome.kind === 'done') {
              toast(`Put “${target.name}” back`, { tone: 'success', detail: 'It is a new job, without its past runs.' });
              await reload();
            }
          }),
      });
    } else {
      toast(`Deleted “${target.name}”`, { tone: 'info', detail: 'This cannot be undone.' });
    }
  };

  const copyDiagnostics = async (target: Job) => {
    setBusy('diagnostics');
    try {
      // The latest runs, with what each produced: a script's are already read; an agent's are read from their sessions now.
      const latest = (runs ?? []).slice(0, 3);
      const reports: RunReport[] = await Promise.all(
        latest.map(async (entry): Promise<RunReport> => ({ run: entry.run, output: entry.output ?? (await loadRunOutput(target, entry.run).catch(() => undefined)) })),
      );
      const bundle = diagnosticsText({ job: target, runs: reports, scheduler: schedulerStatus(jobs ?? [target]), now: Date.now() });
      try {
        await navigator.clipboard.writeText(bundle);
        toast('Copied the diagnostics', { tone: 'success', detail: 'Keys, tokens and passwords are hidden.' });
      } catch {
        toast('This browser would not copy. Allow clipboard access and try again.', { tone: 'warning' });
      }
    } finally {
      setBusy(undefined);
    }
  };

  const gone = jobs !== undefined && job === undefined;
  return (
    <div className="bpage sched jd">
      <PageHeader
        overline={jobId}
        overlineAsIs
        title={job?.name ?? (gone ? 'Schedule not found' : 'Schedule')}
        actions={
          <AppLink className="btn btn--secondary" to="/work/schedules">
            <Icon name="calendar" />
            All schedules
          </AppLink>
        }
      />
      {!job && !gone && !failed && <p role="status">Loading the schedule…</p>}
      {failed && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer, so this page may be out of date. Caduceus tries again by itself.</span>
        </div>
      )}
      {gone && (
        <div className="empty">
          <Icon name="calendar" />
          <h2>This schedule is gone</h2>
          <p>It was deleted, perhaps on another device or from the command line. The list shows what is left.</p>
          <AppLink className="btn btn--primary" to="/work/schedules">
            Show every schedule
          </AppLink>
        </div>
      )}
      {job && (
        <>
          <p className="help-text">
            A <Term id="schedule">schedule</Term> of the <strong>{job.profile}</strong> profile. {job.schedule}. {job.enabled ? '' : 'It is paused, so it does not run.'}
          </p>
          <SchedulerNotice status={scheduler} />
          <div className="jd__acts" role="group" aria-label="Actions">
            <WriteButton type="button" className="btn btn--primary" disabled={busy !== undefined} aria-busy={busy === 'run'} onClick={() => void run(job)}>
              <Icon name="play" />
              {busy === 'run' ? 'Running…' : 'Run now'}
            </WriteButton>
            {job.type !== 'script' && (
              <AppLink className="btn btn--secondary" to={`/work/schedules/${encodeURIComponent(job.id)}/edit`}>
                <Icon name="sliders" />
                Edit
              </AppLink>
            )}
            <WriteButton type="button" className="btn btn--secondary" disabled={busy !== undefined} onClick={() => void toggle(job)}>
              <Icon name={job.enabled ? 'paused' : 'play'} />
              {busy === 'pause' ? 'Pausing…' : busy === 'resume' ? 'Resuming…' : job.enabled ? 'Pause' : 'Resume'}
            </WriteButton>
            <WriteButton type="button" className="btn btn--secondary" disabled={busy !== undefined} onClick={() => void duplicate(job)}>
              <Icon name="copy" />
              Duplicate
            </WriteButton>
            <button type="button" className="btn btn--secondary" disabled={busy !== undefined} aria-busy={busy === 'diagnostics'} onClick={() => void copyDiagnostics(job)}>
              <Icon name="clip" />
              Copy diagnostics
            </button>
            <WriteButton type="button" className="btn btn--danger-quiet" disabled={busy !== undefined} onClick={() => void remove(job)}>
              <Icon name="trash" />
              Delete
            </WriteButton>
          </div>
          <div className="jd__grid">
            <Settings job={job} now={now} />
            <JobNotifications profile={job.profile} id={job.id} />
            <JobGuardExemption profile={job.profile} id={job.id} />
            {job.type === 'script' && <ScriptSection job={job} />}
            <section className="jd__runs" aria-labelledby="jd-runs">
              <h2 id="jd-runs">Run history</h2>
              {runsFailed && <p className="error-text">Hermes did not give the runs{runs ? ', so these may be out of date' : ''}.</p>}
              {runs === undefined && !runsFailed && <p role="status">Loading the runs…</p>}
              {runs?.length === 0 && <p className="subtle">This job has not run yet. Run now makes the first run.</p>}
              {runs && runs.length > 0 && (
                <ul className="jruns">
                  {runs.map((entry) => (
                    <RunItem key={entry.run.id} job={job} entry={entry} now={now} />
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
