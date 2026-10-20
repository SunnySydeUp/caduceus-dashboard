import { Icon } from '../../icons.tsx';
import { Layer } from '../../overlays/Layer.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { Term } from '../../shell/Term.tsx';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { useTaskPeek } from './board-data.ts';
import { BLOCK_META, BOARD_STATUSES, STATUS_META, briefExcerpt, outcomeLabel, priorityLabel, type BoardStatus, type TaskPeek as TaskPeekData } from './board-model.ts';

/** How much of the brief the peek shows; the task page has all of it. */
const EXCERPT_CHARS = 600;

const when = (seconds: number) => new Date(seconds * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

const isBoardStatus = (status: string): status is BoardStatus => BOARD_STATUSES.some((known) => known === status);

/** Where a task's page is; the board goes along when the URL named one. */
export const taskHref = (taskId: string, board: string | undefined) => `/work/tasks/${encodeURIComponent(taskId)}${board ? `?board=${encodeURIComponent(board)}` : ''}`;

/** The facts of a task a reader needs before opening it: status, who has it, the start of its brief and how its latest run ended. Read-only. */
export function TaskFacts({ peek, excerpt }: { peek: TaskPeekData; excerpt: boolean }) {
  // In the peek the sheet's own title is the `h2` above; on the task page the page title is the `h1`.
  const Heading = excerpt ? 'h3' : 'h2';
  const brief = excerpt ? briefExcerpt(peek.brief, EXCERPT_CHARS) : { text: peek.brief.trim(), cut: false };
  const priority = priorityLabel(peek.priority);
  const run = peek.latestRun;
  return (
    <div className="peek">
      <dl className="peek__facts">
        <div>
          <dt>Status</dt>
          <dd>
            <span className="tag" data-tone={peek.status === 'done' ? 'success' : peek.status === 'running' ? 'running' : peek.status === 'blocked' ? 'warning' : undefined}>
              {isBoardStatus(peek.status) ? STATUS_META[peek.status].label : peek.status}
            </span>
            {peek.blockKind && <span className="subtle"> · {BLOCK_META[peek.blockKind].label}</span>}
          </dd>
        </div>
        <div>
          <dt>Assignee</dt>
          <dd>
            {peek.assignee ? (
              <span className="ptag">
                <Sigil name={peek.assignee} size="xs" />
                <span className="ptag__name">{peek.assignee}</span>
              </span>
            ) : (
              <span className="subtle">Unassigned</span>
            )}
          </dd>
        </div>
        {priority && (
          <div>
            <dt>Priority</dt>
            <dd>{priority}</dd>
          </div>
        )}
        <div>
          <dt>Task</dt>
          <dd className="mono">{peek.id}</dd>
        </div>
      </dl>

      <section aria-labelledby="peek-brief">
        <Heading id="peek-brief" className="overline">
          Brief
        </Heading>
        {brief.text ? (
          <p className="peek__brief">
            {brief.text}
            {brief.cut && '…'}
          </p>
        ) : (
          <p className="subtle">This task has no brief.</p>
        )}
      </section>

      <section aria-labelledby="peek-run">
        <Heading id="peek-run" className="overline">
          Latest run
        </Heading>
        <p className="subtle">
          The newest attempt by a worker, called a <Term id="kanban-run">run</Term>.
        </p>
        {run ? (
          <div className="peek__run">
            <p>
              <strong>{outcomeLabel(run)}</strong>
              {run.profile && <span className="subtle"> · {run.profile}</span>}
              <span className="subtle"> · {when(run.endedAt ?? run.startedAt)}</span>
              {peek.runCount > 1 && <span className="subtle"> · attempt {peek.runCount}</span>}
            </p>
            {run.summary && <p className="peek__brief">{run.summary}</p>}
            {run.error && <p className="peek__error mono">{run.error}</p>}
          </div>
        ) : (
          <p className="subtle">No worker has run this task yet.</p>
        )}
      </section>
    </div>
  );
}

function PeekBody({ taskId, slug }: { taskId: string; slug: string | undefined }) {
  const { phase, peek } = useTaskPeek(taskId, slug);
  if (phase === 'loading') return <p role="status">Loading the task…</p>;
  if (!peek) {
    return (
      <div className="banner" data-tone="danger" role="alert">
        <Icon name="alert" />
        <span className="banner__content">Hermes did not give this task. It may have been deleted, or Hermes may be restarting.</span>
      </div>
    );
  }
  return (
    <>
      <h3 className="peek__title">{peek.title}</h3>
      <TaskFacts peek={peek} excerpt />
      <div className="peek__actions">
        <AppLink className="btn btn--primary" to={taskHref(peek.id, slug)}>
          Open task
          <Icon name="arrow-r" />
        </AppLink>
      </div>
    </>
  );
}

/** The peek at a card: a sheet on a phone, a side panel on larger windows. Read-only, with a link to the task. */
export function TaskPeekPanel({ taskId, slug, onClose }: { taskId: string; slug: string | undefined; onClose(): void }) {
  const compact = useSizeClass() === 'compact';
  if (compact) {
    return (
      <Sheet title="Task" detents={['auto', 'full']} onClose={onClose}>
        <PeekBody taskId={taskId} slug={slug} />
      </Sheet>
    );
  }
  return (
    <Layer kind="drawer" panelClassName="drawer drawer--end" label="Task" initialFocus="[data-close]" onClose={onClose}>
      <header className="overlay__head">
        <h2>Task</h2>
        <button type="button" className="btn btn--ghost btn--icon" aria-label="Close the task" onClick={onClose} data-close>
          <Icon name="x" />
        </button>
      </header>
      <div className="overlay__body drawer__body" data-body>
        <PeekBody taskId={taskId} slug={slug} />
      </div>
    </Layer>
  );
}
