import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuditPage } from '@caduceus/contracts/caduceus-api';
import type { HermesBackend } from '../src/hermes-backend.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchFakeHermes } from './fixtures/fake-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// The audit log viewer (M5 #15) at the Caduceus HTTP seam: the entries Caduceus recorded, filtered and exported. Read-only: nothing here changes the log.
let backend: HermesBackend | undefined;
let server: CaduceusServer | undefined;
let root: string | undefined;
afterEach(async () => {
  await server?.close();
  await backend?.stop();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  server = backend = root = undefined;
});

const START = Date.parse('2026-10-07T09:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

/** Signs in and makes a log that spans three days: failed sign-ins, T1 and T2 requests, one of them for a profile. */
async function seeded() {
  backend = launchFakeHermes();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-root-'));
  const clock = { now: START };
  server = await startCaduceusServer({ backend, hermesRoot: root, now: () => clock.now });
  await backend.ready();
  const { url } = server;
  const cookie = await ownerCookie(url);
  const authenticator = await addPasskey(url, cookie);
  const call = (method: string, route: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${url}${route}`, { method, headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  await fetch(`${url}/_caduceus/api/auth/sign-in`, { method: 'POST', headers: { origin: url, 'content-type': 'application/json' }, body: JSON.stringify({ password: 'wrong guess' }) });
  clock.now += DAY;
  await call('POST', '/api/profiles/coder/describe-auto');
  await call('POST', '/api/ops/doctor');
  clock.now += DAY;
  await stepUp(url, cookie, authenticator);
  await call('POST', '/api/ops/checkpoints/prune');
  const read = async (query: string): Promise<AuditPage> => (await call('GET', `/_caduceus/api/audit/entries${query}`)).json();
  return { url, cookie, call, read, clock };
}

describe('the audit log viewer', () => {
  test('lists the entries newest first with their actor, tier, action, target, profile and time, and filters by tier, action, profile and date', async () => {
    const { read } = await seeded();

    const all = await read('');
    const t1 = await read('?tier=T1');
    const forCoder = await read('?profile=coder');
    const prune = await read('?action=checkpoints');
    const middleDay = await read(`?from=${new Date(START + DAY).toISOString()}&to=${new Date(START + 2 * DAY - 1).toISOString()}`);

    expect(all.entries[0]).toMatchObject({ actor: 'owner', action: 'POST /api/ops/checkpoints/prune', target: '/api/ops/checkpoints/prune', source: 'local', tier: 'T2', at: new Date(START + 2 * DAY).toISOString() });
    expect(all.entries.map((entry) => entry.at)).toEqual([...all.entries.map((entry) => entry.at)].sort().reverse());
    expect(all.total).toBe(all.entries.length);
    expect(t1.entries.map((entry) => entry.action)).toEqual(['POST /api/ops/doctor', 'POST /api/profiles/{name}/describe-auto', 'passkey.register']);
    expect(forCoder.entries).toEqual([expect.objectContaining({ action: 'POST /api/profiles/{name}/describe-auto', profile: 'coder', tier: 'T1' })]);
    expect(prune.entries.map((entry) => entry.action)).toEqual(['POST /api/ops/checkpoints/prune']);
    expect(middleDay.entries.map((entry) => entry.action)).toEqual(['POST /api/ops/doctor', 'POST /api/profiles/{name}/describe-auto']);
    expect(all.entries.every((entry) => typeof entry.id === 'number')).toBe(true);
  });

  test('pages with a cursor, and refuses a filter it does not understand rather than showing everything', async () => {
    const { read, call } = await seeded();

    const first = await read('?limit=2');
    const second = await read(`?limit=2&before=${first.nextBefore}`);
    const bad = await call('GET', '/_caduceus/api/audit/entries?tier=T9');
    const badDate = await call('GET', '/_caduceus/api/audit/entries?from=yesterday');

    expect(first.entries).toHaveLength(2);
    expect(first.total).toBeGreaterThan(2);
    expect(second.entries[0].id).toBeLessThan(first.entries[1].id);
    expect(bad.status).toBe(400);
    expect(badDate.status).toBe(400);
  });

  test('exports what the filters match as JSON or CSV, as a download, and the viewer cannot change the log', async () => {
    const { call, read } = await seeded();
    const before = (await read('')).total;

    const json = await call('GET', '/_caduceus/api/audit/export?format=json&tier=T1');
    const csv = await call('GET', '/_caduceus/api/audit/export?format=csv&profile=coder');
    const del = await call('DELETE', '/_caduceus/api/audit/entries');
    const put = await call('PUT', '/_caduceus/api/audit/entries', {});

    expect(json.headers.get('content-disposition')).toMatch(/^attachment; filename="caduceus-audit-.*\.json"$/);
    expect(((await json.json()) as { action: string }[]).map((entry) => entry.action)).toEqual(['POST /api/ops/doctor', 'POST /api/profiles/{name}/describe-auto', 'passkey.register']);
    expect(csv.headers.get('content-type')).toContain('text/csv');
    const lines = (await csv.text()).trim().split('\n');
    expect(lines[0]).toBe('time,actor,tier,action,target,profile,source');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('POST /api/profiles/{name}/describe-auto');
    expect([del.status, put.status]).toEqual([404, 404]);
    expect((await read('')).total).toBe(before);
  });
});
