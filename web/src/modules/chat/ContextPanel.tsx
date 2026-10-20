// The chat's context panel (M1 #05, #07): Todo (the agent's task list, live from `todo.updated`) and Run (the session's goal, live from
// `session.control.update`, the children the agent delegated work to, and the token usage). A column beside the conversation on a large
// screen and a sheet on a smaller one.
import { lazy, Suspense, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { GoalSnapshot, Usage } from '@caduceus/contracts/hermes/gateway';
import { Icon, type IconName } from '../../icons.tsx';
import { ActivityGroup } from './ActivityCards.tsx';
import type { SubagentActivity, Todo } from './activity.ts';
import type { ArtifactsTabProps } from './ArtifactsTab.tsx';

const ArtifactsTab = lazy(() => import('./ArtifactsTab.tsx').then((m) => ({ default: m.ArtifactsTab })));

const TABS = ['todo', 'run', 'artifacts'] as const;
type Tab = (typeof TABS)[number];

const TODO_STATUS: Record<Todo['status'], { label: string; icon: IconName }> = {
  pending: { label: 'To do', icon: 'queued' },
  in_progress: { label: 'In progress', icon: 'running' },
  completed: { label: 'Done', icon: 'succeeded' },
  cancelled: { label: 'Cancelled', icon: 'cancelled' },
};

const number = new Intl.NumberFormat('en');

/** The usage rows worth a line: what Hermes reported, in words. */
export function usageRows(usage: Usage): [string, string][] {
  const input = usage.input ?? usage.prompt;
  const output = usage.output ?? usage.completion;
  const rows: [string, string | undefined][] = [
    ['Input tokens', input === undefined ? undefined : number.format(input)],
    ['Output tokens', output === undefined ? undefined : number.format(output)],
    ['Reasoning tokens', usage.reasoning ? number.format(usage.reasoning) : undefined],
    ['Total tokens', usage.total === undefined ? undefined : number.format(usage.total)],
    ['Model calls', usage.calls === undefined ? undefined : number.format(usage.calls)],
    ['Context used', usage.context_used == null ? undefined : `${number.format(usage.context_used)}${usage.context_max ? ` of ${number.format(usage.context_max)}` : ''}${usage.context_percent == null ? '' : ` (${Math.round(usage.context_percent)}%)`}`],
    ['Cache hits', usage.cache_hit_pct == null ? undefined : `${Math.round(usage.cache_hit_pct)}%`],
    ['Speed', usage.avg_tps ? `${Math.round(usage.avg_tps * 10) / 10} tokens/s` : undefined],
    ['Cost', usage.cost_usd == null ? undefined : `$${usage.cost_usd.toFixed(4)}`],
  ];
  return rows.filter((row): row is [string, string] => row[1] !== undefined);
}

function TodoTab({ todos }: { todos: readonly Todo[] }) {
  if (todos.length === 0) {
    return (
      <div className="empty">
        <span className="empty__icon">
          <Icon name="tasks" />
        </span>
        <p>No tasks yet. When the agent plans its work as a list, it appears here and updates as it goes.</p>
      </div>
    );
  }
  return (
    <ul className="ctx__todos">
      {todos.map((todo) => {
        const status = TODO_STATUS[todo.status];
        return (
          <li key={todo.id} className="ctx__todo" data-status={todo.status}>
            <Icon name={status.icon} small />
            <span className="ctx__todo-text">{todo.content}</span>
            <span className="act__chip">{status.label}</span>
          </li>
        );
      })}
    </ul>
  );
}

/** What the owner can do to the goal. A missing one means the chat is not there yet. */
interface GoalActions {
  onSetGoal?: (text: string) => Promise<void> | void;
  onClearGoal?: () => Promise<void> | void;
  onPauseGoal?: (paused: boolean) => Promise<void> | void;
}

const GOAL_STATUS: Record<string, string> = { active: 'Working on it', paused: 'Paused', done: 'Done', achieved: 'Done', waiting: 'Waiting', parked: 'Parked' };

/** The session's goal (Hermes's own: `/goal`): its words, how Hermes sees it, and the way to edit, pause or clear it. */
function GoalPanel({ goal, onSetGoal, onClearGoal, onPauseGoal }: { goal: GoalSnapshot | undefined } & GoalActions) {
  const [editing, setEditing] = useState<string>();
  const fieldId = useId();
  const paused = goal?.status === 'paused';
  const form = editing !== undefined && (
    <form
      className="ctx__goal-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (editing.trim() === '') return;
        void onSetGoal?.(editing.trim());
        setEditing(undefined);
      }}
    >
      <label className="sr-only" htmlFor={fieldId}>
        Goal
      </label>
      <textarea id={fieldId} className="input" rows={3} value={editing} autoFocus onChange={(event) => setEditing(event.target.value)} />
      <div className="ctx__goal-acts">
        <button type="submit" className="btn btn--primary btn--sm" disabled={editing.trim() === ''}>
          {goal ? 'Save goal' : 'Set goal'}
        </button>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => setEditing(undefined)}>
          Discard changes
        </button>
      </div>
    </form>
  );
  return (
    <section aria-labelledby="ctx-goal">
      <h3 id="ctx-goal" className="ctx__heading">
        Goal
      </h3>
      {goal ? (
        <div className="ctx__goal" data-status={goal.status}>
          <p className="ctx__goal-title">{goal.title}</p>
          <p className="ctx__goal-meta">
            <span className="act__chip" role="status">
              {GOAL_STATUS[goal.status] ?? goal.status}
            </span>
            <span className="subtle">
              {goal.turns_used} of {goal.max_turns} turns
            </span>
          </p>
          {goal.paused_reason && <p className="subtle ctx__goal-note">Paused: {goal.paused_reason}</p>}
          {goal.last_reason && <p className="subtle ctx__goal-note">Hermes’s last check: {goal.last_reason}</p>}
          {editing === undefined && (
            <div className="ctx__goal-acts">
              <button type="button" className="btn btn--secondary btn--sm" disabled={!onSetGoal} onClick={() => setEditing(goal.title)}>
                Edit
              </button>
              <button type="button" className="btn btn--secondary btn--sm" disabled={!onPauseGoal} onClick={() => void onPauseGoal?.(!paused)}>
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button type="button" className="btn btn--danger-quiet btn--sm" disabled={!onClearGoal} onClick={() => void onClearGoal?.()}>
                Clear
              </button>
            </div>
          )}
          {form}
        </div>
      ) : editing === undefined ? (
        <>
          <p className="subtle">No goal in this chat. Type /goal and what you want done, or set one here.</p>
          <button type="button" className="btn btn--secondary btn--sm" disabled={!onSetGoal} onClick={() => setEditing('')}>
            Set a goal
          </button>
        </>
      ) : (
        form
      )}
    </section>
  );
}

function RunTab({ goal, subagents, usage, openChild, ...actions }: { goal: GoalSnapshot | undefined; subagents: readonly SubagentActivity[]; usage: Usage | undefined; openChild?: (sessionId: string) => ReactNode } & GoalActions) {
  const rows = usage ? usageRows(usage) : [];
  return (
    <>
      <GoalPanel goal={goal} {...actions} />
      <section aria-labelledby="ctx-subagents">
        <h3 id="ctx-subagents" className="ctx__heading">
          Subagents
        </h3>
        {subagents.length === 0 ? <p className="subtle">The agent has not delegated any work in this chat.</p> : <ActivityGroup items={subagents} mode="stream" openChild={openChild} />}
      </section>
      <section aria-labelledby="ctx-usage">
        <h3 id="ctx-usage" className="ctx__heading">
          Usage
        </h3>
        {rows.length === 0 ? (
          <p className="subtle">Usage appears once Hermes has finished a reply.</p>
        ) : (
          <dl className="act__facts ctx__usage">
            {rows.map(([name, value]) => (
              <div key={name}>
                <dt>{name}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </>
  );
}

/** How many things need the owner's eye, for the badge on the phone's button: tasks not finished and children still running. */
export function openWork(todos: readonly Todo[], subagents: readonly SubagentActivity[]): number {
  return todos.filter((todo) => todo.status === 'pending' || todo.status === 'in_progress').length + subagents.filter((child) => child.status === 'running' || child.status === 'queued').length;
}

export function ContextPanel({ todos, subagents, usage, goal, openChild, artifacts, ...actions }: { todos: readonly Todo[]; subagents: readonly SubagentActivity[]; usage: Usage | undefined; goal?: GoalSnapshot | undefined; openChild?: (sessionId: string) => ReactNode; /** What the Artifacts tab needs; without it the chat has none. */ artifacts?: ArtifactsTabProps } & GoalActions) {
  const [tab, setTab] = useState<Tab>('todo');
  const id = useId();
  const done = todos.filter((todo) => todo.status === 'completed').length;
  const labels: Record<Tab, string> = { todo: todos.length > 0 ? `Todo ${done}/${todos.length}` : 'Todo', run: 'Run', artifacts: 'Artifacts' };
  const tabs: readonly Tab[] = artifacts === undefined ? TABS.filter((name) => name !== 'artifacts') : TABS;
  const onKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const rtl = getComputedStyle(event.currentTarget).direction === 'rtl';
    const step = event.key === 'ArrowRight' ? (rtl ? -1 : 1) : event.key === 'ArrowLeft' ? (rtl ? 1 : -1) : 0;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : step === 0 ? undefined : (tabs.indexOf(tab) + step + tabs.length) % tabs.length;
    if (next === undefined) return;
    event.preventDefault();
    setTab(tabs[next]!);
    document.getElementById(`${id}-tab-${tabs[next]}`)?.focus();
  };
  return (
    <div className="ctx">
      <div role="tablist" aria-label="Context" className="seg ctx__tabs" onKeyDown={onKeys}>
        {tabs.map((name) => (
          <button key={name} type="button" role="tab" id={`${id}-tab-${name}`} aria-selected={tab === name} aria-controls={`${id}-panel-${name}`} tabIndex={tab === name ? 0 : -1} onClick={() => setTab(name)}>
            {labels[name]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel-todo`} aria-labelledby={`${id}-tab-todo`} hidden={tab !== 'todo'} className="ctx__panel">
        <TodoTab todos={todos} />
      </div>
      <div role="tabpanel" id={`${id}-panel-run`} aria-labelledby={`${id}-tab-run`} hidden={tab !== 'run'} className="ctx__panel">
        <RunTab goal={goal} subagents={subagents} usage={usage} openChild={openChild} {...actions} />
      </div>
      {artifacts !== undefined && (
        <div role="tabpanel" id={`${id}-panel-artifacts`} aria-labelledby={`${id}-tab-artifacts`} hidden={tab !== 'artifacts'} className="ctx__panel">
          {tab === 'artifacts' && (
            <Suspense fallback={<p className="subtle" role="status">Loading…</p>}>
              <ArtifactsTab {...artifacts} />
            </Suspense>
          )}
        </div>
      )}
    </div>
  );
}
