import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRestClassifier } from '@caduceus/contracts/policy/rest';
import type { Reminder, RemindersFailure, RemindersState } from '@caduceus/contracts/today';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { parseReminders } from '../src/reminders.ts';
import { makeFakeRemindctl, type FakeRemindctl } from './fixtures/fake-remindctl.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';

// Today's reminders: the Apple Reminders that have a due date, read from `remindctl`. The server runs the command with a fixed argument list and turns its JSON into
// the page's list; when the command is missing or fails, the answer says so in words. A fake `remindctl` (a real executable) stands in for the Mac's.
const NOW = Date.parse('2026-10-20T02:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString().replace('.000Z', 'Z');
const entry = (over: Record<string, unknown>) => ({
  alarmDate: '2026-10-31T23:00:00Z',
  creationDate: '2026-10-20T09:09:22Z',
  dueDate: iso(2 * DAY),
  dueDateIsAllDay: false,
  id: 'id-1',
  isCompleted: false,
  lastModifiedDate: '2026-10-20T09:09:22Z',
  listID: 'list-1',
  listName: 'Reminders',
  priority: 'none',
  title: 'A reminder',
  ...over,
});

let hermes: TestHermes;
let server: CaduceusServer | undefined;
let fake: FakeRemindctl | undefined;
let cookie = '';
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 90_000);
afterAll(() => hermes.stop());
afterEach(async () => {
  await server?.close();
  server = undefined;
  fake?.remove();
  fake = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function open(remindctl: string) {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, hermesInstallDir: hermes.install.dir, now: () => NOW, remindctl });
  cookie = await ownerCookie(server.url);
  return (headers: Record<string, string> = { cookie }) => fetch(`${server!.url}/_caduceus/api/today/reminders`, { headers });
}

describe('GET /_caduceus/api/today/reminders', () => {
  test('lists the dated reminders soonest first, by running remindctl with a fixed command line', async () => {
    fake = makeFakeRemindctl();
    fake.prints(
      JSON.stringify([
        entry({ id: 'late', title: 'Later one', dueDate: iso(9 * DAY), listName: 'Home' }),
        entry({ id: 'soon', title: 'Sooner one', dueDate: iso(DAY) }),
        entry({ id: 'undated', title: 'No date', dueDate: undefined }),
        entry({ id: 'done', title: 'Finished', dueDate: iso(-DAY), isCompleted: true }),
      ]),
    );
    const get = await open(fake.command);

    const res = await get();
    expect(res.status).toBe(200);
    const { reminders } = (await res.json()) as RemindersState;
    expect(reminders.map((r) => [r.id, r.title, r.list, r.completed])).toEqual([
      ['done', 'Finished', 'Reminders', true],
      ['soon', 'Sooner one', 'Reminders', false],
      ['late', 'Later one', 'Home', false],
    ]);
    expect(reminders[1]).toEqual({ id: 'soon', title: 'Sooner one', list: 'Reminders', due: iso(DAY), allDay: false, day: undefined, completed: false } satisfies Reminder);
    // The command line is fixed: nothing of the request reaches it, and it only reads.
    expect(fake.calls()).toEqual([['export', '--json', '--no-input', '--no-color']]);
  });

  test('is behind sign-in', async () => {
    fake = makeFakeRemindctl();
    const get = await open(fake.command);
    expect((await get({})).status).toBe(401);
    expect(fake.calls()).toEqual([]);
  });

  test('says remindctl is not installed, in words, when the command is missing', async () => {
    const get = await open('/nonexistent/remindctl');
    const res = await get();
    expect(res.status).toBe(503);
    const failure = (await res.json()) as RemindersFailure;
    expect(failure).toMatchObject({ error: 'reminders-unavailable', reason: 'not-installed' });
    expect(failure.message).toMatch(/remindctl/);
  });

  test('says so when remindctl fails, with its first line of complaint, and recovers when it works again', async () => {
    fake = makeFakeRemindctl();
    fake.fails(1, 'Reminders access denied\nrun remindctl authorize\n');
    const get = await open(fake.command);

    const res = await get();
    expect(res.status).toBe(503);
    const failure = (await res.json()) as RemindersFailure;
    expect(failure).toMatchObject({ error: 'reminders-unavailable', reason: 'failed' });
    expect(failure.message).toContain('Reminders access denied');
    expect(failure.message).not.toContain('run remindctl authorize');

    fake.prints(JSON.stringify([entry({ id: 'back' })]));
    expect(((await (await get()).json()) as RemindersState).reminders.map((r) => r.id)).toEqual(['back']);
  });

  test('says so when remindctl prints something that is not a list of reminders', async () => {
    fake = makeFakeRemindctl();
    fake.prints('not json at all');
    const get = await open(fake.command);
    const res = await get();
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'reminders-unavailable', reason: 'unreadable' });
  });

  test('is classified in the policy map as a read', () => {
    const match = createRestClassifier()('GET', '/_caduceus/api/today/reminders');
    expect(match).toMatchObject({ ok: true, operation: 'GET /_caduceus/api/today/reminders', policy: { tier: 'T0', read: true } });
  });
});

describe('parseReminders', () => {
  test('keeps what a reminder needs and nothing else (no notes, no ids of lists)', () => {
    const [only] = parseReminders(JSON.stringify([entry({ notes: 'private notes', url: 'https://example.com/secret', id: 'x' })]), NOW);
    expect(Object.keys(only!).sort()).toEqual(['allDay', 'completed', 'day', 'due', 'id', 'list', 'title']);
  });

  test('names the day of an all-day reminder as the Mac does, and leaves a timed one to the reader', () => {
    const allDay = new Date(2026, 10, 3, 0, 0, 0);
    const [a, b] = parseReminders(JSON.stringify([entry({ id: 'a', dueDate: allDay.toISOString(), dueDateIsAllDay: true }), entry({ id: 'b', dueDate: allDay.toISOString() })]), NOW);
    expect(a).toMatchObject({ id: 'a', allDay: true, day: '2026-11-03' });
    expect(b).toMatchObject({ id: 'b', allDay: false, day: undefined });
  });

  test('drops completed reminders older than 90 days but keeps an open one however late it is', () => {
    const list = parseReminders(
      JSON.stringify([entry({ id: 'old-done', dueDate: iso(-91 * DAY), isCompleted: true }), entry({ id: 'recent-done', dueDate: iso(-89 * DAY), isCompleted: true }), entry({ id: 'old-open', dueDate: iso(-400 * DAY) })]),
      NOW,
    );
    expect(list.map((r) => r.id)).toEqual(['old-open', 'recent-done']);
  });

  test('skips entries it cannot make sense of instead of failing the whole list', () => {
    const list = parseReminders(JSON.stringify([null, 'x', { title: 'no id', dueDate: iso(DAY) }, entry({ id: 'bad-date', dueDate: 'next tuesday' }), entry({ id: 'ok' })]), NOW);
    expect(list.map((r) => r.id)).toEqual(['ok']);
  });

  test('refuses an answer that is not a list', () => {
    expect(() => parseReminders('{"reminders":[]}', NOW)).toThrow();
    expect(() => parseReminders('', NOW)).toThrow();
  });
});
