import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AuditEntry, PolicyRefusal } from '@caduceus/contracts/caduceus-api';
import { approveRequest, clearPending, pairingListPath, parsePairing, revokeUser } from '../../web/src/modules/pairing/pairing-model.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { openGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { seedApprovedUser, seedPairingRequest } from './fixtures/seed-pairing.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Connect › Pairing (M5 #04) through the Caduceus server, in front of the real Hermes in a throwaway HERMES_HOME. The pairing store
// is seeded the way a messaging gateway writes it (`fixtures/seed-pairing.ts`); no platform is ever contacted. The page's own reading
// and request code (`web/src/modules/pairing/pairing-model.ts`) is run over what Hermes really answers.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 90_000);
afterAll(async () => {
  await hermes.stop();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
  fs.rmSync(path.join(hermes.home, 'platforms', 'pairing'), { recursive: true, force: true });
});

interface Owner {
  url: string;
  cookie: string;
  call<T = unknown>(method: string, route: string, init?: { body?: unknown }): Promise<{ status: number; body: T; headers: Headers; text: string }>;
}

/** The owner signed in at the server; with `steppedUp`, a passkey step-up too (what a Tier 2 action asks for). */
async function start({ steppedUp = true }: { steppedUp?: boolean } = {}): Promise<Owner> {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const { url } = server;
  const cookie = await ownerCookie(url);
  if (steppedUp) await stepUp(url, cookie, await addPasskey(url, cookie));
  const call: Owner['call'] = async (method, route, { body } = {}) => {
    const res = await fetch(`${url}${route}`, {
      method,
      headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, body: (text.startsWith('{') ? JSON.parse(text) : text) as never };
  };
  return { url, cookie, call };
}

describe('the lists of pairing requests', () => {
  test('are Hermes’s own pending and approved users, read by the page’s code, and no code or hash of one reaches the browser', async () => {
    await seedPairingRequest(hermes.home, 'telegram', '1001', 'Ann');
    await seedPairingRequest(hermes.home, 'discord', '2002', 'Bo');
    await seedApprovedUser(hermes.home, 'telegram', '3003', 'Cy');
    const owner = await start();

    const answer = await owner.call('GET', pairingListPath('default'));
    const { pending, approved } = parsePairing(answer.body);

    expect(answer.status).toBe(200);
    expect(answer.headers.get('cache-control')).toBe('no-store');
    expect(pending.map(({ platform, userId, userName, ageMinutes, approvable }) => ({ platform, userId, userName, ageMinutes, approvable }))).toEqual([
      // Hermes lists a platform at a time, in the order of the platforms' names.
      { platform: 'discord', userId: '2002', userName: 'Bo', ageMinutes: 0, approvable: true },
      { platform: 'telegram', userId: '1001', userName: 'Ann', ageMinutes: 0, approvable: true },
    ]);
    expect(pending.every((request) => /^[0-9a-f]{16}$/.test(request.requestId))).toBe(true);
    expect(approved.map(({ platform, userId, userName }) => ({ platform, userId, userName }))).toEqual([{ platform: 'telegram', userId: '3003', userName: 'Cy' }]);
    expect(approved[0].approvedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(answer.text).not.toMatch(/salt|hash|"code"/);
  });
});

const listed = async (owner: Owner, profile = 'default') => parsePairing((await owner.call('GET', pairingListPath(profile))).body);

describe('approving a request', () => {
  test('is Tier 2: without a passkey step-up Hermes is not asked and the request stays pending', async () => {
    await seedPairingRequest(hermes.home, 'telegram', '1001', 'Ann');
    const owner = await start({ steppedUp: false });
    const [request] = (await listed(owner)).pending;
    const send = approveRequest(request, 'default');

    const refused = await owner.call<PolicyRefusal>(send.method, send.path, { body: send.body });

    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'step-up-required', tier: 'T2' });
    expect((await listed(owner)).pending).toHaveLength(1);
  });

  test('moves the user from pending to approved through Hermes, by the request’s id, and is audited with the profile', async () => {
    await seedPairingRequest(hermes.home, 'telegram', '1001', 'Ann');
    const owner = await start();
    const [request] = (await listed(owner)).pending;
    const send = approveRequest(request, 'default');

    const approved = await owner.call(send.method, send.path, { body: send.body });
    const after = await listed(owner);
    const audit = await owner.call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit');

    expect(approved.status).toBe(200);
    expect(after.pending).toEqual([]);
    expect(after.approved.map(({ platform, userId, userName }) => ({ platform, userId, userName }))).toEqual([{ platform: 'telegram', userId: '1001', userName: 'Ann' }]);
    expect(audit.body.entries.find((entry) => entry.action === 'POST /api/pairing/approve')).toMatchObject({ tier: 'T2', target: '/api/pairing/approve', profile: 'default' });
  });

  test('a request that has expired or was already answered is Hermes’s own 404, in its words', async () => {
    await seedPairingRequest(hermes.home, 'telegram', '1001', 'Ann');
    const owner = await start();
    const [request] = (await listed(owner)).pending;
    const send = approveRequest(request, 'default');
    await owner.call(send.method, send.path, { body: send.body });

    const again = await owner.call<{ detail: string }>(send.method, send.path, { body: send.body });

    expect(again.status).toBe(404);
    expect(again.body.detail).toBe("Pairing request or code not found or expired for platform 'telegram'.");
  });
});

describe('revoking an approved user', () => {
  test('is Tier 2 and Hermes forgets them: they leave the approved list, and the audit trail names the profile', async () => {
    await seedApprovedUser(hermes.home, 'telegram', '3003', 'Cy');
    const unsteady = await start({ steppedUp: false });
    const [user] = (await listed(unsteady)).approved;
    const send = revokeUser(user, 'default');
    const refused = await unsteady.call<PolicyRefusal>(send.method, send.path, { body: send.body });
    expect(refused.body).toMatchObject({ error: 'step-up-required', tier: 'T2' });
    expect((await listed(unsteady)).approved).toHaveLength(1);
    await server?.close();

    const owner = await start();
    const revoked = await owner.call(send.method, send.path, { body: send.body });
    const audit = await owner.call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit');

    expect(revoked.status).toBe(200);
    expect((await listed(owner)).approved).toEqual([]);
    expect(audit.body.entries.find((entry) => entry.action === 'POST /api/pairing/revoke')).toMatchObject({ tier: 'T2', target: '/api/pairing/revoke', profile: 'default' });
    const again = await owner.call<{ detail: string }>(send.method, send.path, { body: send.body });
    expect(again.status).toBe(404);
    expect(again.body.detail).toBe('User 3003 not found in approved list for telegram.');
  });
});

describe('clearing the pending requests', () => {
  test('is Tier 1: it needs no passkey, Hermes says how many it dropped, approved users stay, and it is audited', async () => {
    await seedPairingRequest(hermes.home, 'telegram', '1001', 'Ann');
    await seedPairingRequest(hermes.home, 'telegram', '1002', 'Bo');
    await seedApprovedUser(hermes.home, 'discord', '3003', 'Cy');
    const owner = await start({ steppedUp: false });
    const send = clearPending('default');

    const cleared = await owner.call<{ cleared: number }>(send.method, send.path);
    const after = await listed(owner);
    const audit = await owner.call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit');

    expect(cleared.status).toBe(200);
    expect(cleared.body.cleared).toBe(2);
    expect(after.pending).toEqual([]);
    expect(after.approved).toHaveLength(1);
    expect(audit.body.entries.find((entry) => entry.action === 'POST /api/pairing/clear-pending')).toMatchObject({ tier: 'T1', profile: 'default' });
  });
});

describe('a named profile', () => {
  test('has the pairing store of its own gateway: what is pending for it is not pending for the default profile, and approving writes into its store', async () => {
    const created = await hermes.backend.fetch('/api/profiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'coder' }) });
    expect(created.ok).toBe(true);
    await seedPairingRequest(hermes.home, 'telegram', '1001', 'Ann', 'coder');
    const owner = await start();

    expect((await listed(owner, 'default')).pending).toEqual([]);
    const [request] = (await listed(owner, 'coder')).pending;
    expect(request).toMatchObject({ platform: 'telegram', userId: '1001' });
    const send = approveRequest(request, 'coder');
    expect((await owner.call(send.method, send.path, { body: send.body })).status).toBe(200);

    expect((await listed(owner, 'coder')).approved.map((user) => user.userId)).toEqual(['1001']);
    expect((await listed(owner, 'default')).approved).toEqual([]);
  });
});

describe('the lists, kept live', () => {
  test('a request that arrives reaches the page as pairing.changed, and the list it then reads has it', async () => {
    await seedPairingRequest(hermes.home, 'telegram', '1001', 'Ann');
    const owner = await start();
    const page = openGatewayConnection(owner.url, owner.cookie);
    try {
      await page.until((status) => status.state === 'connected');
      const { client } = page.connection;

      // Hermes's change watcher records the ledgers' modification time on its first pass, a moment after the first gateway
      // connection, and reports later changes only. So touch the ledger (what a gateway writing to it does) until it reports.
      // A bounded poll of an OS-level fact, the watcher's own tick; it fails with the time it gave up at.
      let primed = false;
      const stopPriming = client.on('pairing.changed', () => {
        primed = true;
      });
      await vi.waitFor(
        () => {
          if (primed) return;
          const now = new Date();
          fs.utimesSync(path.join(hermes.home, 'platforms', 'pairing', 'telegram-pending.json'), now, now);
          throw new Error('Hermes has not reported a change yet');
        },
        { timeout: 15_000, interval: 600 },
      );
      stopPriming();

      const { promise: changed, resolve } = Promise.withResolvers<void>();
      client.on('pairing.changed', () => resolve());
      await seedPairingRequest(hermes.home, 'telegram', '1002', 'Bo');
      await changed;

      expect((await listed(owner)).pending.map((request) => request.userId)).toEqual(['1001', '1002']);
    } finally {
      page.connection.close();
    }
  }, 45_000);
});
