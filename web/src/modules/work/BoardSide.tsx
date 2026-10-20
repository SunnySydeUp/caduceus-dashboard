// The board's side panel: what Hermes says is wrong (diagnostics), the counts it keeps (by status and by profile) and the workers running now, with
// Reclaim for a stuck one. A sheet on a phone and a drawer elsewhere. Everything is read from Hermes and follows the board as it changes.
import { Icon } from '../../icons.tsx';
import { Layer } from '../../overlays/Layer.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { Term } from '../../shell/Term.tsx';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { plainDuration } from '../../plain-duration.ts';
import { reclaimTask } from './board-actions.ts';
import { BOARD_STATUSES, STATUS_META, type BoardStatus } from './board-model.ts';
import type { SideState } from './board-ops-data.ts';
import { taskHref } from './TaskPeek.tsx';
import './board-ops.css';

const SEVERITY_TONE = { warning: 'warning', error: 'danger', critical: 'danger' } as const;

const isStatus = (status: string): status is BoardStatus => BOARD_STATUSES.some((known) => known === status);

function SideBody({ state, slug, now }: { state: SideState; slug: string | undefined; now: number }) {
  const { side } = state;
  if (!side) return <p role={state.phase === 'failed' ? 'alert' : 'status'}>{state.phase === 'failed' ? 'Hermes did not give the board’s details. Caduceus tries again when the board changes.' : 'Reading the board’s details…'}</p>;
  const total = Object.values(side.byStatus).reduce((sum, n) => sum + n, 0);
  return (
    <div className="bo-side">
      {state.phase === 'failed' && (
        <p className="subtle" role="status">
          Hermes did not answer just now, so this may be out of date.
        </p>
      )}
      <section aria-labelledby="bo-side-diag">
        <h3 id="bo-side-diag" className="overline">
          Diagnostics ({side.problemCount})
        </h3>
        {side.problems.length === 0 ? (
          <p className="subtle">Hermes sees nothing wrong with the tasks on this board.</p>
        ) : (
          <ul className="bo-problems">
            {side.problems.map((task) => (
              <li key={task.taskId} className="bo-problem">
                <p className="bo-problem__head">
                  <AppLink to={taskHref(task.taskId, slug)}>{task.title}</AppLink>
                  <span className="subtle">
                    {' '}
                    · {isStatus(task.status) ? STATUS_META[task.status].label : task.status}
                    {task.assignee ? ` · ${task.assignee}` : ''}
                  </span>
                </p>
                {task.problems.map((problem) => (
                  <p key={`${problem.kind}-${problem.title}`} className="bo-problem__item">
                    <span className="tag" data-tone={SEVERITY_TONE[problem.severity]}>
                      {problem.severity}
                    </span>{' '}
                    <strong>{problem.title}</strong>
                    {problem.detail && <span className="subtle"> {problem.detail}</span>}
                  </p>
                ))}
                {task.canReclaim && task.status === 'running' && (
                  <WriteButton type="button" className="btn btn--secondary btn--sm" data-reclaim={task.taskId} onClick={() => void reclaimTask({ id: task.taskId, title: task.title, assignee: task.assignee }, slug)}>
                    <Icon name="refresh" />
                    <span className="sr-only">Reclaim {task.title}</span>
                    <span aria-hidden="true">Reclaim</span>
                  </WriteButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="bo-side-workers">
        <h3 id="bo-side-workers" className="overline">
          Active workers ({side.workers.length})
        </h3>
        <p className="subtle bo-fine">
          A worker is a Hermes process running a task. <Term id="reclaim">Reclaim</Term> stops one that is stuck and returns its task to Ready.
        </p>
        {side.workers.length === 0 ? (
          <p className="subtle">No worker is running on this board.</p>
        ) : (
          <ul className="bo-problems">
            {side.workers.map((worker) => (
              <li key={worker.runId} className="bo-problem" data-run={worker.runId}>
                <p className="bo-problem__head">
                  <AppLink to={taskHref(worker.taskId, slug)}>{worker.title}</AppLink>
                </p>
                <p className="subtle bo-fine">
                  {worker.profile ?? 'No profile'}
                  {worker.startedAt !== null && ` · started ${plainDuration(Math.max(0, now - worker.startedAt))} ago`}
                  {worker.lastHeartbeatAt !== null && ` · last sign of life ${plainDuration(Math.max(0, now - worker.lastHeartbeatAt))} ago`}
                </p>
                <WriteButton type="button" className="btn btn--secondary btn--sm" data-reclaim={worker.taskId} onClick={() => void reclaimTask({ id: worker.taskId, title: worker.title, assignee: worker.profile }, slug)}>
                  <Icon name="refresh" />
                  <span className="sr-only">Reclaim {worker.title}</span>
                  <span aria-hidden="true">Reclaim</span>
                </WriteButton>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="bo-side-stats">
        <h3 id="bo-side-stats" className="overline">
          Stats ({total} {total === 1 ? 'task' : 'tasks'})
        </h3>
        <p className="subtle bo-fine">By status</p>
        <ul className="bo-chips" aria-label="Tasks by status">
          {BOARD_STATUSES.filter((status) => (side.byStatus[status] ?? 0) > 0).map((status) => (
            <li key={status} className="tag">
              {STATUS_META[status].label} <span className="mono">{side.byStatus[status]}</span>
            </li>
          ))}
          {total === 0 && <li className="subtle">No tasks.</li>}
        </ul>
        {side.oldestReadySeconds !== null && <p className="subtle bo-fine">The oldest ready task has waited {plainDuration(side.oldestReadySeconds)}.</p>}
        <p className="subtle bo-fine">By profile</p>
        <ul className="bo-chips" aria-label="Tasks by profile">
          {side.byAssignee.map((row) => (
            <li key={row.name} className="tag" title={Object.entries(row.counts).map(([status, n]) => `${isStatus(status) ? STATUS_META[status].label : status} ${n}`).join(', ')}>
              <Sigil name={row.name} size="xs" /> {row.name} <span className="mono">{row.total}</span>
            </li>
          ))}
          {side.byAssignee.length === 0 && <li className="subtle">No task has a profile.</li>}
        </ul>
      </section>
    </div>
  );
}

/** The side panel, as a sheet on a phone and a drawer elsewhere. `now` is the time the page shows the ages against (seconds since the epoch). */
export function BoardSidePanel({ state, slug, now, onClose }: { state: SideState; slug: string | undefined; now: number; onClose(): void }) {
  const compact = useSizeClass() === 'compact';
  if (compact) {
    return (
      <Sheet title="Board details" detents={['half', 'full']} onClose={onClose}>
        <SideBody state={state} slug={slug} now={now} />
      </Sheet>
    );
  }
  return (
    <Layer kind="drawer" panelClassName="drawer drawer--end" label="Board details" initialFocus="[data-close]" onClose={onClose}>
      <header className="overlay__head">
        <h2>Board details</h2>
        <button type="button" className="btn btn--ghost btn--icon" aria-label="Close the board details" onClick={onClose} data-close>
          <Icon name="x" />
        </button>
      </header>
      <div className="overlay__body drawer__body" data-body>
        <SideBody state={state} slug={slug} now={now} />
      </div>
    </Layer>
  );
}
