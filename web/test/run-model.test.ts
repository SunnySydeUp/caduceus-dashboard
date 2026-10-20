import { describe, expect, test } from 'vitest';
import { chatHref, parseInspect, runActions, parseRun, parseSessionRows, pickRunSession, runSummary, sessionsPath, stepsOf, shownLogLines, parseDensity, DENSITIES } from '../src/modules/work/run-model.ts';

// The run view's pure half (M3 #11): what Hermes's run and session routes say, read defensively, and which of the worker sessions in Hermes's
// store is a run's. Hermes records no link from a run to its session, so the link is read from what a dispatched worker leaves: source `kanban`,
// the first user message `work kanban task <id>` and the time it started.

const hermesRun = (extra: Record<string, unknown> = {}) => ({
  id: 7,
  task_id: 't_abc',
  profile: 'coder',
  step_key: null,
  status: 'running',
  claim_lock: 'x',
  claim_expires: 1_700_000_900,
  worker_pid: 4242,
  max_runtime_seconds: 600,
  last_heartbeat_at: 1_700_000_140,
  started_at: 1_700_000_100,
  ended_at: null,
  outcome: null,
  summary: null,
  metadata: { cost_usd: 0.25 },
  error: null,
  ...extra,
});

const hermesSession = (id: string, startedAt: number, extra: Record<string, unknown> = {}) => ({
  id,
  source: 'kanban',
  started_at: startedAt,
  ended_at: null,
  cwd: '/work/space',
  preview: 'work kanban task t_abc',
  input_tokens: 1000,
  output_tokens: 200,
  estimated_cost_usd: 0.5,
  actual_cost_usd: null,
  message_count: 4,
  profile: 'coder',
  ...extra,
});

describe('reading the run Hermes gives', () => {
  test('is the run with its task, profile, times and outcome; an answer that is not a run is an error', () => {
    expect(parseRun({ run: hermesRun() })).toEqual({
      id: 7,
      taskId: 't_abc',
      profile: 'coder',
      status: 'running',
      outcome: null,
      summary: null,
      error: null,
      metadata: { cost_usd: 0.25 },
      startedAt: 1_700_000_100,
      endedAt: null,
      workerPid: 4242,
    });
    expect(parseRun({ run: hermesRun({ ended_at: 1_700_000_200, outcome: 'completed', status: 'completed', summary: 'Did it', worker_pid: null }) })).toMatchObject({ endedAt: 1_700_000_200, outcome: 'completed', summary: 'Did it', workerPid: null });
    expect(() => parseRun({ detail: 'run not found' })).toThrow();
    expect(() => parseRun({ run: { id: 'x' } })).toThrow();
  });
});

describe('which session is the run’s', () => {
  const run = parseRun({ run: hermesRun({ started_at: 1_700_000_100, ended_at: 1_700_000_400, outcome: 'completed' }) });

  test('is asked of Hermes as the kanban sessions of the run’s profile, newest first, in one page', () => {
    expect(sessionsPath(run, 0)).toBe('/api/sessions?source=kanban&profile=coder&order=created&limit=100&offset=0');
    expect(sessionsPath(run, 100)).toBe('/api/sessions?source=kanban&profile=coder&order=created&limit=100&offset=100');
    expect(sessionsPath({ ...run, profile: null }, 0)).toBe('/api/sessions?source=kanban&order=created&limit=100&offset=0');
  });

  test('is the session of this task that started with the run: not another task’s, not an earlier run’s, not a later run’s', () => {
    const rows = parseSessionRows({
      sessions: [
        hermesSession('later-run', 1_700_000_900),
        hermesSession('other-task', 1_700_000_105, { preview: 'work kanban task t_zzz' }),
        hermesSession('this-run', 1_700_000_103),
        hermesSession('earlier-run', 1_699_999_000),
      ],
    });

    expect(pickRunSession(run, rows)?.id).toBe('this-run');
  });

  test('is the one that started after the run began, while the run is still going', () => {
    const going = parseRun({ run: hermesRun() });
    const rows = parseSessionRows({ sessions: [hermesSession('this-run', 1_700_000_103), hermesSession('earlier-run', 1_699_999_000)] });

    expect(pickRunSession(going, rows)?.id).toBe('this-run');
  });

  test('is the earliest session that started inside the run when a worker made two', () => {
    const rows = parseSessionRows({ sessions: [hermesSession('second', 1_700_000_300), hermesSession('first', 1_700_000_103)] });

    expect(pickRunSession(run, rows)?.id).toBe('first');
  });

  test('is none when no worker session started with the run, and a row that is not a session is dropped', () => {
    expect(pickRunSession(run, parseSessionRows({ sessions: [hermesSession('earlier-run', 1_699_999_000), { nonsense: true }] }))).toBeUndefined();
    expect(parseSessionRows({ sessions: [{ nonsense: true }] })).toEqual([]);
  });

  test('carries what Hermes recorded of the session: tokens, cost (the real one over the estimate) and its profile', () => {
    const [row] = parseSessionRows({ sessions: [hermesSession('a', 1_700_000_103, { actual_cost_usd: 0.4 })] });

    expect(row).toMatchObject({ id: 'a', startedAt: 1_700_000_103, inputTokens: 1000, outputTokens: 200, costUsd: 0.4, profile: 'coder' });
    expect(parseSessionRows({ sessions: [hermesSession('b', 1)] })[0]!.costUsd).toBe(0.5);
    expect(parseSessionRows({ sessions: [hermesSession('c', 1, { estimated_cost_usd: null })] })[0]!.costUsd).toBeNull();
  });
});

// The rows of a worker's session as Hermes's `/messages` serves them (timestamps in seconds).
const call = (id: string, name: string, args: Record<string, unknown> = {}) => ({ id, type: 'function', function: { name, arguments: JSON.stringify(args) } });
const SESSION_ROWS = [
  { id: 1, role: 'user', content: 'work kanban task t_abc', timestamp: 100 },
  { id: 2, role: 'assistant', content: '', tool_calls: [call('c1', 'read_file', { path: 'a.txt' })], timestamp: 110, token_count: 50 },
  { id: 3, role: 'tool', tool_call_id: 'c1', content: 'file text', timestamp: 112 },
  { id: 4, role: 'assistant', content: 'Now the tests', tool_calls: [call('c2', 'terminal', { command: 'npm test' })], timestamp: 120, token_count: 20 },
  { id: 5, role: 'tool', tool_call_id: 'c2', content: JSON.stringify({ error: 'npm test failed' }), timestamp: 130 },
  { id: 6, role: 'assistant', content: 'All done. The tests pass after the fix.', timestamp: 140, token_count: 30 },
];

describe('the steps of a run', () => {
  test('are the worker’s turns: each assistant message with the tool results that answer it, timed from the row before it', () => {
    const steps = stepsOf(SESSION_ROWS, { finished: true });

    expect(steps.map(({ index, title, durationS, tokens, outcome, toolCount }) => ({ index, title, durationS, tokens, outcome, toolCount }))).toEqual([
      { index: 1, title: 'read_file', durationS: 12, tokens: 50, outcome: 'done', toolCount: 1 },
      { index: 2, title: 'Now the tests', durationS: 18, tokens: 20, outcome: 'failed', toolCount: 1 },
      { index: 3, title: 'All done. The tests pass after the fix.', durationS: 10, tokens: 30, outcome: 'done', toolCount: 0 },
    ]);
    expect(steps[1]!.rows.map((row) => row.id)).toEqual([4, 5]);
    expect(steps[1]!.failure).toBe('npm test failed');
  });

  test('a step with no recorded tokens has none, and the last step of a session still going is running', () => {
    const rows = SESSION_ROWS.map(({ token_count: _gone, ...row }) => row);
    const steps = stepsOf(rows, { finished: false });

    expect(steps.map((step) => step.tokens)).toEqual([null, null, null]);
    expect(steps.map((step) => step.outcome)).toEqual(['done', 'failed', 'running']);
  });

  test('a tool call with no result in a finished session is incomplete, and several tools name the step by the first three', () => {
    const rows = [
      { id: 1, role: 'user', content: 'go', timestamp: 100 },
      { id: 2, role: 'assistant', content: '', tool_calls: [call('a', 'one'), call('b', 'two'), call('c', 'three'), call('d', 'four')], timestamp: 105 },
      { id: 3, role: 'tool', tool_call_id: 'a', content: 'ok', timestamp: 106 },
    ];
    const [step] = stepsOf(rows, { finished: true });

    expect(step).toMatchObject({ title: 'one, two, three +1', outcome: 'incomplete', toolCount: 4 });
  });

  test('rows that hold no assistant message are no steps, and a hidden row is skipped', () => {
    expect(stepsOf([{ id: 1, role: 'user', content: 'go', timestamp: 100 }], { finished: false })).toEqual([]);
    const hidden = [...SESSION_ROWS, { id: 7, role: 'assistant', content: 'secret', display_kind: 'hidden', timestamp: 150 }];
    expect(stepsOf(hidden, { finished: true })).toHaveLength(3);
  });

  test('a user message in the middle (a nudge to go on) belongs to the step before it', () => {
    const rows = [...SESSION_ROWS.slice(0, 3), { id: 9, role: 'user', content: 'Continue.', timestamp: 113 }, ...SESSION_ROWS.slice(3)];
    const steps = stepsOf(rows, { finished: true });

    expect(steps[0]!.rows.map((row) => row.id)).toEqual([2, 3, 9]);
    expect(steps[1]!.durationS).toBe(17);
  });
});

describe('the figures of the header', () => {
  const run = parseRun({ run: hermesRun() });
  const [session] = parseSessionRows({ sessions: [hermesSession('a', 1_700_000_103, { actual_cost_usd: 0.4 })] });

  test('a run that is going is Running, timed up to now, and costs what its session cost', () => {
    expect(runSummary(run, session, 1_700_000_160)).toEqual({ label: 'Running', running: true, elapsedS: 60, costUsd: 0.4, costFrom: 'session', tokens: 1200 });
  });

  test('a run that has ended says how, and is timed from its start to its end whatever the time now is', () => {
    const ended = parseRun({ run: hermesRun({ ended_at: 1_700_000_190, outcome: 'timed_out', status: 'timed_out' }) });

    expect(runSummary(ended, undefined, 1_800_000_000)).toMatchObject({ label: 'Timed out', running: false, elapsedS: 90 });
  });

  test('without a session the cost is what the worker reported in the run’s metadata, and without that there is none', () => {
    expect(runSummary(run, undefined, 1_700_000_160)).toMatchObject({ costUsd: 0.25, costFrom: 'worker', tokens: null });
    expect(runSummary(parseRun({ run: hermesRun({ metadata: null }) }), undefined, 1_700_000_160)).toMatchObject({ costUsd: null, costFrom: null });
  });
});

describe('the worker log in each density', () => {
  const LINES = ['\u001b[32mINFO\u001b[0m starting', '', '╭──────────╮', '│ ☤ Hermes │', 'Initializing agent...', 'session_id: 20261001_abc', 'tool: read_file a.txt'];

  test('Raw is every line as the worker wrote it, colour codes and all', () => {
    expect(shownLogLines(LINES, 'raw')).toEqual(LINES);
  });

  test('Stream is every line without the colour codes', () => {
    expect(shownLogLines(LINES, 'stream')).toEqual(['INFO starting', '', '╭──────────╮', '│ ☤ Hermes │', 'Initializing agent...', 'session_id: 20261001_abc', 'tool: read_file a.txt']);
  });

  test('Worklog drops the blank lines, the frames the CLI draws and its start-up chatter, and keeps what the worker did', () => {
    expect(shownLogLines(LINES, 'worklog')).toEqual(['INFO starting', 'tool: read_file a.txt']);
  });

  test('the device’s choice is read back; anything else is no choice, and Worklog is the default Chat has too', () => {
    expect(DENSITIES).toEqual(['stream', 'worklog', 'raw']);
    expect(parseDensity('raw')).toBe('raw');
    expect(parseDensity('final')).toBeUndefined();
    expect(parseDensity(null)).toBeUndefined();
  });
});

describe('the live worker Hermes inspects', () => {
  test('a live worker has its process figures, in plain units; a worker that is not there says why', () => {
    expect(parseInspect({ run_id: 7, alive: true, pid: 4242, cpu_percent: 12.5, memory_rss_bytes: 150 * 1024 * 1024, num_threads: 9, status: 'sleeping' })).toEqual({ alive: true, pid: 4242, cpuPercent: 12.5, memoryBytes: 150 * 1024 * 1024, threads: 9, status: 'sleeping', reason: null });
    expect(parseInspect({ run_id: 7, alive: false, reason: 'run already ended' })).toEqual({ alive: false, pid: null, cpuPercent: null, memoryBytes: null, threads: null, status: null, reason: 'run already ended' });
    expect(parseInspect({ run_id: 7, alive: true, pid: 4242, error: 'access denied' })).toMatchObject({ alive: true, pid: 4242, reason: 'access denied' });
    expect(parseInspect('nonsense')).toEqual({ alive: false, pid: null, cpuPercent: null, memoryBytes: null, threads: null, status: null, reason: null });
  });
});

describe('Open in Chat', () => {
  test('is the session’s own address, scoped to the profile that holds it', () => {
    expect(chatHref('20261001_abc', 'coder')).toBe('/chat/20261001_abc?profile=coder');
    expect(chatHref('20261001_abc', null)).toBe('/chat/20261001_abc');
    expect(chatHref('a/b', 'x y')).toBe('/chat/a%2Fb?profile=x+y');
  });
});

describe('the actions of a run', () => {
  const task = (status: string) => ({ status, currentRunId: 7 }) as Parameters<typeof runActions>[0];
  const run = (extra: Record<string, unknown> = {}) => parseRun({ run: hermesRun(extra) });
  const ended = { ended_at: 1_700_000_200, outcome: 'crashed' };

  test('a run that is going can be terminated, and its task’s claim reclaimed', () => {
    expect(runActions(task('running'), run(), [run()])).toEqual(['terminate', 'reclaim']);
  });

  test('the newest run of a task that Hermes will take back to Ready can be retried; an older run, or a task that is done, cannot', () => {
    const newest = run(ended);
    expect(runActions(task('blocked'), newest, [newest])).toEqual(['retry']);
    expect(runActions(task('todo'), newest, [newest])).toEqual(['retry']);
    expect(runActions(task('done'), run({ ...ended, outcome: 'completed' }), [])).toEqual([]);
    const older = run({ ...ended, id: 3, started_at: 1_699_000_000 });
    expect(runActions(task('blocked'), older, [older, newest])).toEqual([]);
  });

  test('a task that has been archived has no actions', () => {
    expect(runActions(task('archived'), run(), [run()])).toEqual([]);
  });
});
