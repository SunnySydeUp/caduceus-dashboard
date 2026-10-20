import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import type { HermesBackend } from '../src/hermes-backend.ts';
import { openEventStream, type EventStream } from './fixtures/event-stream.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';

// The worker log of a run (M3 #11, architecture §4 "Live relays"): Hermes can only be asked for the last bytes of a task's log, so Caduceus asks once for
// everyone who watches a run and pushes what is new. In front of the real Hermes in a throwaway HERMES_HOME; the log is written where Hermes's
// own `GET /tasks/{id}/log` says it is, the way a worker's stdout lands in it, and a run is made and ended with Hermes's own CLI and REST.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
const streams: EventStream[] = [];
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 90_000);
afterAll(() => hermes.stop());
afterEach(async () => {
  for (const stream of streams.splice(0)) stream.close();
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

/** The backend as Caduceus sees it, noting every request it makes of Hermes. */
function noting(backend: HermesBackend, asked: string[]): HermesBackend {
  return new Proxy(backend, {
    get(target, name) {
      if (name === 'fetch') return (route: string, init?: RequestInit) => (asked.push(route), target.fetch(route, init));
      const value = Reflect.get(target, name);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

async function start(options: { pollMs?: number; asked?: string[] } = {}) {
  server = await startCaduceusServer({ backend: options.asked ? noting(hermes.backend, options.asked) : hermes.backend, hermesRoot: hermes.home, logPollMs: options.pollMs ?? 20 });
  const { url } = server;
  const cookie = await ownerCookie(url);
  return {
    url,
    cookie,
    async watch(route: string) {
      const stream = await openEventStream(url, route, cookie);
      streams.push(stream);
      return stream;
    },
  };
}

/** A task a worker of `coder` has claimed (so a run is open), and where Hermes keeps that task's worker log. */
async function runningTask(title: string): Promise<{ taskId: string; runId: number; logPath: string }> {
  const response = await hermes.backend.fetch('/api/plugins/kanban/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
  const created: { task: { id: string } } = await response.json();
  const taskId = created.task.id;
  await hermes.cli('kanban', 'assign', taskId, 'coder');
  await hermes.cli('kanban', 'claim', taskId);
  const task: { task: { current_run_id: number } } = await (await hermes.backend.fetch(`/api/plugins/kanban/tasks/${taskId}`)).json();
  const log: { path: string } = await (await hermes.backend.fetch(`/api/plugins/kanban/tasks/${taskId}/log`)).json();
  return { taskId, runId: task.task.current_run_id, logPath: log.path };
}

const writeLog = (logPath: string, text: string) => {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, text);
};
const logStream = (runId: number | string, query = '') => `/_caduceus/api/work/runs/${runId}/log/stream${query}`;

describe('the worker log of a running run', () => {
  test('starts with the lines Hermes has, pushes the lines the worker writes after, and ends with the run', async () => {
    const { runId, taskId, logPath } = await runningTask('Tail me');
    writeLog(logPath, 'booting worker\nreading the brief\n');
    const owner = await start();

    const stream = await owner.watch(logStream(runId));
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toContain('text/event-stream');
    expect(await stream.next()).toEqual({ event: 'replace', data: { kind: 'replace', lines: ['booting worker', 'reading the brief'] } });

    writeLog(logPath, 'running the tests\n');
    expect(await stream.next()).toEqual({ event: 'append', data: { kind: 'append', lines: ['running the tests'] } });

    // The run ends (the owner terminates it): the tail says so and stops, after the lines that came with the end.
    writeLog(logPath, 'terminated\n');
    const ended = await hermes.backend.fetch(`/api/plugins/kanban/runs/${runId}/terminate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'test' }) });
    expect(ended.status).toBe(200);
    const heard: string[] = [];
    for (;;) {
      const update = await stream.next();
      heard.push(update.event);
      if (update.event === 'ended') break;
    }
    expect(heard.at(-1)).toBe('ended');
    await expect(stream.next()).rejects.toThrow('ended');
    const after: { task: { status: string } } = await (await hermes.backend.fetch(`/api/plugins/kanban/tasks/${taskId}`)).json();
    expect(after.task.status).not.toBe('running');
  });

  test('a run that has already ended gives its whole log and `ended` at once', async () => {
    const { runId, logPath } = await runningTask('Already over');
    writeLog(logPath, 'one\ntwo\n');
    await hermes.backend.fetch(`/api/plugins/kanban/runs/${runId}/terminate`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const owner = await start();

    const stream = await owner.watch(logStream(runId));

    expect(await stream.next()).toEqual({ event: 'replace', data: { kind: 'replace', lines: ['one', 'two'] } });
    expect(await stream.next()).toEqual({ event: 'ended', data: { kind: 'ended' } });
  });

  test('a run whose task never spawned a worker has an empty log', async () => {
    const { runId } = await runningTask('Silent');
    const owner = await start();

    expect(await (await owner.watch(logStream(runId))).next()).toEqual({ event: 'replace', data: { kind: 'replace', lines: [] } });
  });
});

describe('several viewers of one run', () => {
  test('are one ask of Hermes for the log, and each hears the same new lines', async () => {
    const { runId, logPath } = await runningTask('Shared');
    writeLog(logPath, 'first\n');
    const asked: string[] = [];
    // The next ask is an hour away: after the first, anything more that reaches Hermes would be a second poller.
    const owner = await start({ pollMs: 3_600_000, asked });

    const one = await owner.watch(logStream(runId));
    const two = await owner.watch(logStream(runId));
    const three = await owner.watch(logStream(runId));

    for (const stream of [one, two, three]) expect(await stream.next()).toEqual({ event: 'replace', data: { kind: 'replace', lines: ['first'] } });
    expect(asked.filter((route) => route.includes('/log'))).toHaveLength(1);
    expect(asked.filter((route) => /\/runs\/\d+(\?|$)/.test(route))).toHaveLength(1);
  });

  test('one leaving does not end the others', async () => {
    const { runId, logPath } = await runningTask('Leaver');
    writeLog(logPath, 'a\n');
    const owner = await start();
    const one = await owner.watch(logStream(runId));
    const two = await owner.watch(logStream(runId));
    expect((await one.next()).event).toBe('replace');
    expect((await two.next()).event).toBe('replace');

    one.close();
    writeLog(logPath, 'b\n');

    expect(await two.next()).toEqual({ event: 'append', data: { kind: 'append', lines: ['b'] } });
  });
});

describe('what the stream refuses', () => {
  test('a run Hermes does not have is refused in the stream, and the stream ends', async () => {
    const owner = await start();
    const stream = await owner.watch(logStream(987654));

    expect(await stream.next()).toMatchObject({ event: 'rejected', data: { kind: 'rejected' } });
    await expect(stream.next()).rejects.toThrow('ended');
  });

  test('a run number or a board that is not one is a bad request, and no session is no stream', async () => {
    const owner = await start();

    expect((await owner.watch(logStream('abc'))).status).toBe(400);
    expect((await owner.watch(logStream(0))).status).toBe(400);
    expect((await owner.watch(logStream(1, '?board=../etc'))).status).toBe(400);
    expect((await openEventStream(owner.url, logStream(1), '')).status).toBe(401);
  });

  test('the stream of a session that signs out ends with it', async () => {
    const { runId } = await runningTask('Sign out');
    const owner = await start();
    const stream = await owner.watch(logStream(runId));
    expect((await stream.next()).event).toBe('replace');

    await fetch(`${owner.url}/_caduceus/api/auth/sign-out`, { method: 'POST', headers: { origin: owner.url, cookie: owner.cookie } });

    await expect(stream.next()).rejects.toThrow('ended');
  });
});
