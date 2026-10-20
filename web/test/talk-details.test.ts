import { describe, expect, test } from 'vitest';
import type { ToolActivity, SubagentActivity, Todo } from '../src/modules/chat/activity.ts';
import type { ChatMessage, ChatTurn } from '../src/modules/chat/chat-session.ts';
import type { OpenRequest } from '../src/modules/chat/requests.ts';
import type { BoardTask } from '../src/modules/work/board-model.ts';
import type { Job } from '../src/modules/work/schedules-model.ts';
import { aboutOf, detailsLayout, detailsSections, liveLine, planHasContent, rightNow, spendOf, workOf, workspaceOf } from '../src/modules/chat/talk-details.ts';

// What the Details panel of Talk says about an agent. Pure: every value is something Hermes already sent (the transcript, the usage, the board, the jobs).
const tool = (name: string, over: Partial<ToolActivity> = {}): ToolActivity => ({ kind: 'tool', key: `k-${name}-${Math.random()}`, id: undefined, name, status: 'done', ...over });
const todo = (id: string, status: Todo['status']): Todo => ({ id, content: `Task ${id}`, status });
const turnWith = (items: ToolActivity[] | SubagentActivity[], over: Partial<ChatTurn> = {}): ChatTurn => ({ user: 'go', segments: [{ kind: 'activity', items }], status: 'streaming', ...over });
const reply = (...items: ToolActivity[]): ChatMessage => ({ role: 'assistant', text: '', activity: items });
const approval = (command: string): OpenRequest => ({ kind: 'approval', id: 'a1', sessionId: 'rt', status: 'open', requestId: 'r1', tool: 'terminal', command, description: '', choices: ['once', 'deny'] });
const question = (text: string): OpenRequest => ({ kind: 'clarify', id: 'c1', sessionId: 'rt', status: 'open', questions: [{ qid: 'q', question: text, choices: [], multiSelect: false }], receivedAt: 0 });

const quiet = { requests: [], turn: undefined, running: false, todos: [] as Todo[], subagents: [] as SubagentActivity[] };

describe('Right now', () => {
  test('says nothing is running when no turn is under way', () => {
    expect(rightNow(quiet)).toMatchObject({ tone: 'idle', headline: 'Nothing is running', step: undefined, progress: undefined });
  });

  test('names the tool the agent is running, with what it is about', () => {
    const now = rightNow({ ...quiet, running: true, turn: turnWith([tool('read_file', { status: 'done' }), tool('terminal', { status: 'running', context: 'pnpm vitest webhooks' })]) });
    expect(now).toMatchObject({ tone: 'working', headline: 'Running a command: pnpm vitest webhooks' });
  });

  test('puts a decision the owner must make first, whatever else is running', () => {
    const asked = rightNow({ ...quiet, running: true, requests: [approval('git push origin feat/x')], turn: turnWith([tool('terminal', { status: 'running', context: 'ls' })]) });
    expect(asked).toMatchObject({ tone: 'waiting', headline: 'Waiting for your OK to run git push origin feat/x' });
    expect(rightNow({ ...quiet, running: true, requests: [question('Which plumber slot?')] })).toMatchObject({ tone: 'waiting', headline: 'Waiting for your answer: Which plumber slot?' });
  });

  test('counts the agent’s own task list as the steps: the next open one of all of them, and how far along it is', () => {
    const steps = [todo('1', 'completed'), todo('2', 'completed'), todo('3', 'in_progress'), todo('4', 'pending')];
    const now = rightNow({ ...quiet, running: true, todos: steps, turn: turnWith([], { segments: [] }) });
    expect(now.step).toBe('Step 3 of 4');
    expect(now.progress).toBeCloseTo(0.5);
  });

  test('does not count a cancelled task as a step', () => {
    const now = rightNow({ ...quiet, running: true, todos: [todo('1', 'completed'), todo('2', 'cancelled'), todo('3', 'pending')], turn: turnWith([], { segments: [] }) });
    expect(now.step).toBe('Step 2 of 2');
  });

  test('is Step n of n, full, when every task is done', () => {
    expect(rightNow({ ...quiet, todos: [todo('1', 'completed'), todo('2', 'completed')] })).toMatchObject({ tone: 'idle', step: 'Step 2 of 2', progress: 1 });
  });

  test('has no step and no bar when the agent keeps no task list', () => {
    const now = rightNow({ ...quiet, running: true, turn: turnWith([tool('patch', { status: 'running' })]) });
    expect(now.step).toBeUndefined();
    expect(now.progress).toBeUndefined();
  });

  test('says what a helper agent is doing when it is the only thing under way, and thinking and writing when those are', () => {
    const helper: SubagentActivity = { kind: 'subagent', key: 's', id: 's1', goal: 'Check the timers', status: 'running' };
    expect(rightNow({ ...quiet, running: true, subagents: [helper], turn: turnWith([], { segments: [] }) }).headline).toBe('A helper agent is working: Check the timers');
    expect(rightNow({ ...quiet, running: true, turn: { user: 'go', segments: [{ kind: 'activity', items: [{ kind: 'reasoning', key: 'r', text: '…', streaming: true }] }], status: 'streaming' } }).headline).toBe('Thinking');
    expect(rightNow({ ...quiet, running: true, turn: { user: 'go', segments: [{ kind: 'text', text: 'Good.' }], status: 'streaming' } }).headline).toBe('Writing a reply');
    expect(rightNow({ ...quiet, running: true, turn: { user: 'go', segments: [], status: 'waiting' } }).headline).toBe('Starting');
  });

  test('reports a turn that failed, in Hermes’s words', () => {
    expect(rightNow({ ...quiet, turn: { user: 'go', segments: [], status: 'failed', error: 'The provider refused the key.' } })).toMatchObject({ tone: 'failed', headline: 'The last turn failed: The provider refused the key.' });
  });
});

describe('the live line under the agent’s name', () => {
  test('joins the state in words with what it is doing, and is only the state for an idle agent', () => {
    expect(liveLine({ profile: 'coder', state: 'waiting', line: 'Wants to run git push', since: 1 })).toBe('Waiting for you · Wants to run git push');
    expect(liveLine({ profile: 'coder', state: 'idle', line: 'Nothing going on', since: undefined })).toBe('Idle');
    expect(liveLine(undefined)).toBe('');
  });
});

describe('the workspace preview', () => {
  test('holds the last terminal command and the last browser step, newest of the whole chat', () => {
    const a = tool('terminal', { context: 'first' });
    const b = tool('terminal', { context: 'second' });
    const page = tool('browser_snapshot');
    const view = workspaceOf([reply(a), { role: 'user', text: 'more' }, reply(b, page)]);
    expect(view.terminal).toBe(b);
    expect(view.browser).toBe(page);
  });

  test('lists the files the agent wrote or patched, newest first and each once, and not the ones it only read', () => {
    const view = workspaceOf([reply(tool('write_file', { args: { path: 'src/a.ts' } }), tool('read_file', { args: { path: 'src/readme.md' } }), tool('patch', { args: { path: 'src/b.ts' } }), tool('patch', { args: { path: 'src/a.ts' } }))]);
    expect(view.files).toEqual(['src/a.ts', 'src/b.ts']);
  });

  test('skips a file call whose path Hermes did not send', () => {
    expect(workspaceOf([reply(tool('patch', { args: { mode: 'patch' } }), tool('write_file'))]).files).toEqual([]);
  });
});

const task = (id: string, over: Partial<BoardTask> = {}): BoardTask => ({
  id, title: `Task ${id}`, status: 'ready', assignee: 'coder', priority: 0, tenant: null, projectId: null, blockKind: null, summary: null, commentCount: 0, createdAt: 0,
  workflowTemplateId: null, currentStepKey: null, idempotencyKey: null, startedAt: null, completedAt: null, lastHeartbeatAt: null, failures: 0, lastFailureError: null, ...over,
});
const job = (id: string, over: Partial<Job> = {}): Job => ({ id, name: `Job ${id}`, profile: 'coder', type: 'agent', enabled: true, state: 'scheduled', schedule: 'Every weekday at 06:00', scheduleExpression: '', config: {}, ...over });
const NOW = Date.UTC(2026, 9, 19, 8, 0);

describe('Work: this agent’s tasks, runs and routines', () => {
  const input = { profile: 'coder', session: 'open-chat', now: NOW };

  test('lists the agent’s tasks that are not done and none of another agent’s, the ones that wait for the owner first', () => {
    const { entries } = workOf({
      ...input,
      tasks: [task('t1', { status: 'running', startedAt: NOW / 1000 - 300 }), task('t2', { status: 'done' }), task('t3', { status: 'review' }), task('t4', { assignee: 'librarian' }), task('t5', { assignee: null })],
      jobs: [],
      runs: [],
    });
    expect(entries.map((entry) => [entry.id, entry.tone])).toEqual([['t3', 'waiting'], ['t1', 'running']]);
    expect(entries[0]).toMatchObject({ kind: 'task', title: 'Task t3', detail: 'Review', to: '/work/tasks/t3' });
    expect(entries[1]?.detail).toBe('Running for 5 min');
  });

  test('marks a task that failed or is blocked as a failure and leaves the rest ready', () => {
    const { entries } = workOf({ ...input, tasks: [task('t1', { status: 'blocked', blockKind: 'dependency' }), task('t2', { failures: 2, lastFailureError: 'boom' }), task('t3')], jobs: [], runs: [] });
    expect(Object.fromEntries(entries.map((entry) => [entry.id, entry.tone]))).toEqual({ t1: 'failed', t2: 'failed', t3: 'idle' });
  });

  test('lists the agent’s routines with their schedule in words and leaves out a paused or another agent’s', () => {
    const { entries } = workOf({ ...input, tasks: [], runs: [], jobs: [job('j1'), job('j2', { enabled: false, state: 'paused' }), job('j3', { profile: 'librarian' })] });
    expect(entries).toEqual([{ kind: 'routine', id: 'j1', title: 'Job j1', detail: 'Every weekday at 06:00', tone: 'idle', to: '/work/schedules/j1' }]);
  });

  test('lists the agent’s other live chats as runs, not the chat that is open', () => {
    const { entries } = workOf({
      ...input,
      tasks: [],
      jobs: [],
      runs: [
        { sessionId: 'rt1', storedSessionId: 'open-chat', title: 'This one', profile: 'coder', status: 'running', since: NOW - 1000 },
        { sessionId: 'rt2', storedSessionId: 'other', title: 'Docs', profile: 'coder', status: 'waiting', since: NOW - 60_000 },
        { sessionId: 'rt3', storedSessionId: 'x', title: 'Not mine', profile: 'librarian', status: 'running', since: NOW },
      ],
    });
    expect(entries).toEqual([{ kind: 'run', id: 'other', title: 'Docs', detail: 'Waiting for you', tone: 'waiting', to: '/chat/other' }]);
  });

  test('shows the first few and counts the rest, waiting before running before routines', () => {
    const tasks = Array.from({ length: 9 }, (_, index) => task(`t${index}`));
    const { entries, more } = workOf({ ...input, tasks, jobs: [job('j1')], runs: [] });
    expect(entries).toHaveLength(6);
    expect(more).toBe(4);
    expect(entries.at(-1)?.kind).toBe('task');
  });

  test('is empty, with no more, when Hermes has not answered yet', () => {
    expect(workOf({ ...input, tasks: undefined, jobs: undefined, runs: [] })).toEqual({ entries: [], more: 0 });
  });
});

describe('About', () => {
  const usage = { context_used: 38_000, context_max: 100_000 };

  test('gives the model, the folder, the cost today and how much of the context is used, as Hermes reported them', () => {
    expect(aboutOf({ model: 'glm-5.3', cwd: '/Users/me/code/hermes-console', usage, spendToday: 0.612 })).toEqual([
      { label: 'Model', value: 'glm-5.3' },
      { label: 'Folder', value: '/Users/me/code/hermes-console' },
      { label: 'Cost today', value: '$0.61' },
      { label: 'Context', value: '38% used' },
    ]);
  });

  test('says so, in words, for what is not known yet rather than a made-up number', () => {
    expect(aboutOf({ model: undefined, cwd: undefined, usage: undefined, spendToday: undefined })).toEqual([
      { label: 'Model', value: 'The profile’s default' },
      { label: 'Folder', value: 'Not set' },
      { label: 'Cost today', value: 'Not known yet' },
      { label: 'Context', value: 'Not known until the first reply' },
    ]);
  });

  test('shows a cost under a cent as such, and a model that costs nothing as $0.00', () => {
    expect(aboutOf({ model: 'm', cwd: '/x', usage, spendToday: 0.004 })[2]?.value).toBe('Under $0.01');
    expect(aboutOf({ model: 'm', cwd: '/x', usage, spendToday: 0 })[2]?.value).toBe('$0.00');
  });
});

const SPEND_DAY = new Date(Date.UTC(2026, 9, 7, 14, 2, 30));

/** Hermes's usage analytics for a profile: one row per UTC day (`daily`). */
const usage = (rows: { day: string; input?: number; output?: number; estimated?: number; actual?: number }[]) => ({
  daily: rows.map((row) => ({ day: row.day, input_tokens: row.input ?? 0, output_tokens: row.output ?? 0, estimated_cost: row.estimated ?? 0, actual_cost: row.actual ?? 0 })),
});

describe('spend', () => {
  test('is today\'s and this month\'s cost and tokens, from the days Hermes reports', () => {
    const spend = spendOf(
      [
        usage([
          { day: '2026-09-30', output: 9000, actual: 9 },
          { day: '2026-10-01', input: 1000, output: 500, estimated: 0.4 },
          { day: '2026-10-06', input: 2000, output: 1000, actual: 1.25, estimated: 1.1 },
          { day: '2026-10-07', input: 300, output: 200, estimated: 0.05 },
        ]),
      ],
      SPEND_DAY,
    );

    expect(spend).toEqual({ today: { cost: 0.05, tokens: 500 }, month: { cost: 0.4 + 1.25 + 0.05, tokens: 1500 + 3000 + 500 } });
  });

  test('adds up the profiles it is asked about', () => {
    const spend = spendOf([usage([{ day: '2026-10-07', input: 100, output: 100, actual: 1 }]), usage([{ day: '2026-10-07', input: 50, output: 50, estimated: 2 }])], SPEND_DAY);

    expect(spend).toEqual({ today: { cost: 3, tokens: 300 }, month: { cost: 3, tokens: 300 } });
  });

  test('reads an answer it cannot make sense of as nothing spent, not as an error in the page', () => {
    expect(spendOf([undefined, { daily: 'none' }, { daily: [{ day: '2026-10-07' }, null] }], SPEND_DAY)).toEqual({ today: { cost: 0, tokens: 0 }, month: { cost: 0, tokens: 0 } });
  });
});

describe('which sections of Details show', () => {
  const idle = rightNow(quiet);
  const waiting = rightNow({ ...quiet, running: true, requests: [approval('git push')] });
  const running = rightNow({ ...quiet, running: true, turn: turnWith([tool('terminal', { status: 'running', context: 'ls' })]) });
  const failed = rightNow({ ...quiet, turn: { user: 'go', segments: [], status: 'failed', error: 'No key.' } });

  test('an agent with nothing to say shows only Last command and About', () => {
    expect(detailsSections({ now: idle, workEntries: 0, plan: false })).toEqual(['last-command', 'about']);
  });

  test('an idle agent with work and a plan adds Work and Plan and run, still without Right now', () => {
    expect(detailsSections({ now: idle, workEntries: 2, plan: true })).toEqual(['last-command', 'work', 'about', 'plan']);
  });

  test('a running agent and one that waits for the owner show Right now first', () => {
    expect(detailsSections({ now: running, workEntries: 0, plan: false })).toEqual(['now', 'last-command', 'about']);
    expect(detailsSections({ now: waiting, workEntries: 1, plan: false })).toEqual(['now', 'last-command', 'work', 'about']);
  });

  test('a failed last turn is shown too, so that it is not hidden', () => {
    expect(detailsSections({ now: failed, workEntries: 0, plan: false })[0]).toBe('now');
  });

  test('Last command and About are in every answer', () => {
    for (const now of [idle, waiting, running, failed]) for (const workEntries of [0, 3]) for (const plan of [false, true]) expect(detailsSections({ now, workEntries, plan })).toEqual(expect.arrayContaining(['last-command', 'about']));
  });

  test('the plan has content once there is a task, a helper, a goal or a usage report, and not before', () => {
    const helper: SubagentActivity = { kind: 'subagent', key: 's', id: 's1', goal: 'Check', status: 'running' };
    const empty = { todos: [] as Todo[], subagents: [] as SubagentActivity[], goal: undefined, usage: undefined };
    expect(planHasContent(empty)).toBe(false);
    expect(planHasContent({ ...empty, todos: [todo('1', 'pending')] })).toBe(true);
    expect(planHasContent({ ...empty, subagents: [helper] })).toBe(true);
    expect(planHasContent({ ...empty, usage: { total: 10 } })).toBe(true);
    expect(planHasContent({ ...empty, goal: { title: 'Ship it', status: 'active', turns_used: 0, max_turns: 20 } as never })).toBe(true);
  });
});

describe('where Details opens', () => {
  test('a sheet on a phone, an overlay on a tablet and a column from 1280 px', () => {
    expect(detailsLayout(390)).toBe('sheet');
    expect(detailsLayout(599)).toBe('sheet');
    expect(detailsLayout(600)).toBe('overlay');
    expect(detailsLayout(1279)).toBe('overlay');
    expect(detailsLayout(1280)).toBe('column');
    expect(detailsLayout(1440)).toBe('column');
  });
});
