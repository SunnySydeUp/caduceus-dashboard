import { afterEach, describe, expect, test, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { WebSocketServer } from 'ws';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { TerminalServerFrame } from '@caduceus/contracts/caduceus-api';
import type { HermesBackend } from '../src/hermes-backend.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { openTerminalConnection, type TerminalConnection, type TerminalStatus } from '../../web/src/modules/terminal/terminal-connection.ts';
import { terminalSocketUrl } from '../../web/src/modules/terminal/terminal-model.ts';
import { browserWebSocket } from './fixtures/browser-socket.ts';
import { launchFakeHermes } from './fixtures/fake-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// The web app's terminal connection (`web/src/modules/terminal/terminal-connection.ts`) against a Caduceus server, over a WebSocket that sends the owner's cookie.
let backend: HermesBackend | undefined;
let server: CaduceusServer | undefined;
const temps: string[] = [];
const connections: TerminalConnection[] = [];
afterEach(async () => {
  for (const connection of connections.splice(0)) connection.close();
  await server?.close();
  await backend?.stop();
  for (const dir of temps.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  server = undefined;
  backend = undefined;
});

async function start() {
  backend = launchFakeHermes();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-terminal-client-'));
  const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-terminal-client-work-')));
  temps.push(root, work);
  server = await startCaduceusServer({ backend, hermesRoot: root, fileRoots: [work], terminal: { shell: '/bin/sh', args: [], env: { PATH: process.env.PATH, PS1: '' } } });
  await backend.ready();
  const { url } = server;
  const cookie = await ownerCookie(url);
  const sockets: WebSocket[] = [];
  const asked: boolean[] = [];

  /** Opens the page's connection; `grant` is how the page gets a step-up grant when it needs one (the passkey prompt). */
  const open = (grant: () => Promise<boolean>) => {
    const statuses: TerminalStatus[] = [];
    const frames: TerminalServerFrame[] = [];
    const waiting = new Set<() => void>();
    const connection = openTerminalConnection({
      url: () => terminalSocketUrl({ origin: url, cwd: work, cols: 80, rows: 24 }),
      socketFactory: (address) => {
        const { pathname, search } = new URL(address);
        const socket = browserWebSocket(url, { cookie, path: `${pathname}${search}` });
        sockets.push(socket);
        return socket;
      },
      askForGrant: () => {
        asked.push(true);
        return grant();
      },
      backoff: { baseDelayMs: 5, capMs: 20 },
      onStatus: (status) => {
        statuses.push(status);
        for (const wake of waiting) wake();
      },
      onFrame: (frame) => {
        frames.push(frame);
        for (const wake of waiting) wake();
      },
    });
    connections.push(connection);
    /** Resolves once `ready` holds, looking at what has come so far and at everything that comes. */
    const until = (ready: () => boolean) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      const check = () => {
        if (!ready()) return;
        waiting.delete(check);
        resolve();
      };
      waiting.add(check);
      check();
      return promise;
    };
    return { connection, statuses, frames, until };
  };
  const printed = (frames: TerminalServerFrame[]) => frames.map((frame) => (frame.type === 'output' ? frame.data : '')).join('');
  const giveStepUp = async () => {
    await stepUp(url, cookie, await addPasskey(url, cookie));
    return true;
  };
  return { open, sockets, asked, printed, giveStepUp, url, cookie };
}

describe('the terminal connection of the page', () => {
  test('asks for the passkey when the server refuses to open the shell, shows what the shell prints, and reconnects to the same shell after the network drops', async () => {
    const { open, sockets, asked, printed, giveStepUp } = await start();
    const page = open(giveStepUp);

    await page.until(() => page.statuses.at(-1)?.state === 'live');
    page.connection.send({ type: 'input', data: 'KEPT=across-the-drop; echo set-up-$((1+1))\n' });
    await page.until(() => printed(page.frames).includes('set-up-2'));
    // The network goes: the browser sees a socket that closed abnormally, not a goodbye.
    // The first socket was the refused one; the live shell is on the latest.
    sockets.at(-1)!.close(4000, 'network lost');
    await page.until(() => page.statuses.some((status) => status.state === 'reconnecting'));
    await page.until(() => page.statuses.filter((status) => status.state === 'live').length === 2);
    page.connection.send({ type: 'input', data: 'echo "kept=${KEPT}"\n' });
    await page.until(() => printed(page.frames).includes('kept=across-the-drop'));

    // Asked once, when the first try was refused; the reconnect after the drop finds the grant still there and does not ask.
    expect(asked).toEqual([true]);
    expect(page.frames.filter((frame) => frame.type === 'attached')).toHaveLength(2);
    // The second attach replays the scrollback: what was printed before the drop comes again.
    expect(printed(page.frames).split('set-up-2').length).toBeGreaterThan(2);
  });

  test('a refused upgrade asks for the passkey, and says so when it is still refused or declined', async () => {
    const { open, asked, url, cookie } = await start();
    await fetch(`${url}/_caduceus/api/policy/read-only`, { method: 'PUT', headers: { cookie, origin: url, 'content-type': 'application/json' }, body: JSON.stringify({ readOnly: true }) });
    const page = open(async () => true);

    await page.until(() => page.statuses.at(-1)?.state === 'closed');
    const declined = open(async () => false);
    await declined.until(() => declined.statuses.at(-1)?.state === 'closed');

    expect(asked).toEqual([true, true]);
    expect(page.statuses.at(-1)).toEqual({ state: 'closed', reason: 'Caduceus did not open the shell. Read-only mode may be on, or the passkey confirmation was not accepted.' });
    expect(declined.statuses.at(-1)).toEqual({ state: 'closed', reason: 'Opening the terminal needs your passkey.' });
  });

  test('gives up on a connection that does not come back, and says to press Reconnect, which asks again', async () => {
    const { open, giveStepUp } = await start();
    const page = open(giveStepUp);
    await page.until(() => page.statuses.at(-1)?.state === 'live');

    await server!.close();
    server = undefined;
    await page.until(() => page.statuses.at(-1)?.state === 'closed');

    expect(page.statuses.at(-1)).toEqual({ state: 'closed', reason: 'The connection to the shell was lost. Press Reconnect to try again.' });
    expect(page.statuses.filter((status) => status.state === 'reconnecting').length).toBeGreaterThan(1);
  });

  test('does not reconnect after a terminal that ended and closed its socket (a TUI the owner left): it says so, and Reconnect starts a new one', async () => {
    // The Hermes TUI relay closes the socket after `ended`; a stand-in server plays that, and counts how many times it is dialled.
    const relay = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    let dials = 0;
    relay.on('connection', (socket) => {
      dials++;
      socket.send(JSON.stringify({ type: 'attached', running: true, cols: 80, rows: 24 }));
      socket.send(JSON.stringify({ type: 'ended', reason: 'exited' }));
      socket.close(1000, 'The terminal ended.');
    });
    await new Promise<void>((resolve) => relay.once('listening', resolve));
    try {
      const { port } = relay.address() as AddressInfo;
      const statuses: TerminalStatus[] = [];
      const frames: TerminalServerFrame[] = [];
      const connection = openTerminalConnection({ url: () => `ws://127.0.0.1:${port}/`, askForGrant: async () => true, backoff: { baseDelayMs: 5, capMs: 20 }, onStatus: (status) => statuses.push(status), onFrame: (frame) => frames.push(frame) });
      connections.push(connection);
      const closed = (count: number) => vi.waitFor(() => expect(statuses.filter((status) => status.state === 'closed')).toHaveLength(count));
      await closed(1);
      connection.reconnect();
      await closed(2);

      expect(dials).toBe(2);
      expect(frames.filter((frame) => frame.type === 'ended')).toHaveLength(2);
      expect(statuses.at(-1)).toEqual({ state: 'closed', reason: 'The terminal ended.' });
      expect(statuses.some((status) => status.state === 'reconnecting')).toBe(false);
    } finally {
      await new Promise((resolve) => relay.close(resolve));
    }
  });
});
