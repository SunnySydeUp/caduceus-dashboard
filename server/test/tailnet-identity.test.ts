import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { once } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { serveIdentity } from '../src/tailnet-identity.ts';
import { startCaduceusServer, type CaduceusServer, type CaduceusServerOptions } from '../src/caduceus-server.ts';
import { upgradeStatus } from './fixtures/browser-socket.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie, TEST_OWNER_PASSWORD } from './fixtures/owner.ts';

// The tailnet identity gate (M0 #13), through the Caduceus server's HTTP API in front of the real Hermes: configured as in
// production (the ts.net origin and RP ID of ticket 13, the owner's Tailscale login), reached the way Tailscale Serve reaches
// it, which is from loopback with the forwarding headers Serve always sets and, for a tailnet user, `Tailscale-User-Login`.
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
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

const HOST = 'my-mac.tail0000aa.ts.net';
const SERVE_ORIGIN = `https://${HOST}:9443`;
const OWNER_LOGIN = 'owner@example.com';
const VIA_SERVE = { 'x-forwarded-host': `${HOST}:9443`, 'x-forwarded-for': '100.101.102.103', 'x-forwarded-proto': 'https' };

async function start(options: Partial<CaduceusServerOptions> = {}): Promise<CaduceusServer> {
  server = await startCaduceusServer({
    backend: hermes.backend,
    hermesRoot: hermes.home,
    webRoot,
    publicOrigin: SERVE_ORIGIN,
    rpId: HOST,
    tailnetOwners: [OWNER_LOGIN],
    ...options,
  });
  return server;
}

/** A request as Serve forwards it: the forwarding headers, and the login of the tailnet user it came from, if it knows one. */
function viaServe(login: string | undefined, headers: Record<string, string> = {}): Record<string, string> {
  return { ...VIA_SERVE, ...(login === undefined ? {} : { 'tailscale-user-login': login }), ...headers };
}

describe('tailnet identity', () => {
  test('through Serve, a request without the owner\'s Tailscale login is refused on every route, whatever session cookie it carries', async () => {
    const { url } = await start();
    const cookie = await ownerCookie(url);
    const routes = ['/', '/sign-in', '/assets/app.js', '/_caduceus/healthz', '/_caduceus/api/auth/session', '/_caduceus/api/backend', '/api/status'];

    const answers: Record<string, unknown> = {};
    for (const login of [undefined, 'intruder@example.com', 'owner@example.org', 'owner@example.com.evil.test']) {
      for (const route of routes) {
        const res = await fetch(`${url}${route}`, { headers: viaServe(login, { cookie }), redirect: 'manual' });
        answers[`${login ?? '(no login)'} ${route}`] = [res.status, res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text()];
      }
    }

    expect(Object.values(answers)).toEqual(Array(4 * routes.length).fill([403, { error: 'tailnet-identity' }]));
  });

  test('through Serve, the owner\'s Tailscale login, in any case, is served as usual: the sign-in page, password sign-in and the API with the session', async () => {
    const { url } = await start();
    await ownerCookie(url);

    const served: unknown[] = [];
    for (const login of [OWNER_LOGIN, 'Owner@Example.COM']) {
      const page = await fetch(`${url}/sign-in`, { headers: viaServe(login) });
      const signIn = await fetch(`${url}/_caduceus/api/auth/sign-in`, {
        method: 'POST',
        headers: viaServe(login, { origin: SERVE_ORIGIN, 'content-type': 'application/json' }),
        body: JSON.stringify({ password: TEST_OWNER_PASSWORD }),
      });
      const cookie = signIn.headers.get('set-cookie')!.split(';')[0];
      const session = await fetch(`${url}/_caduceus/api/auth/session`, { headers: viaServe(login, { cookie }) });
      const hermesApi = await fetch(`${url}/api/status`, { headers: viaServe(login, { cookie }) });
      served.push([page.status, signIn.status, signIn.headers.get('set-cookie')!.includes('Secure'), session.status, await session.json(), hermesApi.status]);
    }

    const state = { ownerExists: true, setupAllowed: false, signedIn: true, passwordSignIn: true };
    expect(served).toEqual(Array(2).fill([200, 204, true, 200, state, 200]));
  });

  test('through Serve, a live gateway connection is upgraded only for the owner\'s login, with a valid session and the Serve origin', async () => {
    const { url } = await start();
    const cookie = await ownerCookie(url);
    const upgrade = (login: string | undefined) => upgradeStatus(url, viaServe(login, { cookie, origin: SERVE_ORIGIN }));

    const statuses = [await upgrade(undefined), await upgrade('intruder@example.com'), await upgrade(OWNER_LOGIN)];

    expect(statuses).toEqual([403, 403, 101]);
  });

  test('this Mac itself is never subject to the allowlist (it sets up and recovers), and an empty allowlist refuses every request that came through Serve', async () => {
    const { url } = await start({ tailnetOwners: [] });

    const cookie = await ownerCookie(url);
    const fromThisMac = await fetch(`${url}/api/status`, { headers: { cookie } });
    const throughServeAsOwner = await fetch(`${url}/api/status`, { headers: viaServe(OWNER_LOGIN, { cookie }) });

    expect(fromThisMac.status).toBe(200);
    expect(throughServeAsOwner.status).toBe(403);
  });

  test('every refused request is reported with where it came from, so a wrong allowlist can be found in the log; nothing else is', async () => {
    const refusals: string[] = [];
    const { url } = await start({ onTailnetRefusal: (source) => refusals.push(source) });

    await fetch(`${url}/sign-in`, { headers: viaServe('intruder@example.com') });
    await fetch(`${url}/sign-in`, { headers: viaServe(undefined) });
    await fetch(`${url}/sign-in`, { headers: viaServe(OWNER_LOGIN) });
    await fetch(`${url}/sign-in`);

    expect(refusals).toEqual(['tailnet:intruder@example.com', 'forwarded:100.101.102.103']);
  });

  // The identity header is only as good as the listener: a tailnet peer that could reach Caduceus directly, at this Mac's
  // tailnet or LAN address, would not pass through Serve, and would be believed whatever it sent. Whether each of this
  // machine's own addresses accepts a connection is an OS-level fact only an attempt can show; an address that cannot answer
  // (an interface that is down, a VPN that drops the packet) ends in the bounded wait, and that is not a connection either.
  const otherAddresses = Object.values(os.networkInterfaces())
    .flatMap((addresses) => addresses ?? [])
    .filter((address) => address.family === 'IPv4' && !address.internal)
    .map((address) => address.address);
  test.skipIf(otherAddresses.length === 0)('Caduceus listens on loopback alone: no other address of this Mac accepts a connection', async () => {
    const { url } = await start();
    const port = Number(new URL(url).port);
    const accepts = async (host: string) => {
      const socket = net.connect({ host, port });
      try {
        await once(socket, 'connect', { signal: AbortSignal.timeout(2_000) });
        return true;
      } catch {
        return false;
      } finally {
        socket.destroy();
      }
    };

    const connected = Object.fromEntries(await Promise.all(['127.0.0.1', ...otherAddresses].map(async (host) => [host, await accepts(host)])));

    expect(connected).toEqual({ '127.0.0.1': true, ...Object.fromEntries(otherAddresses.map((host) => [host, false])) });
  });
});

describe('serveIdentity', () => {
  const headers = { 'tailscale-user-login': 'Owner@Example.com', ...VIA_SERVE };
  const reader = (all: Record<string, string>) => (name: string) => all[name];

  test('names the login (lower case) of a request that came through Serve on this Mac, and nothing for any other source', () => {
    expect(serveIdentity('127.0.0.1', reader(headers))).toBe('owner@example.com');
    expect(serveIdentity('::1', reader(headers))).toBe('owner@example.com');
    // Not from this Mac: the header is only what the sender wrote.
    expect(serveIdentity('203.0.113.9', reader(headers))).toBeUndefined();
    expect(serveIdentity('192.168.1.20', reader(headers))).toBeUndefined();
    // Without what Serve always adds.
    expect(serveIdentity('127.0.0.1', reader({ 'tailscale-user-login': 'owner@example.com' }))).toBeUndefined();
    expect(serveIdentity('127.0.0.1', reader(VIA_SERVE))).toBeUndefined();
  });
});
