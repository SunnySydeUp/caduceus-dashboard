import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { startCaduceusServer, type CaduceusServer, type CaduceusServerOptions } from '../src/caduceus-server.ts';
import { upgradeStatus } from './fixtures/browser-socket.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';

// Owner sign-in, sessions and audit, through the Caduceus server's HTTP API, in front of the real Hermes
// (in a throwaway HERMES_HOME, which is also the Hermes root home the Caduceus store lives in).
let hermes: TestHermes;
let webRoot: string;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-web-'));
  fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><title>Caduceus</title>');
  fs.mkdirSync(path.join(webRoot, 'assets'));
  fs.writeFileSync(path.join(webRoot, 'assets', 'app.js'), 'export {};');
  await hermes.backend.ready();
}, 60_000);
afterAll(async () => {
  try {
    await hermes.stop();
  } finally {
    fs.rmSync(webRoot, { recursive: true, force: true });
  }
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  // Every test starts before the owner exists.
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

/** Where Tailscale Serve exposes Caduceus in these tests; Serve preserves the Host and adds X-Forwarded-* headers. */
const SERVE_ORIGIN = 'https://mac.tail1234.ts.net:9443';
const VIA_SERVE = { origin: SERVE_ORIGIN, 'x-forwarded-host': 'mac.tail1234.ts.net:9443', 'x-forwarded-for': '100.101.102.103', 'x-forwarded-proto': 'https' };

async function start(options: Partial<CaduceusServerOptions> = {}): Promise<CaduceusServer> {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, webRoot, publicOrigin: SERVE_ORIGIN, ...options });
  return server;
}

const PASSWORD = 'a long owner passphrase';

/** POSTs JSON the way the web app does: same origin, so the browser sends that exact Origin. */
function post(url: string, route: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${url}${route}`, {
    method: 'POST',
    headers: { origin: url, 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** The `name=value` part of the session cookie a response sets, as the browser would send it back. */
function sessionCookie(res: Response): string {
  const setCookie = res.headers.get('set-cookie');
  expect(setCookie).toBeTruthy();
  return setCookie!.split(';')[0];
}

describe('owner sign-in', () => {
  test('without a session, pages redirect to sign-in and the Caduceus API and Hermes proxy answer 401', async () => {
    const { url } = await start();

    const page = await fetch(`${url}/sessions/abc?profile=coder`, { redirect: 'manual' });
    const home = await fetch(`${url}/`, { redirect: 'manual' });
    const signInPage = await fetch(`${url}/sign-in`);
    const asset = await fetch(`${url}/assets/app.js`);
    const caduceusApi = await fetch(`${url}/_caduceus/api/backend`);
    const hermesApi = await fetch(`${url}/api/status`);

    expect(page.status).toBe(302);
    expect(page.headers.get('location')).toBe('/sign-in?next=%2Fsessions%2Fabc%3Fprofile%3Dcoder');
    expect(home.status).toBe(302);
    expect(home.headers.get('location')).toBe('/sign-in?next=%2F');
    expect(signInPage.status).toBe(200);
    expect(asset.status).toBe(200);
    expect(caduceusApi.status).toBe(401);
    expect(await caduceusApi.json()).toEqual({ error: 'signed-out' });
    expect(hermesApi.status).toBe(401);
    expect(await hermesApi.json()).toEqual({ error: 'signed-out' });
  });

  test('on first run the owner sets a password from this Mac and is signed in to the API and Hermes', async () => {
    const { url } = await start();
    const before = await (await fetch(`${url}/_caduceus/api/auth/session`)).json();

    const setup = await post(url, '/_caduceus/api/auth/setup', { password: PASSWORD });
    const cookie = sessionCookie(setup);

    expect(before).toEqual({ ownerExists: false, setupAllowed: true, signedIn: false, passwordSignIn: false });
    expect(setup.status).toBe(201);
    expect((await fetch(`${url}/_caduceus/api/backend`, { headers: { cookie } })).status).toBe(200);
    expect((await fetch(`${url}/api/status`, { headers: { cookie } })).status).toBe(200);
    expect((await fetch(`${url}/`, { headers: { cookie }, redirect: 'manual' })).status).toBe(200);
    expect(await (await fetch(`${url}/_caduceus/api/auth/session`, { headers: { cookie } })).json()).toEqual({
      ownerExists: true,
      setupAllowed: false,
      signedIn: true,
      passwordSignIn: true,
    });
  });

  test('owner setup is refused through a forwarding proxy (Tailscale Serve also connects from loopback) and once an owner exists', async () => {
    const { url } = await start();
    const viaServe = { 'x-forwarded-for': '100.101.102.103', 'x-forwarded-host': 'mac.tail1234.ts.net:9443' };
    const viaServeAsUser = { 'tailscale-user-login': 'owner@example.com' };

    const stateViaServe = await (await fetch(`${url}/_caduceus/api/auth/session`, { headers: viaServe })).json();
    const forwarded = await post(url, '/_caduceus/api/auth/setup', { password: PASSWORD }, viaServe);
    const asTailnetUser = await post(url, '/_caduceus/api/auth/setup', { password: PASSWORD }, viaServeAsUser);
    const first = await post(url, '/_caduceus/api/auth/setup', { password: PASSWORD });
    const second = await post(url, '/_caduceus/api/auth/setup', { password: 'someone else entirely' });

    expect(stateViaServe).toEqual({ ownerExists: false, setupAllowed: false, signedIn: false, passwordSignIn: false });
    expect(forwarded.status).toBe(403);
    expect(await forwarded.json()).toEqual({ error: 'setup-not-local' });
    expect(asTailnetUser.status).toBe(403);
    expect(first.status).toBe(201);
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: 'owner-exists' });
    expect(second.headers.get('set-cookie')).toBeNull();
  });

  test('the owner signs in with the password and out again; a wrong password is refused', async () => {
    const { url } = await start();
    await post(url, '/_caduceus/api/auth/setup', { password: PASSWORD });

    const wrong = await post(url, '/_caduceus/api/auth/sign-in', { password: 'not the password' });
    const signIn = await post(url, '/_caduceus/api/auth/sign-in', { password: PASSWORD });
    const cookie = sessionCookie(signIn);
    const whileSignedIn = await fetch(`${url}/api/status`, { headers: { cookie } });
    const signOut = await post(url, '/_caduceus/api/auth/sign-out', undefined, { cookie });
    const afterSignOut = await fetch(`${url}/api/status`, { headers: { cookie } });

    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ error: 'wrong-password' });
    expect(wrong.headers.get('set-cookie')).toBeNull();
    expect(signIn.status).toBe(204);
    expect(whileSignedIn.status).toBe(200);
    expect(signOut.status).toBe(204);
    expect(signOut.headers.get('set-cookie')).toMatch(/^caduceus_session=;.*Max-Age=0/);
    expect(afterSignOut.status).toBe(401);
  });

  test('the session cookie is HttpOnly and SameSite=Strict, and Secure unless the browser is on this Mac over plain http', async () => {
    const { url } = await start();
    const setup = await post(url, '/_caduceus/api/auth/setup', { password: PASSWORD });

    const local = (await post(url, '/_caduceus/api/auth/sign-in', { password: PASSWORD })).headers.get('set-cookie')!;
    const viaServe = (await post(url, '/_caduceus/api/auth/sign-in', { password: PASSWORD }, VIA_SERVE)).headers.get('set-cookie')!;

    for (const cookie of [setup.headers.get('set-cookie')!, local, viaServe]) {
      const attributes = cookie.split(/;\s*/).slice(1);
      expect(attributes).toEqual(expect.arrayContaining(['HttpOnly', 'SameSite=Strict', 'Path=/', `Max-Age=${30 * 24 * 60 * 60}`]));
    }
    expect(local).not.toMatch(/;\s*Secure/);
    expect(viaServe).toMatch(/;\s*Secure/);
  });

  test('a session ends after 7 days without a request, and 30 days after sign-in however busy it is', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    const clock = { now: Date.parse('2026-10-07T09:00:00Z') };
    const { url } = await start({ now: () => clock.now });
    await post(url, '/_caduceus/api/auth/setup', { password: PASSWORD });
    const statusAfter = async (cookie: string, elapsedMs: number) => {
      clock.now += elapsedMs;
      return (await fetch(`${url}/_caduceus/api/backend`, { headers: { cookie } })).status;
    };

    const idle = sessionCookie(await post(url, '/_caduceus/api/auth/sign-in', { password: PASSWORD }));
    const idleStatuses = [await statusAfter(idle, 7 * DAY - 1), await statusAfter(idle, 7 * DAY - 1), await statusAfter(idle, 7 * DAY)];
    const busy = sessionCookie(await post(url, '/_caduceus/api/auth/sign-in', { password: PASSWORD }));
    const busyStatuses = [];
    for (const elapsed of [6 * DAY, 6 * DAY, 6 * DAY, 6 * DAY, 6 * DAY - 1, 1]) busyStatuses.push(await statusAfter(busy, elapsed));

    expect(idleStatuses).toEqual([200, 200, 401]);
    expect(busyStatuses).toEqual([200, 200, 200, 200, 200, 401]);
  });

  test('unsafe requests must carry exactly the Origin Caduceus is served at', async () => {
    const { url } = await start();
    const cookie = sessionCookie(await post(url, '/_caduceus/api/auth/setup', { password: PASSWORD }));
    const port = new URL(url).port;
    const foreign = [
      'https://evil.example',
      `http://127.0.0.1:${Number(port) + 1}`,
      `https://127.0.0.1:${port}`,
      `${url}/`,
      'null',
      'https://mac.tail1234.ts.net',
    ];

    const refused = [];
    for (const origin of [...foreign, undefined]) {
      const headers = { cookie, ...(origin === undefined ? {} : { origin }) };
      for (const [method, route] of [['POST', '/_caduceus/api/auth/sign-in'], ['POST', '/_caduceus/api/auth/sign-out'], ['PUT', '/api/config'], ['DELETE', '/api/sessions/x']]) {
        const res = await fetch(`${url}${route}`, { method, headers, body: method === 'DELETE' ? undefined : '{}' });
        refused.push(`${res.status} ${JSON.stringify(await res.json())}`);
      }
    }
    const sameOrigin = await post(url, '/_caduceus/api/auth/sign-in', { password: PASSWORD }, { origin: `http://localhost:${port}` });
    const viaServe = await post(url, '/_caduceus/api/auth/sign-in', { password: PASSWORD }, VIA_SERVE);
    const safeFromElsewhere = await fetch(`${url}/_caduceus/api/backend`, { headers: { cookie, origin: 'https://evil.example' } });
    const stillSignedIn = await fetch(`${url}/_caduceus/api/backend`, { headers: { cookie } });

    expect(refused).toEqual(Array(refused.length).fill('403 {"error":"origin-mismatch"}'));
    expect(sameOrigin.status).toBe(204);
    expect(viaServe.status).toBe(204);
    expect(safeFromElsewhere.status).toBe(200);
    expect(stillSignedIn.status).toBe(200);
  });

  test('WebSocket upgrades need exactly the Origin Caduceus is served at, and a session', async () => {
    const { url } = await start();
    const cookie = sessionCookie(await post(url, '/_caduceus/api/auth/setup', { password: PASSWORD }));

    expect(await upgradeStatus(url, { cookie, origin: 'https://evil.example' })).toBe(403);
    expect(await upgradeStatus(url, { cookie })).toBe(403);
    expect(await upgradeStatus(url, { origin: url })).toBe(401);
    // Past the gate, the live gateway connection (M0 #09): the handshake is accepted.
    expect(await upgradeStatus(url, { cookie, origin: url })).toBe(101);
  });

  test('after 5 wrong passwords sign-in is throttled for every client, whatever forwarding headers it sends', async () => {
    const clock = { now: Date.parse('2026-10-07T09:00:00Z') };
    const { url } = await start({ now: () => clock.now });
    await post(url, '/_caduceus/api/auth/setup', { password: PASSWORD });
    let client = 0;
    /** Each attempt claims to come from somewhere new. */
    const attempt = async (password: string) => {
      client += 1;
      const spoofed = { 'x-forwarded-for': `203.0.113.${client}`, 'tailscale-user-login': `user${client}@example.com`, 'x-real-ip': `198.51.100.${client}` };
      const res = await post(url, '/_caduceus/api/auth/sign-in', { password }, { ...VIA_SERVE, ...spoofed });
      return `${res.status} ${res.headers.get('retry-after') ?? '-'} ${await res.text()}`;
    };

    const wrong = [];
    for (let i = 0; i < 5; i++) wrong.push(await attempt('guess'));
    const rightButThrottled = await attempt(PASSWORD);
    const fromThisMac = await post(url, '/_caduceus/api/auth/sign-in', { password: PASSWORD });
    clock.now += 59_999;
    const stillThrottled = await attempt(PASSWORD);
    clock.now += 1;
    const wrongAfterWait = await attempt('guess');
    const throttledAgain = await attempt(PASSWORD);
    clock.now += 120_000;
    const rightAfterLongerWait = await attempt(PASSWORD);

    expect(wrong).toEqual(Array(5).fill('401 - {"error":"wrong-password"}'));
    expect(rightButThrottled).toBe('429 60 {"error":"throttled","retryAfterSeconds":60}');
    expect(fromThisMac.status).toBe(429);
    expect(stillThrottled).toBe('429 1 {"error":"throttled","retryAfterSeconds":1}');
    // Each further failure doubles the wait.
    expect(wrongAfterWait).toBe('401 - {"error":"wrong-password"}');
    expect(throttledAgain).toBe('429 120 {"error":"throttled","retryAfterSeconds":120}');
    expect(rightAfterLongerWait).toBe('204 - ');
  });

  test('sign-ins, sign-outs and failures are audited with actor, action, target, source and time', async () => {
    const clock = { now: Date.parse('2026-10-07T09:00:00.000Z') };
    const { url } = await start({ now: () => clock.now });
    const minuteLater = () => (clock.now += 60_000);
    const alice = { ...VIA_SERVE, 'tailscale-user-login': 'alice@example.com' };

    const cookie = sessionCookie(await post(url, '/_caduceus/api/auth/setup', { password: PASSWORD }));
    minuteLater();
    await post(url, '/_caduceus/api/auth/sign-in', { password: 'guess' }, alice);
    minuteLater();
    const phone = sessionCookie(await post(url, '/_caduceus/api/auth/sign-in', { password: PASSWORD }, alice));
    minuteLater();
    await post(url, '/_caduceus/api/auth/sign-out', undefined, { ...alice, cookie: phone });
    minuteLater();
    await post(url, '/_caduceus/api/auth/setup', { password: 'take over' }, VIA_SERVE);
    const res = await fetch(`${url}/_caduceus/api/audit`, { headers: { cookie } });
    const { entries } = await res.json();

    const session = expect.stringMatching(/^session:[0-9a-f]{16}$/);
    expect(entries).toEqual([
      { at: '2026-10-07T09:04:00.000Z', actor: 'anonymous', action: 'owner.set-up-refused', target: 'owner', source: 'forwarded:100.101.102.103' },
      { at: '2026-10-07T09:03:00.000Z', actor: 'owner', action: 'session.sign-out', target: session, source: 'tailnet:alice@example.com' },
      { at: '2026-10-07T09:02:00.000Z', actor: 'owner', action: 'session.sign-in', target: session, source: 'tailnet:alice@example.com' },
      { at: '2026-10-07T09:01:00.000Z', actor: 'anonymous', action: 'session.sign-in-failed', target: 'owner', source: 'tailnet:alice@example.com' },
      { at: '2026-10-07T09:00:00.000Z', actor: 'owner', action: 'session.sign-in', target: session, source: 'local' },
      { at: '2026-10-07T09:00:00.000Z', actor: 'owner', action: 'owner.set-up', target: 'owner', source: 'local' },
    ]);
    // The phone's sign-out names the session its sign-in opened, and that is not the first session.
    expect(entries[1].target).toBe(entries[2].target);
    expect(entries[2].target).not.toBe(entries[4].target);
  });

  test('the owner password must be 12 to 1024 characters, and malformed requests are refused without effect', async () => {
    const { url } = await start();
    const answer = async (route: string, body: string) => {
      const res = await fetch(`${url}${route}`, { method: 'POST', headers: { origin: url, 'content-type': 'application/json' }, body });
      return `${res.status} ${await res.text()}`;
    };

    const refused = [
      await answer('/_caduceus/api/auth/setup', JSON.stringify({ password: 'elevenchars' })),
      await answer('/_caduceus/api/auth/setup', JSON.stringify({ password: 'x'.repeat(1025) })),
      await answer('/_caduceus/api/auth/setup', '{}'),
      await answer('/_caduceus/api/auth/setup', 'not json'),
      await answer('/_caduceus/api/auth/sign-in', JSON.stringify({ password: 42 })),
    ];
    const state = await (await fetch(`${url}/_caduceus/api/auth/session`)).json();
    const longest = await answer('/_caduceus/api/auth/setup', JSON.stringify({ password: 'x'.repeat(1024) }));

    expect(refused).toEqual([
      '400 {"error":"password-too-short","minLength":12}',
      '400 {"error":"bad-request"}',
      '400 {"error":"bad-request"}',
      '400 {"error":"bad-request"}',
      '400 {"error":"bad-request"}',
    ]);
    expect(state.ownerExists).toBe(false);
    expect(longest).toBe('201 ');
  });
});

describe('Caduceus store', () => {
  test('lives in caduceus/ under the Hermes root home, owner-only even when restored with looser modes, with the password under scrypt', async () => {
    // As a restored backup leaves it: `hermes import` does not restore modes for files it does not know are secret.
    const dir = path.join(hermes.home, 'caduceus');
    fs.mkdirSync(dir, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, 'caduceus.db'), '', { mode: 0o644 });
    const { url } = await start();
    await post(url, '/_caduceus/api/auth/setup', { password: PASSWORD });
    await post(url, '/_caduceus/api/auth/sign-in', { password: PASSWORD });

    const files = fs.readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isFile()).map((entry) => entry.name);
    const modes = Object.fromEntries(files.map((name) => [name, (fs.statSync(path.join(dir, name)).mode & 0o777).toString(8)]));
    const db = new DatabaseSync(path.join(dir, 'caduceus.db'), { readOnly: true });
    const { password_hash } = db.prepare('SELECT password_hash FROM owner').get() as { password_hash: string };
    db.close();
    const plaintextIn = files.filter((name) => fs.readFileSync(path.join(dir, name)).includes(PASSWORD));

    expect((fs.statSync(dir).mode & 0o777).toString(8)).toBe('700');
    // The templates' folder (M3 #08) is owner-only too.
    expect((fs.statSync(path.join(dir, 'playbooks')).mode & 0o777).toString(8)).toBe('700');
    // The MCP server's token (M4 #11) is a file of its own, owner-only likewise.
    // And the VAPID key pair for Web Push (M2 #03).
    expect(modes).toEqual({ 'caduceus.db': '600', 'caduceus.db-shm': '600', 'caduceus.db-wal': '600', 'mcp-token': '600', 'vapid.json': '600' });
    // scrypt, N = 2^17, r = 8, p = 1 (128 MiB per guess), a 16-byte salt and a 32-byte key.
    expect(password_hash).toMatch(/^scrypt\$131072\$8\$1\$[A-Za-z0-9+/]{22}==\$[A-Za-z0-9+/]{43}=$/);
    expect(plaintextIn).toEqual([]);
  });
});
