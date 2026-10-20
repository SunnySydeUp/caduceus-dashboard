import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { GatewayFacts } from '@caduceus/contracts/caduceus-api';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Connect › Gateway (M5 #01) in front of the real Hermes in a throwaway HERMES_HOME. Only what cannot touch a gateway is run
// here: reads, and drain, which writes a marker file in the temp home. Start, stop, restart and migrate spawn `hermes gateway …`,
// which on this Mac can act on the owner's own gateway, so they are tested against the stub upstream (gateway-control.test.ts).
let hermes: TestHermes;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  for (const name of ['coder', 'writer']) {
    const created = await hermes.backend.fetch('/api/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
    if (!created.ok) throw new Error(`Creating ${name}: HTTP ${created.status}`);
  }
}, 90_000);
afterAll(async () => {
  await hermes.stop();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function start() {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const { url } = server;
  const cookie = await ownerCookie(url);
  const authenticator = await addPasskey(url, cookie);
  await stepUp(url, cookie, authenticator);
  return async <T = unknown>(method: string, route: string, body?: unknown): Promise<{ status: number; body: T }> => {
    const res = await fetch(`${url}${route}`, {
      method,
      headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as never };
  };
}

/** How long a process has been running, from `ps`'s own elapsed-time field (`[[dd-]hh:]mm:ss`): a second reading of the same fact. */
function elapsedSeconds(pid: number): number {
  const field = execFileSync('ps', ['-o', 'etime=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  const [clock, days] = field.split('-').reverse();
  const [seconds = 0, minutes = 0, hours = 0] = clock.split(':').reverse().map(Number);
  return (Number(days ?? 0) * 24 + hours) * 3600 + minutes * 60 + seconds;
}

describe('what Caduceus adds to the gateway answers', () => {
  test('start times agree with Hermes’s own status: a profile Hermes says has a gateway has the start time of that process', async () => {
    const call = await start();
    const profiles = ((await call<{ profiles: { name: string }[] }>('GET', '/api/profiles')).body.profiles).map((profile) => profile.name);
    const statuses = await Promise.all(profiles.map(async (name) => [name, (await call<{ gateway_running: boolean; gateway_pid?: number }>('GET', `/api/status?profile=${name}`)).body] as const));

    const facts = await call<GatewayFacts>('GET', '/_caduceus/api/gateway');

    expect(facts.status).toBe(200);
    expect(facts.body.pending).toEqual([]);
    // Hermes's answer decides which profiles have a gateway; this Mac may or may not be running one.
    expect(Object.keys(facts.body.startedAt)).toEqual(statuses.filter(([, status]) => status.gateway_running && status.gateway_pid !== undefined).map(([name]) => name));
    for (const [name, status] of statuses) {
      if (!(name in facts.body.startedAt)) continue;
      const ageSeconds = (Date.now() - Date.parse(facts.body.startedAt[name])) / 1000;
      expect(Math.abs(ageSeconds - elapsedSeconds(status.gateway_pid!))).toBeLessThan(3);
    }
  });

  test('the migration plan comes through as Hermes gives it, with its blockers, and a profile’s gateway with its own status', async () => {
    const call = await start();

    const plan = await call<{ blockers: string[]; notices: string[]; eligible: boolean; profiles: { profile: string }[]; command: string }>('GET', '/api/gateway/migrate/plan');

    expect(plan.status).toBe(200);
    expect(Array.isArray(plan.body.blockers)).toBe(true);
    expect(Array.isArray(plan.body.notices)).toBe(true);
    expect(typeof plan.body.eligible).toBe('boolean');
    expect(plan.body.profiles.map((profile) => profile.profile).sort()).toEqual(['coder', 'default', 'writer']);
    expect(plan.body.command).toContain('hermes gateway migrate');
  });

  test('drain is requested and cancelled through Hermes, which keeps its marker in its own home', async () => {
    const call = await start();
    const marker = path.join(hermes.home, '.drain_request.json');

    const requested = await call<{ ok: boolean; action: string; draining: boolean }>('POST', '/api/gateway/drain', { action: 'drain' });
    const markerAfterDrain = fs.existsSync(marker);
    const cancelled = await call<{ ok: boolean; action: string; was_draining: boolean }>('POST', '/api/gateway/drain', { action: 'cancel' });

    expect(requested).toMatchObject({ status: 200, body: { ok: true, action: 'drain', draining: true } });
    expect(markerAfterDrain).toBe(true);
    expect(cancelled).toMatchObject({ status: 200, body: { ok: true, action: 'cancel', was_draining: true } });
    expect(fs.existsSync(marker)).toBe(false);
  });
});
