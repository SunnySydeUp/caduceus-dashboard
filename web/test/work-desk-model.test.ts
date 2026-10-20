import { describe, expect, test } from 'vitest';
import type { LiveRun } from '@caduceus/contracts/inbox';
import type { ReadyItem } from '@caduceus/contracts/today';
import { BOARD_STATUSES, BLOCK_KINDS, type BoardStatus, type BoardTask, type BlockKind } from '../src/modules/work/board-model.ts';
import type { Job } from '../src/modules/work/schedules-model.ts';
import { groupWork, readyTaskId, whenInWords, WORK_GROUPS, type WorkGroupId, type WorkInput, type WorkRow } from '../src/modules/work/work-desk-model.ts';

const NOW = Date.parse('2026-10-19T12:00:00Z');
const MINUTE = 60_000;
const seconds = (at: number) => Math.floor(at / 1000);

function task(id: string, status: BoardStatus, fields: Partial<BoardTask> = {}): BoardTask {
  return {
    id,
    title: `Task ${id}`,
    status,
    assignee: 'coder',
    priority: 0,
    tenant: null,
    projectId: null,
    blockKind: null,
    summary: null,
    commentCount: 0,
    createdAt: seconds(NOW - 60 * MINUTE),
    workflowTemplateId: null,
    currentStepKey: null,
    idempotencyKey: null,
    startedAt: null,
    completedAt: null,
    lastHeartbeatAt: null,
    failures: 0,
    lastFailureError: null,
    ...fields,
  };
}

function job(id: string, fields: Partial<Job> = {}): Job {
  return { id, name: `Job ${id}`, profile: 'coder', type: 'agent', enabled: true, state: 'scheduled', schedule: 'Every day at 23:00', scheduleExpression: '0 23 * * *', nextRunAt: NOW + 60 * MINUTE, config: {}, ...fields };
}

function run(sessionId: string, fields: Partial<LiveRun> = {}): LiveRun {
  return { sessionId, storedSessionId: `stored-${sessionId}`, title: `Run ${sessionId}`, profile: 'coder', status: 'running', since: NOW - 5 * MINUTE, ...fields };
}

/** What Today's review state says of a task that is done and not opened: its id, and the finish it stands for. */
function readyTask(slug: string, done: BoardTask): ReadyItem {
  return { id: readyTaskId(slug, done.id), stamp: String(done.completedAt), kind: 'task', title: done.title, summary: undefined, profile: done.assignee ?? undefined, at: done.completedAt! * 1000, to: `/work/tasks/${done.id}` };
}

/** A chat that finished and has not been opened. */
function readyRun(session: string, at: number, fields: Partial<ReadyItem> = {}): ReadyItem {
  return { id: `run:${session}`, stamp: String(at), kind: 'run', title: `Run ${session}`, summary: undefined, profile: 'coder', at, to: `/chat/${session}`, ...fields };
}

const none: WorkInput = { boards: [], runs: [], ready: [], jobs: [] };

/** The keys of each group's rows, so that a test says only what it checks. */
function keys(input: Partial<WorkInput>, agent?: string): Record<WorkGroupId, string[]> {
  const { groups } = groupWork({ ...none, ...input }, agent);
  return Object.fromEntries(WORK_GROUPS.map((id) => [id, groups[id].map((row: WorkRow) => row.key)])) as Record<WorkGroupId, string[]>;
}

describe('where a Kanban task goes', () => {
  test('each status and each block kind has one group: what needs the owner waits, a worker on it runs, finished work is ready for review, and what has not started is scheduled', () => {
    const blocked = (kind: BlockKind | null) => task(`blocked-${kind}`, 'blocked', { blockKind: kind });
    const tasks = [
      ...BOARD_STATUSES.filter((status) => status !== 'blocked').map((status) => task(status, status, status === 'done' ? { completedAt: seconds(NOW - MINUTE) } : {})),
      ...[...BLOCK_KINDS, null].map(blocked),
    ];
    const placed = keys({ boards: [{ slug: 'default', tasks }], ready: tasks.filter((candidate) => candidate.status === 'done').map((done) => readyTask('default', done)) });
    const at = (id: string) => `task:default/${id}`;

    expect(placed.waiting.sort()).toEqual(['review', 'blocked-needs_input', 'blocked-capability', 'blocked-null'].map(at).sort());
    expect(placed.running).toEqual([at('running')]);
    expect(placed.review).toEqual([at('done')]);
    expect(placed.scheduled.sort()).toEqual(['triage', 'todo', 'scheduled', 'ready', 'blocked-dependency', 'blocked-transient'].map(at).sort());
  });
});

describe('where a run, a finished run and a schedule go', () => {
  test('a live run is Running, one stopped on the owner is Waiting, an unopened finished run is Ready for review, and every schedule is Scheduled whether it is timed, paused or over', () => {
    const placed = keys({
      runs: [run('a'), run('b', { status: 'waiting' })],
      ready: [readyRun('done-1', NOW - MINUTE)],
      jobs: [job('timed'), job('paused', { enabled: false, state: 'paused', nextRunAt: undefined }), job('over', { state: 'completed', nextRunAt: undefined })],
    });

    expect(placed).toEqual({
      waiting: ['run:b'],
      running: ['run:a'],
      review: ['finished:done-1'],
      scheduled: ['job:coder/timed', 'job:coder/paused', 'job:coder/over'],
    });
  });

  test('a chat Hermes still lists as live is not also Ready for review, even while it is on the list of finished work', () => {
    const { groups } = groupWork({ ...none, runs: [run('x', { storedSessionId: 'live-1' })], ready: [readyRun('live-1', NOW - 9 * MINUTE), readyRun('over', NOW - 3 * MINUTE)] });

    expect(groups.running.map((row) => row.key)).toEqual(['run:x']);
    expect(groups.review.map((row) => row.key)).toEqual(['finished:over']);
  });

  test('a done task that is not on the list of finished work, or that was done again since it was opened, is in no group and is counted as settled', () => {
    const tasks = [task('new', 'done', { completedAt: seconds(NOW - MINUTE) }), task('opened', 'done', { completedAt: seconds(NOW - 99 * MINUTE) }), task('again', 'done', { completedAt: seconds(NOW - 2 * MINUTE) })];
    const staleStamp = { ...readyTask('default', tasks[2]), stamp: String(seconds(NOW - 50 * MINUTE)) };
    const result = groupWork({ ...none, boards: [{ slug: 'default', tasks }], ready: [readyTask('default', tasks[0]), staleStamp] });

    expect(result.groups.review.map((row) => row.key)).toEqual(['task:default/new']);
    expect(result.groups.review[0].opened).toEqual({ id: 'task:default:new', stamp: String(seconds(NOW - MINUTE)) });
    expect(result.settled).toBe(2);
  });

  test('a task is one row on each board that has it, since a board is a place of its own', () => {
    const placed = keys({ boards: [{ slug: 'default', tasks: [task('t_1', 'running')] }, { slug: 'other', tasks: [task('t_1', 'running')] }] });

    expect(placed.running).toEqual(['task:default/t_1', 'task:other/t_1']);
  });
});

describe('what a row says and where it leads', () => {
  test('a waiting task offers Decide, a running one Open, a finished one Review, and a timed schedule Pause (Resume once paused), each leading to the task or the schedule', () => {
    const finishedTask = task('t_c', 'done', { completedAt: seconds(NOW) });
    const { groups } = groupWork({
      ...none,
      ready: [readyTask('my board', finishedTask)],
      boards: [{ slug: 'my board', tasks: [task('t_a', 'review'), task('t_b', 'running', { currentStepKey: 'draft' }), finishedTask] }],
      jobs: [job('j 1'), job('j2', { enabled: false, state: 'paused' })],
      runs: [run('r', { storedSessionId: undefined })],
    });
    const rows = Object.fromEntries(WORK_GROUPS.flatMap((id) => groups[id]).map((row) => [row.key, row]));

    expect(rows['task:my board/t_a']).toMatchObject({ action: 'decide', to: '/work/tasks/t_a?board=my%20board' });
    expect(rows['task:my board/t_b']).toMatchObject({ action: 'open', line: 'Stage: draft' });
    expect(rows['task:my board/t_c']).toMatchObject({ action: 'review' });
    expect(rows['job:coder/j 1']).toMatchObject({ action: 'pause', to: '/work/schedules/j%201', line: 'Every day at 23:00' });
    expect(rows['job:coder/j2']).toMatchObject({ action: 'resume', when: { kind: 'paused' } });
    expect(rows['run:r']).toMatchObject({ action: 'open', to: '/chat' });
  });

  test('a background run Hermes has going is a running row that says it runs in the background, and opens its own session', () => {
    const { groups } = groupWork({ ...none, runs: [run('bg_1', { background: true, storedSessionId: 'bg_1' })] });
    expect(groups.running).toEqual([expect.objectContaining({ key: 'run:bg_1', line: 'Running in the background', action: 'open', to: '/chat/bg_1' })]);
  });

  test('a schedule whose last run failed says so beside its schedule', () => {
    const { groups } = groupWork({ ...none, jobs: [job('bad', { lastStatus: 'error' })] });

    expect(groups.scheduled[0].line).toBe('Every day at 23:00 · last run failed');
  });
});

describe('the order inside a group', () => {
  test('Waiting and Running put the oldest first, Ready for review the newest first', () => {
    const doneOld = task('done-old', 'done', { completedAt: seconds(NOW - 20 * MINUTE) });
    const doneNew = task('done-new', 'done', { completedAt: seconds(NOW - 30_000) });
    const placed = keys({
      boards: [{ slug: 'b', tasks: [doneOld, doneNew] }],
      runs: [run('new-wait', { status: 'waiting', since: NOW - MINUTE }), run('old-wait', { status: 'waiting', since: NOW - 9 * MINUTE }), run('new-go', { since: NOW - 2 * MINUTE }), run('old-go', { since: NOW - 7 * MINUTE })],
      ready: [readyRun('first', NOW - 9 * MINUTE), readyRun('last', NOW - MINUTE), readyTask('b', doneOld), readyTask('b', doneNew)],
    });

    expect(placed.waiting).toEqual(['run:old-wait', 'run:new-wait']);
    expect(placed.running).toEqual(['run:old-go', 'run:new-go']);
    expect(placed.review).toEqual(['task:b/done-new', 'finished:last', 'finished:first', 'task:b/done-old']);
  });

  test('Scheduled lists timed schedules by next run, then queued tasks by priority and age, then schedules that are off, then those that are over', () => {
    const queued = (id: string, priority: number, minutesOld: number) => task(id, 'ready', { priority, createdAt: seconds(NOW - minutesOld * MINUTE) });
    const placed = keys({
      boards: [{ slug: 'b', tasks: [queued('old', 0, 90), queued('urgent', 5, 5), queued('young', 0, 10)] }],
      jobs: [
        job('over', { state: 'completed', nextRunAt: undefined }),
        job('later', { nextRunAt: NOW + 120 * MINUTE }),
        job('paused', { enabled: false, state: 'paused' }),
        job('soon', { nextRunAt: NOW + 10 * MINUTE }),
      ],
    });

    expect(placed.scheduled).toEqual(['job:coder/soon', 'job:coder/later', 'task:b/urgent', 'task:b/old', 'task:b/young', 'job:coder/paused', 'job:coder/over']);
  });

  test('rows that tie keep a fixed order, whatever order Hermes answered in', () => {
    const tasks = ['t_3', 't_1', 't_2'].map((id) => task(id, 'ready'));

    expect(keys({ boards: [{ slug: 'b', tasks }] }).scheduled).toEqual(['task:b/t_1', 'task:b/t_2', 'task:b/t_3']);
    expect(keys({ boards: [{ slug: 'b', tasks: [...tasks].reverse() }] }).scheduled).toEqual(['task:b/t_1', 'task:b/t_2', 'task:b/t_3']);
  });
});

describe('the agent filter', () => {
  const everything: Partial<WorkInput> = {
    boards: [{ slug: 'b', tasks: [task('mine', 'running', { assignee: 'coder' }), task('theirs', 'review', { assignee: 'librarian' }), task('nobody', 'ready', { assignee: null })] }],
    runs: [run('r', { profile: 'librarian' }), run('anon', { profile: undefined })],
    jobs: [job('j', { profile: 'general' })],
  };

  test('one agent keeps only its rows, in every group, and a row nobody owns is only in the unfiltered view', () => {
    expect(keys(everything, 'librarian')).toEqual({ waiting: ['task:b/theirs'], running: ['run:r'], review: [], scheduled: [] });
    expect(keys(everything, 'coder')).toEqual({ waiting: [], running: ['task:b/mine'], review: [], scheduled: [] });
    const all = keys(everything);
    expect(Object.values(all).flat()).toContain('task:b/nobody');
    expect(Object.values(all).flat()).toContain('run:anon');
  });

  test('the agents are everyone who has a row, whatever the filter, sorted', () => {
    expect(groupWork({ ...none, ...everything }, 'coder').agents).toEqual(['coder', 'general', 'librarian']);
  });
});

describe('a row’s time in words', () => {
  test.each([
    [{ kind: 'asked', at: NOW - 6 * MINUTE }, 'Asked 6 min ago'],
    [{ kind: 'started', at: NOW - 12 * MINUTE }, 'Started 12 min ago'],
    [{ kind: 'finished', at: NOW - 2 * 60 * MINUTE }, 'Finished 2 h ago'],
    [{ kind: 'added', at: NOW - 3 * 24 * 60 * MINUTE }, 'Added 3 d ago'],
    [{ kind: 'next', at: NOW + 3 * 60 * MINUTE }, 'Next in 3 h'],
    [{ kind: 'asked', at: NOW + 5 * MINUTE }, 'Asked just now'],
    [{ kind: 'paused' }, 'Paused'],
    [{ kind: 'ended' }, 'Finished'],
    [undefined, ''],
  ] as const)('%j reads %j', (when, words) => {
    expect(whenInWords(when, NOW)).toBe(words);
  });
});
