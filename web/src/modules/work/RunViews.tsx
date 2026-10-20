// The run page's Compact and Raw views (M6 #04). Compact is one line for each stage attempt: the stage, which attempt, where its task is and how it ended.
// Raw is the Kanban tasks the run is made of, with the fields the engine reads (`idempotency_key`, `workflow_template_id`, `current_step_key`, status) and the
// links between them, so a run that looks wrong can be checked against what Hermes holds. Nothing here is kept: the Raw view reads Hermes each time.
import type { ReactNode } from 'react';
import type { RunDetail, TimelineEntry } from '@caduceus/contracts/playbook-runs';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { useRunRaw, type RawTask } from './playbook-run-data.ts';
import { taskStatusChip, VERDICT_CHIP, type PendingStage } from './playbook-runs-model.ts';

const taskPath = (id: string, board: string) => `/work/tasks/${encodeURIComponent(id)}?board=${encodeURIComponent(board)}`;

export function CompactView({ attempts, pending, board }: { attempts: readonly TimelineEntry[]; pending: readonly PendingStage[]; board: string }) {
  return (
    <ol className="run__compact">
      {attempts.map((entry) => {
        const chip = taskStatusChip(entry.status);
        const verdict = entry.verdict === undefined ? undefined : VERDICT_CHIP[entry.verdict];
        return (
          <li key={entry.taskId} className="run__line" data-tone={chip.tone}>
            <AppLink className="run__line-stage" to={taskPath(entry.taskId, board)}>
              {entry.title}
            </AppLink>
            <span className="run__line-attempt">Attempt {entry.attempt}</span>
            <span className="tag" data-tone={chip.tone}>
              {chip.label}
            </span>
            {verdict ? (
              <span className="tag" data-tone={verdict.tone}>
                {verdict.label}
              </span>
            ) : (
              <span className="subtle">No verdict yet</span>
            )}
          </li>
        );
      })}
      {pending.map((stage) => (
        <li key={stage.stage} className="run__line" data-pending>
          <span className="run__line-title">{stage.title}</span>
          <span className="tag">Not started</span>
        </li>
      ))}
    </ol>
  );
}

function Field({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="run__raw-row">
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}

const Value = ({ value }: { value: string | null }) => (value === null ? <span className="subtle">Not set</span> : <code>{value}</code>);

function Ids({ ids, board }: { ids: readonly string[] | undefined; board: string }) {
  if (ids === undefined) return <span className="subtle">Hermes did not answer for this task’s links.</span>;
  if (ids.length === 0) return <span className="subtle">None</span>;
  return (
    <ul className="run__ids">
      {ids.map((id) => (
        <li key={id}>
          <AppLink className="run__link" to={taskPath(id, board)}>
            <code>{id}</code>
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

function RawTaskItem({ task, board }: { task: RawTask; board: string }) {
  return (
    <li className="run__raw-task">
      <div className="run__head">
        <h3 className="run__title">
          <AppLink className="run__link" to={taskPath(task.id, board)}>
            <code>{task.id}</code>
          </AppLink>
        </h3>
        {task.stage !== undefined && task.attempt !== undefined && (
          <span className="tag">
            {task.stage} · attempt {task.attempt}
          </span>
        )}
        {!task.onBoard && <span className="tag">Not on the board</span>}
      </div>
      <dl className="run__raw-fields">
        <Field name="Title">{task.title}</Field>
        <Field name="Status">
          <code>{task.status}</code>
        </Field>
        <Field name="idempotency_key">
          <Value value={task.idempotencyKey} />
        </Field>
        <Field name="workflow_template_id">
          <Value value={task.workflowTemplateId} />
        </Field>
        <Field name="current_step_key">
          <Value value={task.currentStepKey} />
        </Field>
        <Field name="Parents">
          <Ids ids={task.links?.parents} board={board} />
        </Field>
        <Field name="Children">
          <Ids ids={task.links?.children} board={board} />
        </Field>
      </dl>
    </li>
  );
}

/** The run's tasks as Hermes holds them. Mounted only while the Raw view is open, so nothing is read before it is asked for. */
export function RawView({ run }: { run: Pick<RunDetail, 'root' | 'board' | 'timeline' | 'playbook'> }) {
  const raw = useRunRaw(run);
  if (raw.status === 'loading') return <p role="status">Reading the tasks from Hermes…</p>;
  if (raw.status === 'failed') {
    return (
      <div className="banner" data-tone="danger" role="alert">
        <Icon name="alert" />
        <span className="banner__content">The tasks could not be read: {raw.error}</span>
        <button type="button" className="btn btn--secondary btn--sm" onClick={raw.retry}>
          Try again
        </button>
      </div>
    );
  }
  return (
    <>
      <p className="subtle">The tasks this run is made of, as Hermes holds them. A task’s parents are the tasks it waits for; its children are the tasks that wait for it.</p>
      <ul className="run__raw">
        {raw.tasks.map((task) => (
          <RawTaskItem key={task.id} task={task} board={run.board} />
        ))}
      </ul>
    </>
  );
}
