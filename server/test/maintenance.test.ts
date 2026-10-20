import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ApiReference, InstallFacts } from '@caduceus/contracts/caduceus-api';
import type { HermesBackend } from '../src/hermes-backend.ts';
import { startCaduceusServer, type CaduceusServer, type CaduceusServerOptions } from '../src/caduceus-server.ts';
import { connectBrowserSocket } from './fixtures/browser-socket.ts';
import { openEventStream, type EventStream, type ServerEvent } from './fixtures/event-stream.ts';
import { fakeHermesInstall, fakeStateDir, launchFakeHermes, scriptFakeHermes } from './fixtures/fake-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// System › Maintenance › Diagnostics (M5 #13) at the Caduceus HTTP seam, in front of the fake Hermes (a stand-in whose diagnostic actions the test drives line
// by line). What the real Hermes answers for its console is in console-hermes.test.ts.
let backend: HermesBackend | undefined;
let server: CaduceusServer | undefined;
const dirs: string[] = [];
afterEach(async () => {
  await server?.close();
  await backend?.stop();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  server = undefined;
  backend = undefined;
});

/** A request as the browser makes it: the status and the JSON (or text) body of the answer. */
type Call = (method: string, route: string, body?: unknown) => Promise<{ status: number; body: any }>;

async function start({ steppedUp = true, ...options }: { steppedUp?: boolean } & Partial<CaduceusServerOptions> = {}) {
  const state = fakeStateDir();
  const install = fakeHermesInstall();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-root-'));
  dirs.push(state, install, root);
  backend = launchFakeHermes({ env: { FAKE_HERMES_STATE_DIR: state } });
  server = await startCaduceusServer({ backend, hermesRoot: root, hermesInstallDir: install, ...options });
  await backend.ready();
  const { url } = server;
  const cookie = await ownerCookie(url);
  if (steppedUp) await stepUp(url, cookie, await addPasskey(url, cookie));
  const call = async (method: string, route: string, body?: unknown) => {
    const res = await fetch(`${url}${route}`, { method, headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text };
  };
  const hits = async () => ((await (await backend!.fetch('/api/__fake/hits')).json()) as { method: string; target: string }[]).map((hit) => `${hit.method} ${hit.target.split('?')[0]}`);
  const action = (step: unknown) => backend!.fetch('/api/__fake/action', { method: 'POST', body: JSON.stringify(step) });
  return { url, cookie, call, hits, backend, state, action };
}

async function until(stream: EventStream, match: (event: ServerEvent) => boolean): Promise<ServerEvent[]> {
  const seen: ServerEvent[] = [];
  for (;;) {
    const event = await stream.next();
    seen.push(event);
    if (match(event)) return seen;
  }
}
const launches = (dir: string) => fs.readdirSync(dir).filter((name) => name.startsWith('launch-')).length;
const RESTART = '/_caduceus/api/maintenance/restart';

describe('restarting the Hermes backend', () => {
  test('needs a fresh passkey confirmation (T2), and the backend is left alone without it', async () => {
    const { call, state } = await start({ steppedUp: false });

    const answer = await call('POST', RESTART, { target: 'backend' });

    expect(answer.status).toBe(403);
    expect(answer.body).toMatchObject({ error: 'step-up-required', tier: 'T2' });
    expect(launches(state)).toBe(1);
  });

  test('drains first, waits for a turn that is working, restarts Hermes, ends the page’s connection so it reconnects, and lets turns start again', async () => {
    const { url, cookie, call, backend, state } = await start({ drainTimeoutMs: 60_000, logPollMs: 5 });
    await scriptFakeHermes(backend, { 'rpc session.active_list': { sessions: [{ id: 's1', status: 'working' }] } });
    const page = await connectBrowserSocket(url, { cookie });

    const started = await call('POST', RESTART, { target: 'backend' });

    expect(started.status).toBe(202);
    // The page is told, and while the turn is working Hermes is not restarted.
    expect((await page.waitFor((frame) => frame.params?.type === 'caduceus.drain')).params.payload).toMatchObject({ active: true, reason: 'The Hermes backend is restarting.' });
    // Caduceus asks Hermes again and again whether the turn is over (a bounded poll of the fake: the asking is the server's own timer), and does not restart it meanwhile.
    const asked = async () => ((await (await backend.fetch('/api/__fake/ws')).json()) as { frames: string[] }).frames.filter((frame) => frame.includes('session.active_list')).length;
    await expect.poll(asked, { timeout: 10_000 }).toBeGreaterThanOrEqual(3);
    expect(launches(state)).toBe(1);
    page.send({ jsonrpc: '2.0', id: 't1', method: 'prompt.submit', params: { session_id: 's1', text: 'hi' } });
    expect((await page.waitFor((frame) => frame.id === 't1')).error.data).toMatchObject({ error: 'draining' });

    await scriptFakeHermes(backend, { 'rpc session.active_list': { sessions: [] } });
    expect(await page.closed).toEqual({ code: 1012, reason: 'Hermes closed the connection.' });
    await backend.ready();
    expect(launches(state)).toBe(2);
    // Drain over: the turn that was refused is accepted on the connection the page opens again.
    await drainEnds(call);
    const again = await connectBrowserSocket(url, { cookie });
    again.send({ jsonrpc: '2.0', id: 't2', method: 'prompt.submit', params: { session_id: 's1', text: 'hi' } });
    expect((await again.waitFor((frame) => frame.id === 't2')).result).toEqual({ method: 'prompt.submit' });
    again.close();
  });

  test('is allowed in read-only mode (it changes nothing in Hermes’s data) and is audited as a T2 of the owner', async () => {
    const { call, state } = await start({ logPollMs: 5 });
    await call('PUT', '/_caduceus/api/policy/read-only', { readOnly: true });

    const started = await call('POST', RESTART, { target: 'backend' });
    await drainEnds(call);

    expect(started.status).toBe(202);
    expect(launches(state)).toBe(2);
    expect((await call('GET', '/_caduceus/api/audit')).body.entries).toContainEqual(expect.objectContaining({ actor: 'owner', action: 'maintenance.restart-backend', tier: 'T2' }));
  });

  test('a restart already under way (the drain is on) refuses a second one, and a target that is neither is a bad request', async () => {
    const { call, backend } = await start({ drainTimeoutMs: 60_000, logPollMs: 5 });
    await scriptFakeHermes(backend, { 'rpc session.active_list': { sessions: [{ id: 's1', status: 'working' }] } });
    await call('POST', RESTART, { target: 'backend' });

    const second = await call('POST', RESTART, { target: 'backend' });

    expect(second.status).toBe(409);
    expect((await call('POST', RESTART, { target: 'macos' })).status).toBe(400);
    await scriptFakeHermes(backend, { 'rpc session.active_list': { sessions: [] } });
    await drainEnds(call);
  });
});

/** The drain ends once the restart is done: the page reads it from the same state the Updates screen does. A bounded poll, because the restart is Hermes's own process starting. */
async function drainEnds(call: Call) {
  await expect.poll(async () => (await call('GET', '/_caduceus/api/updates')).body.drain.active, { timeout: 20_000 }).toBe(false);
}

describe('restarting Caduceus', () => {
  test('drains, ends the page’s connections with the reason that makes them reconnect, and then asks the process to restart, still draining', async () => {
    const { promise: restarted, resolve } = Promise.withResolvers<{ drain: { active: boolean } }>();
    let call!: Call;
    const running = await start({ logPollMs: 5, restart: async () => resolve((await call('GET', '/_caduceus/api/updates')).body) });
    call = running.call;
    const page = await connectBrowserSocket(running.url, { cookie: running.cookie });

    const started = await call('POST', RESTART, { target: 'caduceus' });

    expect(started.status).toBe(202);
    expect(await page.closed).toEqual({ code: 1001, reason: 'Caduceus is stopping.' });
    expect(await restarted).toMatchObject({ drain: { active: true } });
  });

  test('a Caduceus that is not the background service cannot restart itself, says so, and is not left draining', async () => {
    const { call } = await start();

    const answer = await call('POST', RESTART, { target: 'caduceus' });

    expect(answer.status).toBe(409);
    expect(answer.body).toMatchObject({ error: 'unavailable' });
    expect((await call('GET', '/_caduceus/api/updates')).body.drain.active).toBe(false);
  });
});

describe('the output of a diagnostic action', () => {
  test('is streamed line by line from Hermes’s log, only the latest run of it (Hermes appends every run to one log), and ends with how it exited', async () => {
    const { url, cookie, call, action } = await start({ logPollMs: 5 });
    // An earlier run is still in the log.
    await call('POST', '/api/ops/doctor');
    await action({ name: 'doctor', line: 'old run: all fine' });
    await action({ name: 'doctor', finish: { exit_code: 0 } });
    await call('POST', '/api/ops/doctor');

    const stream = await openEventStream(url, '/_caduceus/api/maintenance/actions/doctor/stream', cookie);
    await action({ name: 'doctor', line: 'Checking Python…' });
    const first = await until(stream, (event) => event.event === 'line' && (event.data as { text: string }).text === 'Checking Python…');
    await action({ name: 'doctor', line: '1 problem found' });
    await action({ name: 'doctor', finish: { exit_code: 1 } });
    const rest = await until(stream, (event) => event.event === 'end');

    expect([...first, ...rest].filter((event) => event.event === 'line').map((event) => (event.data as { text: string }).text)).toEqual(['Checking Python…', '1 problem found']);
    expect(rest.at(-1)!.data).toEqual({ ok: false, exitCode: 1 });
  });

  test('a run that has ended is read again from where it stopped, with its exit code, whenever the page asks', async () => {
    const { url, cookie, call, action } = await start({ logPollMs: 5 });
    await call('POST', '/api/ops/security-audit');
    await action({ name: 'security-audit', line: 'No findings.' });
    await action({ name: 'security-audit', finish: { exit_code: 0 } });

    const events = await until(await openEventStream(url, '/_caduceus/api/maintenance/actions/security-audit/stream', cookie), (event) => event.event === 'end');

    expect(events).toEqual([
      { event: 'line', data: { text: 'No findings.' } },
      { event: 'end', data: { ok: true, exitCode: 0 } },
    ]);
  });

  test('a run Hermes has forgotten the exit code of (it restarted) ends with the code Caduceus saw it end with, and a later run Hermes lost does not borrow it', async () => {
    const { url, cookie, call, action } = await start({ logPollMs: 5 });
    const ended = async () => (await until(await openEventStream(url, '/_caduceus/api/maintenance/actions/doctor/stream', cookie), (event) => event.event === 'end')).at(-1)!.data;
    await call('POST', '/api/ops/doctor');
    await action({ name: 'doctor', finish: { exit_code: 0 } });
    const seen = await ended();
    // Hermes restarts: it keeps the log, and no longer knows how the run ended.
    await action({ name: 'doctor', finish: { exit_code: null } });
    const forgotten = await ended();
    // A new run that Hermes loses in the same way.
    await call('POST', '/api/ops/doctor');
    await action({ name: 'doctor', finish: { exit_code: null } });
    const lost = await ended();

    expect([seen, forgotten, lost]).toEqual([
      { ok: true, exitCode: 0 },
      { ok: true, exitCode: 0 },
      { ok: true, exitCode: null },
    ]);
  });

  test('only Hermes’s diagnostic actions can be followed', async () => {
    const { call } = await start();

    expect((await call('GET', '/_caduceus/api/maintenance/actions/hermes-update/stream')).status).toBe(404);
    expect((await call('GET', '/_caduceus/api/maintenance/actions/..%2Fstatus/stream')).status).toBe(404);
  });
});

describe('the policy of the diagnostics', () => {
  test('doctor, the security audit, the support dump and config migrate are T1, prompt size is a read, debug share is T3, and the Nous share RPC stays denied', async () => {
    const { url, cookie, call } = await start({ steppedUp: false });
    const reference: ApiReference = (await call('GET', '/_caduceus/api/maintenance/api-reference')).body;
    const tierOf = (method: string, name: string) => [...reference.rest, ...reference.gateway].find((entry) => entry.method === method && entry.name === name)?.tier;

    expect(['/api/ops/doctor', '/api/ops/security-audit', '/api/ops/dump', '/api/ops/config-migrate'].map((route) => tierOf('POST', route))).toEqual(['T1', 'T1', 'T1', 'T1']);
    expect(tierOf('POST', '/api/ops/prompt-size')).toBe('T0');
    expect(tierOf('POST', '/api/ops/debug-share')).toBe('T3');
    expect(tierOf('RPC', 'diagnostics.share_nous')).toBe('denied');
    // And the proxy enforces it: the Nous share frame is refused on the live connection.
    const page = await connectBrowserSocket(url, { cookie });
    page.send({ jsonrpc: '2.0', id: 'share', method: 'diagnostics.share_nous', params: {} });
    expect((await page.waitFor((frame) => frame.id === 'share')).error.data).toMatchObject({ error: 'denied', reason: 'debug-upload' });
    page.close();
  });
});

describe('install facts', () => {
  test('say what a bug report needs: the versions of Caduceus and Hermes, the contracts, the host, and nothing of the owner’s', async () => {
    const { call } = await start();

    const { body, status } = await call('GET', '/_caduceus/api/maintenance/facts');
    const facts: InstallFacts = body;

    expect(status).toBe(200);
    expect(facts).toMatchObject({
      caduceus: { version: expect.stringMatching(/^\d+\.\d+\.\d+/), node: process.version, arch: os.arch() },
      hermes: { version: '0.21.4-fake', state: 'ready' },
      contracts: { state: 'compatible', differences: [] },
    });
    // Nothing that names the owner, their folders or their machine.
    const text = JSON.stringify(facts);
    expect(text).not.toContain(os.homedir());
    expect(text).not.toContain(os.hostname());
    expect(text).not.toContain(os.userInfo().username);
  });
});

describe('the API reference', () => {
  test('lists the pinned REST operations and gateway methods with their tiers, and never asks Hermes', async () => {
    const { call, hits } = await start();
    await hits();

    const reference: ApiReference = (await call('GET', '/_caduceus/api/maintenance/api-reference')).body;

    expect(reference.version).toMatch(/^\d+\.\d+\.\d+/);
    expect(reference.rest).toContainEqual(expect.objectContaining({ kind: 'rest', method: 'GET', name: '/api/status', tier: 'T0', read: true }));
    expect(reference.gateway).toContainEqual(expect.objectContaining({ kind: 'gateway', method: 'RPC', name: 'session.list', group: 'session', tier: 'T0', read: true }));
    expect(reference.gateway.find((entry) => entry.name === 'shell.exec')?.tier).toBe('denied');
    // It is made from the pinned contracts: Hermes's own docs routes are not called, and neither is anything else of Hermes's.
    expect(await hits()).toEqual([]);
  });
});
