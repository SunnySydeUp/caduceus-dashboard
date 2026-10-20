import { afterEach, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { WebSocket as RawWebSocket } from 'ws';
import type { CompatibilityReport, SessionInfo } from '@caduceus/contracts/caduceus-api';
import { POLICY_ERROR_CODE } from '../src/gateway-policy.ts';
import type { HermesBackend } from '../src/hermes-backend.ts';
import { loadPinnedContracts } from '../src/hermes-contract.ts';
import { startCaduceusServer, type CaduceusServer, type CaduceusServerOptions } from '../src/caduceus-server.ts';
import { browserWebSocket, connectBrowserSocket, upgradeStatus, type BrowserSocket } from './fixtures/browser-socket.ts';
import type { GatewayConnectionOptions } from '../../web/src/gateway-connection.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { fakeHermesInstall, launchFakeHermes } from './fixtures/fake-hermes.ts';
import { graceClock } from './fixtures/grace-clock.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// The gateway proxy at the Caduceus WebSocket seam, in front of the fake Hermes: a stand-in upstream that records
// what Caduceus presents to it and every frame it receives, and can echo its secret or drop the socket. What the real
// Hermes does with the live connection is in gateway-live.test.ts.
let backend: HermesBackend | undefined;
let server: CaduceusServer | undefined;
let root: string | undefined;
const sockets: BrowserSocket[] = [];
const pages: TestGatewayConnection[] = [];
const installs: string[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const page of pages.splice(0)) page.connection.close();
  await server?.close();
  await backend?.stop();
  if (root) fs.rmSync(root, { recursive: true, force: true });
  for (const install of installs.splice(0)) fs.rmSync(install, { recursive: true, force: true });
  server = undefined;
  backend = undefined;
  root = undefined;
});

interface FakeGateway {
  upgrades: { path: string; authorized: boolean; origin: string | null; cookie: string | null }[];
  frames: string[];
  closes: number[];
  stalled: number;
}

/** Where Tailscale Serve exposes Caduceus in these tests: a browser there sends this Origin. */
const SERVE_ORIGIN = 'https://mac.tail1234.ts.net:9443';

async function start(options: Partial<CaduceusServerOptions> = {}) {
  backend = launchFakeHermes();
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-root-'));
  server = await startCaduceusServer({ backend, hermesRoot: root, ...options });
  await backend.ready();
  const { url } = server;
  const cookie = await ownerCookie(url);
  // Caduceus checks every Hermes launch against the pinned contracts, over a gateway socket of its own. Let that
  // finish, and forget it: what a test counts is what it sent itself.
  await fetch(`${url}/_caduceus/api/compatibility`, { headers: { cookie } });
  /** What the fake has seen on its gateway; `reset` makes the next look start from here. */
  const upstream = async (reset = false): Promise<FakeGateway> => (await backend!.fetch(`/api/__fake/ws${reset ? '?reset=1' : ''}`)).json();
  await upstream(true);
  const open = async (options: { cookie?: string; origin?: string; path?: string } = {}) => {
    const socket = await connectBrowserSocket(url, { cookie, ...options });
    sockets.push(socket);
    return socket;
  };
  /** The page's own gateway connection (the shared client in the web app's controller), as the owner; `options` replace what the page passes. */
  const page = (options: Partial<GatewayConnectionOptions> = {}) => {
    const connection = openGatewayConnection(url, cookie, options);
    pages.push(connection);
    return connection;
  };
  return { url, cookie, open, page, upstream };
}

describe('the gateway proxy, in front of the fake Hermes', () => {
  test('a Denied method from the browser gets the policy error, and only what the policy lets through reaches Hermes', async () => {
    const { open, upstream } = await start();
    const socket = await open();

    socket.send({ jsonrpc: '2.0', id: 'denied', method: 'shell.exec', params: { command: 'echo hi' } });
    const refused = await socket.waitFor((frame) => frame.id === 'denied');
    socket.send({ jsonrpc: '2.0', id: 'allowed', method: 'session.list', params: {} });
    const answered = await socket.waitFor((frame) => frame.id === 'allowed');

    expect(refused.error).toMatchObject({ code: POLICY_ERROR_CODE, data: { error: 'denied', tier: 'denied', operation: 'rpc shell.exec', reason: 'shell-exec' } });
    expect(answered.result).toEqual({ method: 'session.list' });
    // Sent in this order, so a forwarded `shell.exec` would be in front of `session.list`.
    expect((await upstream()).frames.map((text) => JSON.parse(text).method)).toEqual(['session.list']);
  });

  test('Hermes is dialled with the launch secret alone: not the browser\'s Origin, cookie or token', async () => {
    const { open, upstream } = await start({ publicOrigin: SERVE_ORIGIN });
    await open({ origin: SERVE_ORIGIN, path: '/api/ws?token=forged' });

    const { upgrades } = await upstream();
    // `authorized` is the fake's comparison of `?token=` with the secret it was launched with.
    expect(upgrades).toEqual([{ path: '/api/ws', authorized: true, origin: null, cookie: null }]);
  });

  test('the launch secret is redacted from what Hermes sends the browser', async () => {
    const { open } = await start();
    const socket = await open();

    socket.send({ jsonrpc: '2.0', id: 'leak', method: 'session.list', params: { leak: true } });
    const answer = await socket.waitFor((frame) => frame.id === 'leak');

    expect(answer.result).toEqual({ method: 'session.list', leaked: '[redacted]' });
  });

  test('an upgrade needs the exact Origin, then a session; Hermes\'s frame-injection routes and unknown paths are refused', async () => {
    const { url, cookie } = await start();
    const asOwner = { cookie, origin: url };

    expect({
      'a foreign Origin': await upgradeStatus(url, { cookie, origin: 'https://evil.example' }),
      'no Origin': await upgradeStatus(url, { cookie }),
      'no session': await upgradeStatus(url, { origin: url }),
      'the owner on the gateway': await upgradeStatus(url, asOwner),
      '/api/events (denied: frame injection)': await upgradeStatus(url, asOwner, '/api/events?channel=x'),
      '/api/pub (denied: frame injection)': await upgradeStatus(url, asOwner, '/api/pub?channel=x'),
      'a path Hermes does not have': await upgradeStatus(url, asOwner, '/api/nope'),
    }).toEqual({
      'a foreign Origin': 403,
      'no Origin': 403,
      'no session': 401,
      'the owner on the gateway': 101,
      '/api/events (denied: frame injection)': 403,
      '/api/pub (denied: frame injection)': 403,
      'a path Hermes does not have': 404,
    });
  });

  test('the terminal routes (T2) need a step-up grant on the session, and read-only mode closes them', async () => {
    const { url, cookie } = await start();
    const asOwner = { cookie, origin: url };
    const terminals = async () => ({ pty: await upgradeStatus(url, asOwner, '/api/pty'), console: await upgradeStatus(url, asOwner, '/api/console') });
    const setReadOnly = (readOnly: boolean) =>
      fetch(`${url}/_caduceus/api/policy/read-only`, { method: 'PUT', headers: { ...asOwner, 'content-type': 'application/json' }, body: JSON.stringify({ readOnly }) });

    const withoutGrant = await terminals();
    await stepUp(url, cookie, await addPasskey(url, cookie));
    // Past the policy, both are relayed (the PTY by M1 #19, the console by M5 #13): the fake Hermes has neither, so Caduceus answers 502.
    const withGrant = await terminals();
    await setReadOnly(true);
    // Read-only mode refuses what is not a read, but the gateway stays: every frame on it is judged on its own.
    const readOnly = { ...(await terminals()), gateway: await upgradeStatus(url, asOwner) };

    expect(withoutGrant).toEqual({ pty: 403, console: 403 });
    expect(withGrant).toEqual({ pty: 502, console: 502 });
    expect(readOnly).toEqual({ pty: 403, console: 403, gateway: 101 });
  });

  test('revoking a session, or signing it out, closes its live connections and their upstreams, and only theirs', async () => {
    const { url, cookie: phone, open, upstream } = await start();
    const laptop = await ownerCookie(url);
    const onPhone = await open({ cookie: phone });
    const onLaptop = await open({ cookie: laptop });
    const { sessions }: { sessions: SessionInfo[] } = await (await fetch(`${url}/_caduceus/api/auth/sessions`, { headers: { cookie: phone } })).json();
    const phoneId = sessions.find((session) => session.current)!.id;

    const revoked = await fetch(`${url}/_caduceus/api/auth/sessions/${phoneId}`, { method: 'DELETE', headers: { cookie: laptop, origin: url } });
    const phoneClosed = await onPhone.closed;
    // The laptop's connection is untouched.
    onLaptop.send({ jsonrpc: '2.0', id: 'ping', method: 'gateway.ping', params: {} });
    await onLaptop.waitFor((frame) => frame.id === 'ping');
    await fetch(`${url}/_caduceus/api/auth/sign-out`, { method: 'POST', headers: { cookie: laptop, origin: url } });
    const laptopClosed = await onLaptop.closed;

    expect(revoked.status).toBe(204);
    // 4401 is the code Hermes's own auth gate closes with (hermes-protocol.md §2.3); the reason is for people.
    expect(phoneClosed).toEqual({ code: 4401, reason: 'Your session ended. Sign in again.' });
    expect(laptopClosed).toEqual({ code: 4401, reason: 'Your session ended. Sign in again.' });
    // The upstream sockets went with them. The fake lives in another process and records a close when it sees it, so
    // this is a bounded poll of its record: there is nothing to await.
    await vi.waitFor(async () => expect((await upstream()).closes).toHaveLength(2));
  });

  test('when Hermes drops the connection the browser\'s socket closes with a reason, and when the browser leaves Hermes\'s side closes', async () => {
    const { open, upstream } = await start();
    const dropped = await open();
    dropped.send({ jsonrpc: '2.0', id: 'drop', method: 'session.list', params: { drop: true } });
    const droppedClose = await dropped.closed;
    const leaving = await open();

    leaving.close();

    // The page redials on 1012 (service restart) and can say why.
    expect(droppedClose).toEqual({ code: 1012, reason: 'Hermes closed the connection.' });
    // One close is the one Hermes made itself; the other is Caduceus closing the leaving browser's upstream. The fake
    // lives in another process and records a close when it sees it, so this is a bounded poll of its record.
    await vi.waitFor(async () => expect((await upstream()).closes).toHaveLength(2));
  });

  test('a browser socket that stops answering pings is dropped with its upstream, and one that keeps answering stays', async () => {
    const { url, cookie, open, upstream } = await start({ gatewayKeepaliveMs: 100 });
    const answering = await open();
    // A browser answers a ping by itself. This client does not, like a phone that lost its radio without a goodbye.
    const silent = new RawWebSocket(`${url.replace(/^http/, 'ws')}/api/ws`, { headers: { cookie, origin: url }, autoPong: false });
    const { promise: silentClosed, resolve } = Promise.withResolvers<number>();
    silent.on('close', (code) => resolve(code));

    // Without a pong the silent socket is dropped; the answering one has lived through the same pings.
    expect(await silentClosed).toBe(1006);
    answering.send({ jsonrpc: '2.0', id: 'still-there', method: 'gateway.ping', params: {} });
    await answering.waitFor((frame) => frame.id === 'still-there');
    // The fake lives in another process and records a close when it sees it, so this is a bounded poll of its record.
    await vi.waitFor(async () => expect((await upstream()).closes).toHaveLength(1));
  });

  test('a Hermes the launcher believes ready but whose port refuses connections is answered 502 at once, not left waiting', async () => {
    // The moments after a crash look like this: the launcher has not yet seen the process exit. A refused connection is
    // reported by Node's WebSocket as an `error` alone, and it never closes, so a proxy that waits for the close waits forever.
    backend = launchFakeHermes({ env: { FAKE_HERMES_DEAF_AFTER_READY: '1' } });
    await backend.ready();
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-root-'));
    server = await startCaduceusServer({ backend, hermesRoot: root });
    const cookie = await ownerCookie(server.url);

    expect(backend.status.state).toBe('ready');
    expect(await upgradeStatus(server.url, { cookie, origin: server.url })).toBe(502);
  });

  test('a Hermes that takes the connection but never answers the handshake is answered 502 once the open timeout has passed, and the connection is let go', async () => {
    const { url, cookie, upstream } = await start({ gatewayOpenTimeoutMs: 100 });
    await backend!.fetch('/api/__fake/ws?stall=1');

    expect(await upgradeStatus(url, { cookie, origin: url })).toBe(502);
    // The fake lives in another process and counts the connections it still holds, so this is a bounded poll of its record.
    await vi.waitFor(async () => expect((await upstream()).stalled).toBe(0));
  });
});

describe('the page\'s gateway connection, in front of the fake Hermes', () => {
  test('the capabilities handshake is sent on every connect and on every reconnect', async () => {
    const { page, upstream } = await start();
    const { connection, until } = page();
    await until((status) => status.state === 'connected');

    // Hermes drops the connection: the page reconnects by itself.
    void connection.client.request('session.list', { drop: true }).catch(() => undefined);
    await until((status) => status.state === 'reconnecting');
    await until((status) => status.state === 'connected');

    // The handshake is the page's own frame, so it reaches the fake a moment after the page has seen `gateway.ready`: the
    // fake lives in another process, so this is a bounded poll of its record.
    const handshakes = async () => (await upstream()).frames.map((text) => JSON.parse(text)).filter((frame) => frame.method === 'client.capabilities');
    await vi.waitFor(async () => expect(await handshakes()).toHaveLength(2));
    expect((await handshakes()).map((frame) => frame.params)).toEqual([{ server_requests: true }, { server_requests: true }]);
  });

  test('when Caduceus itself stops answering, the page goes offline and says Caduceus is not reachable', async () => {
    const { page } = await start();
    const { connection, until } = page();
    await until((status) => status.state === 'connected');

    await server!.close();
    server = undefined;
    const offline = await until((status) => status.state === 'offline');

    expect(offline.reason).toBe('Caduceus is not reachable.');
    expect(connection.backend.unreachable).toBe(true);
  });

  test('while Caduceus stays unreachable, each failed dial keeps the page offline: the dot does not flicker back to reconnecting', async () => {
    const { page } = await start();
    const { until, statuses } = page();
    await until((status) => status.state === 'connected');
    await server!.close();
    server = undefined;
    await until((status) => status.state === 'offline');

    // Two more dials fail, one after another. Each is counted, and the page is not "reconnecting" at any point of it.
    const third = await until((status) => status.attempt >= 3);

    expect(third.state).toBe('offline');
    expect(statuses.slice(statuses.findIndex((status) => status.state === 'offline')).map((status) => status.state)).not.toContain('reconnecting');
  });

  test('when the Hermes backend has stopped for good, the page goes offline and says the backend has stopped', async () => {
    const { page } = await start();
    const { connection, until } = page();
    await until((status) => status.state === 'connected');

    await backend!.stop();
    const offline = await until((status) => status.state === 'offline');

    expect(offline.reason).toBe('The Hermes backend has stopped.');
    expect(connection.backend).toEqual({ status: { state: 'stopped' }, unreachable: false });
  });

  test('when its session is revoked the page stops at once: signed out, and it does not dial again', async () => {
    const { url, cookie: phone, page } = await start();
    const laptop = await ownerCookie(url);
    const onSignedOut = vi.fn();
    let dials = 0;
    const { until, statuses } = page({
      onSignedOut,
      socketFactory: () => {
        dials += 1;
        return browserWebSocket(url, { cookie: phone });
      },
    });
    await until((status) => status.state === 'connected');
    const { sessions }: { sessions: SessionInfo[] } = await (await fetch(`${url}/_caduceus/api/auth/sessions`, { headers: { cookie: phone } })).json();
    const phoneId = sessions.find((session) => session.current)!.id;

    await fetch(`${url}/_caduceus/api/auth/sessions/${phoneId}`, { method: 'DELETE', headers: { cookie: laptop, origin: url } });
    const offline = await until((status) => status.state === 'offline');

    expect(offline.reason).toBe('Your session ended. Sign in again.');
    expect(onSignedOut).toHaveBeenCalledOnce();
    // The close code said it all: no `reconnecting` in between, and so no timer to dial again.
    expect(statuses.map((status) => status.state)).toEqual(['reconnecting', 'connected', 'offline']);
    expect(dials).toBe(1);
  });

  test('a page whose session is already gone finds that out when its dial is refused, and stops', async () => {
    const { url, cookie, page } = await start();
    await fetch(`${url}/_caduceus/api/auth/sign-out`, { method: 'POST', headers: { cookie, origin: url } });
    const onSignedOut = vi.fn();

    const { until } = page({ onSignedOut });
    const offline = await until((status) => status.state === 'offline');

    expect(offline.reason).toBe('Your session ended. Sign in again.');
    expect(onSignedOut).toHaveBeenCalledOnce();
  });

  test('reconnect() on a connection that looks open asks Hermes whether it is there, and dials again only when Hermes does not answer', async () => {
    const { page, upstream } = await start();
    const { connection, until, statuses, readies } = page({ probeTimeoutMs: 100 });
    await until((status) => status.state === 'connected');

    // A phone that wakes cannot know whether its socket survived. Hermes answers: the connection stays.
    connection.reconnect();
    // The fake lives in another process, so that the question reached it is a bounded poll of its record.
    await vi.waitFor(async () => expect((await upstream()).frames.filter((text) => JSON.parse(text).method === 'gateway.ping')).toHaveLength(1));
    // Hermes goes silent while the socket stays open. The same question now goes unanswered.
    await backend!.fetch('/api/__fake/ws?mute=1');
    connection.reconnect();
    await until((status) => status.state === 'reconnecting');
    await until((status) => status.state === 'connected');

    // Nothing changed after the first question; the second made the page dial again, and the same Hermes (the same epoch) said hello.
    expect(statuses.map((status) => status.state)).toEqual(['reconnecting', 'connected', 'reconnecting', 'connected']);
    expect(readies).toEqual([
      { epoch: expect.stringMatching(/^[0-9a-f]{32}$/), reconnected: false, restarted: false },
      { epoch: readies[0].epoch, reconnected: true, restarted: false },
    ]);
  });
});

describe('the grace hold, in front of the fake Hermes', () => {
  /** A browser socket as the page opens it: it names its tab. */
  const tab = (name: string) => ({ path: `/api/ws?tab=${name}` });

  test('a browser socket that goes away leaves its upstream open for ten minutes; the same tab\'s next socket takes it over and is greeted like a new one', async () => {
    const clock = graceClock();
    const { open, upstream } = await start({ gatewayGrace: { timers: clock.timers } });
    const first = await open(tab('phone'));
    const ready = await first.waitFor((frame) => frame.params?.type === 'gateway.ready');

    const holding = clock.nextStart();
    first.close();
    const timer = await holding;
    // Ten minutes is the grace, and Hermes's side is still open.
    expect(timer.ms).toBe(600_000);
    expect((await upstream()).closes).toEqual([]);

    const second = await open(tab('phone'));
    const again = await second.waitFor((frame) => frame.params?.type === 'gateway.ready');
    second.send({ jsonrpc: '2.0', id: 'ping', method: 'gateway.ping', params: {} });
    await second.waitFor((frame) => frame.id === 'ping');

    // The same upstream: Hermes saw one handshake, said `gateway.ready` once, and the second socket got the same one.
    expect(again).toEqual(ready);
    expect((await upstream()).upgrades).toHaveLength(1);
    expect(timer.cancelled).toBe(true);
    expect((await upstream()).closes).toEqual([]);
  });

  test('when the grace is over the upstream closes, and the next socket gets a new one', async () => {
    const clock = graceClock();
    const { open, upstream } = await start({ gatewayGrace: { timers: clock.timers } });
    const first = await open(tab('phone'));
    const holding = clock.nextStart();
    first.close();
    const timer = await holding;

    timer.fire();
    // The fake lives in another process and records a close when it sees it, so this is a bounded poll of its record.
    await vi.waitFor(async () => expect((await upstream()).closes).toHaveLength(1));
    const second = await open(tab('phone'));
    second.send({ jsonrpc: '2.0', id: 'ping', method: 'gateway.ping', params: {} });
    await second.waitFor((frame) => frame.id === 'ping');

    expect((await upstream()).upgrades).toHaveLength(2);
  });

  test('another tab, another sign-in, and a socket that names no tab never take a held upstream', async () => {
    const clock = graceClock();
    const { url, cookie, open, upstream } = await start({ gatewayGrace: { timers: clock.timers } });
    const laptop = await ownerCookie(url);
    const first = await open(tab('phone'));
    const holding = clock.nextStart();
    first.close();
    await holding;

    await open(tab('other'));
    await open({ ...tab('phone'), cookie: laptop });
    await open();

    expect((await upstream()).upgrades).toHaveLength(4);
    expect(cookie).not.toBe(laptop);
  });

  test('signing out ends a held upstream with the rest of the session\'s connections', async () => {
    const clock = graceClock();
    const { url, cookie, open, upstream } = await start({ gatewayGrace: { timers: clock.timers } });
    const first = await open(tab('phone'));
    const holding = clock.nextStart();
    first.close();
    await holding;

    await fetch(`${url}/_caduceus/api/auth/sign-out`, { method: 'POST', headers: { cookie, origin: url } });

    await vi.waitFor(async () => expect((await upstream()).closes).toHaveLength(1));
  });

  test('a held upstream that Hermes closes is gone: the next socket gets a new one', async () => {
    const clock = graceClock();
    const { open, upstream } = await start({ gatewayGrace: { timers: clock.timers } });
    const first = await open(tab('phone'));
    first.send({ jsonrpc: '2.0', id: 'drop', method: 'session.list', params: { drop: true } });
    await first.closed;
    // Nothing is held: the connection ended with Hermes's close, not with the browser's.
    expect(clock.started).toEqual([]);

    const second = await open(tab('phone'));
    second.send({ jsonrpc: '2.0', id: 'ping', method: 'gateway.ping', params: {} });
    await second.waitFor((frame) => frame.id === 'ping');
    expect((await upstream()).upgrades).toHaveLength(2);
  });

  test('the first desktop contract number Hermes reports (in a session.info event or a create result) is compared with the pin: a different one makes Hermes incompatible and read-only', async () => {
    const hermesInstallDir = fakeHermesInstall();
    installs.push(hermesInstallDir);
    const { cookie, url, open } = await start({ hermesInstallDir });
    const report = async () => (await (await fetch(`${url}/_caduceus/api/compatibility`, { headers: { cookie } })).json()) as CompatibilityReport;
    const socket = await open();
    const pinnedNumber = (await loadPinnedContracts()).markers.desktopContract!;
    expect(await report()).toMatchObject({ state: 'compatible', markers: { live: { desktopContract: null } } });

    // A Hermes that says the pinned number changes nothing but the live marker.
    socket.send({ jsonrpc: '2.0', id: 'same', method: 'session.create', params: { desktopContract: pinnedNumber } });
    await socket.waitFor((frame) => frame.id === 'same');
    expect(await report()).toMatchObject({ state: 'compatible', reasons: [], markers: { live: { desktopContract: pinnedNumber } } });

    // A Hermes whose GUI contract moved on is not the one Caduceus was built for.
    socket.send({ jsonrpc: '2.0', id: 'event', method: 'session.list', params: { infoEvent: pinnedNumber + 1 } });
    await socket.waitFor((frame) => frame.id === 'event');
    expect(await report()).toMatchObject({
      state: 'incompatible',
      reasons: [`Gateway marker changed: desktop contract: pinned ${pinnedNumber}, live ${pinnedNumber + 1}`],
      markers: { live: { desktopContract: pinnedNumber + 1 } },
    });
    const readOnly = await (await fetch(`${url}/_caduceus/api/policy/read-only`, { headers: { cookie } })).json();
    expect(readOnly).toEqual({ readOnly: true, automatic: 'contract-mismatch' });
  });
});
