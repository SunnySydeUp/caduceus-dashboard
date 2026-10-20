import { afterEach, describe, expect, test } from 'vitest';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuditEntry, HealthReport, Subsystem } from '@caduceus/contracts/caduceus-api';
import type { HermesBackend } from '../src/hermes-backend.ts';
import { startCaduceusServer, type CaduceusServer, type CaduceusServerOptions } from '../src/caduceus-server.ts';
import { loadPinnedContracts, type HermesContracts } from '../src/hermes-contract.ts';
import { fakeHermesInstall, fakeLaunch, fakeStateDir, launchFakeHermes, scriptFakeHermes } from './fixtures/fake-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Health and Repairs at the Caduceus HTTP seam, in front of the fake Hermes: a stub upstream whose status answers a test
// scripts, and which can crash on demand. What the real Hermes says is in health-hermes.test.ts.
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

/**
 * Starts Caduceus in front of the fake Hermes (launched here unless the test launched it), which follows the pinned contracts
 * and so is compatible unless a test pins something else, or says there is no install to read the gateway contract from.
 */
async function start(options: Partial<CaduceusServerOptions> = {}) {
  backend ??= launchFakeHermes();
  const hermesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-root-'));
  const hermesInstallDir = fakeHermesInstall();
  tempDirs.push(hermesRoot, hermesInstallDir);
  server = await startCaduceusServer({ backend, hermesRoot, hermesInstallDir, ...options });
  return { url: server.url, backend };
}

describe('liveness', () => {
  test('answers without a session, and says nothing about Hermes, the host or the owner', async () => {
    const { url } = await start();
    await ownerCookie(url);

    const res = await fetch(`${url}/_caduceus/healthz`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    // A supervisor needs no session, so the probe must not hand it one.
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  test('still says it is up while Hermes is down: a supervisor must not restart Caduceus for that', async () => {
    backend = launchFakeHermes({ env: { FAKE_HERMES_EXIT_BEFORE_READY: '1' }, restartDelaysMs: [60_000] });
    const { promise: down, resolve } = Promise.withResolvers<void>();
    backend.on('status', (status) => status.state === 'restarting' && resolve());
    const { url } = await start();
    await down;

    const res = await fetch(`${url}/_caduceus/healthz`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

const START = Date.parse('2026-10-07T09:00:00.000Z');

/** What a signed-in browser gets from the health report. */
async function report(url: string, cookie: string): Promise<HealthReport> {
  const res = await fetch(`${url}/_caduceus/api/health`, { headers: { cookie } });
  expect(res.status).toBe(200);
  return res.json();
}

const subsystem = (health: HealthReport, id: Subsystem['id']): Subsystem => health.subsystems.find((s) => s.id === id)!;

describe('the health report', () => {
  test('is for the owner only, and says for each subsystem its state, why, and when Caduceus asked', async () => {
    const { url, backend } = await start({ now: () => START });
    await backend.ready();
    const cookie = await ownerCookie(url);

    const signedOut = await fetch(`${url}/_caduceus/api/health`);
    const health = await report(url, cookie);

    expect(signedOut.status).toBe(401);
    const asked = '2026-10-07T09:00:00.000Z';
    expect(health.checkedAt).toBe(asked);
    expect(subsystem(health, 'caduceus')).toMatchObject({ name: 'Caduceus server', state: 'ok', reason: 'Caduceus is running and answering.', checkedAt: asked });
    expect(subsystem(health, 'backend')).toMatchObject({ name: 'Hermes backend', state: 'ok', reason: 'The private Hermes backend is running and answering.', checkedAt: asked });
  });
});

/** What Hermes's `/api/status` answers (the shape of 0.21.4), for a gateway that runs unless `over` says otherwise. */
const status = (over: Record<string, unknown> = {}) => ({
  version: '0.21.4-fake',
  gateway_running: true,
  gateway_state: 'running',
  gateway_platforms: {},
  gateway_exit_reason: null,
  gateway_heartbeat_stale_s: null,
  active_sessions: 0,
  ...over,
});
const repairIds = (health: HealthReport) => health.repairs.map((repair) => repair.id);

describe('the messaging gateway', () => {
  test('is down, with a Repair that says why, while Hermes says the gateway is not running, and clears when it runs again', async () => {
    const { url, backend } = await start({ now: () => START });
    await backend.ready();
    const cookie = await ownerCookie(url);

    const running = await report(url, cookie);
    await scriptFakeHermes(backend, { '/api/status': status({ gateway_running: false, gateway_state: 'stopped', gateway_exit_reason: 'stopped by the operator' }) });
    const stopped = await report(url, cookie);
    await scriptFakeHermes(backend, { '/api/status': null });
    const recovered = await report(url, cookie);

    expect(subsystem(running, 'gateway')).toMatchObject({ state: 'ok', reason: 'The messaging gateway is running.' });
    expect(repairIds(running)).not.toContain('gateway-not-running');
    expect(subsystem(stopped, 'gateway')).toMatchObject({ name: 'Messaging gateway', state: 'down', reason: 'The messaging gateway is not running.' });
    expect(stopped.repairs).toContainEqual({
      id: 'gateway-not-running',
      severity: 'warning',
      subsystem: 'gateway',
      title: 'The messaging gateway is not running',
      cause:
        'Hermes is not receiving messages from chat platforms, and scheduled jobs and Kanban tasks do not start, because all three run inside the gateway. ' +
        'Start it on the Mac that runs Hermes with “hermes gateway start”. Hermes gave this reason for the stop: stopped by the operator.',
      link: { label: 'Open Gateway', to: '/connect/gateway' },
    });
    expect(subsystem(recovered, 'gateway').state).toBe('ok');
    expect(repairIds(recovered)).not.toContain('gateway-not-running');
  });
});

/** A job as `GET /api/cron/jobs?profile=all` lists it (0.21.4), with the heartbeat of its profile's ticker. */
const job = (over: Record<string, unknown> = {}) => ({
  id: 'job-1',
  name: 'Nightly backup',
  profile: 'default',
  enabled: true,
  state: 'scheduled',
  scheduler_heartbeat_age_s: 14,
  ...over,
});

describe('the cron scheduler', () => {
  test('is down, with a Repair, when the tick behind a job that should run is stale, and fine while it ticks', async () => {
    const { url, backend } = await start({ now: () => START });
    await backend.ready();
    const cookie = await ownerCookie(url);
    const jobs = async (list: unknown[], gateway = status()) => {
      await scriptFakeHermes(backend, { '/api/cron/jobs': list, '/api/status': gateway });
      return report(url, cookie);
    };
    const THREE_HOURS = 3 * 3600;

    const noJobs = await jobs([]);
    const fresh = await jobs([job()]);
    const idleStale = await jobs([job({ scheduler_heartbeat_age_s: THREE_HOURS, state: 'paused' }), job({ scheduler_heartbeat_age_s: THREE_HOURS, enabled: false })]);
    const stale = await jobs([job(), job({ id: 'job-2', profile: 'coder', scheduler_heartbeat_age_s: THREE_HOURS })]);
    const staleGatewayDown = await jobs([job({ scheduler_heartbeat_age_s: THREE_HOURS })], status({ gateway_running: false, gateway_state: 'stopped' }));

    expect(subsystem(noJobs, 'scheduler')).toMatchObject({ name: 'Cron scheduler', state: 'ok', reason: 'No scheduled jobs are waiting to run, so there is no tick to check.' });
    expect(subsystem(fresh, 'scheduler')).toMatchObject({ state: 'ok', reason: 'The scheduler ticked 14 s ago, and 1 scheduled job is waiting to run.' });
    // A paused or disabled job does not need the scheduler, so its stale heartbeat is no problem (Hermes's own dashboard agrees).
    expect(subsystem(idleStale, 'scheduler').state).toBe('ok');
    for (const health of [noJobs, fresh, idleStale]) expect(repairIds(health)).not.toContain('scheduler-stale');
    // Each profile has its own ticker; the oldest one is what is wrong.
    expect(subsystem(stale, 'scheduler')).toMatchObject({ state: 'down', reason: 'The scheduler last ticked 3 h ago, though it ticks every minute: scheduled jobs are not running.' });
    expect(stale.repairs).toContainEqual({
      id: 'scheduler-stale',
      severity: 'warning',
      subsystem: 'scheduler',
      title: 'Scheduled jobs are not running',
      cause: 'The scheduler last ticked 3 h ago, and it ticks every minute. Restart the gateway on the Mac that runs Hermes with “hermes gateway restart”.',
    });
    expect(staleGatewayDown.repairs.find((repair) => repair.id === 'scheduler-stale')?.cause).toBe(
      'The scheduler runs inside the messaging gateway, which is not running. Its last tick was 3 h ago, and it ticks every minute.',
    );
  });
});

describe('the Hermes backend', () => {
  test('reports its restarts, and raises a Repair with a fix once it has restarted three times in an hour', async () => {
    const dir = fakeStateDir();
    tempDirs.push(dir);
    const clock = { now: START };
    backend = launchFakeHermes({ env: { FAKE_HERMES_STATE_DIR: dir }, restartDelaysMs: [10], now: () => clock.now });
    const { url } = await start({ now: () => clock.now });
    await backend.ready();
    const cookie = await ownerCookie(url);
    /** Kills the running Hermes outright, as a crash would, and waits for the launcher to bring a new one up. */
    const crash = async (launch: number) => {
      const back = once(backend!, 'ready');
      process.kill(fakeLaunch(dir, launch).pid, 'SIGKILL');
      await back;
    };

    const { version } = await loadPinnedContracts();
    const calm = await report(url, cookie);
    await crash(1);
    clock.now += 5 * 60_000;
    await crash(2);
    clock.now += 5 * 60_000;
    const twice = await report(url, cookie);
    await crash(3);
    clock.now += 5 * 60_000;
    const thrice = await report(url, cookie);
    clock.now += 52 * 60_000;
    const later = await report(url, cookie);

    expect(subsystem(calm, 'backend')).toMatchObject({ state: 'ok', reason: 'The private Hermes backend is running and answering.' });
    expect(subsystem(calm, 'backend').facts).toEqual([
      { label: 'Restarts in the last hour', value: '0' },
      { label: 'Hermes version', value: version },
      { label: 'Contracts', value: 'Match those Caduceus was built for' },
    ]);
    expect(subsystem(thrice, 'backend').facts).toEqual([
      { label: 'Restarts in the last hour', value: '3' },
      { label: 'Last restart', value: '5 min ago' },
      { label: 'Hermes version', value: version },
      { label: 'Contracts', value: 'Match those Caduceus was built for' },
    ]);
    expect(subsystem(twice, 'backend')).toMatchObject({ state: 'ok', reason: 'The private Hermes backend is running and answering. It restarted 2 times in the last hour.' });
    expect(repairIds(twice)).not.toContain('backend-restarting');
    expect(subsystem(thrice, 'backend').reason).toBe('The private Hermes backend is running and answering. It restarted 3 times in the last hour.');
    expect(thrice.repairs).toContainEqual({
      id: 'backend-restarting',
      severity: 'warning',
      subsystem: 'backend',
      title: 'Hermes keeps restarting',
      cause:
        'The private Hermes backend stopped and was started again 3 times in the last hour; the last time was 5 min ago. Restarting it by hand starts it afresh. ' +
        'If it keeps stopping, the Hermes install or its configuration is at fault: Hermes’s log, which Caduceus passes on to its own output, says why.',
      fix: { id: 'restart-backend', label: 'Restart Hermes backend', tier: 'T2' },
    });
    // The first two restarts are now more than an hour old; the third is not.
    expect(subsystem(later, 'backend').reason).toBe('The private Hermes backend is running and answering. It restarted 1 time in the last hour.');
    expect(repairIds(later)).not.toContain('backend-restarting');
  });

  test('is down, and the Repair critical, while Hermes keeps crashing; what Hermes would say is unknown meanwhile', async () => {
    backend = launchFakeHermes({ env: { FAKE_HERMES_EXIT_BEFORE_READY: '1' }, restartDelaysMs: [10, 10, 60_000], now: () => START });
    // Hermes dies at once, three times; then the launcher waits a minute before the next try, which is when to look.
    const { promise: waiting, resolve } = Promise.withResolvers<void>();
    backend.on('status', (status) => status.state === 'restarting' && status.retryInMs === 60_000 && resolve());
    const { url } = await start({ now: () => START });
    await waiting;
    const cookie = await ownerCookie(url);

    const health = await report(url, cookie);

    expect(subsystem(health, 'backend')).toMatchObject({ state: 'down', reason: 'The private Hermes backend stopped. Caduceus is starting it again (attempt 3). It restarted 3 times in the last hour.' });
    expect(subsystem(health, 'gateway')).toMatchObject({ state: 'unknown', reason: 'The Hermes backend is not running, so this cannot be checked.' });
    expect(health.repairs.find((repair) => repair.id === 'backend-restarting')).toMatchObject({ severity: 'critical', fix: { id: 'restart-backend' } });
  });
});

/** The contracts Caduceus pins, plus one REST operation the running Hermes does not have: as if a Hermes update had removed it. */
async function pinnedWithRemovedOperation(): Promise<HermesContracts> {
  const pin = await loadPinnedContracts();
  return { ...pin, rest: { ...pin.rest, paths: { ...pin.rest.paths, '/api/retired': { get: { responses: {} } } } } };
}

describe('a Hermes that no longer matches the contracts Caduceus was built for', () => {
  test('raises a critical Repair that names what changed, and turns read-only mode on by itself, audited as Caduceus', async () => {
    const pinned = await pinnedWithRemovedOperation();
    const { url, backend } = await start({ pinned, now: () => START });
    await backend.ready();
    const cookie = await ownerCookie(url);
    const call = (method: string, route: string) => fetch(`${url}${route}`, { method, headers: { origin: url, cookie, 'content-type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });

    const health = await report(url, cookie);
    const readOnly = await (await call('GET', '/_caduceus/api/policy/read-only')).json();
    const audit: { entries: AuditEntry[] } = await (await call('GET', '/_caduceus/api/audit')).json();
    const write = await call('PATCH', '/api/sessions/any-session');

    expect(health.repairs).toContainEqual({
      id: 'contract-mismatch',
      severity: 'critical',
      subsystem: 'backend',
      title: 'Hermes no longer matches what Caduceus was built for',
      cause:
        `The running Hermes (version ${pinned.version}) differs from the contracts Caduceus was pinned to (version ${pinned.version}): REST removed: GET /api/retired. ` +
        'Caduceus is in read-only mode until this is dealt with. Update Caduceus to a version built for this Hermes, or put back the Hermes it was built for.',
    });
    expect(subsystem(health, 'backend')).toMatchObject({ state: 'degraded', reason: 'The private Hermes backend is running, but Hermes no longer matches the contracts Caduceus was built for.' });
    // Read-only mode is Caduceus's own switch, and it says that Caduceus flipped it, not the owner.
    expect(readOnly).toEqual({ readOnly: true, automatic: 'contract-mismatch' });
    expect(audit.entries).toContainEqual({ at: '2026-10-07T09:00:00.000Z', actor: 'caduceus', action: 'policy.read-only-on', target: 'caduceus', source: 'caduceus' });
    // Enforced at the proxy: a write never reaches Hermes.
    expect(write.status).toBe(403);
    expect(await write.json()).toMatchObject({ error: 'read-only' });
  });

  test('is checked again whenever Hermes starts: the owner can lift read-only mode, and a Hermes that is still wrong puts it back', async () => {
    const dir = fakeStateDir();
    tempDirs.push(dir);
    backend = launchFakeHermes({ env: { FAKE_HERMES_STATE_DIR: dir }, restartDelaysMs: [10] });
    const { url } = await start({ pinned: await pinnedWithRemovedOperation() });
    await backend.ready();
    const cookie = await ownerCookie(url);
    const readOnly = async () => (await fetch(`${url}/_caduceus/api/policy/read-only`, { headers: { cookie } })).json();
    await report(url, cookie);
    const turnedOn = await readOnly();

    const authenticator = await addPasskey(url, cookie);
    await stepUp(url, cookie, authenticator);
    await fetch(`${url}/_caduceus/api/policy/read-only`, { method: 'PUT', headers: { origin: url, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ readOnly: false }) });
    const lifted = await readOnly();
    // The owner knows, and has said so: until Hermes starts again Caduceus leaves it, and the Repair says what that means.
    const whileLifted = await report(url, cookie);
    const back = once(backend, 'ready');
    process.kill(fakeLaunch(dir, 1).pid, 'SIGKILL');
    await back;
    await report(url, cookie);
    const again = await readOnly();

    expect(turnedOn).toEqual({ readOnly: true, automatic: 'contract-mismatch' });
    expect(lifted).toEqual({ readOnly: false });
    expect(whileLifted.repairs.find((repair) => repair.id === 'contract-mismatch')?.cause).toContain(
      'Read-only mode is off, so Caduceus may change things in Hermes in ways that no longer work as it expects.',
    );
    expect(again).toEqual({ readOnly: true, automatic: 'contract-mismatch' });
  });

  test('is never read-only when Caduceus merely cannot read the contracts: that is a warning, not a mismatch', async () => {
    const { url, backend } = await start({ hermesInstallDir: undefined });
    await backend.ready();
    const cookie = await ownerCookie(url);

    const health = await report(url, cookie);
    const readOnly = await (await fetch(`${url}/_caduceus/api/policy/read-only`, { headers: { cookie } })).json();

    expect(health.repairs).toContainEqual({
      id: 'contract-unreadable',
      severity: 'warning',
      subsystem: 'backend',
      title: 'Caduceus cannot check Hermes’s contracts',
      cause:
        'Caduceus could not read part of what it compares Hermes with, so it cannot tell whether Hermes still matches the contracts it was built for: ' +
        'Gateway contract unavailable: Hermes install directory unknown. Caduceus checks again whenever Hermes starts.',
    });
    expect(repairIds(health)).not.toContain('contract-mismatch');
    expect(subsystem(health, 'backend')).toMatchObject({ state: 'degraded', reason: 'The private Hermes backend is running, but Caduceus could not check Hermes against the contracts it was built for.' });
    expect(readOnly).toEqual({ readOnly: false });
  });
});

describe('the fix "Restart Hermes backend"', () => {
  test('needs a step-up, is audited, and starts a fresh Hermes that is not counted as a crash', async () => {
    const dir = fakeStateDir();
    tempDirs.push(dir);
    backend = launchFakeHermes({ env: { FAKE_HERMES_STATE_DIR: dir }, now: () => START });
    const { url } = await start({ now: () => START });
    await backend.ready();
    const cookie = await ownerCookie(url);
    const launches = () => fs.readdirSync(dir).filter((name) => name.startsWith('launch-')).length;
    const restart = () => fetch(`${url}/_caduceus/api/health/fixes/restart-backend`, { method: 'POST', headers: { origin: url, cookie } });
    const firstSecret = fakeLaunch(dir, 1).token;

    const withoutGrant = await restart();
    const untouched = launches();
    await stepUp(url, cookie, await addPasskey(url, cookie));
    const back = once(backend, 'ready');
    const withGrant = await restart();
    await back;
    const audit: { entries: AuditEntry[] } = await (await fetch(`${url}/_caduceus/api/audit`, { headers: { cookie } })).json();
    const health = await report(url, cookie);

    expect(withoutGrant.status).toBe(403);
    expect(await withoutGrant.json()).toEqual({ error: 'step-up-required' });
    expect(untouched).toBe(1);
    expect(withGrant.status).toBe(202);
    expect(await withGrant.json()).toEqual({ restarting: true });
    expect(launches()).toBe(2);
    expect(fakeLaunch(dir, 2).token).not.toBe(firstSecret);
    expect(audit.entries).toContainEqual({ at: '2026-10-07T09:00:00.000Z', actor: 'owner', action: 'backend.restart', target: 'hermes-backend', source: 'local', tier: 'T2' });
    expect(subsystem(health, 'backend')).toMatchObject({ state: 'ok', reason: 'The private Hermes backend is running and answering.' });
  });

  test('clears the Repair it was offered by: a Hermes started afresh has not stopped yet', async () => {
    const dir = fakeStateDir();
    tempDirs.push(dir);
    backend = launchFakeHermes({ env: { FAKE_HERMES_STATE_DIR: dir }, restartDelaysMs: [10] });
    const { url } = await start();
    await backend.ready();
    const cookie = await ownerCookie(url);
    for (let launch = 1; launch <= 3; launch++) {
      const back = once(backend, 'ready');
      process.kill(fakeLaunch(dir, launch).pid, 'SIGKILL');
      await back;
    }
    const before = await report(url, cookie);
    await stepUp(url, cookie, await addPasskey(url, cookie));

    const back = once(backend, 'ready');
    await fetch(`${url}/_caduceus/api/health/fixes/restart-backend`, { method: 'POST', headers: { origin: url, cookie } });
    await back;
    const after = await report(url, cookie);

    expect(before.repairs.find((repair) => repair.id === 'backend-restarting')?.fix).toEqual({ id: 'restart-backend', label: 'Restart Hermes backend', tier: 'T2' });
    expect(repairIds(after)).not.toContain('backend-restarting');
    expect(subsystem(after, 'backend').reason).toBe('The private Hermes backend is running and answering.');
  });

  test('is still there while read-only mode is on: that is when a broken Hermes most needs it', async () => {
    const { url, backend } = await start({ pinned: await pinnedWithRemovedOperation() });
    await backend.ready();
    const cookie = await ownerCookie(url);
    await report(url, cookie);
    await stepUp(url, cookie, await addPasskey(url, cookie));
    const readOnly = await (await fetch(`${url}/_caduceus/api/policy/read-only`, { headers: { cookie } })).json();

    const back = once(backend, 'ready');
    const res = await fetch(`${url}/_caduceus/api/health/fixes/restart-backend`, { method: 'POST', headers: { origin: url, cookie } });
    await back;

    expect(readOnly).toEqual({ readOnly: true, automatic: 'contract-mismatch' });
    expect(res.status).toBe(202);
  });

  test('is not a route for anything else a request names', async () => {
    const { url, backend } = await start();
    await backend.ready();
    const cookie = await ownerCookie(url);

    const res = await fetch(`${url}/_caduceus/api/health/fixes/format-the-disk`, { method: 'POST', headers: { origin: url, cookie } });

    expect(res.status).toBe(404);
  });
});

describe('a failure that keeps coming back', () => {
  const HOUR = 3_600_000;
  const stopped = status({ gateway_running: false, gateway_state: 'stopped' });
  const recurrence = (health: HealthReport) => health.repairs.find((repair) => repair.id === 'gateway-not-running')?.recurring;

  test('is flagged as recurring once it has returned within the window, and not on its first appearance', async () => {
    let now = START;
    const { url, backend } = await start({ now: () => now });
    await backend.ready();
    const cookie = await ownerCookie(url);

    await scriptFakeHermes(backend, { '/api/status': stopped });
    const first = await report(url, cookie);
    const stillDown = await report(url, cookie);
    await scriptFakeHermes(backend, { '/api/status': null });
    now += 10 * 60_000;
    const recovered = await report(url, cookie);
    await scriptFakeHermes(backend, { '/api/status': stopped });
    now += 10 * 60_000;
    const back = await report(url, cookie);

    // Seeing the same failure twice in a row is one failure, not two.
    expect(recurrence(first)).toBeUndefined();
    expect(recurrence(stillDown)).toBeUndefined();
    expect(repairIds(recovered)).not.toContain('gateway-not-running');
    expect(recurrence(back)).toEqual({ times: 2, windowHours: 24 });
  });

  test('stops being flagged when the earlier appearances are older than the window', async () => {
    let now = START;
    const { url, backend } = await start({ now: () => now });
    await backend.ready();
    const cookie = await ownerCookie(url);

    await scriptFakeHermes(backend, { '/api/status': stopped });
    await report(url, cookie);
    await scriptFakeHermes(backend, { '/api/status': null });
    await report(url, cookie);
    await scriptFakeHermes(backend, { '/api/status': stopped });
    const flagged = await report(url, cookie);
    now += 25 * HOUR;
    const later = await report(url, cookie);

    expect(recurrence(flagged)).toEqual({ times: 2, windowHours: 24 });
    // Both appearances are over a day old by now, and it has not left since: one long failure, not a recurring one.
    expect(repairIds(later)).toContain('gateway-not-running');
    expect(recurrence(later)).toBeUndefined();
  });
});
