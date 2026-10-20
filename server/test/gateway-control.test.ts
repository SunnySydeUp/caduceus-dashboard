import { afterEach, describe, expect, test } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuditEntry, GatewayFacts, PendingGatewayRestart } from '@caduceus/contracts/caduceus-api';
import type { HermesBackend } from '../src/hermes-backend.ts';
import { startCaduceusServer, type CaduceusServer, type CaduceusServerOptions } from '../src/caduceus-server.ts';
import { launchFakeHermes, scriptFakeHermes } from './fixtures/fake-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Connect › Gateway (M5 #01) at the Caduceus HTTP seam, in front of the fake Hermes: a stub upstream that records what reaches
// it and answers the gateway routes as Hermes 0.21.4 does. The real Hermes is never asked to start or stop a gateway in these
// tests: on this Mac that could touch the owner's own gateway. What the real Hermes answers for reading is in gateway-hermes.test.ts.
let backend: HermesBackend | undefined;
let server: CaduceusServer | undefined;
let tempDirs: string[] = [];
afterEach(async () => {
  await server?.close();
  await backend?.stop();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  server = undefined;
  backend = undefined;
  tempDirs = [];
});


interface Started {
  url: string;
  cookie: string;
  hermesRoot: string;
  clock: { now: number };
  call<T = unknown>(method: string, route: string, init?: { body?: unknown }): Promise<{ status: number; body: T }>;
  /** What reached the fake Hermes since the last time this was asked, as `METHOD target`. */
  upstream(): Promise<string[]>;
}

async function start(again?: { hermesRoot: string }, options: Partial<CaduceusServerOptions> = {}): Promise<Started> {
  backend ??= launchFakeHermes();
  const hermesRoot = again?.hermesRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-root-'));
  if (!again) tempDirs.push(hermesRoot);
  // The real time: the gateway processes of these tests are real, and their start times are the operating system's.
  const clock = { now: Date.now() };
  server = await startCaduceusServer({ backend, hermesRoot, now: () => clock.now, ...options });
  await backend.ready();
  const { url } = server;
  const cookie = await ownerCookie(url);
  // Caduceus checks every Hermes launch against the pinned contracts, which the stand-in sees as requests: forget them.
  await fetch(`${url}/_caduceus/api/compatibility`, { headers: { cookie } });
  await backend.fetch('/api/__fake/hits');
  return {
    url,
    cookie,
    hermesRoot,
    clock,
    async call(method, route, { body } = {}) {
      const res = await fetch(`${url}${route}`, {
        method,
        headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: (text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : text) as never };
    },
    async upstream() {
      const hits = (await (await backend!.fetch('/api/__fake/hits')).json()) as { method: string; target: string }[];
      return hits.map((hit) => `${hit.method} ${hit.target}`);
    },
  };
}

describe('the gateway actions', () => {
  test('start is a T1 that needs no passkey; stop, restart, drain and migrate are T2 that do; each reaches Hermes only when allowed and is audited with its profile', async () => {
    const { url, cookie, call, upstream } = await start();
    const authenticator = await addPasskey(url, cookie);
    const actions = [
      ['POST', '/api/gateway/start?profile=coder', 'T1'],
      ['POST', '/api/gateway/stop?profile=coder', 'T2'],
      ['POST', '/api/gateway/restart?profile=coder', 'T2'],
      ['POST', '/api/gateway/drain', 'T2'],
      ['POST', '/api/gateway/migrate', 'T2'],
    ] as const;

    // No grant yet: a T1 goes through, and every T2 is asked for a passkey, and does not reach Hermes.
    const before = await Promise.all(actions.map(([method, route]) => call<{ error?: string; tier?: string; ok?: boolean }>(method, route, { body: route.includes('drain') ? { action: 'drain' } : undefined })));
    const reachedBefore = await upstream();
    await stepUp(url, cookie, authenticator);
    const after: { status: number; body: { ok?: boolean; name?: string } }[] = [];
    // One at a time, so that the order of what reached Hermes is the order of the list.
    for (const [method, route] of actions.slice(1)) after.push(await call(method, route, { body: route.includes('drain') ? { action: 'drain' } : undefined }));
    const reachedAfter = await upstream();
    const { entries } = (await call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit')).body;

    expect(before.map(({ status, body }) => [status, body.error ?? 'ok'])).toEqual([[200, 'ok'], [403, 'step-up-required'], [403, 'step-up-required'], [403, 'step-up-required'], [403, 'step-up-required']]);
    expect(before.slice(1).map(({ body }) => body.tier)).toEqual(['T2', 'T2', 'T2', 'T2']);
    expect(reachedBefore).toEqual(['POST /api/gateway/start?profile=coder']);
    expect(after.map(({ status, body }) => [status, body.ok])).toEqual([[200, true], [200, true], [200, true], [200, true]]);
    expect(reachedAfter).toEqual(['POST /api/gateway/stop?profile=coder', 'POST /api/gateway/restart?profile=coder', 'POST /api/gateway/drain', 'POST /api/gateway/migrate']);
    // Newest first; the profile is the one the request named, and there is none for what is not about one.
    expect(entries.filter((entry) => entry.action.startsWith('POST /api/gateway/')).map(({ action, tier, profile }) => [action, tier, profile])).toEqual([
      ['POST /api/gateway/migrate', 'T2', undefined],
      ['POST /api/gateway/drain', 'T2', undefined],
      ['POST /api/gateway/restart', 'T2', 'coder'],
      ['POST /api/gateway/stop', 'T2', 'coder'],
      ['POST /api/gateway/start', 'T1', 'coder'],
    ]);
  });
});

/** A real process that does nothing until it is killed: a stand-in for a gateway process, with a start time only the OS knows. */
const sleepers: ChildProcess[] = [];
afterEach(() => {
  for (const sleeper of sleepers.splice(0)) sleeper.kill('SIGKILL');
});
function spawnSleeper(): ChildProcess {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore' });
  sleepers.push(child);
  return child;
}

describe('when each gateway started', () => {
  test('is the start time of the process Hermes names for each profile, from the operating system; a profile with no gateway, or whose process is gone, has none', async () => {
    const { call } = await start();
    const before = Date.now();
    const gateway = spawnSleeper();
    const after = Date.now();
    const gone = spawnSleeper();
    gone.kill('SIGKILL');
    await once(gone, 'exit');
    await scriptFakeHermes(backend!, {
      '/api/profiles': { profiles: [{ name: 'default' }, { name: 'coder' }, { name: 'ops' }, { name: 'stale' }] },
      // One multiplexer serves two profiles: they share a process, so they share a start time.
      '/api/status?profile=default': { gateway_running: true, gateway_pid: gateway.pid },
      '/api/status?profile=coder': { gateway_running: true, gateway_pid: gateway.pid },
      '/api/status?profile=ops': { gateway_running: false, gateway_pid: null },
      '/api/status?profile=stale': { gateway_running: true, gateway_pid: gone.pid },
    });

    const answer = await call<{ startedAt: Record<string, string> }>('GET', '/_caduceus/api/gateway');

    expect(answer.status).toBe(200);
    expect(Object.keys(answer.body.startedAt)).toEqual(['default', 'coder']);
    const started = Date.parse(answer.body.startedAt.default);
    // The operating system gives a start time to the second.
    expect(started).toBeGreaterThanOrEqual(before - 1_000);
    expect(started).toBeLessThanOrEqual(after + 1_000);
    expect(answer.body.startedAt.coder).toBe(answer.body.startedAt.default);
  });
});

describe('the restart-to-apply banner', () => {
  const raise = (call: Started['call'], profile: string, reason: string) => call<{ pending: PendingGatewayRestart[] }>('POST', '/_caduceus/api/gateway/pending', { body: { profile, reason } });

  test('is raised by anything, lists what changed since the gateway last started, and is dropped once the profile’s gateway has started after the latest change', async () => {
    const { call, clock } = await start();
    const gateway = spawnSleeper();
    await scriptFakeHermes(backend!, {
      '/api/profiles': { profiles: [{ name: 'default' }, { name: 'coder' }] },
      '/api/status?profile=default': { gateway_running: true, gateway_pid: gateway.pid },
      '/api/status?profile=coder': { gateway_running: true, gateway_pid: gateway.pid },
    });
    const started = Date.now();
    const hourBefore = started - 3_600_000;
    const hourAfter = started + 3_600_000;

    // Changes made after the gateway started (the clock is ahead of the process): both wait.
    clock.now = hourAfter;
    const first = await raise(call, 'coder', 'Channel settings saved');
    clock.now = hourAfter + 60_000;
    await raise(call, 'coder', 'Config saved');
    // Saying the same thing again is the same reason, and the change is the later one.
    clock.now = hourAfter + 120_000;
    const again = await raise(call, 'coder', 'Config saved');
    await raise(call, 'default', 'Platform settings saved');
    const listed = await call<GatewayFacts>('GET', '/_caduceus/api/gateway');
    // A change from before the gateway started was applied by that start: nothing to wait for.
    clock.now = hourBefore;
    await raise(call, 'coder', 'Old change');
    const afterOld = await call<GatewayFacts>('GET', '/_caduceus/api/gateway');

    expect(first.body.pending).toEqual([{ profile: 'coder', reasons: ['Channel settings saved'], raisedAt: new Date(hourAfter).toISOString() }]);
    expect(again.body.pending).toEqual([{ profile: 'coder', reasons: ['Channel settings saved', 'Config saved'], raisedAt: new Date(hourAfter + 120_000).toISOString() }]);
    expect(listed.body.pending.map((entry) => [entry.profile, entry.reasons])).toEqual([
      ['coder', ['Channel settings saved', 'Config saved']],
      ['default', ['Platform settings saved']],
    ]);
    // The old change is not waiting, and it did not take the others with it.
    expect(afterOld.body.pending.map((entry) => entry.profile)).toEqual(['coder', 'default']);
    expect(afterOld.body.pending[0].reasons).toEqual(['Channel settings saved', 'Config saved']);
  });
});

describe('the banner over a restart', () => {
  test('clears when the gateway restarts after the change, stays for a gateway that is stopped, keeps a profile when Hermes is silent and drops one Hermes no longer has; and survives a restart of Caduceus', async () => {
    // The operating system's start times, by hand: a restart is a new process that started later.
    const started = new Map<number, number>([[100, Date.parse('2026-10-07T08:00:00.000Z')]]);
    const options = { processStartTimes: async (pids: readonly number[]) => new Map(pids.flatMap((pid): [number, number][] => (started.has(pid) ? [[pid, started.get(pid)!]] : []))) };
    const first = await start(undefined, options);
    await scriptFakeHermes(backend!, {
      '/api/profiles': { profiles: [{ name: 'default' }, { name: 'coder' }, { name: 'ops' }] },
      '/api/status?profile=default': { gateway_running: true, gateway_pid: 100 },
      '/api/status?profile=coder': { gateway_running: true, gateway_pid: 100 },
      '/api/status?profile=ops': { gateway_running: false, gateway_pid: null },
    });
    const raise = (profile: string, reason: string) => first.call('POST', '/_caduceus/api/gateway/pending', { body: { profile, reason } });
    first.clock.now = Date.parse('2026-10-07T09:00:00.000Z');
    await raise('coder', 'Channel settings saved');
    await raise('ops', 'Config saved');
    await raise('ghost', 'Config saved');

    const waiting = await first.call<GatewayFacts>('GET', '/_caduceus/api/gateway');
    // Caduceus restarts on the same store: what is waiting is still waiting.
    await server!.close();
    const second = await start({ hermesRoot: first.hermesRoot }, options);
    const afterRestart = await second.call<GatewayFacts>('GET', '/_caduceus/api/gateway');
    // Hermes goes quiet: it says nothing about which profiles exist, so nothing is dropped for it.
    await scriptFakeHermes(backend!, { '/api/profiles': { detail: 'down' } });
    const silent = await second.call<GatewayFacts>('GET', '/_caduceus/api/gateway');
    // The gateway restarts after the change: a new process, started at 09:30.
    started.set(200, Date.parse('2026-10-07T09:30:00.000Z'));
    await scriptFakeHermes(backend!, {
      '/api/profiles': { profiles: [{ name: 'default' }, { name: 'coder' }, { name: 'ops' }] },
      '/api/status?profile=default': { gateway_running: true, gateway_pid: 200 },
      '/api/status?profile=coder': { gateway_running: true, gateway_pid: 200 },
    });
    const restarted = await second.call<GatewayFacts>('GET', '/_caduceus/api/gateway');
    const later = await second.call<GatewayFacts>('GET', '/_caduceus/api/gateway');

    // The ghost is a profile Hermes does not list: nothing can apply its change.
    expect(waiting.body.pending.map((entry) => entry.profile)).toEqual(['coder', 'ops']);
    expect(afterRestart.body.pending.map((entry) => entry.profile)).toEqual(['coder', 'ops']);
    expect(silent.body.pending.map((entry) => entry.profile)).toEqual(['coder', 'ops']);
    // Coder's gateway started after the change. Ops has none running, so its change waits for a start.
    expect(restarted.body.pending.map((entry) => entry.profile)).toEqual(['ops']);
    expect(later.body.pending).toEqual(restarted.body.pending);
    expect(restarted.body.startedAt).toEqual({ default: '2026-10-07T09:30:00.000Z', coder: '2026-10-07T09:30:00.000Z' });
  });

  test('refuses a request with no profile or no reason, and is for the owner only', async () => {
    const { url, call } = await start();

    const answers = await Promise.all([
      call('POST', '/_caduceus/api/gateway/pending', { body: { profile: '', reason: 'x' } }),
      call('POST', '/_caduceus/api/gateway/pending', { body: { profile: 'coder' } }),
      call('POST', '/_caduceus/api/gateway/pending', { body: { profile: 'coder', reason: 'x'.repeat(121) } }),
    ]);
    const stranger = await fetch(`${url}/_caduceus/api/gateway`);

    expect(answers.map((answer) => answer.status)).toEqual([400, 400, 400]);
    expect(stranger.status).toBe(401);
  });
});
