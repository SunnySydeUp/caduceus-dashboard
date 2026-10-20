import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { HermesBackend } from '../src/hermes-backend.ts';
import { startCaduceusServer, type CaduceusServer, type CaduceusServerOptions } from '../src/caduceus-server.ts';
import { fakeHermesInstall, fakeStateDir, launchFakeHermes, scriptFakeHermes } from './fixtures/fake-hermes.ts';
import { connectBrowserSocket } from './fixtures/browser-socket.ts';
import { openEventStream, type EventStream, type ServerEvent } from './fixtures/event-stream.ts';
import { createDeploymentRepo, type DeploymentRepo } from './fixtures/deployment-repo.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// System › Maintenance › Updates (M5 #12) at the Caduceus HTTP seam, in front of the fake Hermes: a stub upstream whose `hermes update`
// the test drives line by line (`POST /api/__fake/update`), so that nothing is ever updated and no test waits on a clock. What the real
// Hermes answers to its update check is in updates-hermes.test.ts.
let backend: HermesBackend | undefined;
let server: CaduceusServer | undefined;
const dirs: string[] = [];
const deployments: DeploymentRepo[] = [];
afterEach(async () => {
  await server?.close();
  await backend?.stop();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  for (const repo of deployments.splice(0)) repo.remove();
  server = undefined;
  backend = undefined;
});

const temp = (prefix: string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  dirs.push(dir);
  return dir;
};

/** A request as the browser makes it: the status and the JSON (or text) body of the answer. */
type Call = (method: string, route: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function start({ steppedUp = true, ...options }: { steppedUp?: boolean } & Partial<CaduceusServerOptions> = {}) {
  const state = fakeStateDir();
  dirs.push(state);
  backend = launchFakeHermes({ env: { FAKE_HERMES_STATE_DIR: state } });
  const hermesInstallDir = fakeHermesInstall();
  dirs.push(hermesInstallDir);
  server = await startCaduceusServer({ backend, hermesRoot: temp('caduceus-root-'), hermesInstallDir, ...options });
  await backend.ready();
  const { url } = server;
  const cookie = await ownerCookie(url);
  if (steppedUp) await stepUp(url, cookie, await addPasskey(url, cookie));
  const call = async (method: string, route: string, body?: unknown) => {
    const res = await fetch(`${url}${route}`, { method, headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text };
  };
  /** What the fake Hermes was asked since the last time: `METHOD /path`. */
  const hits = async () => ((await (await backend!.fetch('/api/__fake/hits')).json()) as { method: string; target: string }[]).map((hit) => `${hit.method} ${hit.target.split('?')[0]}`);
  const operations = '/_caduceus/api/updates/operations';
  /** Opens the live log of an operation, as the page's `EventSource` does. */
  const log = (id: string) => openEventStream(url, `${operations}/${id}/stream`, cookie);
  /** Drives the update the fake Hermes is running: a line it printed, or its end. */
  const fake = (step: unknown) => backend!.fetch('/api/__fake/update', { method: 'POST', body: JSON.stringify(step) });
  return { url, cookie, call, hits, backend, state, operations, log, fake };
}

/** Reads events until `match` accepts one; the events before it come back too, in order. */
async function until(stream: EventStream, match: (event: ServerEvent) => boolean): Promise<ServerEvent[]> {
  const seen: ServerEvent[] = [];
  for (;;) {
    const event = await stream.next();
    seen.push(event);
    if (match(event)) return seen;
  }
}
const phaseIs = (phase: string) => (event: ServerEvent) => event.event === 'phase' && (event.data as { phase: string }).phase === phase;
const lineIs = (text: string) => (event: ServerEvent) => event.event === 'line' && (event.data as { text: string }).text === text;
const RECEIPT = { outcome: 'success', started_at: '2026-10-19T00:00:00Z', finished_at: '2026-10-19T00:01:00Z', pre_update: { sha: 'aaaaaaaaaaaa' }, post_update: { sha: 'bbbbbbbbbbbb', version: '0.22.0' } };

describe('starting a Hermes update', () => {
  test('needs a fresh passkey confirmation (T2), and nothing reaches Hermes without it', async () => {
    const { call, hits } = await start({ steppedUp: false });
    await hits();

    const answer = await call('POST', '/_caduceus/api/updates/operations', { target: 'hermes' });

    expect(answer.status).toBe(403);
    expect(answer.body).toMatchObject({ error: 'step-up-required', tier: 'T2' });
    expect(await hits()).not.toContain('POST /api/hermes/update');
  });
});

describe('updating Hermes', () => {
  test('drains first, streams the update log as it grows, restarts Hermes, checks the receipt, and lets turns start again', async () => {
    const { url, cookie, call, backend, operations, log, fake, hits, state: launches } = await start({ updatePollMs: 5 });
    await scriptFakeHermes(backend, {
      '/api/hermes/update/check': { install_method: 'git', current_version: '0.21.4', behind: 2, update_available: true, can_apply: true, update_command: 'hermes update', message: null, commits: [{ sha: 'b'.repeat(40), summary: 'Add dark mode to the TUI', author: 'Ada', at: '2026-10-18T00:00:00Z' }, { sha: 'c'.repeat(40), summary: 'Fix a cron race', author: 'Grace', at: '2026-10-17T00:00:00Z' }] },
    });
    const page = await connectBrowserSocket(url, { cookie });
    const prompt = { jsonrpc: '2.0', id: 'turn-1', method: 'prompt.submit', params: { session_id: 'abc', text: 'hello' } };
    await hits();

    const started = await call('POST', operations, { target: 'hermes' });
    expect(started.status).toBe(202);
    const stream = await log(started.body.id);

    // The page is told that Caduceus drains, and a turn it tries meanwhile is refused with the reason.
    const told = await page.waitFor((frame) => frame.params?.type === 'caduceus.drain');
    expect(told.params.payload).toMatchObject({ active: true, reason: 'Hermes is being updated.' });
    await until(stream, phaseIs('updating'));
    page.send(prompt);
    const refused = await page.waitFor((frame) => frame.id === 'turn-1');
    expect(refused.error.data).toMatchObject({ error: 'draining' });

    // The log comes line by line, as Hermes prints it.
    await fake({ line: 'Fetching origin…' });
    await until(stream, lineIs('Fetching origin…'));
    await fake({ line: 'Updating 2 packages' });
    await until(stream, lineIs('Updating 2 packages'));
    await fake({ finish: { exit_code: 0, receipt: RECEIPT } });
    const rest = await until(stream, (event) => event.event === 'end');

    expect(rest.filter((event) => event.event === 'phase').map((event) => (event.data as { phase: string }).phase)).toEqual(['restarting', 'verifying', 'resuming']);
    expect(rest.at(-1)!.data).toEqual({ ok: true, message: 'Hermes is updated to 0.22.0.' });
    // Hermes was started afresh (a second launch), so that the new code runs, and the receipt was read from it.
    expect(fs.readdirSync(launches).filter((name) => name.startsWith('launch-'))).toHaveLength(2);
    expect(await hits()).toContain('GET /api/hermes/update/receipt');

    // Turns are allowed again (on a new connection: the restart ended the old one), and What's New keeps what the update brought.
    const again = await connectBrowserSocket(url, { cookie });
    again.send({ ...prompt, id: 'turn-2' });
    expect((await again.waitFor((frame) => frame.id === 'turn-2')).result).toEqual({ method: 'prompt.submit' });
    const state = await call('GET', '/_caduceus/api/updates');
    expect(state.body.drain).toEqual({ active: false, reason: null, since: null });
    expect(state.body.history).toEqual([
      expect.objectContaining({ target: 'hermes', ok: true, fromVersion: '0.21.4', toVersion: '0.22.0', changes: [expect.objectContaining({ summary: 'Add dark mode to the TUI', author: 'Ada' }), expect.objectContaining({ summary: 'Fix a cron race' })] }),
    ]);
    page.close();
    again.close();
  });
});

describe('an update that does not go the whole way', () => {
  const launchesOf = (dir: string) => fs.readdirSync(dir).filter((name) => name.startsWith('launch-')).length;

  test('waits, while draining, for the turns Hermes is still working on, and says so in the log', async () => {
    const { call, backend, operations, log, fake, hits } = await start({ updatePollMs: 5 });
    await scriptFakeHermes(backend, { 'rpc session.active_list': { sessions: [{ id: 's1', status: 'working' }, { id: 's2', status: 'idle' }] } });
    await hits();

    const stream = await log((await call('POST', operations, { target: 'hermes' })).body.id);
    await until(stream, lineIs('1 turn is still being worked on. Waiting for it to finish.'));

    // Hermes was not asked to update while the turn went on.
    expect(await hits()).not.toContain('POST /api/hermes/update');
    await scriptFakeHermes(backend, { 'rpc session.active_list': { sessions: [{ id: 's1', status: 'idle' }] } });
    await until(stream, phaseIs('updating'));
    await fake({ finish: { exit_code: 0, receipt: RECEIPT } });
    expect((await until(stream, (event) => event.event === 'end')).at(-1)!.data).toMatchObject({ ok: true });
  });

  test('stops waiting for a turn that does not end, goes on, and says it is interrupted', async () => {
    const { call, backend, operations, log, fake } = await start({ updatePollMs: 5, drainTimeoutMs: 0 });
    await scriptFakeHermes(backend, { 'rpc session.active_list': { sessions: [{ id: 's1', status: 'working' }] } });

    const stream = await log((await call('POST', operations, { target: 'hermes' })).body.id);
    await until(stream, lineIs('Not waiting any longer: the turn still running will be interrupted when Hermes restarts.'));
    await until(stream, phaseIs('updating'));
    await fake({ finish: { exit_code: 0, receipt: RECEIPT } });
    await until(stream, (event) => event.event === 'end');
  });

  test('Hermes refusing to update ends it with Hermes\'s reason, without restarting Hermes, and turns are allowed again', async () => {
    const { call, backend, operations, log, state } = await start({ updatePollMs: 5 });
    await scriptFakeHermes(backend, { 'POST /api/hermes/update': { ok: false, error: 'update_not_in_place', message: 'Hermes was installed by a package manager; update it there.', update_command: 'brew upgrade hermes' } });

    const stream = await log((await call('POST', operations, { target: 'hermes' })).body.id);
    const events = await until(stream, (event) => event.event === 'end');

    expect(events.at(-1)!.data).toEqual({ ok: false, message: 'Hermes was installed by a package manager; update it there.' });
    expect(launchesOf(state)).toBe(1);
    expect((await call('GET', '/_caduceus/api/updates')).body.drain.active).toBe(false);
  });

  test('an update that exits with an error is a failure: Hermes is left running as it was, and turns are allowed again', async () => {
    const { call, backend, operations, log, fake, state } = await start({ updatePollMs: 5 });
    await scriptFakeHermes(backend, { '/api/hermes/update/check': { install_method: 'git', current_version: '0.21.4', behind: 1, update_available: true, can_apply: true, update_command: 'hermes update', message: null } });

    const stream = await log((await call('POST', operations, { target: 'hermes' })).body.id);
    await until(stream, phaseIs('updating'));
    await fake({ line: 'error: your local changes would be overwritten' });
    await fake({ finish: { exit_code: 1 } });
    const events = await until(stream, (event) => event.event === 'end');

    expect(events).toContainEqual({ event: 'line', data: { text: 'error: your local changes would be overwritten' } });
    expect(events.at(-1)!.data).toEqual({ ok: false, message: "Hermes's update failed (exit code 1). Hermes was not restarted." });
    expect(launchesOf(state)).toBe(1);
    const { body } = await call('GET', '/_caduceus/api/updates');
    expect(body.drain.active).toBe(false);
    expect(body.history).toEqual([expect.objectContaining({ ok: false, message: "Hermes's update failed (exit code 1). Hermes was not restarted." })]);
  });

  test('an update that finished but left no receipt is not called a success', async () => {
    const { call, operations, log, fake } = await start({ updatePollMs: 5 });

    const stream = await log((await call('POST', operations, { target: 'hermes' })).body.id);
    await until(stream, phaseIs('updating'));
    await fake({ finish: { exit_code: 0 } });
    const events = await until(stream, (event) => event.event === 'end');

    expect(events.at(-1)!.data).toEqual({ ok: false, message: 'Hermes did not record a receipt for the update, so Caduceus cannot tell whether it worked.' });
  });

  test("a receipt that says the update only partly finished is not a success, whatever the exit code", async () => {
    const { call, operations, log, fake } = await start({ updatePollMs: 5 });

    const stream = await log((await call('POST', operations, { target: 'hermes' })).body.id);
    await until(stream, phaseIs('updating'));
    await fake({ finish: { exit_code: 0, receipt: { ...RECEIPT, outcome: 'partial' } } });
    const events = await until(stream, (event) => event.event === 'end');

    expect(events.at(-1)!.data).toEqual({ ok: false, message: "Hermes's receipt says the update only partly finished (partial)." });
  });

  test('a Hermes that no longer matches the pinned contracts after the update turns read-only mode on by itself, and the result says so', async () => {
    const { url, cookie, call, operations, log, fake } = await start({ updatePollMs: 5 });
    expect((await call('GET', '/_caduceus/api/policy/read-only')).body).toEqual({ readOnly: false });

    const stream = await log((await call('POST', operations, { target: 'hermes' })).body.id);
    await until(stream, phaseIs('updating'));
    // The updated Hermes has lost a route the contracts Caduceus was built for name.
    await fake({ finish: { exit_code: 0, receipt: RECEIPT, dropRoutes: ['/api/gateway/drain'] } });
    const events = await until(stream, (event) => event.event === 'end');

    expect(events.at(-1)!.data).toEqual({ ok: true, message: 'Hermes is updated to 0.22.0. Hermes no longer matches what Caduceus was built for, so Caduceus is in read-only mode until that is dealt with.' });
    expect((await call('GET', '/_caduceus/api/policy/read-only')).body).toEqual({ readOnly: true, automatic: 'contract-mismatch' });
    const write = await fetch(`${url}/api/sessions/any`, { method: 'PATCH', headers: { origin: url, cookie, 'content-type': 'application/json' }, body: '{}' });
    expect(write.status).toBe(403);
  });
});

describe('who may start an update, and when', () => {
  test('one update at a time: a second is refused while the first runs', async () => {
    const { call, operations, log, fake } = await start({ updatePollMs: 5 });
    const first = await call('POST', operations, { target: 'hermes' });
    const stream = await log(first.body.id);
    await until(stream, phaseIs('updating'));

    const second = await call('POST', operations, { target: 'hermes' });

    expect(second.status).toBe(409);
    expect(second.body).toMatchObject({ error: 'busy' });
    await fake({ finish: { exit_code: 0, receipt: RECEIPT } });
    await until(stream, (event) => event.event === 'end');
  });

  test('read-only mode refuses it, and nothing reaches Hermes', async () => {
    const { call, hits, operations } = await start();
    await call('PUT', '/_caduceus/api/policy/read-only', { readOnly: true });
    await hits();

    const answer = await call('POST', operations, { target: 'hermes' });

    expect(answer.status).toBe(403);
    expect(answer.body).toMatchObject({ error: 'read-only' });
    expect(await hits()).not.toContain('POST /api/hermes/update');
  });

  test('a target that is neither Hermes nor Caduceus, or a field that is not known, is a bad request', async () => {
    const { call, operations } = await start();

    expect((await call('POST', operations, { target: 'macos' })).status).toBe(400);
    expect((await call('POST', operations, { target: 'hermes', force: true })).status).toBe(400);
  });

  test('is audited as a T2 of the owner', async () => {
    const { call, operations, log, fake } = await start({ updatePollMs: 5 });

    const stream = await log((await call('POST', operations, { target: 'hermes' })).body.id);
    await until(stream, phaseIs('updating'));
    await fake({ finish: { exit_code: 0, receipt: RECEIPT } });
    await until(stream, (event) => event.event === 'end');

    const { body } = await call('GET', '/_caduceus/api/audit');
    expect(body.entries).toContainEqual(expect.objectContaining({ actor: 'owner', action: 'update.hermes', target: 'hermes', tier: 'T2' }));
  });

  test('a tab that opens the log late reads what was printed before it came, then the rest', async () => {
    const { call, operations, log, fake } = await start({ updatePollMs: 5 });
    const { body } = await call('POST', operations, { target: 'hermes' });
    const first = await log(body.id);
    await until(first, phaseIs('updating'));
    await fake({ line: 'Fetching origin…' });
    await until(first, lineIs('Fetching origin…'));

    const late = await log(body.id);
    await until(late, lineIs('Fetching origin…'));
    await fake({ line: 'Installing' });
    await until(late, lineIs('Installing'));
    await fake({ finish: { exit_code: 0, receipt: RECEIPT } });
    expect((await until(late, (event) => event.event === 'end')).at(-1)!.data).toMatchObject({ ok: true });
  });
});



describe('updating Caduceus itself', () => {
  /** A Caduceus that can restart itself: its restart is a promise the test holds, which says what Caduceus was doing when it was asked. */
  async function startSelfUpdating() {
    const repo = createDeploymentRepo();
    deployments.push(repo);
    const { promise: restarted, resolve } = Promise.withResolvers<{ drain: { active: boolean }; operation: { phase: string } }>();
    let call!: Call;
    const running = await start({
      updatePollMs: 5,
      deployment: repo.deployment,
      restart: async () => resolve((await call('GET', '/_caduceus/api/updates')).body),
    });
    call = running.call;
    return { ...running, repo, restarted };
  }

  test('checks the checkout against its upstream branch and lists what is new', async () => {
    const { call, repo } = await startSelfUpdating();
    const current = await call('GET', '/_caduceus/api/updates/caduceus?force=1');
    expect(current.body).toMatchObject({ current_version: `1.0.0 (${repo.head()})`, behind: 0, update_available: false, can_apply: true });

    repo.publish('Add the Updates screen', { 'README.md': 'hello' });
    const newer = await call('GET', '/_caduceus/api/updates/caduceus?force=1');

    expect(newer.body).toMatchObject({ behind: 1, update_available: true, can_apply: true, commits: [expect.objectContaining({ summary: 'Add the Updates screen', author: 'Fixture' })] });
  });

  test('drains, pulls, installs what the lockfile changed, builds, ends the page\'s connections and restarts, still draining', async () => {
    const { url, cookie, call, operations, log, repo, restarted } = await startSelfUpdating();
    const before = repo.head();
    repo.publish('Add the Updates screen', { 'package-lock.json': '{"changed":true}' });
    repo.publish('Polish the log', { 'web/log.txt': 'x' });
    const page = await connectBrowserSocket(url, { cookie });

    const started = await call('POST', operations, { target: 'caduceus' });
    expect(started.status).toBe(202);
    const events = await until(await log(started.body.id), (event) => event.event === 'end');

    expect(events.filter((event) => event.event === 'phase').map((event) => (event.data as { phase: string }).phase)).toEqual(['draining', 'updating']);
    expect(events).toContainEqual({ event: 'line', data: { text: '$ git pull --ff-only' } });
    expect(events.at(-1)!.data).toEqual({ ok: true, message: 'Caduceus is updated and restarts to use it.' });
    // The lockfile moved, so what it needs was installed, and then the web app was built.
    expect(repo.ran()).toEqual(['install', 'build']);
    expect(repo.head()).not.toBe(before);
    // The page's connection was ended with the reason that makes it reconnect, and Caduceus restarts while it is still draining: no turn can start in between.
    expect(await page.closed).toEqual({ code: 1001, reason: 'Caduceus is stopping.' });
    expect(await restarted).toMatchObject({ drain: { active: true } });
    // What's New: both commits, and the version the checkout moved to.
    const { body } = await call('GET', '/_caduceus/api/updates');
    expect(body.history).toEqual([expect.objectContaining({ target: 'caduceus', ok: true, fromVersion: `1.0.0 (${before})`, toVersion: `1.0.0 (${repo.head()})`, changes: [expect.objectContaining({ summary: 'Polish the log' }), expect.objectContaining({ summary: 'Add the Updates screen' })] })]);
  });

  test('does not install when the lockfile did not move', async () => {
    const { call, operations, log, repo } = await startSelfUpdating();
    repo.publish('Polish the log', { 'web/log.txt': 'x' });

    await until(await log((await call('POST', operations, { target: 'caduceus' })).body.id), (event) => event.event === 'end');

    expect(repo.ran()).toEqual(['build']);
  });

  test('a checkout with changes of its own is not updated, nothing restarts, and turns are allowed again', async () => {
    const { call, operations, log, repo } = await startSelfUpdating();
    repo.publish('Polish the log', { 'web/log.txt': 'x' });
    repo.dirty();
    const before = repo.head();

    const events = await until(await log((await call('POST', operations, { target: 'caduceus' })).body.id), (event) => event.event === 'end');

    expect(events.at(-1)!.data).toEqual({ ok: false, message: 'This copy of Caduceus has changes that are not committed, so it was not updated.' });
    expect(repo.head()).toBe(before);
    expect(repo.ran()).toEqual([]);
    expect((await call('GET', '/_caduceus/api/updates')).body.drain.active).toBe(false);
  });

  test('a Caduceus that cannot restart itself (it is not the background service) cannot update itself, and says why', async () => {
    const repo = createDeploymentRepo();
    deployments.push(repo);
    const { call, operations } = await start({ deployment: repo.deployment });
    repo.publish('Polish the log', { 'web/log.txt': 'x' });

    const answer = await call('POST', operations, { target: 'caduceus' });
    const check = await call('GET', '/_caduceus/api/updates/caduceus?force=1');

    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ error: 'unavailable' });
    expect(check.body).toMatchObject({ update_available: true, can_apply: false });
    expect((await call('GET', '/_caduceus/api/updates')).body.restartable).toBe(false);
  });
});
