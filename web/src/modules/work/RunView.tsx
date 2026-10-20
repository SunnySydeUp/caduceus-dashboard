import { useEffect, useRef, useState } from 'react';
import { useParams, useSearch } from '@tanstack/react-router';
import { Icon } from '../../icons.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { Term } from '../../shell/Term.tsx';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { useLiveTask } from './task-data.ts';
import { reclaim, retry, terminate } from './task-actions.ts';
import { chooseRunDensity, useRunDensity } from './run-density.ts';
import { useRun, useRunLog, useRunSession } from './run-data.ts';
import { chatHref, DENSITIES, runActions, runSummary, type RunActionId, type RunDensity, type RunInfo, type WorkerProcess } from './run-model.ts';
import { RunFacts, StepList, StepPanel, useWide, WorkerLog } from './RunParts.tsx';
import { report } from './TaskTabs.tsx';
import './work.css';

const DENSITY_LABEL: Record<RunDensity, string> = { stream: 'Stream', worklog: 'Worklog', raw: 'Raw' };

const ACTION_BUTTONS: Record<RunActionId, { label: string; icon: 'stop' | 'flag' | 'refresh' }> = {
  terminate: { label: 'Terminate run', icon: 'stop' },
  reclaim: { label: 'Reclaim', icon: 'flag' },
  retry: { label: 'Retry', icon: 'refresh' },
};

/** The most often the steps are read again for a log that keeps growing. */
const STEP_REFRESH_MS = 3000;

/** The run's worker log grew: tells the page to read the steps again, but not more than once in `STEP_REFRESH_MS`. */
function useThrottledBump(): [number, () => void] {
  const [count, setCount] = useState(0);
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const bump = () => {
    if (timer.current !== undefined) return;
    const wait = Math.max(0, STEP_REFRESH_MS - (Date.now() - last.current));
    timer.current = setTimeout(() => {
      timer.current = undefined;
      last.current = Date.now();
      setCount((n) => n + 1);
    }, wait);
  };
  return [count, bump];
}

/** One run: what it did, step by step, its worker's log while it goes, and the actions that stop or repeat it. */
function RunBody({ run, process, slug, onChanged }: { run: RunInfo; process: WorkerProcess | undefined; slug: string | undefined; onChanged(): void }) {
  const { state, reload } = useLiveTask(run.taskId, slug);
  const { detail } = state;
  const density = useRunDensity();
  const wide = useWide();
  const [activity, bump] = useThrottledBump();
  const session = useRunSession(run, activity);
  const log = useRunLog(run.id, slug, bump);
  const [open, setOpen] = useState<number>();
  const [working, setWorking] = useState<RunActionId>();
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const going = run.endedAt === null;
  useEffect(() => {
    if (!going) return;
    const timer = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [going]);
  // The task changed (a status change, an event of the run): the run is read again.
  const version = detail ? `${detail.latestEventId}:${detail.task.status}` : undefined;
  useEffect(() => {
    if (version !== undefined) onChanged();
    // `onChanged` is the page's reader; the change of version is what asks for it.
  }, [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const task = detail?.task;
  const row = detail?.runs.find((candidate) => candidate.id === run.id);
  const summary = runSummary(run, session.session, nowSeconds);
  const actions = task && detail ? runActions(task, run, detail.runs) : [];
  const step = session.steps.find((candidate) => candidate.key === open);
  const taskPath = `/work/tasks/${encodeURIComponent(run.taskId)}${slug ? `?board=${encodeURIComponent(slug)}` : ''}`;

  const act = async (action: RunActionId) => {
    if (!task || !row) return;
    setWorking(action);
    try {
      if (action === 'terminate' && report(await terminate(task, row, slug), `Run ${run.id} terminated`)) reload();
      else if (action === 'reclaim' && report(await reclaim(task, slug), 'Claim reclaimed')) reload();
      else if (action === 'retry' && report(await retry(task, slug), 'Back to Ready')) reload();
    } finally {
      setWorking(undefined);
    }
  };

  return (
    <div className="bpage rv">
      <PageHeader
        overline={`Run ${run.id}`}
        overlineAsIs
        title={task?.title ?? run.taskId}
        subtitle={
          <span className="td-head">
            <span className="tag" data-tone={summary.running ? 'running' : run.outcome === 'completed' ? 'success' : run.outcome === 'crashed' || run.outcome === 'timed_out' || run.outcome === 'spawn_failed' ? 'danger' : undefined}>
              {summary.label}
            </span>
            {run.profile ? (
              <span className="ptag">
                <Sigil name={run.profile} size="xs" />
                <span className="ptag__name">{run.profile}</span>
              </span>
            ) : (
              <span className="subtle">No profile</span>
            )}
            <span className="subtle" role="status">
              {state.live ? 'Live' : state.phase === 'ready' ? 'Reconnecting…' : ''}
            </span>
          </span>
        }
        actions={
          <>
            {session.session && (
              <AppLink className="btn btn--secondary" to={chatHref(session.session.id, session.session.profile ?? run.profile)}>
                <Icon name="chat" />
                Open in Chat
              </AppLink>
            )}
            <AppLink className="btn btn--secondary" to={taskPath}>
              <Icon name="work" />
              Back to the task
            </AppLink>
          </>
        }
      />
      <p className="help-text">
        One attempt at a task: a <Term id="kanban-run">run</Term>, its <Term id="run-step">steps</Term> and the <Term id="worker-log">worker log</Term>, read from Hermes. Nothing about runs or sessions is kept in Caduceus.
      </p>
      {state.phase === 'failed' && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not answer just now, so the task’s actions may be out of date. It tries again by itself.</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={reload}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      <RunFacts summary={summary} process={process} startedAt={run.startedAt} profile={run.profile} />
      {(run.summary || run.error) && (
        <div className="rv-outcome">
          {run.summary && <p className="td-run__summary">{run.summary}</p>}
          {run.error && <p className="td-run__error mono">{run.error}</p>}
        </div>
      )}
      <div className="rv-bar">
        {actions.length > 0 && (
          <div className="td-actions" role="group" aria-label="Run actions">
            {actions.map((action) => (
              <WriteButton key={action} type="button" className="btn btn--secondary" disabled={working !== undefined} aria-busy={working === action || undefined} onClick={() => void act(action)}>
                <Icon name={ACTION_BUTTONS[action].icon} />
                {ACTION_BUTTONS[action].label}
              </WriteButton>
            ))}
          </div>
        )}
        <div className="rv-density">
          <span id="rv-density-label" className="overline">
            Show
          </span>
          <RadioGroup
            labelledBy="rv-density-label"
            className="seg"
            value={density}
            onChange={chooseRunDensity}
            options={DENSITIES.map((value) => ({ value, label: DENSITY_LABEL[value] }))}
          />
        </div>
      </div>
      {summary.running && actions.length > 0 && (
        <p className="subtle td-hint">
          <Term id="terminate">Terminate</Term> stops this run’s worker; <Term id="reclaim">Reclaim</Term> releases its claim on the task.
        </p>
      )}
      <div className="rv-grid" data-open={step !== undefined && wide ? '' : undefined}>
        <div className="rv-main">
          <section aria-labelledby="rv-steps-title">
            <div className="rv-section-head">
              <h2 id="rv-steps-title" className="overline">
                Steps
              </h2>
              {session.steps.length > 0 && <span className="subtle">{session.steps.length}</span>}
            </div>
            {session.phase === 'looking' && (
              <p role="status" className="subtle">
                Looking for the worker’s session in Hermes…
              </p>
            )}
            {session.phase === 'none' && <p className="subtle">{summary.running ? 'The worker has not started its session yet. Its steps appear here when it does.' : 'Hermes has no session for this run: the worker never started one, or it was deleted. The worker log below still shows what it printed.'}</p>}
            {session.phase === 'failed' && (
              <p role="alert" className="td-run__error">
                Hermes did not give the worker’s session. Caduceus tries again when the log grows.
              </p>
            )}
            {session.phase === 'ready' && session.steps.length === 0 && <p className="subtle">The session has no worker turns yet.</p>}
            {session.steps.length > 0 && <StepList steps={session.steps} selected={open} onOpen={setOpen} />}
            {session.truncated && <p className="subtle">The transcript is longer than this page reads. Open it in Chat for the rest.</p>}
          </section>
          <WorkerLog log={log} density={density} runEnded={!going} />
        </div>
        {step && <StepPanel step={step} density={density} wide={wide} onClose={() => setOpen(undefined)} />}
      </div>
    </div>
  );
}

function Unavailable({ title, children }: { title: string; children: string }) {
  return (
    <div className="bpage">
      <PageHeader overline="Run" title={title} />
      <p role="status">{children}</p>
      <p>
        <AppLink className="btn btn--secondary" to="/work/board">
          <Icon name="work" />
          Back to the board
        </AppLink>
      </p>
    </div>
  );
}

/** Work › Run: one attempt at a task (`/work/runs/:runId`), live. */
export function RunView() {
  const { runId = '' } = useParams({ strict: false }) as { runId?: string };
  const { board } = useSearch({ strict: false }) as { board?: string };
  const slug = typeof board === 'string' ? board : undefined;
  const id = /^[1-9][0-9]{0,15}$/.test(runId) ? Number(runId) : undefined;
  if (id === undefined) return <Unavailable title="Run not found">That is not the number of a run.</Unavailable>;
  return <RunLoader key={`${slug ?? ''}/${id}`} id={id} slug={slug} />;
}

function RunLoader({ id, slug }: { id: number; slug: string | undefined }) {
  const [version, setVersion] = useState(0);
  const { run, phase, process, reload } = useRun(id, slug, version);
  if (!run) {
    if (phase === 'missing') return <Unavailable title="Run not found">Hermes has no run with this number. It may belong to another board, or be gone.</Unavailable>;
    if (phase === 'failed')
      return (
        <div className="bpage">
          <PageHeader overline={`Run ${id}`} overlineAsIs title="Run" />
          <div className="banner" data-tone="danger" role="alert">
            <Icon name="alert" />
            <span className="banner__content">Hermes did not give this run. It may be restarting.</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={reload}>
              <Icon name="refresh" />
              Retry
            </button>
          </div>
        </div>
      );
    return (
      <div className="bpage">
        <PageHeader overline={`Run ${id}`} overlineAsIs title="Run" />
        <p role="status">Loading the run…</p>
      </div>
    );
  }
  return <RunBody run={run} process={process} slug={slug} onChanged={() => setVersion((n) => n + 1)} />;
}
