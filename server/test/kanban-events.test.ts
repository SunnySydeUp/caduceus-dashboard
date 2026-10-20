import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { connectBrowserSocket, upgradeStatus, type BrowserSocket } from './fixtures/browser-socket.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';
import { ownerCookie } from './fixtures/owner.ts';

// The Kanban events WebSocket through Caduceus, in front of the real Hermes (a real `hermes serve` in a throwaway
// HERMES_HOME): what a board page needs to stay live. Hermes writes Kanban tasks into its own `kanban.db`; Caduceus
// only relays what Hermes says.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
const sockets: BrowserSocket[] = [];
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 60_000);
afterAll(() => hermes.stop());
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.close();
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function start() {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, hermesInstallDir: hermes.install.dir });
  const cookie = await ownerCookie(server.url);
  return { url: server.url, cookie };
}

/** A task made in Hermes itself, the way the CLI or a worker would make one (not through Caduceus). */
async function createTask(title: string): Promise<string> {
  const response = await hermes.backend.fetch('/api/plugins/kanban/tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  expect(response.status).toBe(200);
  const created: { task: { id: string } } = await response.json();
  return created.task.id;
}

describe('Kanban events, through Caduceus', () => {
  test('a page that opens the events socket is told when a task is created and when its status changes', async () => {
    const { url, cookie } = await start();
    // The cursor a board read hands the page: the events after it are the news.
    const board: { latest_event_id: number } = await (await fetch(`${url}/api/plugins/kanban/board`, { headers: { cookie } })).json();
    const socket = await connectBrowserSocket(url, { cookie, path: `/api/plugins/kanban/events?since=${board.latest_event_id}` });
    sockets.push(socket);
    const id = await createTask('Events through Caduceus');
    const created = await socket.waitFor((frame) => frame.events?.some((event: { task_id: string; kind: string }) => event.task_id === id && event.kind === 'created'));
    expect(created.cursor).toEqual(expect.any(Number));

    const moved = await hermes.backend.fetch(`/api/plugins/kanban/tasks/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'ready' }) });
    expect(moved.status).toBe(200);
    const changed = await socket.waitFor((frame) => frame.cursor > created.cursor && frame.events?.some((event: { task_id: string }) => event.task_id === id));
    expect(changed.events.map((event: { kind: string }) => event.kind)).not.toContain('created');
  });

  test('a delete made through Caduceus is announced, since Hermes records no event for it', async () => {
    const { url, cookie } = await start();
    await stepUp(url, cookie, await addPasskey(url, cookie));
    const id = await createTask('Deleted through Caduceus');
    const socket = await connectBrowserSocket(url, { cookie, path: '/api/plugins/kanban/events?since=999999999' });
    sockets.push(socket);

    const deleted = await fetch(`${url}/api/plugins/kanban/tasks/${id}`, { method: 'DELETE', headers: { cookie, origin: url } });
    expect(deleted.status).toBe(200);
    await socket.waitFor((frame) => frame.written === true);
    const board: { columns: { tasks: { id: string }[] }[] } = await (await fetch(`${url}/api/plugins/kanban/board`, { headers: { cookie } })).json();
    expect(board.columns.flatMap((column) => column.tasks.map((task) => task.id))).not.toContain(id);
  });

  test('an upgrade without the owner’s session is refused, and so is one from another origin', async () => {
    const { url, cookie } = await start();
    expect(await upgradeStatus(url, { origin: url }, '/api/plugins/kanban/events')).toBe(401);
    expect(await upgradeStatus(url, { origin: 'http://evil.example', cookie }, '/api/plugins/kanban/events')).toBe(403);
  });
});
