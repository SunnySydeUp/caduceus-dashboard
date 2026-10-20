import { afterEach, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AuditEntry, PolicyRefusal } from '@caduceus/contracts/caduceus-api';
import type { HermesBackend } from '../src/hermes-backend.ts';
import { startCaduceusServer, type CaduceusServer, type CaduceusServerOptions } from '../src/caduceus-server.ts';
import { launchFakeHermes } from './fixtures/fake-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// The policy proxy at the Caduceus HTTP seam, in front of the fake Hermes: a stub upstream that counts what reaches it.
// What the real Hermes does with what is let through is checked in policy-proxy-hermes.test.ts.
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

const START = Date.parse('2026-10-07T09:00:00.000Z');

/** Asks for a typed confirmation the way the dialog does, once the owner has typed `typed` for `target`. */
const confirmation = (call: Started['call'], operation: string, target: string, typed = target, bodySha256?: string) =>
  call<Confirmation>('POST', '/_caduceus/api/policy/confirmations', { body: { operation, target, typed, ...(bodySha256 ? { bodySha256 } : {}) } });
const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');
const withToken = (token: string) => ({ headers: { 'x-caduceus-confirmation': token } });

/** A typed confirmation, as the mint route answers. */
interface Confirmation {
  token: string;
  expiresAt: string;
}

interface Started {
  url: string;
  cookie: string;
  hermesRoot: string;
  /** The clock the server reads; move `now` to move time. */
  clock: { now: number };
  /** Calls Caduceus the way the web app does, from the owner's session. `T` is the body the test expects. */
  call<T = unknown>(method: string, route: string, init?: { body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; body: T }>;
  /** What reached the fake Hermes since the last time this was asked. */
  upstream(): Promise<{ method: string; target: string; body: string }[]>;
}

/** Starts Caduceus in front of the fake Hermes and signs in. `again` restarts Caduceus on the same Hermes and store. */
async function start(options: Partial<CaduceusServerOptions> = {}, again?: { hermesRoot: string }): Promise<Started> {
  backend ??= launchFakeHermes();
  const hermesRoot = again?.hermesRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-root-'));
  if (!again) tempDirs.push(hermesRoot);
  const clock = { now: START };
  server = await startCaduceusServer({ backend, hermesRoot, now: () => clock.now, ...options });
  await backend.ready();
  const { url } = server;
  const cookie = await ownerCookie(url);
  // Caduceus checks every Hermes launch against the pinned contracts, which the stand-in sees as requests. Let that
  // finish, and forget it: what a test counts is what it sent itself.
  await fetch(`${url}/_caduceus/api/compatibility`, { headers: { cookie } });
  await backend.fetch('/api/__fake/hits');
  return {
    url,
    cookie,
    hermesRoot,
    clock,
    async call(method, route, { body, headers } = {}) {
      const res = await fetch(`${url}${route}`, {
        method,
        headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      // Unchecked: the assertions that follow are what check the body.
      const parsed = (res.headers.get('content-type')?.startsWith('application/json') ? JSON.parse(text) : text) as never;
      return { status: res.status, body: parsed };
    },
    async upstream() {
      // What reached Hermes as a request of the page's. The counters Caduceus reads to fence a session write (`session-fence.ts`) are its own reads, not the page's.
      const hits: { method: string; target: string; body: string }[] = await (await backend!.fetch('/api/__fake/hits')).json();
      return hits.filter((hit) => !hit.target.includes('/mutation-snapshot'));
    },
  };
}

describe('denied requests', () => {
  test('never reach Hermes, and the answer says what was denied and why', async () => {
    const { call, upstream } = await start();

    const answers = await Promise.all(
      [
        ['POST', '/api/profiles/coder/open-terminal'],
        ['POST', '/api/auth/ws-ticket'],
        ['POST', '/api/pub'],
        ['GET', '/api/events'],
        // Not in the pinned contract: nobody has decided its tier.
        ['GET', '/api/does-not-exist'],
        ['GET', '/api/plugins/commandcode-usage/health'],
        // A path Hermes would route to something else than what it looks like.
        ['GET', '/api/sessions/%2e%2e%2fconfig'],
        ['GET', '/api//status'],
      ].map(([method, route]) => call(method, route)),
    );

    expect(answers.map((a) => a.status)).toEqual(Array(8).fill(403));
    const refusals = answers.map((a) => a.body as PolicyRefusal);
    expect(refusals.map((r) => [r.error, r.tier, r.reason])).toEqual([
      ['denied', 'denied', 'host-terminal'],
      ['denied', 'denied', 'hermes-auth'],
      ['denied', 'denied', 'frame-injection'],
      ['denied', 'denied', 'frame-injection'],
      ['denied', 'denied', 'unclassified'],
      ['denied', 'denied', 'unclassified'],
      ['denied', 'denied', 'bad-path'],
      ['denied', 'denied', 'bad-path'],
    ]);
    expect(refusals[0]).toMatchObject({
      operation: 'POST /api/profiles/{name}/open-terminal',
      message: 'Opening a terminal on the host is not available through Caduceus. Copy the command and run it yourself.',
    });
    // The stub upstream counts what arrives: nothing did.
    expect(await upstream()).toEqual([]);

    // The same stub does get a request that is classified, so the empty list above means something.
    expect((await call('GET', '/api/status')).status).toBe(200);
    expect(await upstream()).toEqual([{ method: 'GET', target: '/api/status', body: '' }]);
  });
});

describe('step-up (T2)', () => {
  test('a T2 request without a grant is answered step-up-required and never reaches Hermes; a passkey grant lets it through, for 5 minutes', async () => {
    const { url, cookie, clock, call, upstream } = await start();
    const authenticator = await addPasskey(url, cookie);
    const restart = () => call('POST', '/api/gateway/restart');

    const without = await restart();
    const beforeGrant = await upstream();
    await stepUp(url, cookie, authenticator);
    const first = await restart();
    clock.now += 5 * 60_000 - 1;
    const justBeforeExpiry = await restart();
    clock.now += 1;
    const expired = await restart();

    expect(without).toMatchObject({ status: 403, body: { error: 'step-up-required', tier: 'T2', operation: 'POST /api/gateway/restart' } });
    expect(beforeGrant).toEqual([]);
    // Past the policy, the stand-in answers the lifecycle call itself: what matters is that it got it.
    expect([first.status, justBeforeExpiry.status]).toEqual([200, 200]);
    expect(await upstream()).toEqual([
      { method: 'POST', target: '/api/gateway/restart', body: '' },
      { method: 'POST', target: '/api/gateway/restart', body: '' },
    ]);
    expect(expired).toMatchObject({ status: 403, body: { error: 'step-up-required' } });
  });

  test('a T1 request needs no step-up', async () => {
    const { call, upstream } = await start();

    const answer = await call('POST', '/api/profiles/coder/describe-auto', { body: {} });

    expect(answer.status).toBe(404);
    expect(await upstream()).toEqual([{ method: 'POST', target: '/api/profiles/coder/describe-auto', body: '{}' }]);
  });
});

describe('read-only mode', () => {
  test('is off at first, turning it on or off is T2, and while it is on only reads reach Hermes, at every tier', async () => {
    const { url, cookie, call, upstream } = await start();
    const authenticator = await addPasskey(url, cookie);
    const readOnly = (value: boolean) => call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: value } });

    const initial = await call('GET', '/_caduceus/api/policy/read-only');
    const turnOnWithoutGrant = await readOnly(true);
    await stepUp(url, cookie, authenticator);
    const turnedOn = await readOnly(true);
    // A grant does not lift read-only mode: the step-up is asked after it, so nothing is asked in vain.
    const attempts = [
      ['GET', '/api/status'],
      ['POST', '/api/audio/speak'],
      ['PATCH', '/api/sessions/s1'],
      ['POST', '/api/ops/backup'],
      ['POST', '/api/gateway/restart'],
      ['PUT', '/api/config'],
      ['GET', '/api/ops/backup/download'],
      ['POST', '/api/sessions/prune'],
    ];
    const whileOn: [number, string | undefined][] = [];
    for (const [method, route] of attempts) {
      const answer = await call<{ error?: string }>(method, route);
      whileOn.push([answer.status, answer.body.error]);
    }
    const reached = await upstream();
    // A session with no grant is told read-only mode is on, not asked for a passkey for what cannot happen.
    const noGrant = await call('POST', '/api/gateway/restart', { headers: { cookie: await ownerCookie(url) } });
    const turnedOff = await readOnly(false);
    const afterwards = await call('PATCH', '/api/sessions/s1');

    expect(initial).toEqual({ status: 200, body: { readOnly: false } });
    expect(turnOnWithoutGrant).toMatchObject({ status: 403, body: { error: 'step-up-required' } });
    expect(turnedOn).toEqual({ status: 200, body: { readOnly: true } });
    expect(whileOn).toEqual([
      [200, undefined],
      [404, undefined],
      [403, 'read-only'],
      [403, 'read-only'],
      [403, 'read-only'],
      [403, 'read-only'],
      [403, 'read-only'],
      // A prune with no body is not a dry run.
      [403, 'read-only'],
    ]);
    // Only the two reads reached the stand-in (the speak route is a read it does not have: its own 404).
    expect(reached.map((hit) => `${hit.method} ${hit.target}`)).toEqual(['GET /api/status', 'POST /api/audio/speak']);
    expect(noGrant).toMatchObject({ status: 403, body: { error: 'read-only' } });
    expect(turnedOff).toEqual({ status: 200, body: { readOnly: false } });
    expect(afterwards.status).toBe(404);
  });

  test('says why a write was refused, and stays on across a restart of Caduceus', async () => {
    const first = await start();
    const authenticator = await addPasskey(first.url, first.cookie);
    await stepUp(first.url, first.cookie, authenticator);
    await first.call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } });
    await server!.close();

    const second = await start({}, { hermesRoot: first.hermesRoot });
    const state = await second.call('GET', '/_caduceus/api/policy/read-only');
    const refused = await second.call('PATCH', '/api/sessions/s1');

    expect(state.body).toEqual({ readOnly: true });
    expect(refused).toMatchObject({
      status: 403,
      body: { error: 'read-only', tier: 'T0', operation: 'PATCH /api/sessions/{session_id}', message: 'Read-only mode is on: Caduceus is not changing anything in Hermes.' },
    });
  });
});

describe('typed confirmation (T3)', () => {
  test('needs a step-up and a typed confirmation bound to its target: none, one for another target, a replayed one and a stale one are refused', async () => {
    const { url, cookie, clock, call, upstream } = await start();
    const authenticator = await addPasskey(url, cookie);
    const remove = (name: string, token?: string) => call('DELETE', `/api/profiles/${name}`, token ? withToken(token) : {});

    const noStepUp = await remove('coder');
    const mintWithoutStepUp = await confirmation(call, 'DELETE /api/profiles/coder', 'coder');
    await stepUp(url, cookie, authenticator);
    const noToken = await remove('coder');
    const mistyped = await confirmation(call, 'DELETE /api/profiles/coder', 'coder', 'cod');
    const forWriter = (await confirmation(call, 'DELETE /api/profiles/writer', 'writer')).body;
    const wrongTarget = await remove('coder', forWriter.token);
    const minted = (await confirmation(call, 'DELETE /api/profiles/coder', 'coder')).body;
    const first = await remove('coder', minted.token);
    const replayed = await remove('coder', minted.token);
    // The same instant a confirmation is 60 s old it is stale: a request queued while offline and sent later is refused.
    const staleOne = (await confirmation(call, 'DELETE /api/profiles/coder', 'coder')).body;
    clock.now += 60_000 - 1;
    const justInTime = await remove('coder', staleOne.token);
    const stale = (await confirmation(call, 'DELETE /api/profiles/coder', 'coder')).body;
    clock.now += 60_000;
    const late = await remove('coder', stale.token);
    const nonsense = await remove('coder', 'not-a-token');

    expect(noStepUp).toMatchObject({ status: 403, body: { error: 'step-up-required', tier: 'T3', operation: 'DELETE /api/profiles/{name}' } });
    expect(mintWithoutStepUp).toMatchObject({ status: 403, body: { error: 'step-up-required' } });
    expect(noToken).toMatchObject({ status: 403, body: { error: 'confirmation-required', tier: 'T3', operation: 'DELETE /api/profiles/{name}' } });
    expect(mistyped).toMatchObject({ status: 400, body: { error: 'confirmation-mismatch' } });
    expect(minted.expiresAt).toBe('2026-10-07T09:01:00.000Z');
    expect(wrongTarget).toMatchObject({ status: 403, body: { error: 'confirmation-invalid' } });
    expect(first.status).toBe(404);
    expect(replayed).toMatchObject({ status: 403, body: { error: 'confirmation-invalid' } });
    expect(justInTime.status).toBe(404);
    expect(late).toMatchObject({ status: 403, body: { error: 'confirmation-expired', message: 'This confirmation expired. Confirm again.' } });
    expect(nonsense).toMatchObject({ status: 403, body: { error: 'confirmation-invalid' } });
    // Only the two good requests reached the stand-in, and each said what it deleted.
    expect(await upstream()).toEqual([
      { method: 'DELETE', target: '/api/profiles/coder', body: '' },
      { method: 'DELETE', target: '/api/profiles/coder', body: '' },
    ]);
  });

  test("binds a confirmation to the request's body, to the session that confirmed, and refuses one while read-only mode is on", async () => {
    const { url, cookie, call, upstream } = await start();
    const authenticator = await addPasskey(url, cookie);
    await stepUp(url, cookie, authenticator);
    const body = { ids: ['a', 'b'] };
    const bulkDelete = (token: string, ids = body.ids) => call('POST', '/api/sessions/bulk-delete', { body: { ids, profile: 'default' }, ...withToken(token) });
    const bound = async (ids: string[]) => (await confirmation(call, 'POST /api/sessions/bulk-delete', '2 sessions', '2 sessions', sha256(JSON.stringify({ ids, profile: 'default' })))).body.token;

    const otherIds = await bulkDelete(await bound(['a', 'b']), ['a', 'b', 'c']);
    const sameIds = await bulkDelete(await bound(['a', 'b']));
    // A token minted by one session is of no use to another, even one holding a step-up of its own.
    const other = await ownerCookie(url);
    await stepUp(url, other, authenticator);
    const borrowed = await call('DELETE', '/api/profiles/coder', {
      headers: { cookie: other, 'x-caduceus-confirmation': (await confirmation(call, 'DELETE /api/profiles/coder', 'coder')).body.token },
    });
    // Nothing is confirmed for a request the policy would not forward.
    const unknownOperation = await confirmation(call, 'DELETE /api/does-not-exist', 'x');
    await call('PUT', '/_caduceus/api/policy/read-only', { body: { readOnly: true } });
    const whileReadOnly = await confirmation(call, 'DELETE /api/profiles/coder', 'coder');

    expect(otherIds).toMatchObject({ status: 403, body: { error: 'confirmation-invalid' } });
    expect(sameIds.status).toBe(404);
    expect(borrowed).toMatchObject({ status: 403, body: { error: 'confirmation-invalid' } });
    expect(whileReadOnly).toMatchObject({ status: 403, body: { error: 'read-only' } });
    expect(unknownOperation).toMatchObject({ status: 400, body: { error: 'unknown-operation' } });
    expect(await upstream()).toEqual([{ method: 'POST', target: '/api/sessions/bulk-delete', body: '{"ids":["a","b"],"profile":"default"}' }]);
  });
});

describe('the file-write guard', () => {
  /** A Hermes root home under a fake home directory, with a workspace and a folder outside the allowed roots. */
  function folders() {
    const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-files-')));
    tempDirs.push(home);
    const hermesRoot = path.join(home, '.hermes');
    const workspace = path.join(home, 'work', 'project');
    const outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-outside-')));
    tempDirs.push(outside);
    fs.mkdirSync(path.join(hermesRoot, 'caduceus'), { recursive: true });
    fs.mkdirSync(workspace, { recursive: true });
    return { home, hermesRoot, workspace, outside };
  }

  test('refuses raw writes to .env, auth.json, caduceus/ and outside the allowed roots, and unreadable ones, before they reach Hermes', async () => {
    const { home, hermesRoot, outside } = folders();
    const { url, cookie, call, upstream } = await start({ fileRoots: [home] }, { hermesRoot });
    const authenticator = await addPasskey(url, cookie);
    await stepUp(url, cookie, authenticator);
    const writeText = (target: string) => call<PolicyRefusal>('POST', '/api/fs/write-text', { body: { path: target, content: 'x' } });
    // A request with a body of its own kind (multipart, or JSON that is not quite JSON), sent as the browser would.
    const bytes = async (route: string, init: RequestInit & { headers?: Record<string, string> }) => {
      const res = await fetch(`${url}${route}`, { ...init, headers: { origin: url, cookie, ...init.headers } });
      const body: PolicyRefusal = await res.json();
      return { status: res.status, body };
    };
    const form = new FormData();
    form.set('path', path.join(hermesRoot, '.env'));
    form.set('file', new Blob(['KEY=1']), 'x');

    const attempts = [
      await writeText(path.join(hermesRoot, '.env')),
      await writeText(path.join(hermesRoot, 'profiles', 'coder', 'auth.json')),
      await writeText(path.join(hermesRoot, 'caduceus', 'caduceus.db')),
      await writeText(path.join(outside, 'x.txt')),
      await writeText('/etc/hosts'),
      await writeText('notes.md'),
      await writeText('file:///etc/hosts'),
      await call<PolicyRefusal>('POST', '/api/files/upload', { body: { path: path.join(hermesRoot, 'caduceus', 'x'), data_url: 'data:text/plain;base64,eA==' } }),
      await call<PolicyRefusal>('POST', '/api/files/mkdir', { body: { path: path.join(outside, 'new') } }),
      await call<PolicyRefusal>('DELETE', '/api/files', { body: { path: path.join(hermesRoot, 'caduceus') } }),
      await call<PolicyRefusal>('POST', '/api/ops/backup', { body: { output: path.join(hermesRoot, '.env') } }),
      await call<PolicyRefusal>('POST', '/api/profiles/coder/export', { body: { output: path.join(outside, 'coder.zip') } }),
      await bytes('/api/files/upload-stream', { method: 'POST', body: form }),
      // Hermes parses JSON that JavaScript does not (NaN), so a body Caduceus cannot read is refused where it matters.
      await bytes('/api/fs/write-text', { method: 'POST', headers: { 'content-type': 'application/json' }, body: `{"path": ${JSON.stringify(path.join(hermesRoot, '.env'))}, "content": "", "n": NaN}` }),
    ];
    const reads = [
      await call<PolicyRefusal>('GET', `/api/fs/read-text?path=${encodeURIComponent(path.join(hermesRoot, 'caduceus', 'caduceus.db'))}`),
      await call<PolicyRefusal>('GET', `/api/files/read?path=${encodeURIComponent(path.join(home, 'ok.txt'))}&path=${encodeURIComponent(path.join(hermesRoot, '.env'))}`),
    ];

    expect(attempts.map((a) => [a.status, a.body.reason])).toEqual([
      [403, 'protected-path'],
      [403, 'protected-path'],
      [403, 'protected-path'],
      [403, 'outside-roots'],
      [403, 'outside-roots'],
      [403, 'bad-path'],
      [403, 'bad-path'],
      [403, 'protected-path'],
      [403, 'outside-roots'],
      [403, 'protected-path'],
      [403, 'protected-path'],
      [403, 'outside-roots'],
      [403, 'protected-path'],
      [403, 'bad-body'],
    ]);
    expect(attempts[0].body).toMatchObject({
      error: 'denied',
      tier: 'denied',
      operation: 'POST /api/fs/write-text',
      message: 'This file is protected: Hermes’s keys, its sign-in file and Caduceus’s own data are edited only on their own screens.',
    });
    expect(reads.map((a) => [a.status, a.body.reason])).toEqual([
      [403, 'protected-path'],
      [403, 'protected-path'],
    ]);
    expect(await upstream()).toEqual([]);
  });

  test('lets a write inside the allowed roots through as T3, and as T1 inside a workspace Caduceus knows', async () => {
    const { home, hermesRoot, workspace } = folders();
    const { url, cookie, call, upstream } = await start({ fileRoots: [home], workspaceRoots: () => [workspace] }, { hermesRoot });
    const authenticator = await addPasskey(url, cookie);
    const write = (target: string, token?: string) =>
      call('POST', '/api/fs/write-text', { body: { path: target, content: 'hello' }, ...(token ? { headers: { 'x-caduceus-confirmation': token } } : {}) });
    const inRoots = path.join(home, 'notes.md');

    // In a workspace it is T1: no passkey, no typed confirmation.
    const inWorkspace = await write(path.join(workspace, 'src', 'main.ts'));
    // Elsewhere inside the roots it is T3.
    const withoutGrant = await write(inRoots);
    await stepUp(url, cookie, authenticator);
    const withoutToken = await write(inRoots);
    const body = JSON.stringify({ path: inRoots, content: 'hello' });
    const { token } = (await confirmation(call, 'POST /api/fs/write-text', 'notes.md', 'notes.md', crypto.createHash('sha256').update(body).digest('hex'))).body;
    const confirmed = await write(inRoots, token);

    expect(inWorkspace.status).toBe(404);
    expect(withoutGrant).toMatchObject({ status: 403, body: { error: 'step-up-required', tier: 'T3' } });
    expect(withoutToken).toMatchObject({ status: 403, body: { error: 'confirmation-required' } });
    expect(confirmed.status).toBe(404);
    // Before each write Caduceus reads the file, to keep the text it replaces as a snapshot (M4 #02): those reads are not what this test is about.
    expect((await upstream()).map((hit) => hit.target).filter((target) => !target.startsWith('/api/fs/read-text'))).toEqual(['/api/fs/write-text', '/api/fs/write-text']);
  });

  test('refuses to read, list or download keys and credentials with a cookie alone, and still reads an ordinary file', async () => {
    const { home, hermesRoot, workspace } = folders();
    const { call, upstream } = await start({ fileRoots: [home], home, workspaceRoots: () => [workspace] }, { hermesRoot });
    const q = (target: string) => encodeURIComponent(target);
    const secrets = [path.join(home, '.ssh', 'id_ed25519'), path.join(home, '.aws', 'credentials'), path.join(hermesRoot, 'vault.key'), path.join(hermesRoot, 'config.yaml'), path.join(home, '.ssh')];
    const routes = (target: string) => [`/api/fs/read-text?path=${q(target)}`, `/api/fs/download?path=${q(target)}`, `/api/fs/read-data-url?path=${q(target)}`, `/api/fs/list?path=${q(target)}`, `/api/files/download?path=${q(target)}`, `/api/files?path=${q(target)}`, `/api/media?path=${q(target)}`];

    const refused = await Promise.all(secrets.flatMap(routes).map((route) => call<PolicyRefusal>('GET', route)));
    const ordinary = await call('GET', `/api/fs/read-text?path=${q(path.join(workspace, 'main.ts'))}`);

    expect(refused.map((a) => [a.status, a.body.reason])).toEqual(Array(secrets.length * 7).fill([403, 'secret-path']));
    expect(ordinary.status).toBe(404);
    expect((await upstream()).map((hit) => hit.target)).toEqual([`/api/fs/read-text?path=${q(path.join(workspace, 'main.ts'))}`]);
  });

  test('treats an upload, a new folder and a delete like a raw write: T3 outside a workspace, T1 inside one, and never into a place that runs code later', async () => {
    const { home, hermesRoot, workspace } = folders();
    const { url, cookie, call, upstream } = await start({ fileRoots: [home], home, workspaceRoots: () => [workspace] }, { hermesRoot });
    const authenticator = await addPasskey(url, cookie);
    const upload = (target: string) => call<PolicyRefusal>('POST', '/api/files/upload', { body: { path: target, data_url: 'data:text/plain;base64,eA==', overwrite: true } });
    const makeFolder = (target: string) => call<PolicyRefusal>('POST', '/api/files/mkdir', { body: { path: target } });
    const remove = (target: string) => call<PolicyRefusal>('DELETE', '/api/files', { body: { path: target } });
    const stream = async (target: string) => {
      const form = new FormData();
      form.set('path', target);
      form.set('file', new Blob(['x']), 'x');
      const res = await fetch(`${url}/api/files/upload-stream`, { method: 'POST', headers: { origin: url, cookie }, body: form });
      return { status: res.status, body: (await res.json()) as PolicyRefusal };
    };
    const all = (target: string) => Promise.all([upload(target), makeFolder(target), remove(target), stream(target)]);
    const elsewhere = path.join(home, 'Documents', 'a.txt');

    // No passkey: outside a workspace each of them needs one.
    const cookieOnly = await all(elsewhere);
    // In a workspace Caduceus knows they are T1: nothing is asked.
    const inWorkspace = await all(path.join(workspace, 'src', 'a.txt'));
    await stepUp(url, cookie, authenticator);
    const places = [
      path.join(home, '.zshrc'),
      path.join(home, '.ssh', 'authorized_keys'),
      path.join(home, 'Library', 'LaunchAgents', 'x.plist'),
      path.join(workspace, '.git', 'hooks', 'pre-commit'),
      path.join(home, '.config', 'x'),
      path.join(hermesRoot, 'scripts', 'a.sh'),
      path.join(hermesRoot, 'skills', 'x', 'SKILL.md'),
    ];
    const persistent = (await Promise.all(places.map(all))).flat();

    expect(cookieOnly.map((a) => [a.status, a.body.error, a.body.tier])).toEqual(Array(4).fill([403, 'step-up-required', 'T3']));
    expect(inWorkspace.map((a) => a.status)).toEqual([404, 404, 404, 404]);
    // Even a passkey does not open them, in a workspace or out of one.
    expect(persistent.map((a) => [a.status, a.body.reason ?? a.body])).toEqual(Array(places.length * 4).fill([403, 'persistence-path']));
    expect((await upstream()).map((hit) => hit.target).sort()).toEqual(['/api/files', '/api/files/mkdir', '/api/files/upload', '/api/files/upload-stream']);
  });
});

describe('request body limits', () => {
  const ONE_MIB = 1024 * 1024;

  test('a Hermes request over the limit is refused before it reaches Hermes; an upload may be bigger', async () => {
    const { url, cookie, call, upstream } = await start();
    const send = async (route: string, size: number, headers: Record<string, string> = {}) => {
      const res = await fetch(`${url}${route}`, {
        method: 'PATCH',
        headers: { origin: url, cookie, 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ title: 'x'.repeat(size) }),
      });
      const body: PolicyRefusal = await res.json();
      return { status: res.status, body };
    };

    const atLimit = await send('/api/sessions/s1', ONE_MIB - '{"title":""}'.length);
    const over = await send('/api/sessions/s1', ONE_MIB);
    // A body with no length in advance (chunked) is counted as it arrives.
    const chunked = await fetch(`${url}/api/sessions/s1`, {
      method: 'PATCH',
      headers: { origin: url, cookie, 'content-type': 'application/json' },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"title":"'));
          controller.enqueue(new TextEncoder().encode('x'.repeat(ONE_MIB)));
          controller.enqueue(new TextEncoder().encode('"}'));
          controller.close();
        },
      }),
      // @ts-expect-error: Node's fetch needs `duplex` to send a stream, and the DOM typings do not know it.
      duplex: 'half',
    });
    const upload = await call('POST', '/api/fs/write-text', { body: { path: '/nowhere', content: 'y'.repeat(2 * ONE_MIB) } });
    const hits = (await upstream()).map((hit) => `${hit.method} ${hit.target}`);

    expect(atLimit.status).toBe(404);
    expect(over).toMatchObject({ status: 413, body: { error: 'payload-too-large', maxBytes: ONE_MIB } });
    expect(chunked.status).toBe(413);
    // The upload is refused by the file guard (a path outside the roots), not by the body limit: its size was fine.
    expect(upload).toMatchObject({ status: 403, body: { reason: 'outside-roots' } });
    expect(hits).toEqual(['PATCH /api/sessions/s1']);
  });

  test('the Caduceus API itself takes only small bodies: a sign-in or passkey call cannot be a megabyte', async () => {
    const { url } = await start();

    const res = await fetch(`${url}/_caduceus/api/auth/sign-in`, {
      method: 'POST',
      headers: { origin: url, 'content-type': 'application/json' },
      body: JSON.stringify({ password: 'x'.repeat(100 * 1024) }),
    });

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: 'payload-too-large', maxBytes: 64 * 1024 });
  });
});

describe('the audit log', () => {
  test('a config save names the keys it changes and never their values', async () => {
    const { url, cookie, call } = await start();
    await stepUp(url, cookie, await addPasskey(url, cookie));
    const body = { config: { display: { compact: true }, agent: { max_turns: 40 }, auxiliary: { vision: { api_key: 'sk-super-secret' } }, toolsets: ['web', 'file'] } };
    const token = (await confirmation(call, 'PUT /api/config?profile=writer', 'writer', 'writer', sha256(JSON.stringify(body)))).body.token;

    const saved = await call('PUT', '/api/config?profile=writer', { body, ...withToken(token) });
    const { entries } = (await call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit')).body;

    // The stand-in has no such route (its own 404): the request was let through.
    expect(saved.status).toBe(404);
    const entry = entries.find((candidate) => candidate.action === 'PUT /api/config');
    expect(entry).toMatchObject({ tier: 'T3', profile: 'writer', target: '/api/config (display.compact, agent.max_turns, auxiliary.vision.api_key, toolsets)' });
    expect(JSON.stringify(entries)).not.toContain('sk-super-secret');
  });

  test('records every T1 and higher request, and every denial, with actor, tier, target and profile, and nothing for T0 or reads', async () => {
    const { url, cookie, clock, call } = await start();
    const authenticator = await addPasskey(url, cookie);
    const minuteLater = () => (clock.now += 60_000);

    minuteLater();
    await call('PATCH', '/api/sessions/s1');
    await call('GET', '/api/sessions');
    minuteLater();
    await call('POST', '/api/ops/doctor');
    await call('POST', '/api/profiles/coder/describe-auto');
    minuteLater();
    await call('PUT', '/api/env', { body: { key: 'K', value: 'v' } });
    await stepUp(url, cookie, authenticator);
    await call('PUT', '/api/env?profile=writer', { body: { key: 'K', value: 'v' } });
    await call('POST', '/api/sessions/prune', { body: { profile: 'researcher' }, headers: { 'x-caduceus-confirmation': 'guess' } });
    minuteLater();
    const { token } = (await call<Confirmation>('POST', '/_caduceus/api/policy/confirmations', { body: { operation: 'DELETE /api/profiles/coder', target: 'coder', typed: 'coder' } })).body;
    await call('DELETE', '/api/profiles/coder', { headers: { 'x-caduceus-confirmation': token } });
    minuteLater();
    await call('POST', '/api/profiles/coder/open-terminal');
    const { entries } = (await call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit')).body;

    // Sign-ins, passkey changes and the like have their own tests; these are the entries of Hermes requests and refusals.
    const proxied = entries.filter((entry) => /^(policy\.|[A-Z]+ \/)/.test(entry.action));
    expect(proxied).toEqual([
      { at: '2026-10-07T09:05:00.000Z', actor: 'owner', action: 'policy.denied', target: 'POST /api/profiles/coder/open-terminal', source: 'local', tier: 'denied' },
      { at: '2026-10-07T09:04:00.000Z', actor: 'owner', action: 'DELETE /api/profiles/{name}', target: '/api/profiles/coder', source: 'local', tier: 'T3', profile: 'coder' },
      { at: '2026-10-07T09:03:00.000Z', actor: 'owner', action: 'policy.refused', target: '/api/sessions/prune', source: 'local', tier: 'T3' },
      { at: '2026-10-07T09:03:00.000Z', actor: 'owner', action: 'PUT /api/env', target: '/api/env (K)', source: 'local', tier: 'T2', profile: 'writer' },
      { at: '2026-10-07T09:02:00.000Z', actor: 'owner', action: 'POST /api/profiles/{name}/describe-auto', target: '/api/profiles/coder/describe-auto', source: 'local', tier: 'T1', profile: 'coder' },
      { at: '2026-10-07T09:02:00.000Z', actor: 'owner', action: 'POST /api/ops/doctor', target: '/api/ops/doctor', source: 'local', tier: 'T1' },
    ]);
  });
});

describe('destructive session calls', () => {
  test('are refused without an explicit profile, before anything is asked of the owner, and reach Hermes with one', async () => {
    const { call, upstream } = await start();
    const refusedCalls: [string, string, unknown?][] = [
      ['DELETE', '/api/sessions/s1'],
      ['DELETE', '/api/sessions/empty'],
      ['POST', '/api/sessions/bulk-delete', { ids: ['a'] }],
      ['POST', '/api/sessions/prune', { older_than_days: 30 }],
      ['DELETE', '/api/sessions/s1?profile='],
      ['POST', '/api/sessions/bulk-delete', { ids: ['a'], profile: '  ' }],
    ];
    const refusals = [];
    for (const [method, route, body] of refusedCalls) refusals.push(await call<PolicyRefusal>(method, route, { body }));
    const reachedWithout = await upstream();

    const single = await call('DELETE', '/api/sessions/s1?profile=work');
    const empty = await call('DELETE', '/api/sessions/empty?profile=work');
    // A dry run changes nothing: it is the preview the confirmation reads, and needs no profile.
    const preview = await call('POST', '/api/sessions/prune', { body: { dry_run: true, older_than_days: 30 } });

    for (const refusal of refusals) expect(refusal).toMatchObject({ status: 400, body: { error: 'profile-required', tier: expect.stringMatching(/^T[13]$/) } });
    // `/api/sessions/empty` also fits the single delete's template, which is as strict: either name is the same rule.
    expect(refusals.map((refusal) => refusal.body.operation)).toEqual([
      'DELETE /api/sessions/{session_id}',
      'DELETE /api/sessions/{session_id}',
      'POST /api/sessions/bulk-delete',
      'POST /api/sessions/prune',
      'DELETE /api/sessions/{session_id}',
      'POST /api/sessions/bulk-delete',
    ]);
    expect(reachedWithout).toEqual([]);
    expect([single.status, empty.status, preview.status]).not.toContain(400);
    expect((await upstream()).map((hit) => `${hit.method} ${hit.target}`)).toEqual([
      'DELETE /api/sessions/s1?profile=work',
      'DELETE /api/sessions/empty?profile=work',
      'POST /api/sessions/prune',
    ]);
  });
});
