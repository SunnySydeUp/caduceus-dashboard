import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import type { AuditEntry } from '@caduceus/contracts/caduceus-api';
import { startCaduceusServer, type CaduceusServer, type CaduceusServerOptions } from '../src/caduceus-server.ts';
import { createChat, transcriptOf, type Chat } from '../../web/src/modules/chat/chat-session.ts';
import { connectBrowserSocket, upgradeStatus, type BrowserSocket } from './fixtures/browser-socket.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { graceClock } from './fixtures/grace-clock.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { HERMES_WORK_TIMEOUT_MS, launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { seedSession } from './fixtures/seed-session.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';
import { DEFAULT_REPLY, startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';

// Terminal mode of the chat (M1 #19): Hermes's own TUI behind its PTY WebSocket, relayed by Caduceus, in front of the real Hermes (a stub LLM is its provider).
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
const sockets: BrowserSocket[] = [];
const pages: TestGatewayConnection[] = [];
const chats: Chat[] = [];
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  llm = await startStubLlm();
  await llm.connect(hermes);
}, 60_000);
afterAll(async () => {
  await llm.close();
  await hermes.stop();
});
afterEach(async () => {
  for (const chat of chats.splice(0)) chat.dispose();
  for (const page of pages.splice(0)) page.connection.close();
  for (const socket of sockets.splice(0)) socket.close();
  await server?.close();
  server = undefined;
  fs.rmSync(`${hermes.home}/caduceus`, { recursive: true, force: true });
});

async function start(options: Partial<CaduceusServerOptions> = {}) {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, ...options });
  const { url } = server;
  const cookie = await ownerCookie(url);
  const authenticator = await addPasskey(url, cookie);
  const asOwner = { cookie, origin: url };
  const audit = async (): Promise<AuditEntry[]> => {
    const body: { entries: AuditEntry[] } = await (await fetch(`${url}/_caduceus/api/audit`, { headers: { cookie } })).json();
    return body.entries;
  };
  return {
    url,
    cookie,
    asOwner,
    audit,
    grant: () => stepUp(url, cookie, authenticator),
    /** The page's native chat: the engine over its gateway connection, reading history through the server. */
    nativeChat: async (storedId?: string) => {
      const page = openGatewayConnection(url, cookie);
      pages.push(page);
      await page.until((status) => status.state === 'connected');
      const chat = createChat(page.connection, { history: page.rest, ...(storedId === undefined ? {} : { storedId }) });
      chats.push(chat);
      return chat;
    },
    view: async (session: string, size = 'cols=100&rows=30') => {
      const socket = await connectBrowserSocket(url, { cookie, path: `/api/pty?resume=${session}&${size}` });
      sockets.push(socket);
      return socket;
    },
  };
}

const printed = (socket: BrowserSocket) => socket.frames.map((frame) => (frame.type === 'output' ? String(frame.data) : '')).join('');
const sees = (socket: BrowserSocket, text: string) => socket.waitFor(() => printed(socket).includes(text));

describe('terminal mode', () => {
  test('opens Hermes\'s TUI on a stored session after step-up, and the TUI shows that session\'s history', async () => {
    await seedSession(hermes.home, 'tm-history', [
      { role: 'user', content: 'Name a fruit.' },
      { role: 'assistant', content: 'PINEAPPLE is a fruit.' },
    ]);
    const { url, asOwner, grant, view } = await start();

    const withoutGrant = await upgradeStatus(url, asOwner, '/api/pty?resume=tm-history');
    await grant();
    const socket = await view('tm-history');
    const attached = await socket.waitFor((frame) => frame.type === 'attached');
    await sees(socket, 'PINEAPPLE');

    expect(withoutGrant).toBe(403);
    expect(attached).toEqual({ type: 'attached', running: true, cols: 100, rows: 30 });
  }, HERMES_WORK_TIMEOUT_MS);

  test('is the same Hermes session as the native chat: a message sent in either is in the other after a refresh', async () => {
    const { grant, view, nativeChat } = await start();
    const native = await nativeChat();
    await native.send('ZEBRAXRAY');
    await native.until((state) => !state.running && state.turn === undefined && state.messages.length === 2);
    const sessionId = native.state.storedId!;
    await grant();

    const terminal = await view(sessionId);
    // What the chat sent is on the terminal's screen, and what is typed there goes to the same session.
    // Hermes's TUI draws a space as a cursor move, so a single word is what a test can look for on its screen.
    await sees(terminal, 'ZEBRAXRAY');
    const before = llm.completions.length;
    // Typed, then Enter as a key of its own: the TUI reads text and a newline that arrive together as a paste.
    terminal.send({ type: 'input', data: 'QUOKKAMSG' });
    await sees(terminal, 'QUOKKAMSG');
    terminal.send({ type: 'input', data: '\r' });
    await vi.waitFor(() => expect(llm.completions.length).toBe(before + 1), { timeout: 30_000, interval: 100 });
    await sees(terminal, 'stub');
    // The native chat, opened again on the session, has both exchanges.
    const reopened = await nativeChat(sessionId);
    await reopened.until((state) => state.messages.length === 4 && !state.running);

    expect(transcriptOf(reopened.state).map(({ role, text }) => ({ role, text }))).toEqual([
      { role: 'user', text: 'ZEBRAXRAY' },
      { role: 'assistant', text: DEFAULT_REPLY.join('') },
      { role: 'user', text: 'QUOKKAMSG' },
      { role: 'assistant', text: DEFAULT_REPLY.join('') },
    ]);
  }, HERMES_WORK_TIMEOUT_MS);

  test('is closed in read-only mode', async () => {
    const { url, asOwner, grant } = await start();
    await grant();
    await fetch(`${url}/_caduceus/api/policy/read-only`, { method: 'PUT', headers: { ...asOwner, 'content-type': 'application/json' }, body: JSON.stringify({ readOnly: true }) });

    expect(await upgradeStatus(url, asOwner, '/api/pty?resume=tm-history')).toBe(403);
  });

  test('a reload within the grace period finds the same terminal, with what was on it, and the screen that left is audited', async () => {
    await seedSession(hermes.home, 'tm-reload', [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hello again' }]);
    const { grant, view, audit } = await start();
    await grant();
    const first = await view('tm-reload');
    await sees(first, 'Hello');
    // Text typed and not sent lives in the TUI's own process: a new terminal could not have it.
    first.send({ type: 'input', data: 'UNSENTDRAFT' });
    await sees(first, 'UNSENTDRAFT');
    first.close();
    await first.closed;

    const second = await view('tm-reload');
    await sees(second, 'UNSENTDRAFT');

    expect(second.frames.filter((frame) => frame.type === 'notice')).toEqual([]);
    expect((await audit()).filter((entry) => entry.action.startsWith('terminal-mode.')).map(({ action, target, tier }) => ({ action, target, tier }))).toEqual([
      { action: 'terminal-mode.open', target: 'tm-reload', tier: 'T2' },
      { action: 'terminal-mode.close', target: 'tm-reload', tier: 'T2' },
      { action: 'terminal-mode.open', target: 'tm-reload', tier: 'T2' },
    ].reverse());
  }, HERMES_WORK_TIMEOUT_MS);

  test('after the grace period the terminal is closed, and the screen that comes back is told it has a new one on the same session', async () => {
    await seedSession(hermes.home, 'tm-expiry', [{ role: 'user', content: 'Hello' }, { role: 'assistant', content: 'Hello again' }]);
    const clock = graceClock();
    const { grant, view, audit } = await start({ terminalModeGrace: { ms: 10 * 60_000, timers: clock.timers } });
    await grant();
    const first = await view('tm-expiry');
    await sees(first, 'Hello');
    first.send({ type: 'input', data: 'UNSENTDRAFT' });
    await sees(first, 'UNSENTDRAFT');
    first.close();
    await first.closed;

    const timer = await clock.nextStart();
    timer.fire();
    const second = await view('tm-expiry');
    const notice = await second.waitFor((frame) => frame.type === 'notice');
    await sees(second, 'Hello');

    expect({ ms: timer.ms, notice }).toEqual({
      ms: 600_000,
      notice: { type: 'notice', text: 'The terminal Caduceus kept for this session was closed after 10 minutes with no screen watching it. This is a new terminal on the same session.' },
    });
    // Closed for real: the new terminal is a new process, which has not got the old one's draft.
    expect(printed(second)).not.toContain('UNSENTDRAFT');
    expect((await audit()).map((entry) => entry.action).filter((action) => action.startsWith('terminal-mode.'))).toEqual(['terminal-mode.open', 'terminal-mode.expire', 'terminal-mode.close', 'terminal-mode.open']);
  }, HERMES_WORK_TIMEOUT_MS);
});
