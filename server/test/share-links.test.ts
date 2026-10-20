import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SHARE_UNDO_MS } from '@caduceus/contracts/share-links';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { seedSession } from './fixtures/seed-session.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Share links (R4, M7 #06) through the Caduceus server in front of the real Hermes in a throwaway HERMES_HOME. Sessions are put into Hermes's own
// database by its own `SessionDB`; the clock is the test's, so expiry and the undo window are wound by hand.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
const temp: string[] = [];
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
  for (const folder of temp.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

interface Reply {
  error?: string;
  message?: string;
  token?: string;
  path?: string;
  id?: string;
  title?: string;
  expiresAt?: string | null;
  createdAt?: string;
  undoMs?: number;
  rows?: { id: number; role: string; content?: unknown; tool_calls?: { function: { name: string; arguments: string } }[]; [field: string]: unknown }[];
  shares?: { id: string; sessionId: string; profile: string; title: string; createdAt: string; expiresAt: string | null }[];
  entries?: { action: string; target: string; tier?: string; profile?: string }[];
}
interface Answer {
  status: number;
  body: Reply;
}

const DAY = 86_400_000;

async function start(webRoot?: string) {
  const clock = { at: Date.parse('2026-10-19T10:00:00Z') };
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, now: () => clock.at, webRoot });
  const { url } = server;
  const cookie = await ownerCookie(url);
  const request = async (method: string, route: string, body?: unknown, signedIn = true): Promise<Answer> => {
    const res = await fetch(`${url}${route}`, {
      method,
      headers: { origin: url, ...(signedIn ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: (text.startsWith('{') ? JSON.parse(text) : { message: text }) as Reply };
  };
  return {
    url,
    clock,
    call: (method: string, route: string, body?: unknown) => request(method, route, body),
    visitor: (route: string) => request('GET', route, undefined, false),
    visitorPage: (route: string) => fetch(`${url}${route}`, { redirect: 'manual' }),
    /** Turns read-only mode on, which needs a step-up. */
    async readOnly() {
      const authenticator = await addPasskey(url, cookie);
      await stepUp(url, cookie, authenticator);
      await request('PUT', '/_caduceus/api/policy/read-only', { readOnly: true });
    },
  };
}

const make = (sessionId: string, expiry = '7d') => ({ sessionId, profile: 'default', expiry });

describe('making a share', () => {
  test('is a T1 that freezes the transcript, hands out the token once and keeps only its hash; the link serves the snapshot to a visitor with no session, and with secret tool arguments hidden', async () => {
    await seedSession(
      hermes.home,
      'shared-1',
      [
        { role: 'user', content: 'Find me cat facts' },
        { role: 'assistant', content: 'Searching.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query: 'cats', api_key: 'sk-live-123', headers: { Authorization: 'Bearer abc' } }) } }] },
        { role: 'tool', content: '{"hits":2}', tool_call_id: 'c1', tool_name: 'web_search' },
        { role: 'assistant', content: 'Cats purr at 25 Hz.' },
      ],
      { title: 'Cat facts' },
    );
    const { call, visitor, clock } = await start();

    const made = await call('POST', '/_caduceus/api/shares', make('shared-1', '7d'));

    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ title: 'Cat facts', expiresAt: new Date(clock.at + 7 * DAY).toISOString(), createdAt: new Date(clock.at).toISOString() });
    expect(made.body.path).toBe(`/share/${made.body.token}`);
    expect(made.body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const seen = await visitor(`/_caduceus/share/${made.body.token}`);
    expect(seen.status).toBe(200);
    // What the link serves is the snapshot and nothing of the owner's: no session id, no profile, no field of Hermes's own beyond the row's words.
    expect(Object.keys(seen.body).sort()).toEqual(['createdAt', 'expiresAt', 'rows', 'title']);
    expect(seen.body.rows?.map((row) => [row.role, row.content])).toEqual([['user', 'Find me cat facts'], ['assistant', 'Searching.'], ['tool', '{"hits":2}'], ['assistant', 'Cats purr at 25 Hz.']]);
    expect(Object.keys(seen.body.rows![0]!).every((field) => ['id', 'role', 'content', 'display_kind', 'reasoning', 'reasoning_content', 'tool_calls', 'tool_call_id', 'tool_name'].includes(field))).toBe(true);
    const shown = JSON.parse(seen.body.rows![1]!.tool_calls![0]!.function.arguments);
    expect(shown).toEqual({ query: 'cats', api_key: '[hidden]', headers: { Authorization: '[hidden]' } });
    expect(JSON.stringify(seen.body)).not.toContain('sk-live-123');
    // Only the hash is stored: the token is in no file Caduceus keeps.
    const kept = [path.join(hermes.home, 'caduceus', 'caduceus.db'), path.join(hermes.home, 'caduceus', 'caduceus.db-wal'), ...fs.readdirSync(path.join(hermes.home, 'caduceus', 'shares')).map((name) => path.join(hermes.home, 'caduceus', 'shares', name))];
    for (const file of kept.filter((candidate) => fs.existsSync(candidate))) expect(fs.readFileSync(file).includes(made.body.token!)).toBe(false);
    expect(fs.readFileSync(path.join(hermes.home, 'caduceus', 'shares', `${made.body.id}.json`), 'utf8')).not.toContain('sk-live-123');
  });

  test('the owner’s own routes and Hermes stay behind the sign-in: the link opens the snapshot and nothing else', async () => {
    await seedSession(hermes.home, 'shared-2', [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }]);
    const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-share-web-'));
    temp.push(webRoot);
    fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>shell</title>');
    const { call, visitor, visitorPage } = await start(webRoot);
    const { body: made } = await call('POST', '/_caduceus/api/shares', make('shared-2'));

    const attempts = await Promise.all([
      visitor('/_caduceus/api/shares'),
      visitor('/api/sessions/shared-2/messages'),
      visitor('/api/sessions'),
      visitor('/_caduceus/api/audit'),
      visitor(`/_caduceus/share/${made.token}/extra`),
      visitor(`/_caduceus/share/${'x'.repeat(43)}`),
    ]);
    const page = await visitorPage(`/share/${made.token}`);
    const unknownPage = await visitorPage(`/share/${'x'.repeat(43)}`);
    const homePage = await visitorPage('/home');

    expect(attempts.map((answer) => answer.status)).toEqual([401, 401, 401, 401, 401, 404]);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('<title>shell</title>');
    // A link that is not open is a not-found page, and the shell that draws it is the same.
    expect(unknownPage.status).toBe(404);
    expect(await unknownPage.text()).toContain('<title>shell</title>');
    // Nothing else of the app opens without a session: the sign-in page is what an anonymous visitor to any other address gets.
    expect(homePage.status).toBe(302);
  });
});

const files = () => {
  const dir = path.join(hermes.home, 'caduceus', 'shares');
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

describe('how long a share lasts', () => {
  test('an expired link is not found, and the sweep deletes its snapshot; a link that never expires stays', async () => {
    await seedSession(hermes.home, 'expiry-1', [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]);
    const { call, visitor, clock } = await start();
    const day = (await call('POST', '/_caduceus/api/shares', make('expiry-1', '1d'))).body;
    const month = (await call('POST', '/_caduceus/api/shares', make('expiry-1', '30d'))).body;
    const forever = (await call('POST', '/_caduceus/api/shares', make('expiry-1', 'never'))).body;
    expect(files()).toHaveLength(3);
    expect(forever.expiresAt).toBeNull();

    clock.at += DAY - 1;
    expect((await visitor(`/_caduceus/share/${day.token}`)).status).toBe(200);
    clock.at += 1;
    const gone = await visitor(`/_caduceus/share/${day.token}`);

    expect(gone.status).toBe(404);
    expect(files().sort()).toEqual([`${month.id}.json`, `${forever.id}.json`].sort());
    clock.at += 29 * DAY;
    expect((await visitor(`/_caduceus/share/${month.token}`)).status).toBe(404);
    expect((await visitor(`/_caduceus/share/${forever.token}`)).status).toBe(200);
    expect(files()).toEqual([`${forever.id}.json`]);
  });
});

describe('revoking a share', () => {
  test('stops the link at once, keeps the snapshot for an undo window, brings the link back on Undo, and deletes the snapshot when the window is over', async () => {
    await seedSession(hermes.home, 'revoke-1', [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]);
    const { call, visitor, clock } = await start();
    const made = (await call('POST', '/_caduceus/api/shares', make('revoke-1'))).body;

    const revoked = await call('DELETE', `/_caduceus/api/shares/${made.id}`);
    expect(revoked).toMatchObject({ status: 200, body: { id: made.id, undoMs: SHARE_UNDO_MS } });
    expect((await visitor(`/_caduceus/share/${made.token}`)).status).toBe(404);
    expect((await call('GET', '/_caduceus/api/shares')).body.shares).toEqual([]);
    expect(files()).toEqual([`${made.id}.json`]);

    const undone = await call('POST', `/_caduceus/api/shares/${made.id}/restore`);
    expect(undone.status).toBe(200);
    expect((await visitor(`/_caduceus/share/${made.token}`)).status).toBe(200);

    await call('DELETE', `/_caduceus/api/shares/${made.id}`);
    clock.at += SHARE_UNDO_MS;
    const late = await call('POST', `/_caduceus/api/shares/${made.id}/restore`);
    expect(late.status).toBe(404);
    expect(files()).toEqual([]);
    expect((await visitor(`/_caduceus/share/${made.token}`)).status).toBe(404);
  });
});

describe('the list of active shares', () => {
  test('names each share’s session, profile, title, creation and expiry, newest first, and never shows a token', async () => {
    await seedSession(hermes.home, 'list-1', [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }], { title: 'First' });
    await seedSession(hermes.home, 'list-2', [{ role: 'user', content: 'c' }, { role: 'assistant', content: 'd' }], { title: 'Second' });
    const { call, clock } = await start();
    const one = (await call('POST', '/_caduceus/api/shares', make('list-1', '7d'))).body;
    clock.at += 1000;
    const two = (await call('POST', '/_caduceus/api/shares', make('list-2', 'never'))).body;

    const listed = await call('GET', '/_caduceus/api/shares');

    expect(listed.body.shares).toEqual([
      { id: two.id, sessionId: 'list-2', profile: 'default', title: 'Second', createdAt: two.createdAt, expiresAt: null },
      { id: one.id, sessionId: 'list-1', profile: 'default', title: 'First', createdAt: one.createdAt, expiresAt: one.expiresAt },
    ]);
    expect(JSON.stringify(listed.body)).not.toContain(one.token!);
    expect(JSON.stringify(listed.body)).not.toContain(two.token!);
  });
});

describe('what is refused, and what is audited', () => {
  test('a session Hermes does not have, one with nothing in it, a lifetime that is not offered and read-only mode make no share; making and revoking are audited with the session and profile', async () => {
    await seedSession(hermes.home, 'audit-1', [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]);
    await seedSession(hermes.home, 'empty-1', []);
    const { call } = await start();

    const refusals = [
      await call('POST', '/_caduceus/api/shares', make('no-such-session')),
      await call('POST', '/_caduceus/api/shares', make('empty-1')),
      await call('POST', '/_caduceus/api/shares', make('audit-1', 'forever')),
      await call('POST', '/_caduceus/api/shares', { sessionId: 'audit-1' }),
    ];
    expect(refusals.map((answer) => `${answer.status} ${answer.body.error}`)).toEqual(['404 no-such-session', '400 empty', '400 bad-request', '400 bad-request']);
    expect(files()).toEqual([]);

    const made = (await call('POST', '/_caduceus/api/shares', make('audit-1'))).body;
    await call('DELETE', `/_caduceus/api/shares/${made.id}`);
    const audit = (await call('GET', '/_caduceus/api/audit')).body.entries ?? [];
    expect(audit).toContainEqual(expect.objectContaining({ action: 'share.create', target: 'audit-1 (a)', tier: 'T1', profile: 'default' }));
    expect(audit).toContainEqual(expect.objectContaining({ action: 'share.revoke', target: 'audit-1 (a)', tier: 'T0', profile: 'default' }));

  });
});

describe('read-only mode', () => {
  test('stops making and revoking a share, and leaves a link that is open open', async () => {
    await seedSession(hermes.home, 'ro-1', [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }]);
    const { call, visitor, readOnly } = await start();
    const made = (await call('POST', '/_caduceus/api/shares', make('ro-1'))).body;
    await readOnly();

    const blocked = [await call('POST', '/_caduceus/api/shares', make('ro-1')), await call('DELETE', `/_caduceus/api/shares/${made.id}`)];

    expect(blocked.map((answer) => answer.body.error)).toEqual(['read-only', 'read-only']);
    expect((await visitor(`/_caduceus/share/${made.token}`)).status).toBe(200);
    expect((await call('GET', '/_caduceus/api/shares')).body.shares).toHaveLength(1);
  });
});
