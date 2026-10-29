// The task list: a sortable table on a wide container and the same rows restacked as cards on a narrow one (the stylesheet decides
// which, by the container's width). Only the rows near the screen are in the page (`rowWindow`, constant time), so 2,000 tasks cost
// no more than twenty. Every row has the same height, which the stylesheet fixes and this measures, so the rows that are not drawn
// are stood in for by two spacers of the right size. The page scrolls, not the list: the window follows `scroll` on the window.
import { useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { Icon } from '../../icons.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { blockReason, STATUS_META, priorityLabel, type BoardTask } from './board-model.ts';
import { ageLabel, lastRun, rowWindow, updatedAt, waitsForOwner, type RowWindow, type SortColumn, type SortSpec } from './tasks-model.ts';
import { playbookLabel, playbookOfTask, type PlaybookNames } from './task-playbook.ts';
import { taskHref } from './TaskPeek.tsx';

/** The columns, left to right, as the header and the sort menu name them. */
export const COLUMNS: { column: SortColumn; label: string; className: string }[] = [
  { column: 'title', label: 'Task', className: 'tt__main' },
  { column: 'status', label: 'Status', className: 'tt__status' },
  { column: 'assignee', label: 'Assignee', className: 'tt__asg' },
  { column: 'priority', label: 'Priority', className: 'tt__prio' },
  { column: 'project', label: 'Project', className: 'tt__proj' },
  { column: 'template', label: 'Playbook', className: 'tt__tpl' },
  { column: 'updated', label: 'Updated', className: 'tt__upd' },
  { column: 'outcome', label: 'Last run', className: 'tt__run' },
];

/** A row's height before the first one has been measured, and the rows drawn beyond the screen either way. */
const ESTIMATED_ROW = 64;
const OVERSCAN = 8;

const STATUS_TONE: Partial<Record<BoardTask['status'], string>> = { running: 'running', done: 'success', blocked: 'blocked', review: 'warning' };

/** The rows of `tasks` the page should draw now, following the page's own scroll. `body` is the table body the rows are drawn in. */
function useRowWindow(body: RefObject<HTMLElement | null>, count: number): { window: RowWindow; rowHeight: number } {
  const [rowHeight, setRowHeight] = useState(ESTIMATED_ROW);
  const [place, setPlace] = useState({ scrollTop: 0, viewport: 800 });

  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const top = element.getBoundingClientRect().top;
      const scrollTop = Math.max(0, -top);
      const viewport = window.innerHeight;
      setPlace((previous) => (previous.scrollTop === scrollTop && previous.viewport === viewport ? previous : { scrollTop, viewport }));
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [body]);

  // The first row, as it is: its height and the gap that follows it (a card has one) are the stride of every row.
  useLayoutEffect(() => {
    const row = body.current?.querySelector<HTMLElement>('.tt__row');
    if (!row) return;
    const stride = row.getBoundingClientRect().height + (Number.parseFloat(getComputedStyle(row).marginBlockEnd) || 0);
    if (stride > 0 && Math.abs(stride - rowHeight) > 0.5) setRowHeight(stride);
  });

  return { window: rowWindow({ count, rowHeight, scrollTop: place.scrollTop, viewport: place.viewport, overscan: OVERSCAN }), rowHeight };
}

function StatusCell({ task }: { task: BoardTask }) {
  const reason = blockReason(task)?.label;
  return (
    <>
      <span className="tag" data-tone={STATUS_TONE[task.status]}>
        {STATUS_META[task.status].label}
      </span>
      {reason && <span className="tt__reason subtle">{reason}</span>}
    </>
  );
}

export interface TaskRowProps {
  task: BoardTask;
  index: number;
  projects: Readonly<Record<string, string>>;
  /** The playbooks' names by id, for the playbook column; an id is shown when the name is not known. */
  playbooks?: PlaybookNames;
  board: string | undefined;
  /** Seconds since the epoch, for the age. */
  now: number;
  onOpen(task: BoardTask): void;
}

/** One task, as a table row and as a card. */
export function TaskRow({ task, index, projects, playbooks = {}, board, now, onOpen }: TaskRowProps) {
  const run = lastRun(task);
  const priority = priorityLabel(task.priority);
  const project = task.projectId === null ? undefined : (projects[task.projectId] ?? task.projectId);
  const playbook = playbookOfTask(task);
  const playbookText = playbook && `${playbookLabel(playbook.key, playbooks)}${playbook.stage === undefined ? '' : ` · ${playbook.stage}`}`;
  return (
    <tr className={`tt__row${waitsForOwner(task) ? ' is-attn' : ''}`} aria-rowindex={index + 2} onClick={(event) => !(event.target as HTMLElement).closest('a, button') && onOpen(task)}>
      <td className="tt__main">
        <AppLink className="tt__link" to={taskHref(task.id, board)} title={task.title}>
          {task.title}
        </AppLink>
        <div className="tt__sub">
          <span className="mono">{task.id}</span>
        </div>
      </td>
      <td className="tt__status">
        <StatusCell task={task} />
      </td>
      <td className="tt__asg">
        {task.assignee ? (
          <span className="ptag">
            <Sigil name={task.assignee} size="xs" />
            <span className="ptag__name">{task.assignee}</span>
          </span>
        ) : (
          <span className="ptag">
            <UnassignedSigil size="xs" />
            <span className="ptag__name subtle">Unassigned</span>
          </span>
        )}
      </td>
      <td className={`tt__prio${priority ? '' : ' is-normal'}`}>
        {priority ? (
          <span className="tag prio" data-tone={task.priority > 0 ? 'warning' : 'neutral'}>
            {priority}
          </span>
        ) : (
          <span className="subtle">
            <span aria-hidden="true">—</span>
            <span className="sr-only">Normal priority</span>
          </span>
        )}
      </td>
      <td className="tt__proj">{project ? <span className="truncate">{project}</span> : <span className="subtle">—</span>}</td>
      <td className="tt__tpl">{playbook ? <span className="tag truncate" title={playbookText}>{playbookText}</span> : <span className="subtle">—</span>}</td>
      <td className="tt__upd mono">{ageLabel(updatedAt(task), now)}</td>
      <td className="tt__run">
        <span className="tag" data-tone={run.tone === 'neutral' ? undefined : run.tone} title={run.detail}>
          {run.label}
        </span>
      </td>
    </tr>
  );
}

export interface TaskRowsProps extends Omit<TaskRowProps, 'task' | 'index'> {
  tasks: readonly BoardTask[];
  shown: RowWindow;
}

/** The rows of the window between two spacers that stand in for the rows left out. */
export function TaskRows({ tasks, shown, ...rest }: TaskRowsProps) {
  return (
    <>
      {shown.before > 0 && (
        <tr className="tt__spacer" aria-hidden="true">
          <td colSpan={COLUMNS.length} style={{ blockSize: shown.before }} />
        </tr>
      )}
      {tasks.slice(shown.start, shown.end).map((task, offset) => (
        <TaskRow key={task.id} task={task} index={shown.start + offset} {...rest} />
      ))}
      {shown.after > 0 && (
        <tr className="tt__spacer" aria-hidden="true">
          <td colSpan={COLUMNS.length} style={{ blockSize: shown.after }} />
        </tr>
      )}
    </>
  );
}

export function TaskTable({ tasks, sort, onSort, projects, playbooks, board, caption }: { tasks: readonly BoardTask[]; sort: SortSpec; onSort(column: SortColumn): void; projects: Readonly<Record<string, string>>; playbooks?: PlaybookNames; board: string | undefined; caption: string }) {
  const body = useRef<HTMLTableSectionElement>(null);
  const navigate = useAppNavigate();
  const { window: shown } = useRowWindow(body, tasks.length);
  const now = Math.floor(Date.now() / 1000);

  return (
    <table className="tt" aria-rowcount={tasks.length + 1}>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr aria-rowindex={1}>
          {COLUMNS.map(({ column, label, className }) => {
            const sorted = sort.column === column ? sort.direction : undefined;
            return (
              <th key={column} scope="col" className={className} aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}>
                <button type="button" className="tt__sort" onClick={() => onSort(column)}>
                  <span>{label}</span>
                  <Icon name={sorted === 'desc' ? 'chev-d' : sorted === 'asc' ? 'chev-u' : 'rows'} small />
                  <span className="sr-only">{sorted === 'asc' ? ', sorted ascending' : sorted === 'desc' ? ', sorted descending' : ', press to sort'}</span>
                </button>
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody ref={body}>
        <TaskRows tasks={tasks} shown={shown} projects={projects} playbooks={playbooks} board={board} now={now} onOpen={(task) => void navigate(taskHref(task.id, board))} />
      </tbody>
    </table>
  );
}
