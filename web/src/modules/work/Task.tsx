import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useParams, useSearch } from '@tanstack/react-router';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { Rich } from '../chat/Rich.tsx';
import { BLOCK_META, BOARD_STATUSES, STATUS_META, type BlockKind, type BoardStatus } from './board-model.ts';
import { decompose, estimate, reassign, reclaim, rejectSpecified, retry, runNow, specify, terminate } from './task-actions.ts';
import { loadAssignees, readTask, useLiveTask } from './task-data.ts';
import { availableActions, TASK_TABS, tabOf, type TaskActionId, type TaskDetail, type TaskFull } from './task-model.ts';
import { ActivityPanel, AttachmentsPanel, BriefPanel, LinksPanel, report, RunsPanel, SettingsPanel } from './TaskTabs.tsx';
import './work.css';

const isBoardStatus = (status: string): status is BoardStatus => BOARD_STATUSES.some((known) => known === status);
const isBlockKind = (kind: string | null): kind is BlockKind => kind !== null && kind in BLOCK_META;

const tabHref = (taskId: string, tab: string, slug: string | undefined) => `/work/tasks/${encodeURIComponent(taskId)}/${tab}${slug ? `?board=${encodeURIComponent(slug)}` : ''}`;

const ACTION_BUTTONS: Record<TaskActionId, { label: string; icon: 'play' | 'stop' | 'refresh' | 'bolt' | 'user' | 'flag' | 'git' | 'coin' }> = {
  'run-now': { label: 'Run now', icon: 'play' },
  terminate: { label: 'Terminate run', icon: 'stop' },
  retry: { label: 'Retry', icon: 'refresh' },
  specify: { label: 'Specify', icon: 'bolt' },
  decompose: { label: 'Decompose', icon: 'git' },
  estimate: { label: 'Estimate', icon: 'coin' },
  reassign: { label: 'Reassign', icon: 'user' },
  reclaim: { label: 'Reclaim', icon: 'flag' },
};

/** What an assist leaves for the owner to read before going on. */
type Assist =
  | { kind: 'reassign'; choices: string[] }
  | { kind: 'specify'; before: { title: string; brief: string; status: string }; after: TaskDetail }
  | { kind: 'decompose'; children: string[]; title: string | null }
  | { kind: 'estimate'; tokens: number; complexity: string | null; rationale: string | null; model: string | null };

function ReassignSheet({ task, choices, slug, onClose, onDone }: { task: TaskFull; choices: string[]; slug: string | undefined; onClose(): void; onDone(): void }) {
  const [profile, setProfile] = useState(task.assignee ?? '');
  const options = [...new Set([...(task.assignee ? [task.assignee] : []), ...choices])];
  const submit = async () => {
    onClose();
    if (report(await reassign(task, profile || null, slug), profile ? `Given to ${profile}` : 'Unassigned')) onDone();
  };
  return (
    <Sheet
      title="Reassign"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <WriteButton type="button" className="btn btn--primary" disabled={profile === (task.assignee ?? '')} onClick={() => void submit()}>
            Reassign
          </WriteButton>
        </>
      }
    >
      <div className="field">
        <label className="field__label" htmlFor="td-assignee">
          Profile
        </label>
        <select id="td-assignee" className="input" value={profile} onChange={(event) => setProfile(event.target.value)}>
          <option value="">Unassigned</option>
          {options.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <p className="field__help">The next worker to take the task is of this profile.{task.status === 'running' && ' A worker has it now, so Hermes reclaims it first and stops that worker.'}</p>
      </div>
    </Sheet>
  );
}

function AssistSheet({ task, assist, slug, onClose, onDone }: { task: TaskFull; assist: Assist; slug: string | undefined; onClose(): void; onDone(): void }) {
  if (assist.kind === 'reassign') return <ReassignSheet task={task} choices={assist.choices} slug={slug} onClose={onClose} onDone={onDone} />;
  if (assist.kind === 'specify') {
    const { before, after } = assist;
    const reject = async () => {
      onClose();
      if (report(await rejectSpecified(task.id, before, slug), 'Kept the old brief')) onDone();
    };
    return (
      <Sheet
        title="Specify: the new brief"
        detents={['half', 'full']}
        escapable={false}
        dismissOnScrim={false}
        onClose={() => void reject()}
        footer={
          <>
            <button type="button" className="btn btn--ghost" onClick={() => void reject()}>
              Reject: keep the old brief
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                onClose();
                toast('Brief replaced', { tone: 'success' });
              }}
            >
              Accept the new brief
            </button>
          </>
        }
      >
        <p className="subtle">The model wrote this from the title. Accept it to keep it; Reject puts back the old title, brief and column.</p>
        <h3 className="td-assist__title">{after.task.title}</h3>
        <Rich text={after.task.brief} anchor="specified-brief" />
        {before.brief.trim() && (
          <details>
            <summary>The old brief</summary>
            <Rich text={before.brief} anchor="old-brief" />
          </details>
        )}
      </Sheet>
    );
  }
  if (assist.kind === 'decompose') {
    return (
      <Sheet title="Decompose" onClose={onClose} footer={<button type="button" className="btn btn--primary" onClick={onClose}>Done</button>}>
        {assist.children.length === 0 ? (
          <p>The model kept this task as one piece. Nothing was created.</p>
        ) : (
          <>
            <p>{assist.children.length === 1 ? 'Hermes created 1 subtask:' : `Hermes created ${assist.children.length} subtasks:`}</p>
            <ul className="td-list">
              {assist.children.map((id) => (
                <li key={id}>
                  <AppLink className="mono" to={`/work/tasks/${encodeURIComponent(id)}${slug ? `?board=${encodeURIComponent(slug)}` : ''}`} onClick={onClose}>
                    {id}
                  </AppLink>
                </li>
              ))}
            </ul>
          </>
        )}
      </Sheet>
    );
  }
  return (
    <Sheet title="Estimate" onClose={onClose} footer={<button type="button" className="btn btn--primary" onClick={onClose}>Done</button>}>
      <dl className="td-facts">
        <div>
          <dt>Tokens</dt>
          <dd>about {assist.tokens.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{assist.complexity === 'S' ? 'Small' : assist.complexity === 'M' ? 'Medium' : assist.complexity === 'L' ? 'Large' : '—'}</dd>
        </div>
        {assist.model && (
          <div>
            <dt>Model</dt>
            <dd className="mono">{assist.model}</dd>
          </div>
        )}
      </dl>
      {assist.rationale && <p>{assist.rationale}</p>}
      <p className="subtle">A rough guess by a model, not a price. Nothing on the task changed.</p>
    </Sheet>
  );
}

/** Reads the answer of an assist route; Hermes answers `{ ok: false, reason }` for what it could not do, which is not an HTTP error. */
const bodyOf = (body: unknown): Record<string, unknown> => (typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {});

/** A task, live: its brief, runs, activity, links, files and settings, with the actions that move it. */
export function Task() {
  const { taskId = '', tab: tabName } = useParams({ strict: false }) as { taskId?: string; tab?: string };
  const { board, specify: specifyNow } = useSearch({ strict: false }) as { board?: string; specify?: unknown };
  const slug = typeof board === 'string' ? board : undefined;
  const tab = tabOf(tabName);
  const navigate = useAppNavigate();
  const { state, reload } = useLiveTask(taskId, slug);
  const { detail } = state;
  const [assist, setAssist] = useState<Assist>();
  const [working, setWorking] = useState<TaskActionId>();
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const running = detail?.runs.some((run) => run.endedAt === null) ?? false;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(timer);
  }, [running]);

  const boardPath = `/work/board${slug ? `/${encodeURIComponent(slug)}` : ''}`;
  const task = detail?.task;

  const act = async (action: TaskActionId) => {
    if (!detail || !task) return;
    setWorking(action);
    try {
      switch (action) {
        case 'run-now':
          if (report(await runNow(task, slug), task.assignee ? 'Run requested' : 'In Ready. No worker starts until you assign a profile.')) reload();
          break;
        case 'retry':
          if (report(await retry(task, slug), 'Back to Ready')) reload();
          break;
        case 'reclaim':
          if (report(await reclaim(task, slug), 'Claim reclaimed')) reload();
          break;
        case 'terminate': {
          const run = detail.runs.find((candidate) => candidate.id === task.currentRunId) ?? detail.runs.find((candidate) => candidate.endedAt === null);
          if (!run) toast('This task has no run in progress.', { tone: 'warning' });
          else if (report(await terminate(task, run, slug), `Run ${run.id} terminated`)) reload();
          break;
        }
        case 'reassign':
          setAssist({ kind: 'reassign', choices: await loadAssignees(slug) });
          break;
        case 'specify': {
          const before = { title: task.title, brief: task.brief, status: task.status };
          const outcome = await specify(task, slug);
          if (outcome.kind !== 'done') {
            report(outcome, '');
            break;
          }
          const answer = bodyOf(outcome.body);
          if (answer.ok !== true) {
            toast(typeof answer.reason === 'string' ? answer.reason : 'Hermes could not specify this task.', { tone: 'warning' });
            break;
          }
          setAssist({ kind: 'specify', before, after: await readTask(task.id, slug) });
          reload();
          break;
        }
        case 'decompose': {
          const outcome = await decompose(task, slug);
          if (outcome.kind !== 'done') {
            report(outcome, '');
            break;
          }
          const answer = bodyOf(outcome.body);
          if (answer.ok !== true) {
            toast(typeof answer.reason === 'string' ? answer.reason : 'Hermes could not decompose this task.', { tone: 'warning' });
            break;
          }
          setAssist({ kind: 'decompose', title: typeof answer.new_title === 'string' ? answer.new_title : null, children: Array.isArray(answer.child_ids) ? answer.child_ids.filter((id): id is string => typeof id === 'string') : [] });
          reload();
          break;
        }
        case 'estimate': {
          const outcome = await estimate(task, slug);
          if (outcome.kind !== 'done') {
            report(outcome, '');
            break;
          }
          const answer = bodyOf(outcome.body);
          if (answer.ok !== true) {
            toast(typeof answer.reason === 'string' ? answer.reason : 'Hermes could not estimate this task.', { tone: 'warning' });
            break;
          }
          setAssist({ kind: 'estimate', tokens: typeof answer.est_tokens === 'number' ? answer.est_tokens : 0, complexity: typeof answer.complexity === 'string' ? answer.complexity : null, rationale: typeof answer.rationale === 'string' ? answer.rationale : null, model: typeof answer.model === 'string' ? answer.model : null });
          break;
        }
      }
    } finally {
      setWorking(undefined);
    }
  };

  // A draft saved with "have a model write the brief" arrives here with `?specify=1`: Specify runs once, with its own confirmation, and the address is cleaned.
  const autoSpecify = useRef(false);
  useEffect(() => {
    if (!task || String(specifyNow) !== '1' || autoSpecify.current) return;
    autoSpecify.current = true;
    void navigate(`/work/tasks/${encodeURIComponent(task.id)}${tabName ? `/${tabName}` : ''}${slug ? `?board=${encodeURIComponent(slug)}` : ''}`, { replace: true });
    if (task.status === 'triage') void act('specify');
    // `act` reads the task that is on the page now; it is not a reason to run again.
  }, [task?.id, specifyNow]); // eslint-disable-line react-hooks/exhaustive-deps

  const actions = task && detail ? availableActions(task, detail.runs) : [];
  let panel: ReactNode = null;
  if (detail) {
    const props = { detail, slug, reload };
    panel =
      tab === 'brief' ? <BriefPanel {...props} /> : tab === 'runs' ? <RunsPanel {...props} nowSeconds={nowSeconds} /> : tab === 'activity' ? <ActivityPanel {...props} /> : tab === 'links' ? <LinksPanel {...props} /> : tab === 'attachments' ? <AttachmentsPanel {...props} /> : <SettingsPanel {...props} />;
  }

  return (
    <div className="bpage td">
      <PageHeader
        overline={task?.id ?? taskId}
        overlineAsIs
        title={task?.title ?? (state.phase === 'loading' ? 'Task' : 'Task not found')}
        subtitle={
          task && (
            <span className="td-head">
              <span className="tag" data-tone={task.status === 'done' ? 'success' : task.status === 'running' ? 'running' : task.status === 'blocked' ? 'warning' : undefined}>
                {isBoardStatus(task.status) ? STATUS_META[task.status].label : task.status}
              </span>
              {isBlockKind(task.blockKind) && <span className="subtle">{BLOCK_META[task.blockKind].label}</span>}
              {task.assignee ? (
                <span className="ptag">
                  <Sigil name={task.assignee} size="xs" />
                  <span className="ptag__name">{task.assignee}</span>
                </span>
              ) : (
                <span className="subtle">Unassigned</span>
              )}
              <span className="subtle" role="status">
                {state.live ? 'Live' : state.phase === 'ready' ? 'Reconnecting…' : ''}
              </span>
            </span>
          )
        }
        actions={
          <>
            {task && (
              <AppLink className="btn btn--secondary" to={`/work/tasks/${encodeURIComponent(task.id)}/edit${slug ? `?board=${encodeURIComponent(slug)}` : ''}`}>
                <Icon name="sliders" />
                Edit
              </AppLink>
            )}
            {task && (
              <AppLink className="btn btn--secondary" to={`/work/playbooks/new?fromTask=${encodeURIComponent(task.id)}${slug ? `&board=${encodeURIComponent(slug)}` : ''}`}>
                <Icon name="file" />
                Save as template
              </AppLink>
            )}
            <AppLink className="btn btn--secondary" to={boardPath}>
              <Icon name="work" />
              Back to the board
            </AppLink>
          </>
        }
      />
      {state.phase === 'loading' && <p role="status">Loading the task…</p>}
      {state.phase === 'failed' && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">{detail ? 'Hermes did not answer just now, so this page may be out of date. It tries again by itself.' : 'Hermes did not give this task. It may have been deleted, or Hermes may be restarting.'}</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={reload}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {task && detail && (
        <>
          {actions.length > 0 && (
            <div className="td-actions" role="group" aria-label="Task actions">
              {actions.map((action) => (
                <WriteButton key={action} type="button" className={`btn ${action === 'run-now' ? 'btn--primary' : 'btn--secondary'}`} disabled={working !== undefined} aria-busy={working === action || undefined} onClick={() => void act(action)}>
                  <Icon name={ACTION_BUTTONS[action].icon} />
                  {ACTION_BUTTONS[action].label}
                </WriteButton>
              ))}
            </div>
          )}
          {task.status === 'triage' && (
            <p className="subtle td-hint">
              <Term id="specify">Specify</Term> has a model write the brief; <Term id="decompose">Decompose</Term> has it split the task into subtasks.
            </p>
          )}
          {task.status === 'running' && (
            <p className="subtle td-hint">
              <Term id="terminate">Terminate</Term> stops this run’s worker; <Term id="reclaim">Reclaim</Term> releases its claim on the task.
            </p>
          )}
          <nav className="td-tabs" aria-label="Task sections">
            <ul>
              {TASK_TABS.map((candidate) => (
                <li key={candidate.id}>
                  <AppLink to={tabHref(task.id, candidate.id, slug)} aria-current={candidate.id === tab ? 'page' : undefined}>
                    {candidate.label}
                    {candidate.id === 'runs' && detail.runs.length > 0 && <span className="td-tabs__n">{detail.runs.length}</span>}
                    {candidate.id === 'attachments' && detail.attachments.length > 0 && <span className="td-tabs__n">{detail.attachments.length}</span>}
                  </AppLink>
                </li>
              ))}
            </ul>
          </nav>
          <section className="td-panel" aria-labelledby="td-panel-title">
            <h2 id="td-panel-title" className="sr-only">
              {TASK_TABS.find((candidate) => candidate.id === tab)?.label}
            </h2>
            {panel}
          </section>
          {assist && <AssistSheet task={task} assist={assist} slug={slug} onClose={() => setAssist(undefined)} onDone={reload} />}
        </>
      )}
    </div>
  );
}
