import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PolicyRefusal } from '@caduceus/contracts/caduceus-api';
import type { ConfirmRequest } from '../../web/src/palette.ts';
import { createTieredFetch } from '../../web/src/tiered-fetch.ts';
import { createChat } from '../../web/src/modules/chat/chat-session.ts';
import { branchStored } from '../../web/src/modules/chat/session-branch.ts';
import { addWorktree, linkedWorktreeOf, readBaseBranches, readWorktrees, removeWorktree, type WorktreeIo } from '../../web/src/modules/chat/worktrees.ts';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { runProgram } from './fixtures/run-program.ts';
import { seedSession } from './fixtures/seed-session.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';
import { DEFAULT_REPLY, startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';

// Duplicate, worktree sessions (M1 #17): the row menu's Duplicate is `session.branch` of a stored session, and a worktree session is made by Hermes's git
// worktree endpoints, over a real Hermes in a throwaway HERMES_HOME. The repositories are throwaway too: `git init` in a temp directory, never the owner's.
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
let scratch: string;
const pages: TestGatewayConnection[] = [];

beforeAll(async () => {
  scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-worktrees-')));
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  llm = await startStubLlm();
  await llm.connect(hermes);
}, 120_000);
afterAll(async () => {
  await llm.close();
  await hermes.stop();
  fs.rmSync(scratch, { recursive: true, force: true });
});
afterEach(async () => {
  for (const page of pages.splice(0)) page.connection.close();
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function openPage() {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, fileRoots: [scratch] });
  const cookie = await ownerCookie(server.url);
  const page = openGatewayConnection(server.url, cookie);
  pages.push(page);
  await page.until((status) => status.state === 'connected');
  return page;
}

const git = (cwd: string, ...args: string[]) => runProgram('git', ['-c', 'user.email=owner@example.test', '-c', 'user.name=Owner', ...args], { cwd });

/** A repository of its own in a temp directory: `main` with one commit, and `develop` one commit ahead of it. */
async function makeRepo(name: string): Promise<string> {
  const repo = path.join(scratch, name);
  fs.mkdirSync(repo);
  await git(repo, 'init', '-b', 'main');
  fs.writeFileSync(path.join(repo, 'README.md'), 'Hello\n');
  await git(repo, 'add', '.');
  await git(repo, 'commit', '-m', 'First');
  await git(repo, 'switch', '-c', 'develop');
  fs.writeFileSync(path.join(repo, 'develop-only.txt'), 'only here\n');
  await git(repo, 'add', '.');
  await git(repo, 'commit', '-m', 'Develop');
  await git(repo, 'switch', 'main');
  return repo;
}

const worktreeFolders = async (repo: string) =>
  (await git(repo, 'worktree', 'list', '--porcelain'))
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => fs.realpathSync(line.slice('worktree '.length)));

describe('Duplicate: a full branch of a stored session', () => {
  test('the stored session is attached for the branch alone: the copy has every message, the original is as it was, and Hermes does not keep the original’s runtime', async () => {
    await seedSession(hermes.home, 'dup-source', [
      { role: 'user', content: 'Plan the release' },
      { role: 'assistant', content: 'Three steps: freeze, test, ship.' },
    ], { title: 'Release plan' });
    const page = await openPage();

    const copy = await branchStored(page.connection.client, { storedId: 'dup-source', profile: 'default' });

    expect(copy.storedId).not.toBe('dup-source');
    const held = async (id: string) => ((await page.rest(`/api/sessions/${id}/messages`)) as { messages: { role: string; content: string }[] }).messages.map((row) => `${row.role}: ${row.content}`);
    expect(await held(copy.storedId)).toEqual(['user: Plan the release', 'assistant: Three steps: freeze, test, ship.']);
    expect(await held('dup-source')).toEqual(['user: Plan the release', 'assistant: Three steps: freeze, test, ship.']);
    expect(copy.title).toContain('Release plan');
    const hosted = await page.connection.client.request<{ sessions?: { session_key?: string }[] }>('session.active_list', {});
    expect((hosted.sessions ?? []).map((entry) => entry.session_key)).not.toContain('dup-source');
  });

  test('a session that this Hermes already hosts for an open chat keeps its runtime: Duplicate does not close what another tab is using', async () => {
    await seedSession(hermes.home, 'dup-live', [
      { role: 'user', content: 'Review the diff' },
      { role: 'assistant', content: 'Two files changed.' },
    ], { title: 'Review' });
    const page = await openPage();
    const open = createChat(page.connection, { history: page.rest, storedId: 'dup-live' });
    try {
      await open.until((state) => !state.syncing && state.messages.length > 0);

      const copy = await branchStored(page.connection.client, { storedId: 'dup-live', profile: 'default' });

      expect(copy.storedId).not.toBe('dup-live');
      const hosted = await page.connection.client.request<{ sessions?: { session_key?: string }[] }>('session.active_list', {});
      expect((hosted.sessions ?? []).map((entry) => entry.session_key)).toContain('dup-live');
    } finally {
      open.dispose();
    }
  });

  test('a session with nothing in it is refused in Hermes’s words, and no runtime is left behind', async () => {
    await seedSession(hermes.home, 'dup-empty', [], { title: 'Nothing yet' });
    const page = await openPage();

    await expect(branchStored(page.connection.client, { storedId: 'dup-empty', profile: 'default' })).rejects.toThrow(/nothing to branch/i);

    const hosted = await page.connection.client.request<{ sessions?: { session_key?: string }[] }>('session.active_list', {});
    expect((hosted.sessions ?? []).map((entry) => entry.session_key)).not.toContain('dup-empty');
  });
});

/** The page's way of calling Hermes: Caduceus's server in front of it, the tiered fetch of the web app, and an owner who answers the dialogs as told. */
async function openOwner(options: { steppedUp?: boolean } = {}) {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, fileRoots: [scratch] });
  const { url } = server;
  const cookie = await ownerCookie(url);
  if (options.steppedUp !== false) await stepUp(url, cookie, await addPasskey(url, cookie));
  const dialogs: ConfirmRequest[] = [];
  const answers = { confirm: true };
  const send = createTieredFetch({
    fetch: (route, init) => fetch(`${url}${route}`, { ...init, headers: { origin: url, cookie, ...Object.fromEntries(new Headers(init.headers)) } }),
    confirmer: () => async (request) => {
      dialogs.push(request);
      return answers.confirm ? { typed: request.object ?? request.label } : undefined;
    },
    withStepUp: (request) => request(),
    online: () => true,
    readOnly: () => false,
    sha256: async (text) => crypto.createHash('sha256').update(text).digest('hex'),
  });
  const read = async (route: string): Promise<unknown> => {
    const res = await fetch(`${url}${route}`, { headers: { cookie } });
    const body: unknown = await res.json().catch(() => undefined);
    if (!res.ok) throw new Error(typeof body === 'object' && body !== null && 'detail' in body ? String(body.detail) : `HTTP ${res.status}`);
    return body;
  };
  const raw = async (route: string, body: unknown, as: string = cookie) => {
    const res = await fetch(`${url}${route}`, { method: 'POST', headers: { origin: url, cookie: as, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json().catch(() => undefined)) as PolicyRefusal & { detail?: string } };
  };
  const io: WorktreeIo = { send, read };
  return { io, dialogs, answers, raw, read, url };
}

describe('a new session in a worktree', () => {
  test('the base branches come from Hermes with the default first, and the choice is offered as a Tier 1 confirmation', async () => {
    const repo = await makeRepo('bases');
    const owner = await openOwner();

    const bases = await readBaseBranches(owner.read, repo);
    expect(bases.map((branch) => branch.name).sort()).toEqual(['develop', 'main']);
    expect(bases[0]).toMatchObject({ name: 'main', isDefault: true, isRemote: false });

    const added = await addWorktree(owner.io, { cwd: repo, branch: 'feature/login', base: 'develop' });

    expect(added.kind).toBe('added');
    if (added.kind !== 'added') return;
    expect(owner.dialogs).toHaveLength(1);
    expect(owner.dialogs[0]).toMatchObject({ tier: 'T1', action: 'POST /api/git/worktree/add' });
    expect(added.worktree.branch).toBe('feature/login');
    expect(added.worktree.repoRoot).toBe(repo);
    expect(path.dirname(added.worktree.path)).toBe(path.join(repo, '.worktrees'));
    // It was cut from the base the owner chose, in a folder of its own.
    expect(fs.readFileSync(path.join(added.worktree.path, 'develop-only.txt'), 'utf8')).toBe('only here\n');
    expect(await worktreeFolders(repo)).toEqual([repo, fs.realpathSync(added.worktree.path)]);
    expect((await git(added.worktree.path, 'branch', '--show-current')).trim()).toBe('feature/login');
    expect(fs.existsSync(path.join(repo, 'develop-only.txt'))).toBe(false);
  }, 30_000);

  test('a worktree is a linked one in Hermes’s list: the session’s workspace, or a folder inside it, is "in a worktree"; the repository’s own folder is not', async () => {
    const repo = await makeRepo('badge');
    const owner = await openOwner();
    const added = await addWorktree(owner.io, { cwd: repo, branch: 'badge-check' });
    if (added.kind !== 'added') throw new Error(JSON.stringify(added));

    const trees = await readWorktrees(owner.read, repo);

    expect(trees).toEqual([
      { path: repo, branch: 'main', isMain: true, locked: false },
      { path: fs.realpathSync(added.worktree.path), branch: 'badge-check', isMain: false, locked: false },
    ]);
    expect(linkedWorktreeOf(added.worktree.path, trees)?.branch).toBe('badge-check');
    fs.mkdirSync(path.join(added.worktree.path, 'src'));
    expect(linkedWorktreeOf(path.join(added.worktree.path, 'src'), trees)?.branch).toBe('badge-check');
    // The worktree lives inside the repository's folder, and still it is the main tree's folder, not the worktree, that the repository itself is.
    expect(linkedWorktreeOf(repo, trees)).toBeUndefined();
    expect(linkedWorktreeOf(path.join(repo, 'elsewhere'), trees)).toBeUndefined();
    // A folder that is not a repository has no worktrees, so nothing in it is "in a worktree".
    const plain = fs.mkdtempSync(path.join(scratch, 'plain-'));
    expect(await readWorktrees(owner.read, plain)).toEqual([]);
    expect(linkedWorktreeOf(plain, [])).toBeUndefined();
  }, 30_000);

  test('a bad branch name is refused before anything is asked; a name that git cannot use is refused in git’s words and leaves no folder', async () => {
    const repo = await makeRepo('names');
    const owner = await openOwner();

    expect(await addWorktree(owner.io, { cwd: repo, branch: 'has space' })).toEqual({ kind: 'failed', message: expect.stringContaining('spaces') });
    expect(owner.dialogs).toEqual([]);

    expect((await addWorktree(owner.io, { cwd: repo, branch: 'twice' })).kind).toBe('added');
    // The branch is now checked out in the worktree just made, so git will not check it out again.
    const again = await addWorktree(owner.io, { cwd: repo, branch: 'twice' });
    expect(again.kind).toBe('failed');
    expect(await worktreeFolders(repo)).toHaveLength(2);
  }, 30_000);

  test('declining the confirmation makes nothing', async () => {
    const repo = await makeRepo('declined');
    const owner = await openOwner();
    owner.answers.confirm = false;

    expect(await addWorktree(owner.io, { cwd: repo, branch: 'never' })).toEqual({ kind: 'cancelled' });

    expect(await worktreeFolders(repo)).toEqual([repo]);
  });

  test('the first message of a chat that starts in the worktree makes a session whose workspace is the worktree', async () => {
    const repo = await makeRepo('session');
    const owner = await openOwner();
    const added = await addWorktree(owner.io, { cwd: repo, branch: 'chat-here' });
    if (added.kind !== 'added') throw new Error(JSON.stringify(added));
    const page = await openPage();
    const chat = createChat(page.connection, { history: page.rest, cwd: added.worktree.path });
    try {
      await chat.start();
      await chat.send('Where am I?');
      await chat.until((state) => !state.running && state.turn === undefined && state.messages.length === 2);
      expect(chat.state.messages.at(-1)?.text).toBe(DEFAULT_REPLY.join(''));
      expect(chat.state.cwd).toBe(fs.realpathSync(added.worktree.path));

      const row = (await page.rest(`/api/sessions/${chat.state.storedId}`)) as { cwd?: string };

      expect(fs.realpathSync(row.cwd!)).toBe(fs.realpathSync(added.worktree.path));
      const trees = await readWorktrees(owner.read, row.cwd!);
      expect(linkedWorktreeOf(row.cwd!, trees)?.branch).toBe('chat-here');
    } finally {
      chat.dispose();
    }
  }, 40_000);
});

describe('removing a worktree', () => {
  test('a clean one is a Tier 1 removal, and its folder and registration are gone', async () => {
    const repo = await makeRepo('clean');
    const owner = await openOwner();
    const added = await addWorktree(owner.io, { cwd: repo, branch: 'tidy' });
    if (added.kind !== 'added') throw new Error(JSON.stringify(added));
    owner.dialogs.length = 0;
    const [main, tree] = await readWorktrees(owner.read, repo);

    const removed = await removeWorktree(owner.io, { worktree: tree!, repoRoot: main!.path });

    expect(removed).toEqual({ kind: 'removed', changes: 0 });
    expect(owner.dialogs).toHaveLength(1);
    expect(owner.dialogs[0]).toMatchObject({ tier: 'T1', action: 'POST /api/git/worktree/remove' });
    expect(fs.existsSync(added.worktree.path)).toBe(false);
    expect(await worktreeFolders(repo)).toEqual([repo]);
    // The branch is the owner's work and stays.
    expect(await git(repo, 'branch', '--list', 'tidy')).toContain('tidy');
  }, 30_000);

  test('one with uncommitted changes is Tier 3: the dialog says the changes are lost and asks for the branch to be typed; declined, nothing is removed', async () => {
    const repo = await makeRepo('dirty');
    const owner = await openOwner();
    const added = await addWorktree(owner.io, { cwd: repo, branch: 'wip' });
    if (added.kind !== 'added') throw new Error(JSON.stringify(added));
    fs.writeFileSync(path.join(added.worktree.path, 'README.md'), 'Edited\n');
    fs.writeFileSync(path.join(added.worktree.path, 'notes.txt'), 'untracked\n');
    owner.dialogs.length = 0;
    const [main, tree] = await readWorktrees(owner.read, repo);

    owner.answers.confirm = false;
    expect(await removeWorktree(owner.io, { worktree: tree!, repoRoot: main!.path })).toEqual({ kind: 'cancelled' });
    expect(fs.existsSync(added.worktree.path)).toBe(true);
    expect(owner.dialogs[0]).toMatchObject({ tier: 'T3', object: 'wip', text: expect.stringContaining('2 uncommitted changes'), recoverability: { undoable: false } });

    owner.answers.confirm = true;
    const removed = await removeWorktree(owner.io, { worktree: tree!, repoRoot: main!.path });

    expect(removed).toEqual({ kind: 'removed', changes: 2 });
    expect(owner.dialogs.at(-1)).toMatchObject({ tier: 'T3', confirmLabel: 'Remove and lose the changes' });
    expect(fs.existsSync(added.worktree.path)).toBe(false);
  }, 30_000);

  test('the server refuses a forced removal that is not confirmed through Tier 3: no step-up, then no typed confirmation; and without force git keeps the changes', async () => {
    const repo = await makeRepo('refused');
    const owner = await openOwner();
    const added = await addWorktree(owner.io, { cwd: repo, branch: 'precious' });
    if (added.kind !== 'added') throw new Error(JSON.stringify(added));
    fs.writeFileSync(path.join(added.worktree.path, 'work.txt'), 'hours of work\n');
    const body = { path: repo, worktreePath: added.worktree.path, force: true };
    const remains = () => fs.readFileSync(path.join(added.worktree.path, 'work.txt'), 'utf8');

    // Not forced: the request is a Tier 1 one, and git itself refuses a worktree that has changes.
    const unforced = await owner.raw('/api/git/worktree/remove', { ...body, force: false });
    expect(unforced.status).toBe(400);
    expect(remains()).toBe('hours of work\n');

    // Forced without a step-up grant on the session.
    const plain = await openOwner({ steppedUp: false });
    const noStepUp = await plain.raw('/api/git/worktree/remove', body);
    expect(noStepUp.status).toBe(403);
    expect(noStepUp.body).toMatchObject({ error: 'step-up-required', tier: 'T3' });
    expect(remains()).toBe('hours of work\n');

    // Forced, stepped up, but nothing typed.
    const untyped = await owner.raw('/api/git/worktree/remove', body);
    expect(untyped.status).toBe(403);
    expect(untyped.body).toMatchObject({ error: 'confirmation-required', tier: 'T3' });
    expect(remains()).toBe('hours of work\n');
  }, 30_000);

  test('the repository’s own folder is never removed, and a worktree whose changes cannot be read is not removed', async () => {
    const repo = await makeRepo('guards');
    const owner = await openOwner();
    const added = await addWorktree(owner.io, { cwd: repo, branch: 'guarded' });
    if (added.kind !== 'added') throw new Error(JSON.stringify(added));
    owner.dialogs.length = 0;
    const [main, tree] = await readWorktrees(owner.read, repo);

    expect(await removeWorktree(owner.io, { worktree: main!, repoRoot: main!.path })).toEqual({ kind: 'failed', message: expect.stringContaining('not a worktree') });
    expect(await removeWorktree(owner.io, { worktree: { ...tree!, path: path.join(scratch, 'not-there') }, repoRoot: main!.path })).toEqual({ kind: 'failed', message: expect.stringContaining('could not read the changes') });

    expect(owner.dialogs).toEqual([]);
    expect(fs.existsSync(added.worktree.path)).toBe(true);
  }, 30_000);
});
