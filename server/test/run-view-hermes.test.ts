import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { seedWorkerSession, type SeedWorkerRow } from './fixtures/seed-session.ts';
import { parseRun, parseSessionRows, pickRunSession, rowsPath, sessionsPath, stepsOf } from '../../web/src/modules/work/run-model.ts';
import { requests } from '../../web/src/modules/work/task-requests.ts';

// The run view (M3 #11) in front of the real Hermes in a throwaway HERMES_HOME. A run is made the way a worker makes one (`hermes kanban claim`);
// the worker's session is written the way a dispatched worker leaves it (source `kanban`, first message `work kanban task <id>`). What the page
// reads, and how it reads it, is the web app's own `run-model.ts`, so what is checked here is what the page does.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 90_000);
afterAll(() => hermes.stop());
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function start() {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, hermesInstallDir: hermes.install.dir });
  const cookie = await ownerCookie(server.url);
  const url = server.url;
  return {
    url,
    cookie,
    async get(route: string): Promise<unknown> {
      const res = await fetch(`${url}${route}`, { headers: { cookie } });
      if (!res.ok) throw new Error(`${route}: HTTP ${res.status}`);
      return res.json();
    },
    async send(request: { method: string; path: string; body?: unknown }) {
      const res = await fetch(`${url}${request.path}`, { method: request.method, headers: { cookie, origin: url, ...(request.body ? { 'content-type': 'application/json' } : {}) }, body: request.body ? JSON.stringify(request.body) : undefined });
      return { status: res.status, body: await res.json().catch(() => undefined) };
    },
  };
}

/** A task the `default` profile's worker has claimed: one open run. */
async function runningTask(title: string): Promise<{ taskId: string; runId: number }> {
  const response = await hermes.backend.fetch('/api/plugins/kanban/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
  const created: { task: { id: string } } = await response.json();
  await hermes.cli('kanban', 'assign', created.task.id, 'default');
  await hermes.cli('kanban', 'claim', created.task.id);
  const detail: { task: { current_run_id: number } } = await (await hermes.backend.fetch(`/api/plugins/kanban/tasks/${created.task.id}`)).json();
  return { taskId: created.task.id, runId: detail.task.current_run_id };
}

const call = (id: string, name: string, args: Record<string, unknown>) => ({ id, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } });
const WORK: SeedWorkerRow[] = [
  { role: 'user', content: 'PROMPT', at: 0 },
  { role: 'assistant', content: '', tool_calls: [call('c1', 'read_file', { path: 'a.txt' })], at: 10, token_count: 50 },
  { role: 'tool', tool_call_id: 'c1', content: 'file text', at: 12 },
  { role: 'assistant', content: 'Running the tests', tool_calls: [call('c2', 'terminal', { command: 'npm test' })], at: 20, token_count: 20 },
  { role: 'tool', tool_call_id: 'c2', content: JSON.stringify({ error: 'npm test failed' }), at: 30 },
  { role: 'assistant', content: 'All done.', at: 40, token_count: 30 },
];

describe('a run and the session of its worker, as Hermes serves them', () => {
  test('the run is found by its number, its worker’s session by what the worker leaves, and the steps are read from the session’s rows', async () => {
    const owner = await start();
    const mine = await runningTask('Work for the run view');
    const other = await runningTask('Another task, running at the same time');
    const run = parseRun(await owner.get(`/api/plugins/kanban/runs/${mine.runId}`));
    expect(run).toMatchObject({ id: mine.runId, taskId: mine.taskId, endedAt: null });
    const otherRun = parseRun(await owner.get(`/api/plugins/kanban/runs/${other.runId}`));
    const prompt = (taskId: string) => WORK.map((row) => (row.role === 'user' ? { ...row, content: `work kanban task ${taskId}` } : row));
    await seedWorkerSession(hermes.home, { id: 'worker-mine', cwd: '/tmp/space-a', startedAt: run.startedAt + 2, rows: prompt(mine.taskId), usage: { inputTokens: 900, outputTokens: 100, costUsd: 0.07 } });
    await seedWorkerSession(hermes.home, { id: 'worker-other', cwd: '/tmp/space-b', startedAt: otherRun.startedAt + 2, rows: prompt(other.taskId) });
    await seedWorkerSession(hermes.home, { id: 'worker-before', cwd: '/tmp/space-a', startedAt: run.startedAt - 3600, rows: prompt(mine.taskId) });

    const sessions = parseSessionRows(await owner.get(sessionsPath(run, 0)));
    const session = pickRunSession(run, sessions);
    expect(session).toMatchObject({ id: 'worker-mine', inputTokens: 900, outputTokens: 100, costUsd: 0.07 });
    expect(pickRunSession(otherRun, sessions)?.id).toBe('worker-other');

    const body = (await owner.get(rowsPath(session!.id, run.profile, 0))) as { messages: Parameters<typeof stepsOf>[0] };
    const steps = stepsOf(body.messages, { finished: false });
    expect(steps.map(({ title, durationS, tokens, outcome }) => ({ title, durationS, tokens, outcome }))).toEqual([
      { title: 'read_file', durationS: 12, tokens: 50, outcome: 'done' },
      { title: 'Running the tests', durationS: 18, tokens: 20, outcome: 'failed' },
      { title: 'All done.', durationS: 10, tokens: 30, outcome: 'running' },
    ]);
  });

  test('a run whose worker has not begun a session has none', async () => {
    const owner = await start();
    const { runId } = await runningTask('No session yet');
    const run = parseRun(await owner.get(`/api/plugins/kanban/runs/${runId}`));

    expect(pickRunSession(run, parseSessionRows(await owner.get(sessionsPath(run, 0))))).toBeUndefined();
  });
});

describe('the run view’s actions are audited', () => {
  test('Terminate, Reclaim and Retry leave an entry each, naming the operation and the profile', async () => {
    const owner = await start();
    const first = await runningTask('Terminate from the run view');
    expect((await owner.send(requests.terminate(first.runId, 'Terminated from Caduceus'))).status).toBe(200);
    const second = await runningTask('Reclaim from the run view');
    expect((await owner.send(requests.reclaim(second.taskId, 'Reclaimed from Caduceus'))).status).toBe(200);
    const retried = await owner.send(requests.retry(first.taskId));
    expect(retried.status).toBe(200);
    const after: { task: { status: string } } = (await owner.get(`/api/plugins/kanban/tasks/${first.taskId}`)) as { task: { status: string } };
    expect(after.task.status).toBe('ready');

    const audit = (await owner.get('/_caduceus/api/audit')) as { entries: { action: string; tier: string }[] };
    const actions = audit.entries.map((entry) => `${entry.tier} ${entry.action}`);
    expect(actions).toContain('T1 POST /api/plugins/kanban/runs/{run_id}/terminate');
    expect(actions).toContain('T1 POST /api/plugins/kanban/tasks/{task_id}/reclaim');
    expect(actions).toContain('T1 POST /_caduceus/api/work/tasks/{task_id}/retry');
  });

  test('Retry of a task Hermes does not have is a 404 that changes nothing, and a board that is not one is a bad request', async () => {
    const owner = await start();

    expect((await owner.send(requests.retry('t_nothere'))).status).toBe(404);
    expect((await owner.send(requests.retry('t_x', '../etc'))).status).toBe(400);
  });
});
