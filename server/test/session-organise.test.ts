import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PolicyRefusal } from '@caduceus/contracts/caduceus-api';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createSessionActions, type Outcome, type SessionActions } from '../../web/src/modules/chat/sessions-actions.ts';
import { createSessionList, type SessionList } from '../../web/src/modules/chat/sessions-list.ts';
import type { SessionItem, SessionsView } from '../../web/src/modules/chat/sessions-model.ts';
import type { ConfirmRequest } from '../../web/src/palette.ts';
import { createTieredFetch } from '../../web/src/tiered-fetch.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { seedSessions } from './fixtures/seed-session.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Organising sessions (M1 #14): the engine behind the sessions pane's row menu, bulk bar and toolbar
// (`web/src/modules/chat/sessions-actions.ts`), run over the browser's connection and REST proxy of a Caduceus server in front of the
// real Hermes (a real `hermes serve` in a throwaway HERMES_HOME). Every change is checked by asking Hermes again, not by what the engine says.
// The screen is checked in a browser; the dialogs are the web app's, so the confirmation here is a stand-in for the owner's answer.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
const pages: TestGatewayConnection[] = [];
const disposables: { dispose(): void }[] = [];

beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  await hermes.cli('profile', 'create', 'work');
}, 60_000);
afterAll(async () => {
  await hermes.stop();
});
afterEach(async () => {
  for (const thing of disposables.splice(0)) thing.dispose();
  for (const page of pages.splice(0)) page.connection.close();
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

const CHATS: SessionsView = { tab: 'chats', failed: false, quiet: false, all: false };

interface Owner {
  actions: SessionActions;
  list: SessionList;
  /** What the confirmation dialog was asked, in order. */
  dialogs: ConfirmRequest[];
  /** What the owner answers the dialog (they confirm unless this is set to false). */
  answer: { confirm: boolean };
  /** The device's read-only flag; the server's own read-only mode is turned on through `readOnly`. */
  readOnly(value: boolean): Promise<void>;
  /** Hermes's own row of a session, read around Caduceus. */
  row(id: string, profile?: string): Promise<Record<string, unknown> | undefined>;
  /** Hermes's session ids of a profile, read around Caduceus. */
  ids(profile?: string, extra?: string): Promise<string[]>;
}

/** A signed-in owner with a step-up, as the pane has them: the list, the actions, and the dialog's answers as the test sets them. */
async function openOwner(options: { profile?: string; view?: SessionsView } = {}): Promise<Owner> {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const url = server.url;
  const cookie = await ownerCookie(url);
  const authenticator = await addPasskey(url, cookie);
  await stepUp(url, cookie, authenticator);
  const page = openGatewayConnection(url, cookie);
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  const profile = options.profile ?? 'default';
  const dialogs: ConfirmRequest[] = [];
  const answer = { confirm: true };
  const confirm = async (request: ConfirmRequest) => {
    dialogs.push(request);
    return answer.confirm ? { typed: request.object ?? request.label } : undefined;
  };
  // The page mirrors the server's read-only mode and refuses before asking the owner anything: this is that mirror.
  let readOnlyMirror = false;
  const send = createTieredFetch({
    fetch: (route, init) => fetch(`${url}${route}`, { ...init, headers: { origin: url, cookie, ...Object.fromEntries(new Headers(init.headers)) } }),
    confirmer: () => confirm,
    withStepUp: (request) => request(),
    online: () => true,
    readOnly: () => readOnlyMirror,
    sha256: async (text) => crypto.createHash('sha256').update(text).digest('hex'),
  });
  const list = createSessionList({ connection: page.connection, rest: page.rest, profile, view: options.view ?? CHATS });
  disposables.push(list);
  await list.until((state) => state.loaded);
  const actions = createSessionActions({ send, connection: page.connection, confirm: async (request) => (await confirm(request)) !== undefined, readOnly: () => readOnlyMirror, profile });
  const read = async (route: string) => (await hermes.backend.fetch(route)).json() as Promise<any>;
  return {
    actions,
    list,
    dialogs,
    answer,
    async readOnly(value) {
      const res = await fetch(`${url}/_caduceus/api/policy/read-only`, { method: 'PUT', headers: { origin: url, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ readOnly: value }) });
      if (!res.ok) throw new Error(`Read-only mode: HTTP ${res.status}`);
      readOnlyMirror = value;
    },
    async row(id, forProfile = profile) {
      const body = await read(`/api/sessions?profile=${forProfile}&limit=100&archived=include`);
      return (body.sessions as Record<string, unknown>[]).find((session) => session.id === id);
    },
    async ids(forProfile = profile, extra = '') {
      const body = await read(`/api/sessions?profile=${forProfile}&limit=100&archived=include${extra}`);
      return (body.sessions as { id: string }[]).map((session) => session.id).sort();
    },
  };
}

const item = (owner: Owner, id: string): SessionItem => {
  const found = owner.list.state.items.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`${id} is not in the list`);
  return found;
};

const done = (outcome: Outcome) => {
  if (outcome.kind !== 'done') throw new Error(`Expected done, got ${JSON.stringify(outcome)}`);
  return outcome;
};

describe('pin, archive, unread and rename', () => {
  test('are Tier 0 changes through Hermes, and undoing each puts Hermes back as it was', async () => {
    await seedSessions(hermes.home, [{ id: 'o-1', title: 'Plan the trip' }, { id: 'o-2', title: 'Second' }]);
    const owner = await openOwner();

    const pinned = done(await owner.actions.setPinned(item(owner, 'o-1'), true));
    expect(await owner.row('o-1')).toMatchObject({ pinned: true });
    expect(owner.dialogs).toEqual([]);
    done(await pinned.undo!());
    expect(await owner.row('o-1')).toMatchObject({ pinned: false });

    // Unread: the sessions in the list are read, so marking one unread is a change, and undoing it marks it read again.
    const unread = done(await owner.actions.setUnread(item(owner, 'o-1'), true));
    expect(await owner.row('o-1')).toMatchObject({ unread: true });
    done(await unread.undo!());
    expect(await owner.row('o-1')).toMatchObject({ unread: false });

    const archived = done(await owner.actions.setArchived(item(owner, 'o-2'), true));
    expect(await owner.row('o-2')).toMatchObject({ archived: true });
    done(await archived.undo!());
    expect(await owner.row('o-2')).toMatchObject({ archived: false });

    const renamed = done(await owner.actions.rename(item(owner, 'o-1'), 'Trip to Lisbon'));
    expect(await owner.row('o-1')).toMatchObject({ title: 'Trip to Lisbon' });
    done(await renamed.undo!());
    expect(await owner.row('o-1')).toMatchObject({ title: 'Plan the trip' });

    // A session with no title: undoing the rename clears the title again, so the row goes back to its preview.
    await seedSessions(hermes.home, [{ id: 'o-3' }]);
    await owner.list.refresh();
    const untitled = done(await owner.actions.rename(item(owner, 'o-3'), 'Named'));
    done(await untitled.undo!());
    expect((await owner.row('o-3'))?.title ?? '').toBe('');
  });
});

describe('deleting one session', () => {
  test('is a Tier 1 confirmation that names the session and its profile, and deletes in the profile that owns it', async () => {
    await seedSessions(hermes.home, [{ id: 'd-keep', title: 'Keep me' }, { id: 'd-old', title: 'Old draft' }]);
    await seedSessions(path.join(hermes.home, 'profiles', 'work'), [{ id: 'd-work', title: 'Work draft' }]);
    const owner = await openOwner({ view: { ...CHATS, all: true } });

    // The owner says no: nothing is sent.
    owner.answer.confirm = false;
    expect(await owner.actions.remove(item(owner, 'd-old'))).toEqual({ kind: 'cancelled' });
    expect(await owner.row('d-old')).toBeDefined();

    owner.answer.confirm = true;
    done(await owner.actions.remove(item(owner, 'd-old')));
    // A session of another profile is deleted from that profile, whatever the tab's profile is.
    done(await owner.actions.remove(item(owner, 'd-work')));

    expect(owner.dialogs).toHaveLength(3);
    expect(owner.dialogs[1]).toMatchObject({ tier: 'T1', profile: 'default', confirmLabel: 'Delete', label: expect.stringContaining('Old draft') });
    expect(owner.dialogs[2]).toMatchObject({ tier: 'T1', profile: 'work', label: expect.stringContaining('Work draft') });
    expect(await owner.ids('default')).toEqual(expect.arrayContaining(['d-keep']));
    expect(await owner.ids('default')).not.toContain('d-old');
    expect(await owner.ids('work')).not.toContain('d-work');
  });
});

const many = (owner: Owner, ...ids: string[]) => ids.map((id) => item(owner, id));

describe('changing many sessions', () => {
  test('pin and archive apply to every selected session, and one undo puts them all back', async () => {
    await seedSessions(hermes.home, [{ id: 'm-1', title: 'One' }, { id: 'm-2', title: 'Two' }, { id: 'm-3', title: 'Three' }]);
    await seedSessions(path.join(hermes.home, 'profiles', 'work'), [{ id: 'm-4', title: 'Four' }]);
    const owner = await openOwner({ view: { ...CHATS, all: true } });
    const selected = many(owner, 'm-1', 'm-2', 'm-4');

    const pinned = done(await owner.actions.pinMany(selected, true));
    expect(pinned.message).toBe('Pinned 3 sessions');
    expect([await owner.row('m-1'), await owner.row('m-2'), await owner.row('m-3'), await owner.row('m-4', 'work')].map((row) => row?.pinned)).toEqual([true, true, false, true]);
    done(await pinned.undo!());
    expect([await owner.row('m-1'), await owner.row('m-2'), await owner.row('m-4', 'work')].map((row) => row?.pinned)).toEqual([false, false, false]);

    const archived = done(await owner.actions.archiveMany(selected, true));
    expect(await owner.ids('default')).toEqual(expect.arrayContaining(['m-1', 'm-2']));
    expect([await owner.row('m-1'), await owner.row('m-4', 'work')].map((row) => row?.archived)).toEqual([true, true]);
    done(await archived.undo!());
    expect([await owner.row('m-1'), await owner.row('m-2'), await owner.row('m-4', 'work')].map((row) => row?.archived)).toEqual([false, false, false]);
  });
});

describe('deleting many sessions', () => {
  test('is a Tier 3: step-up and a typed confirmation that says it cannot be undone, then Hermes deletes exactly the selection from the profile that owns it', async () => {
    await seedSessions(hermes.home, ['a', 'b', 'c', 'd'].map((letter) => ({ id: `x-${letter}`, title: `Doomed ${letter}` })));
    const owner = await openOwner();

    owner.answer.confirm = false;
    expect(await owner.actions.removeMany(many(owner, 'x-a', 'x-b', 'x-c'))).toEqual({ kind: 'cancelled' });
    expect(await owner.ids()).toEqual(expect.arrayContaining(['x-a', 'x-b', 'x-c']));

    owner.answer.confirm = true;
    const outcome = done(await owner.actions.removeMany(many(owner, 'x-a', 'x-b', 'x-c')));

    expect(outcome.message).toBe('Deleted 3 sessions');
    expect(owner.dialogs[1]).toMatchObject({ tier: 'T3', label: 'Delete 3 sessions?', object: '3 sessions', profile: 'default', recoverability: { undoable: false }, confirmLabel: 'Delete 3 sessions' });
    const left = await owner.ids();
    expect(left).toContain('x-d');
    expect(left.filter((id) => ['x-a', 'x-b', 'x-c'].includes(id))).toEqual([]);
  });

  test('works on one profile at a time and never on more sessions than Hermes takes in one call', async () => {
    await seedSessions(hermes.home, [{ id: 'y-1', title: 'Default one' }]);
    await seedSessions(path.join(hermes.home, 'profiles', 'work'), [{ id: 'y-2', title: 'Work one' }]);
    const owner = await openOwner({ view: { ...CHATS, all: true } });

    const mixed = await owner.actions.removeMany(many(owner, 'y-1', 'y-2'));
    const tooMany = await owner.actions.removeMany(Array.from({ length: 501 }, (_, n) => ({ ...item(owner, 'y-1'), id: `fake-${n}` })));

    expect(mixed).toEqual({ kind: 'failed', message: 'Delete sessions of one profile at a time: this selection has sessions of default and work.' });
    expect(tooMany).toEqual({ kind: 'failed', message: 'Hermes deletes at most 500 sessions at once: select fewer.' });
    expect(owner.dialogs).toEqual([]);
    expect(await owner.ids('default')).toContain('y-1');
    expect(await owner.ids('work')).toContain('y-2');
  });
});

describe('empty sessions', () => {
  test('are counted by Hermes first, and deleting them is a Tier 1 that lists the count; the ones with messages stay', async () => {
    await seedSessions(hermes.home, [
      { id: 'e-1', exchanges: 0, endReason: 'cli_close' },
      { id: 'e-2', exchanges: 0, endReason: 'cli_close' },
      { id: 'e-live', exchanges: 0 },
      { id: 'e-full', title: 'Has messages', endReason: 'cli_close' },
    ]);
    const owner = await openOwner();

    expect(await owner.actions.countEmpty('default')).toBe(2);
    const outcome = done(await owner.actions.removeEmpty('default'));

    expect(outcome.message).toBe('Deleted 2 empty sessions');
    expect(owner.dialogs).toHaveLength(1);
    expect(owner.dialogs[0]).toMatchObject({ tier: 'T1', label: 'Delete 2 empty sessions?', profile: 'default' });
    expect(await owner.actions.countEmpty('default')).toBe(0);
    // A session still open is not empty by Hermes's reckoning; one with messages never is.
    expect(await owner.ids()).toEqual(expect.arrayContaining(['e-live', 'e-full']));
    expect(await owner.ids()).not.toContain('e-1');

    // Nothing left to delete: nobody is asked.
    expect(await owner.actions.removeEmpty('default')).toEqual({ kind: 'done', message: 'There are no empty sessions to delete.' });
    expect(owner.dialogs).toHaveLength(1);
  });
});

describe('pruning old sessions', () => {
  test('counts what would go first (a read), and the prune itself is a Tier 3 that says it cannot be undone', async () => {
    await seedSessions(hermes.home, [
      { id: 'p-old-1', title: 'Ancient', daysOld: 120, endReason: 'cli_close' },
      { id: 'p-old-2', title: 'Older', daysOld: 400, endReason: 'cli_close' },
      { id: 'p-recent', title: 'Last week', daysOld: 3, endReason: 'cli_close' },
    ]);
    const owner = await openOwner();

    const preview = await owner.actions.previewPrune('default', { olderThanDays: 30 });
    expect(preview).toEqual({ kind: 'previewed', matched: 2 });
    expect(owner.dialogs).toEqual([]);

    const outcome = done(await owner.actions.prune('default', { olderThanDays: 30 }));

    expect(outcome.message).toBe('Pruned 2 sessions older than 30 days');
    expect(owner.dialogs[0]).toMatchObject({ tier: 'T3', label: 'Prune 2 sessions older than 30 days?', object: '2 sessions', profile: 'default', recoverability: { undoable: false } });
    const left = await owner.ids();
    expect(left).toContain('p-recent');
    expect(left.filter((id) => id.startsWith('p-old'))).toEqual([]);
    // Nothing matches any more: nobody is asked for a passkey.
    expect(await owner.actions.prune('default', { olderThanDays: 30 })).toEqual({ kind: 'done', message: 'No sessions are older than 30 days.' });
    expect(owner.dialogs).toHaveLength(1);
  });

  test('Hermes’s own refusal of a bad age is shown in its words', async () => {
    const owner = await openOwner();
    const bad = await owner.actions.previewPrune('default', { olderThanDays: 0 });
    expect(bad).toMatchObject({ kind: 'failed', message: expect.stringContaining('older_than_days') });
  });
});

describe('read-only mode', () => {
  test('stops every change of a session, with the reason in the answer, and leaves Hermes as it was', async () => {
    await seedSessions(hermes.home, [{ id: 'r-1', title: 'Untouched' }, { id: 'r-2', title: 'Also untouched' }]);
    const owner = await openOwner();
    await owner.readOnly(true);
    const refused = { kind: 'failed', message: 'Read-only mode is on: Caduceus is not changing anything in Hermes.' };

    expect(await owner.actions.setPinned(item(owner, 'r-1'), true)).toEqual(refused);
    expect(await owner.actions.rename(item(owner, 'r-1'), 'Changed')).toEqual(refused);
    expect(await owner.actions.archiveMany(many(owner, 'r-1', 'r-2'), true)).toEqual(refused);
    expect(await owner.actions.remove(item(owner, 'r-1'))).toEqual(refused);
    expect(await owner.actions.removeMany(many(owner, 'r-1', 'r-2'))).toEqual(refused);
    expect(await owner.actions.removeEmpty('default')).toEqual({ kind: 'done', message: 'There are no empty sessions to delete.' });
    expect(owner.dialogs).toEqual([]);
    expect(await owner.row('r-1')).toMatchObject({ pinned: false, archived: false, title: 'Untouched' });
    expect(await owner.ids()).toEqual(expect.arrayContaining(['r-1', 'r-2']));

    await owner.readOnly(false);
    done(await owner.actions.setPinned(item(owner, 'r-1'), true));
  });
});

/** The profile's projects as Hermes lists them, read through the gateway the page uses. */
const hermesProjects = async (page: TestGatewayConnection, profile = 'default') =>
  (await page.connection.client.request<{ projects: { id: string; name: string; color: string | null; primary_path: string | null }[] }>('projects.list', { profile })).projects;

describe('projects', () => {
  test('are Hermes’s own: made with a folder, renamed and recoloured (Tier 1), and a session moves into one and out again by its workspace folder', async () => {
    await seedSessions(hermes.home, [{ id: 'j-1', title: 'Flights' }, { id: 'j-2', title: 'Hotels' }, { id: 'j-3', title: 'Unrelated' }]);
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-project-'));
    try {
      const owner = await openOwner({ view: { ...CHATS, group: 'project' } });
      const page = pages[0]!;

      // The owner declines the first dialog: no project is made.
      owner.answer.confirm = false;
      expect((await owner.actions.createProject('default', { name: 'Trip', folder, tone: 'success' })).kind).toBe('cancelled');
      expect(await hermesProjects(page)).toEqual([]);

      owner.answer.confirm = true;
      const created = await owner.actions.createProject('default', { name: 'Trip', folder, tone: 'success' });
      if (created.kind !== 'created') throw new Error(JSON.stringify(created));
      expect(owner.dialogs.at(-1)).toMatchObject({ tier: 'T1', label: 'Create the project “Trip”?', profile: 'default' });
      expect(await hermesProjects(page)).toEqual([expect.objectContaining({ id: created.project.id, name: 'Trip', color: 'success', primary_path: folder })]);

      done(await owner.actions.renameProject('default', created.project, 'Trip 2026'));
      done(await owner.actions.recolourProject('default', created.project, 'warning'));
      expect(await hermesProjects(page)).toEqual([expect.objectContaining({ name: 'Trip 2026', color: 'warning' })]);
      expect(owner.dialogs.slice(-2).map((dialog) => dialog.tier)).toEqual(['T1', 'T1']);

      // A session moves into the project (as Hermes lists it now): Hermes re-homes its workspace to the project's folder, and the list groups it there.
      const trip = (await owner.actions.listProjects('default')).find((project) => project.id === created.project.id)!;
      expect(trip).toEqual({ id: created.project.id, name: 'Trip 2026', tone: 'warning', folder, archived: false });
      const moved = done(await owner.actions.moveToProject(many(owner, 'j-1', 'j-2'), trip));
      expect(moved.message).toBe('Moved 2 sessions to Trip 2026');
      expect(owner.dialogs.at(-1)).toMatchObject({ tier: 'T1', label: 'Move 2 sessions to “Trip 2026”?', profile: 'default' });
      await owner.list.refresh();
      expect(owner.list.state.items.filter((row) => row.cwd === folder).map((row) => row.id).sort()).toEqual(['j-1', 'j-2']);
      expect(owner.list.state.projectOf).toEqual({ 'j-1': created.project.id, 'j-2': created.project.id });
      expect(owner.list.state.projects.map((project) => project.name)).toEqual(['Trip 2026']);

      // And out again: to Hermes's default folder, which belongs to no project.
      done(await owner.actions.moveOut(many(owner, 'j-1')));
      await owner.list.refresh();
      expect(owner.list.state.projectOf).toEqual({ 'j-2': created.project.id });
      expect(item(owner, 'j-1').cwd).not.toBe(folder);
      expect(item(owner, 'j-1').cwd).not.toBe('');
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });

  test('a project with no folder has nowhere to move a session to, and the owner is told so; read-only mode stops a new project before the dialog', async () => {
    await seedSessions(hermes.home, [{ id: 'k-1', title: 'Stays put' }]);
    const owner = await openOwner({ view: { ...CHATS, group: 'project' } });
    const page = pages[0]!;
    const bare = (await page.connection.client.request<{ project: { id: string } }>('projects.create', { profile: 'default', name: 'No folder yet' })).project;

    const result = await owner.actions.moveToProject(many(owner, 'k-1'), { id: bare.id, name: 'No folder yet', tone: undefined, folder: undefined, archived: false });
    expect(result).toEqual({ kind: 'failed', message: '“No folder yet” has no folder yet, so there is nowhere to move a session to. Give it a folder in Hermes first.' });
    expect(owner.dialogs).toEqual([]);

    await owner.readOnly(true);
    const refused = await owner.actions.createProject('default', { name: 'Blocked', folder: os.tmpdir(), tone: undefined });
    expect(refused).toEqual({ kind: 'failed', message: 'Read-only mode is on: Caduceus is not changing anything in Hermes.' });
    expect(owner.dialogs).toEqual([]);
    await owner.readOnly(false);
    const names = (await hermesProjects(page)).map((project) => project.name);
    expect(names).toContain('No folder yet');
    expect(names).not.toContain('Blocked');
  });
});

describe('grouping by project', () => {
  test('reads Hermes’s projects when the view is switched to it, and not before', async () => {
    await seedSessions(hermes.home, [{ id: 'g-1', title: 'Grouped' }]);
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-group-'));
    try {
      const owner = await openOwner();
      const page = pages[0]!;
      const { project } = await page.connection.client.request<{ project: { id: string } }>('projects.create', { profile: 'default', name: 'Grouping', folders: [folder] });
      await page.connection.client.request('session.workspace.move', { profile: 'default', session_key: 'g-1', cwd: folder });
      await owner.list.refresh();
      // Not grouped: the projects are not read.
      expect(owner.list.state.projects).toEqual([]);
      expect(owner.list.state.projectOf).toEqual({});

      owner.list.setView({ ...CHATS, group: 'project' });
      await owner.list.until((state) => state.projects.some((candidate) => candidate.id === project.id));
      expect(owner.list.state.projectOf['g-1']).toBe(project.id);
    } finally {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  });
});
