// Work › Playbooks › one run (`/work/playbooks/:playbookId/runs/:rootTaskId?board=`; M6 #02, #03, #04): where the run stands, and its path as a vertical
// timeline: every stage attempt oldest first (status, how it ended and the note that went with it, profile, when, a link to its task), then the stages
// that have not started, in the definition's order. A stage waiting at a gate says so and points to Today, where the owner decides it. “Re-run from
// this stage” starts a new attempt (Tier 1). The run is the Kanban tasks that carry its tag, read from Hermes by the server each time; the page reads it
// again when any task of its board changes, and the reload button does the same on demand. Timeline, Compact (one line for each attempt) and Raw (the tasks
// as Hermes holds them) are three views of the same path; from 1024 px up the stages can also be drawn as a graph with each stage's live status.
import { useId, useState, type KeyboardEvent } from 'react';
import { useParams, useSearch } from '@tanstack/react-router';
import type { TimelineEntry } from '@caduceus/contracts/playbook-runs';
import { Icon } from '../../icons.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { PlaybookGraphView } from './PlaybookGraphView.tsx';
import { rerunStage, useRun } from './playbook-run-data.ts';
import { playbookPath } from './playbook-model.ts';
import { latestAttemptIds, RUN_STATE, runPathOf, STOPPED_TEXT, stagesText, startedText, taskStatusChip, VERDICT_CHIP, waitingAtGate } from './playbook-runs-model.ts';
import { CompactView, RawView } from './RunViews.tsx';
import { ageLabel } from './tasks-model.ts';
import { useWide } from './use-wide.ts';
import './runs.css';
import './work.css';

const nonBlank = (value: unknown): string | undefined => (typeof value === 'string' && value.trim() !== '' ? value : undefined);

function Step({ entry, board, now, waiting, rerun }: { entry: TimelineEntry; board: string; now: number; waiting: boolean; rerun?: { busy: boolean; onClick(): void } }) {
  const chip = taskStatusChip(entry.status);
  const verdict = entry.verdict === undefined ? undefined : VERDICT_CHIP[entry.verdict];
  const finished = entry.completedAt === null ? undefined : ageLabel(entry.completedAt, now);
  return (
    <li className="run__step" data-tone={chip.tone}>
      <div className="run__head">
        <h3 className="run__title">{entry.title}</h3>
        {entry.attempt > 1 && <span className="tag">Attempt {entry.attempt}</span>}
        {verdict && (
          <span className="tag" data-tone={verdict.tone}>
            {verdict.label}
          </span>
        )}
        <span className="tag" data-tone={chip.tone}>
          {chip.label}
        </span>
      </div>
      {entry.note !== undefined && (
        <p className="run__note">
          <span className="run__note-label">{verdict?.noteLabel ?? 'Note'}</span>
          {entry.note}
        </p>
      )}
      {waiting && (
        <p className="run__wait">
          <StatusBadge state="waiting" label="Waiting for you" />
          <AppLink className="run__link" to="/today">
            Decide it on Today
          </AppLink>
        </p>
      )}
      <div className="run__facts">
        <span>{entry.assignee ?? 'Unassigned'}</span>
        {startedText(entry.createdAt, now) && <span>{startedText(entry.createdAt, now)}</span>}
        {finished && <span>{finished === 'just now' ? 'finished just now' : `finished ${finished} ago`}</span>}
        <AppLink className="run__link" to={`/work/tasks/${encodeURIComponent(entry.taskId)}?board=${encodeURIComponent(board)}`}>
          Open the task
          <span className="sr-only">: {entry.title}</span>
        </AppLink>
        {rerun && (
          <button type="button" className="btn btn--secondary btn--sm" disabled={rerun.busy} onClick={rerun.onClick}>
            <Icon name="refresh" />
            Re-run from this stage
            <span className="sr-only">: {entry.title}</span>
          </button>
        )}
      </div>
    </li>
  );
}

const VIEWS = ['timeline', 'compact', 'raw'] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = { timeline: 'Timeline', compact: 'Compact', raw: 'Raw' };

export function RunPage() {
  const { playbookId = '', rootTaskId = '' } = useParams({ strict: false }) as { playbookId?: string; rootTaskId?: string };
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const board = nonBlank(search.board) ?? 'default';
  const state = useRun(rootTaskId, board);
  const [rerunning, setRerunning] = useState(false);
  const [view, setView] = useState<View>('timeline');
  const [graph, setGraph] = useState(false);
  const wide = useWide();
  const navigate = useAppNavigate();
  const id = useId();

  if (state.status !== 'ready') {
    return (
      <div className="bpage run">
        <PageHeader overline="Work › Playbooks" title="Playbook run" />
        {state.status === 'loading' && <p role="status">Loading the run…</p>}
        {state.status === 'failed' && (
          <div className="banner" data-tone="danger" role="alert">
            <Icon name="alert" />
            <span className="banner__content">The run could not be read: {state.error}</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={state.reload}>
              Try again
            </button>
          </div>
        )}
        {state.status === 'missing' && (
          <div className="empty">
            <Icon name="playbook" />
            <h2>This run was not found</h2>
            <p>No task on the {board === 'default' ? '' : `“${board}” `}board starts it. The run may be on another board, or its tasks were deleted.</p>
            <AppLink className="btn btn--primary" to={playbookId ? playbookPath(playbookId) : '/work/playbooks'}>
              {playbookId ? 'Back to the playbook' : 'Back to Playbooks'}
            </AppLink>
          </div>
        )}
      </div>
    );
  }

  const { run } = state;
  const now = Date.now() / 1000;
  const { attempts, pending } = runPathOf(run);
  const latest = latestAttemptIds(attempts);
  const inputs = run.definition.inputs.filter((input) => (run.inputs[input.key] ?? '') !== '');
  const status = RUN_STATE[run.state];
  const rerunFrom = async (entry: TimelineEntry) => {
    setRerunning(true);
    try {
      const outcome = await rerunStage(run, { key: entry.stage, title: entry.title });
      if (outcome.kind === 'started') {
        toast(`Started attempt ${outcome.attempt} of ${entry.title}`, { tone: 'success' });
        state.reload();
      } else if (outcome.kind === 'problems') toast(outcome.problems.join(' ') || 'Caduceus did not re-run the stage.', { tone: 'danger' });
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Caduceus did not re-run the stage.', { tone: 'danger' });
    } finally {
      setRerunning(false);
    }
  };

  // The graph is offered from 1024 px up; below that nothing of it is rendered. A run always has stages to draw.
  const graphOffered = wide && run.definition.stages.length > 1;
  const showGraph = graphOffered && graph;
  const onViewKeys = (event: KeyboardEvent) => {
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? VIEWS.length - 1 : step === 0 ? undefined : (VIEWS.indexOf(view) + step + VIEWS.length) % VIEWS.length;
    if (next === undefined) return;
    event.preventDefault();
    setView(VIEWS[next]);
    document.getElementById(`${id}-tab-${VIEWS[next]}`)?.focus();
  };

  return (
    <div className="bpage run" data-graph={showGraph ? '' : undefined}>
      <PageHeader
        overline="Work › Playbooks"
        title={run.title}
        subtitle={
          <span className="run__sub">
            <AppLink className="run__link" to={`${playbookPath(run.playbook.id)}?version=${run.playbook.version}`}>
              {run.playbook.name} v{run.playbook.version}
            </AppLink>
            <StatusBadge state={status.badge} label={status.label} />
            <span>{stagesText(run.stagesDone, run.stagesTotal)}</span>
          </span>
        }
        actions={
          <button type="button" className="btn btn--secondary" onClick={state.reload}>
            <Icon name="refresh" />
            Reload
          </button>
        }
      />
      {run.state === 'failed' && (
        <div className="banner" data-tone="danger" role="status">
          <Icon name="alert" />
          <span className="banner__content">{STOPPED_TEXT}</span>
          <AppLink className="btn btn--secondary btn--sm" to="/notices">
            Open Notices
          </AppLink>
        </div>
      )}
      <p className="help-text">
        A <Term id="playbook-run">playbook run</Term> is a plan being carried out: each <Term id="stage">stage</Term> is a Kanban task, made by the <Term id="playbook-engine">playbook engine</Term> when the stage before it ends. Each time a stage is tried is an <Term id="attempt">attempt</Term>, and how it ended is its <Term id="verdict">verdict</Term>. This page follows it live.
      </p>

      <section className="sb__section" aria-labelledby="run-path">
        <div className="run__bar">
          <h2 id="run-path" className="sr-only">
            Stages
          </h2>
          <div role="tablist" aria-label="Run views" className="seg run__views" onKeyDown={onViewKeys}>
            {VIEWS.map((name) => (
              <button key={name} type="button" role="tab" id={`${id}-tab-${name}`} aria-selected={view === name} aria-controls={`${id}-panel`} tabIndex={view === name ? 0 : -1} onClick={() => setView(name)}>
                {VIEW_LABEL[name]}
              </button>
            ))}
          </div>
          {graphOffered && (
            <div role="group" aria-label="Show the stages as" className="seg">
              <button type="button" aria-pressed={!graph} onClick={() => setGraph(false)}>
                List
              </button>
              <button type="button" aria-pressed={graph} onClick={() => setGraph(true)}>
                Graph
              </button>
            </div>
          )}
        </div>
        {showGraph && (
          <div className="run__graph">
            <div className="run__bar">
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setGraph(false)}>
                View as list
              </button>
            </div>
            <PlaybookGraphView
              playbook={run.definition}
              run={run}
              opens="task"
              onOpen={(_, taskId) => taskId !== undefined && void navigate(`/work/tasks/${encodeURIComponent(taskId)}?board=${encodeURIComponent(run.board)}`)}
            />
          </div>
        )}
        <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${view}`} className="run__panel">
          {view === 'timeline' && (
            <ol className="run__timeline">
              {attempts.map((entry) => (
                <Step
                  key={entry.taskId}
                  entry={entry}
                  board={run.board}
                  now={now}
                  waiting={waitingAtGate(entry, run.definition)}
                  rerun={latest.has(entry.taskId) ? { busy: rerunning, onClick: () => void rerunFrom(entry) } : undefined}
                />
              ))}
              {pending.map((stage) => (
                <li key={stage.stage} className="run__step" data-pending>
                  <div className="run__head">
                    <h3 className="run__title">{stage.title}</h3>
                    <span className="tag">Not started</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
          {view === 'compact' && <CompactView attempts={attempts} pending={pending} board={run.board} />}
          {view === 'raw' && <RawView run={run} />}
        </div>
      </section>

      {inputs.length > 0 && (
        <details className="run__inputs">
          <summary>Answers this run was started with</summary>
          <dl className="run__answers">
            {inputs.map((input) => (
              <div key={input.key}>
                <dt>{input.label}</dt>
                <dd>{run.inputs[input.key]}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </div>
  );
}
