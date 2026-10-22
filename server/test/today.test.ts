import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { ReadyState, TodayVisit } from '@caduceus/contracts/today';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { HERMES_WORK_TIMEOUT_MS, launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { seedSessions } from './fixtures/seed-session.ts';

// Today's review state (M8 #03) in front of the real Hermes in a throwaway HERMES_HOME. "Ready for review" is finished work that has not been opened since:
// Hermes says what finished (Kanban tasks that reached Done), Caduceus keeps only which of them the owner opened. Tasks are made and finished the way the CLI
// does, so the list must notice a change Caduceus did not make.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
let cookie = '';
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 90_000);
afterAll(() => hermes.stop());
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function open(now?: () => number) {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, hermesInstallDir: hermes.install.dir, ...(now ? { now } : {}) });
  cookie = await ownerCookie(server.url);
  return api();
}

/** The same Caduceus store behind a fresh server: the owner's next visit after a restart. */
async function reopen(now?: () => number) {
  await server?.close();
  return open(now);
}

function api() {
  const url = server!.url;
  const call = (method: string, route: string, body?: unknown) =>
    fetch(`${url}/_caduceus/api/today${route}`, { method, headers: { cookie, origin: url, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return {
    async ready(): Promise<ReadyState> {
      const res = await call('GET', '/ready');
      expect(res.status).toBe(200);
      return (await res.json()) as ReadyState;
    },
    open: (id: string, stamp: string) => call('POST', '/ready/opened', { id, stamp }),
    async visit(): Promise<TodayVisit> {
      const res = await call('POST', '/visit');
      expect(res.status).toBe(200);
      return (await res.json()) as TodayVisit;
    },
    raw: call,
  };
}

async function finished(title: string, assignee = 'default'): Promise<string> {
  const res = await hermes.backend.fetch('/api/plugins/kanban/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
  const { task } = (await res.json()) as { task: { id: string } };
  await hermes.cli('kanban', 'assign', task.id, assignee);
  await hermes.cli('kanban', 'complete', task.id, '--summary', `${title}: done`);
  return task.id;
}

describe('ready for review', () => {
  test('a task that reached Done is ready; opening it clears it, and it stays cleared after a restart', async () => {
    const page = await open();
    expect((await page.ready()).items).toEqual([]);

    const id = await finished('Draft the lease letter', 'writer');
    const { items } = await page.ready();
    expect(items).toHaveLength(1);
    // What Hermes says of the task is what the item says; Caduceus invents none of it.
    expect(items[0]).toMatchObject({ id: `task:default:${id}`, kind: 'task', title: 'Draft the lease letter', summary: 'Draft the lease letter: done', profile: 'writer', to: `/work/tasks/${id}?board=default` });

    expect((await page.open(items[0]!.id, items[0]!.stamp)).status).toBe(200);
    expect((await page.ready()).items).toEqual([]);

    const again = await reopen();
    expect((await again.ready()).items).toEqual([]);
  }, HERMES_WORK_TIMEOUT_MS);

  test('opening with a body that is not an id and a stamp is refused, and opening something that is not ready changes nothing', async () => {
    const page = await open();
    const id = await finished('Still ready');
    expect((await page.raw('POST', '/ready/opened', { id: 'task:default:nope' })).status).toBe(400);
    expect((await page.raw('POST', '/ready/opened', 'x')).status).toBe(400);
    expect((await page.open('task:default:other', '1')).status).toBe(200);
    expect((await page.ready()).items.map((item) => item.id)).toEqual([`task:default:${id}`]);
  }, HERMES_WORK_TIMEOUT_MS);

  test('work that finished before Caduceus began keeping the owner\'s place is not offered for review', async () => {
    await finished('Done long ago');
    // A clock a day ahead: Today began after the task finished, however fast this test runs.
    const page = await open(() => Date.now() + 86_400_000);
    expect((await page.ready()).items).toEqual([]);
  }, HERMES_WORK_TIMEOUT_MS);

  test('a scheduled job\'s agent run that finished is ready, once for each job by its newest run; opening that run clears it', async () => {
    const page = await open();
    await seedSessions(hermes.home, [
      { id: 'cron_aa11bb22_20261022_080000', source: 'cron', title: 'Morning brief', endReason: 'cron_complete' },
      { id: 'cron_cc33dd44_20261022_090000', source: 'cron', title: 'Broken digest', endReason: 'error' },
      { id: 'cron_ee55ff66_20261022_090000', source: 'cron', title: 'Still going' },
      { id: 'chat-not-a-job', source: 'cli', title: 'A chat', endReason: 'cli_close' },
      { id: 'cron_aa11bb22_20261022_090000', source: 'cron', title: 'Morning brief #2', endReason: 'cron_complete' },
    ]);
    const { items } = await page.ready();
    // Only the job's newest finished run is offered: a failed run is a notice, a run still going is not done, and a chat is not a scheduled job.
    expect(items).toEqual([expect.objectContaining({ id: 'run:cron_aa11bb22_20261022_090000', kind: 'run', title: 'Morning brief #2', profile: 'default', to: '/chat/cron_aa11bb22_20261022_090000' })]);

    expect((await page.open(items[0]!.id, items[0]!.stamp)).status).toBe(200);
    expect((await page.ready()).items).toEqual([]);
  }, HERMES_WORK_TIMEOUT_MS);

  test('the store holds the markers of what was opened and nothing of the tasks', async () => {
    const page = await open();
    const id = await finished('Secret title that must not be copied');
    const [item] = (await page.ready()).items;
    await page.open(item!.id, item!.stamp);
    const db = new DatabaseSync(path.join(hermes.home, 'caduceus', 'caduceus.db'));
    try {
      const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'today%'").all() as { name: string }[];
      const dump = rows.map(({ name }) => JSON.stringify(db.prepare(`SELECT * FROM ${name}`).all())).join('\n');
      expect(dump).toContain(id);
      expect(dump).not.toContain('Secret title');
    } finally {
      db.close();
    }
  }, HERMES_WORK_TIMEOUT_MS);

  test('the review routes need the owner to be signed in', async () => {
    await open();
    const res = await fetch(`${server!.url}/_caduceus/api/today/ready`);
    expect(res.status).toBe(401);
  }, HERMES_WORK_TIMEOUT_MS);
});

describe('the owner\'s last visit', () => {
  test('the first visit has no earlier one; a later visit, after the owner was away, says when the one before it was', async () => {
    let clock = Date.now();
    const page = await open(() => clock);
    const first = await page.visit();
    expect(first).toEqual({ since: null, at: clock });

    clock += 3 * 3_600_000;
    const second = await page.visit();
    expect(second).toEqual({ since: first.at, at: clock });

    // The visit is kept by Caduceus, so a restart does not forget it.
    clock += 3_600_000;
    const after = await reopen(() => clock);
    expect(await after.visit()).toEqual({ since: second.at, at: clock });
  }, HERMES_WORK_TIMEOUT_MS);

  test('opening Today again soon (a reload) is the same visit: the away list does not empty', async () => {
    let clock = Date.now();
    const page = await open(() => clock);
    await page.visit();
    clock += 2 * 3_600_000;
    const away = await page.visit();
    clock += 60_000;
    expect(await page.visit()).toEqual({ since: away.since, at: clock });
  }, HERMES_WORK_TIMEOUT_MS);
});
