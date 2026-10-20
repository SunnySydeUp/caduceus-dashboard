import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AuditEntry, HealthReport, Subsystem } from '@caduceus/contracts/caduceus-api';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { HERMES_WORK_TIMEOUT_MS, killHermes, launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Health in front of the real Hermes (a real `hermes serve` in a throwaway HERMES_HOME): what its own status endpoints say
// is what Health says. The faults a real Hermes cannot produce on demand (a crash loop, a dead scheduler for good) are in
// health.test.ts, against the fake. The Hermes is shared, and so is what Caduceus has seen it do: tests that restart it come
// last, and the one that counts crashes is the last of all.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
const pages: TestGatewayConnection[] = [];
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 60_000);
afterAll(() => hermes.stop());
afterEach(async () => {
  for (const page of pages.splice(0)) page.connection.close();
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function start() {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, hermesInstallDir: hermes.install.dir });
  const cookie = await ownerCookie(server.url);
  const get = async <T>(route: string): Promise<T> => (await fetch(`${server!.url}${route}`, { headers: { cookie } })).json();
  return { url: server.url, cookie, report: () => get<HealthReport>('/_caduceus/api/health'), hermesSays: <T>(route: string) => get<T>(route) };
}

const subsystem = (health: HealthReport, id: Subsystem['id']): Subsystem => health.subsystems.find((s) => s.id === id)!;

describe('Health, in front of the real Hermes', () => {
  test('reads every subsystem from Hermes’s own status endpoints, and copies nothing of Hermes into the report', async () => {
    const { report, hermesSays } = await start();

    const health = await report();
    const status = await hermesSays<{ gateway_running: boolean }>('/api/status');
    const stats = await hermesSays<{ memory: { percent: number }; disk: { percent: number } }>('/api/system/stats');

    expect(health.subsystems.map((s) => [s.id, s.name])).toEqual([
      ['caduceus', 'Caduceus server'],
      ['backend', 'Hermes backend'],
      ['gateway', 'Messaging gateway'],
      ['scheduler', 'Cron scheduler'],
      ['dispatcher', 'Kanban dispatcher'],
      ['activity', 'Work in progress'],
      ['providers', 'Providers'],
      ['egress', 'Egress proxy'],
      ['host', 'Host resources'],
    ]);
    for (const s of health.subsystems) expect(Date.parse(s.checkedAt)).toBeGreaterThan(Date.now() - 60_000);
    expect(subsystem(health, 'backend')).toMatchObject({ state: 'ok', reason: 'The private Hermes backend is running and answering.' });
    // Whether the gateway runs is the machine's business (Hermes may see the owner's own gateway from a throwaway home): the
    // report must say what Hermes says.
    expect(subsystem(health, 'gateway').state).toBe(status.gateway_running ? 'ok' : 'down');
    // A fresh home has no jobs, no tasks and no credentials.
    expect(subsystem(health, 'scheduler')).toMatchObject({ state: 'ok', reason: 'No scheduled jobs are waiting to run, so there is no tick to check.' });
    expect(subsystem(health, 'dispatcher')).toMatchObject({ state: 'ok', reason: 'No Kanban tasks are waiting for a worker.' });
    expect(subsystem(health, 'providers').state).toBe('unknown');
    // Hermes can say whether it is busy (a fresh home is idle, but Hermes may start background work of its own just after launch): Health says what it says.
    expect(subsystem(health, 'activity').state).toBe('ok');
    expect(subsystem(health, 'activity').reason).toMatch(/^Hermes is (idle: nothing is running and nothing is waiting for you\.|busy: |waiting for you: )/);
    expect(subsystem(health, 'egress')).toMatchObject({ state: 'ok', reason: expect.stringMatching(/^The egress proxy is off\./) });
    // The host's numbers are Hermes's (psutil on this machine), read a moment apart, so they agree to within a few points.
    const meters = Object.fromEntries((subsystem(health, 'host').meters ?? []).map((meter) => [meter.label, meter.percent]));
    expect(Math.abs(meters.Memory - stats.memory.percent)).toBeLessThan(5);
    expect(Math.abs(meters.Disk - stats.disk.percent)).toBeLessThan(5);
    // Hermes's status carries paths and a pid on a loopback bind; Health is no place for them.
    expect(JSON.stringify(health)).not.toContain(hermes.home);
  });

  test('an egress proxy that is turned on in Hermes’s config but never set up is a Repair, read from Hermes’s own status text', async () => {
    const { report } = await start();
    await hermes.cli('config', 'set', 'proxy.enabled', 'true');

    const turnedOn = await report();
    await hermes.cli('config', 'set', 'proxy.enabled', 'false');
    const off = await report();

    expect(subsystem(turnedOn, 'egress')).toMatchObject({ state: 'degraded', reason: 'The egress proxy is turned on, but it has not been set up.', suggestion: 'Run “hermes egress setup” on the Mac that runs Hermes.' });
    expect(turnedOn.repairs.map((repair) => repair.id)).toContain('egress-not-set-up');
    expect(subsystem(off, 'egress').state).toBe('ok');
    expect(off.repairs.map((repair) => repair.id)).not.toContain('egress-not-set-up');
  });

  test('sees a scheduler that has stopped ticking in the heartbeat Hermes keeps, and sees it tick again', async () => {
    const { report } = await start();
    // The real thing: a job in Hermes's own store and the ticker heartbeat its scheduler thread writes (seconds since the
    // epoch, in `<home>/cron/ticker_heartbeat`), here stamped three hours ago and then now.
    const created = await hermes.backend.fetch('/api/cron/jobs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: 'say hello', schedule: 'every 1h', name: 'Health test job' }),
    });
    expect(created.status).toBe(200);
    const { id } = (await created.json()) as { id: string };
    const heartbeat = path.join(hermes.home, 'cron', 'ticker_heartbeat');
    fs.mkdirSync(path.dirname(heartbeat), { recursive: true });

    fs.writeFileSync(heartbeat, String(Date.now() / 1000 - 3 * 3600));
    const stale = await report();
    fs.writeFileSync(heartbeat, String(Date.now() / 1000));
    const fresh = await report();
    await hermes.backend.fetch(`/api/cron/jobs/${id}`, { method: 'DELETE' });

    expect(subsystem(stale, 'scheduler')).toMatchObject({ state: 'down', reason: 'The scheduler last ticked 3 h ago, though it ticks every minute: scheduled jobs are not running.' });
    expect(stale.repairs.map((repair) => repair.id)).toContain('scheduler-stale');
    expect(subsystem(fresh, 'scheduler').state).toBe('ok');
    expect(subsystem(fresh, 'scheduler').reason).toMatch(/^The scheduler ticked \d+ s ago, and 1 scheduled job is waiting to run\.$/);
    expect(fresh.repairs.map((repair) => repair.id)).not.toContain('scheduler-stale');
  });

  test('a chat model whose provider has no credentials is a Repair that links to Keys, and adding the key clears it', async () => {
    const { report } = await start();
    // Seeded through Hermes's own CLI, which writes the home this Hermes reads: a provider that has no key, in this throwaway home.
    await hermes.cli('config', 'set', 'model.provider', 'fireworks');
    await hermes.cli('config', 'set', 'model.default', 'accounts/fireworks/models/test');

    const missing = await report();
    const repair = missing.repairs.find((candidate) => candidate.id === 'model-key-missing');
    expect(repair).toMatchObject({ severity: 'warning', subsystem: 'providers', title: 'Hermes has no key for Fireworks AI, the provider of the chat model', link: { label: 'Open Keys', to: '/system/keys' } });
    expect(repair?.cause).toContain('Add FIREWORKS_API_KEY in Keys.');
    expect(subsystem(missing, 'providers').state).toBe('degraded');

    // The key is added the way the Keys page adds it, with a made-up value; Hermes then has credentials for the provider.
    const added = await hermes.backend.fetch('/api/env?profile=default', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'FIREWORKS_API_KEY', value: 'fw-FAKE-0123456789-abcdefghij' }) });
    expect(added.status).toBe(200);
    const fixed = await report();
    await hermes.backend.fetch('/api/env?profile=default', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'FIREWORKS_API_KEY' }) });
    await hermes.cli('config', 'set', 'model.provider', '');

    expect(fixed.repairs.map((candidate) => candidate.id)).not.toContain('model-key-missing');
  });

  test('restarting the backend needs a step-up and is audited; the page’s connection drops and comes back to a Hermes with a new epoch', async () => {
    const { url, cookie, report } = await start();
    const page = openGatewayConnection(url, cookie);
    pages.push(page);
    await page.until((status) => status.state === 'connected');
    const restart = () => fetch(`${url}/_caduceus/api/health/fixes/restart-backend`, { method: 'POST', headers: { origin: url, cookie } });

    const refused = await restart();
    await stepUp(url, cookie, await addPasskey(url, cookie));
    const accepted = await restart();
    await page.until((status) => status.state === 'reconnecting');
    await page.until((status) => status.state === 'connected');
    const audit: { entries: AuditEntry[] } = await (await fetch(`${url}/_caduceus/api/audit`, { headers: { cookie } })).json();
    const health = await report();

    expect(refused.status).toBe(403);
    expect(accepted.status).toBe(202);
    // The dot recovers, and what the page loads afresh is told by the new epoch.
    expect(page.statuses.at(-1)).toEqual({ state: 'connected', attempt: 0 });
    expect(page.readies).toHaveLength(2);
    expect(page.readies[1]).toMatchObject({ reconnected: true, restarted: true });
    expect(page.readies[1].epoch).not.toBe(page.readies[0].epoch);
    expect(audit.entries[0]).toMatchObject({ actor: 'owner', action: 'backend.restart', target: 'hermes-backend', tier: 'T2' });
    // Asked for, so not a crash: nothing to count.
    expect(subsystem(health, 'backend')).toMatchObject({ state: 'ok', reason: 'The private Hermes backend is running and answering.' });
  }, HERMES_WORK_TIMEOUT_MS);

  test('a Hermes that crashes shows in the next report, once the page is back', async () => {
    const { url, cookie, report } = await start();
    const page = openGatewayConnection(url, cookie);
    pages.push(page);
    await page.until((status) => status.state === 'connected');

    killHermes(hermes);
    await page.until((status) => status.state === 'reconnecting');
    await page.until((status) => status.state === 'connected');
    const health = await report();

    expect(subsystem(health, 'backend')).toMatchObject({ state: 'ok', reason: 'The private Hermes backend is running and answering. It restarted 1 time in the last hour.' });
  }, HERMES_WORK_TIMEOUT_MS);
});
