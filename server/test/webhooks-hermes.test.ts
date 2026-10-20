import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { AuditEntry, PolicyRefusal } from '@caduceus/contracts/caduceus-api';
import { createRequest, deleteRequest, emptyDraft, parseWebhooks, readCreated, setEnabledRequest, validateWebhookForm, webhooksListPath, type WebhookDraft } from '../../web/src/modules/webhooks/webhooks-model.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Connect › Webhooks (M5 #04) through the Caduceus server, in front of the real Hermes in a throwaway HERMES_HOME. The page's own
// reading and request code (`web/src/modules/webhooks/webhooks-model.ts`) is run over what Hermes really answers. Switching the
// receiver on (`POST /api/webhooks/enable`) restarts a gateway, which on this Mac can be the owner's own, so that one route is tested
// against the stub upstream (webhooks.test.ts); here the temp home's config is switched on through Hermes's own CLI.
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
  fs.rmSync(path.join(hermes.home, 'webhook_subscriptions.json'), { force: true });
  await setReceiver(false);
});

/** What the owner would have done with `hermes gateway setup`: the webhook platform on or off in the temp home's config. */
function setReceiver(enabled: boolean): Promise<string> {
  return hermes.cli('config', 'set', 'platforms.webhook.enabled', String(enabled));
}

interface Owner {
  url: string;
  cookie: string;
  call<T = unknown>(method: string, route: string, init?: { body?: unknown }): Promise<{ status: number; body: T; headers: Headers; text: string }>;
}

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

describe('the receiver and its subscriptions', () => {
  test('are Hermes’s own, read by the page’s code: a receiver that is off has none, one that is on says where it listens', async () => {
    const owner = await start();

    const off = await owner.call('GET', webhooksListPath('default'));
    expect(off.status).toBe(200);
    expect(off.headers.get('cache-control')).toBe('no-store');
    expect(parseWebhooks(off.body)).toEqual({ enabled: false, baseUrl: 'http://localhost:8644', subscriptions: [] });

    await setReceiver(true);
    const on = parseWebhooks((await owner.call('GET', webhooksListPath('default'))).body);
    expect(on).toEqual({ enabled: true, baseUrl: 'http://localhost:8644', subscriptions: [] });
  });
});

const listed = async (owner: Owner) => parseWebhooks((await owner.call('GET', webhooksListPath('default'))).body);

/** Every file under `dir`, whole. */
function filesUnder(dir: string): { file: string; bytes: Buffer }[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [{ file, bytes: fs.readFileSync(file) }];
  });
}

const draft = (extra: Partial<WebhookDraft> = {}): WebhookDraft => ({ ...emptyDraft(), name: 'github-push', description: 'Pushes to main', events: 'push, pull_request', prompt: 'Summarise {repository.name}', ...extra });

describe('creating a subscription', () => {
  test('is Tier 2: without a passkey step-up Hermes is not asked and nothing is created', async () => {
    await setReceiver(true);
    const owner = await start({ steppedUp: false });
    const send = createRequest(draft(), 'default');

    const refused = await owner.call<PolicyRefusal>(send.method, send.path, { body: send.body });

    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'step-up-required', tier: 'T2' });
    expect((await listed(owner)).subscriptions).toEqual([]);
  });

  test('with a script is Tier 3: a passkey is not enough, it needs the typed confirmation as well', async () => {
    await setReceiver(true);
    const owner = await start();
    const send = createRequest(draft({ script: 'transform.py' }), 'default');

    const unconfirmed = await owner.call<PolicyRefusal>(send.method, send.path, { body: send.body });

    expect(unconfirmed.status).toBe(403);
    expect(unconfirmed.body).toMatchObject({ error: 'confirmation-required', tier: 'T3' });
    expect((await listed(owner)).subscriptions).toEqual([]);
  });

  test('answers with the secret once; Hermes’s list never has it, and it is in no log, audit entry or file of Caduceus', async () => {
    await setReceiver(true);
    const stdout = vi.spyOn(process.stdout, 'write');
    const stderr = vi.spyOn(process.stderr, 'write');
    const hermesLog: string[] = [];
    const onLog = (chunk: string) => hermesLog.push(chunk);
    hermes.backend.on('log', onLog);
    try {
      const owner = await start();
      const send = createRequest(draft(), 'default');

      const created = await owner.call(send.method, send.path, { body: send.body });
      const { webhook, secret } = readCreated(created.body);

      expect(created.status).toBe(200);
      expect(created.headers.get('cache-control')).toBe('no-store');
      expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(webhook).toMatchObject({ name: 'github-push', description: 'Pushes to main', events: ['push', 'pull_request'], deliver: 'log', secretSet: true, enabled: true, url: 'http://localhost:8644/webhooks/github-push' });

      // After that, nothing Caduceus can be asked gives it back.
      const list = await owner.call('GET', webhooksListPath('default'));
      expect(parseWebhooks(list.body).subscriptions).toEqual([webhook]);
      expect(list.text).not.toContain(secret!);
      const audit = await owner.call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit');
      expect(audit.body.entries.find((entry) => entry.action === 'POST /api/webhooks')).toMatchObject({ tier: 'T2', target: '/api/webhooks', profile: 'default' });
      expect(audit.text).not.toContain(secret!);
      expect(hermesLog.join('')).not.toContain(secret!);
      const printed = [...stdout.mock.calls, ...stderr.mock.calls].map(([chunk]) => String(chunk)).join('');
      expect(printed).not.toContain(secret!);
      await server?.close();
      server = undefined;
      for (const { file, bytes } of filesUnder(path.join(hermes.home, 'caduceus'))) expect(bytes.includes(secret!), file).toBe(false);
    } finally {
      hermes.backend.off('log', onLog);
      stdout.mockRestore();
      stderr.mockRestore();
    }
  });

  test('a receiver that is off, or a name Hermes does not accept, is refused in Hermes’s own words, which are the words the form shows', async () => {
    const owner = await start();
    const off = createRequest(draft(), 'default');
    const refusedOff = await owner.call<{ detail: string }>(off.method, off.path, { body: off.body });
    expect(refusedOff.status).toBe(400);
    expect(refusedOff.body.detail).toBe('Webhook platform is not enabled. Enable it from the Webhooks page first.');

    await setReceiver(true);
    for (const bad of [draft({ name: '-nope' }), draft({ name: 'a/b' }), draft({ deliver: 'log', deliverOnly: true })]) {
      const send = createRequest(bad, 'default');
      const refused = await owner.call<{ detail: string }>(send.method, send.path, { body: send.body });
      expect(refused.status).toBe(400);
      expect(Object.values(validateWebhookForm(bad))).toEqual([refused.body.detail]);
    }
    expect(validateWebhookForm(draft())).toEqual({});
  });
});

/** A subscription made straight at Hermes, as `hermes webhook subscribe` would: the test's setup, not what is under test. */
async function subscribe(name: string): Promise<void> {
  await setReceiver(true);
  const send = createRequest(draft({ name }), 'default');
  const made = await hermes.backend.fetch('/api/webhooks?profile=default', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(send.body) });
  expect(made.status).toBe(200);
}

describe('a subscription’s switch', () => {
  test('is Hermes’s own flag: a disabled subscription stays listed and turns back on, with no restart', async () => {
    await subscribe('github-push');
    const owner = await start();

    const off = setEnabledRequest('github-push', false, 'default');
    const switchedOff = await owner.call<{ ok: boolean; enabled: boolean }>(off.method, off.path, { body: off.body });
    expect(switchedOff.body).toMatchObject({ ok: true, enabled: false });
    expect((await listed(owner)).subscriptions.map(({ name, enabled }) => [name, enabled])).toEqual([['github-push', false]]);

    const on = setEnabledRequest('github-push', true, 'default');
    await owner.call(on.method, on.path, { body: on.body });
    expect((await listed(owner)).subscriptions.map(({ name, enabled }) => [name, enabled])).toEqual([['github-push', true]]);
  });
});

describe('deleting a subscription', () => {
  test('is Tier 1: it needs no passkey, names the profile Hermes asks for, removes only that subscription, and is audited by name', async () => {
    await subscribe('github-push');
    await subscribe('stripe-events');
    const steady = await start({ steppedUp: false });
    const send = deleteRequest('github-push', 'default');

    const deleted = await steady.call(send.method, send.path);
    const audit = await steady.call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit');

    expect(deleted.status).toBe(200);
    expect((await listed(steady)).subscriptions.map((webhook) => webhook.name)).toEqual(['stripe-events']);
    expect(audit.body.entries.find((entry) => entry.action === 'DELETE /api/webhooks/{name}')).toMatchObject({ tier: 'T1', target: '/api/webhooks/github-push', profile: 'default' });
    const gone = await steady.call<{ detail: string }>(send.method, send.path);
    expect(gone.status).toBe(404);
    expect(gone.body.detail).toBe("No subscription named 'github-push'");
  });
});
