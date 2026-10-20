import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer, type CaduceusServerOptions } from '../src/caduceus-server.ts';
import { connectBrowserSocket, type BrowserSocket } from './fixtures/browser-socket.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { HERMES_WORK_TIMEOUT_MS, killHermes, launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { primeSessionWatcher } from './fixtures/session-watcher.ts';

// The browser's gateway WebSocket through Caduceus, in front of the real Hermes (a real `hermes serve` in a throwaway
// HERMES_HOME). What the fake Hermes is for (counting what reaches Hermes, echoing the secret) is in gateway-proxy.test.ts.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
const sockets: BrowserSocket[] = [];
const pages: TestGatewayConnection[] = [];
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 60_000);
afterAll(async () => {
  await hermes.stop();
});
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  for (const page of pages.splice(0)) page.connection.close();
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function start(options: Partial<CaduceusServerOptions> = {}) {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, ...options });
  const cookie = await ownerCookie(server.url);
  return { url: server.url, cookie, server };
}

async function open(url: string, cookie: string, origin?: string): Promise<BrowserSocket> {
  const socket = await connectBrowserSocket(url, { cookie, origin });
  sockets.push(socket);
  return socket;
}

/** The page's own gateway connection (the shared client in the web app's controller), as the owner. */
function openPage(url: string, cookie: string): TestGatewayConnection {
  const page = openGatewayConnection(url, cookie);
  pages.push(page);
  return page;
}

describe('the live gateway connection, in front of the real Hermes', () => {
  test('the browser gets Hermes\'s gateway.ready first and its capabilities handshake is answered by Hermes', async () => {
    const { url, cookie } = await start();
    const socket = await open(url, cookie);

    const ready = await socket.waitFor((frame) => frame.method === 'event');
    socket.send({ jsonrpc: '2.0', id: 'caps', method: 'client.capabilities', params: { server_requests: true } });
    const answer = await socket.waitFor((frame) => frame.id === 'caps');

    // hermes-protocol.md §2.2: frame 1 is always gateway.ready, carrying a 32-hex replay epoch and the heartbeat flag.
    expect(ready.params.type).toBe('gateway.ready');
    expect(ready.params.payload.replay_epoch).toMatch(/^[0-9a-f]{32}$/);
    expect(ready.params.payload.heartbeat).toBe(true);
    // Only Hermes can say which server requests it will now send this socket (hermes-protocol.md §4).
    expect(answer.result.server_requests).toEqual(expect.arrayContaining(['approval', 'clarify']));
  });

  test('the client\'s heartbeat, gateway.ping, is answered by Hermes', async () => {
    const { url, cookie } = await start();
    const socket = await open(url, cookie);

    socket.send({ jsonrpc: '2.0', id: 'heartbeat-1', method: 'gateway.ping', params: {} });
    const pong = await socket.waitFor((frame) => frame.id === 'heartbeat-1');

    // The shared client sends this every 15 s and drops the socket after 45 s without any frame (hermes-protocol.md §2.2).
    expect(pong.error).toBeUndefined();
    expect(pong.result).toEqual({ ok: true });
  });

  test('killing Hermes moves the page to reconnecting and back to connected, and it sees the new replay epoch', async () => {
    const { url, cookie } = await start();
    const page = openPage(url, cookie);
    await page.until((status) => status.state === 'connected');

    killHermes(hermes);
    await page.until((status) => status.state === 'reconnecting');
    await page.until((status) => status.state === 'connected');

    // Hermes takes seconds to come back. Meanwhile the page counts its attempts from 1, and says why it waits.
    const afterFirstConnect = page.statuses.slice(page.statuses.findIndex((status) => status.state === 'connected'));
    const reconnecting = afterFirstConnect.filter((status) => status.state === 'reconnecting');
    expect(reconnecting[0].attempt).toBe(1);
    expect(Math.max(...reconnecting.map((status) => status.attempt))).toBeGreaterThanOrEqual(3);
    expect(reconnecting.map((status) => status.reason)).toContain('Hermes is restarting.');
    expect(page.statuses.at(-1)).toEqual({ state: 'connected', attempt: 0 });
    // `gateway.ready` says it all: the first connect, then a reconnect after a restart (a new replay epoch, which is
    // how the page knows its sequence numbers are meaningless and loads live data afresh).
    const epoch = /^[0-9a-f]{32}$/;
    expect(page.readies).toEqual([
      { epoch: expect.stringMatching(epoch), reconnected: false, restarted: false },
      { epoch: expect.stringMatching(epoch), reconnected: true, restarted: true },
    ]);
    expect(page.readies[1].epoch).not.toBe(page.readies[0].epoch);
    // And the new Hermes answers the page's own requests.
    await expect(page.connection.client.request('session.active_list', {})).resolves.toEqual({ sessions: [] });
  }, HERMES_WORK_TIMEOUT_MS);

  test('a session that starts or stops reaches the page as sessions.changed, and Hermes\'s active session count follows', async () => {
    const { url, cookie } = await start();
    const page = openPage(url, cookie);
    await page.until((status) => status.state === 'connected');
    const { client } = page.connection;
    const activeSessions = async (): Promise<number> => (await (await fetch(`${url}/api/status`, { headers: { cookie } })).json()).active_sessions;
    /** Resolves at the first sessions.changed after which Hermes counts `count` active sessions: what Home does with every one. */
    const untilActive = (count: number) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      const stop = client.on('sessions.changed', () => {
        void activeSessions().then((active) => {
          if (active !== count) return;
          stop();
          resolve();
        });
      });
      return promise;
    };

    // Hermes's change watcher takes what exists at its first pass as its baseline, so it is made to report once before the session starts.
    await primeSessionWatcher(hermes.home, client);
    expect(await activeSessions()).toBe(0);

    const started = untilActive(1);
    const { session_id } = await client.request<{ session_id: string }>('session.create', { messages: [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'hi' }] });
    await started;
    const stopped = untilActive(0);
    await client.request('session.close', { session_id });
    await stopped;
  }, 40_000);
});
