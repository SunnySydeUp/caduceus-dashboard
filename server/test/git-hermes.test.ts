import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Workspace › Git (M7 #03) through the Caduceus server, in front of the real Hermes in a throwaway HERMES_HOME. The repositories are temp
// directories made with the real `git`; the managed root is the temp directory that holds them.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
const temp: string[] = [];
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 90_000);
afterAll(async () => {
  await hermes.stop();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
  for (const folder of temp.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

/** What the routes under test answer with, as far as the tests read it. */
interface Reply {
  error?: string;
  reason?: string;
  tier?: string;
  token?: string;
  message?: string;
  detail?: string;
  ok?: boolean;
  diff?: string;
  recent?: string;
  branch?: string | null;
  ahead?: number;
  staged?: number;
  unstaged?: number;
  untracked?: number;
  files?: { path: string; staged: boolean; status: string; added: number }[];
  branches?: { name: string; checkedOut: boolean; isDefault: boolean }[];
  worktrees?: { path: string; branch: string | null; isMain: boolean }[];
  removed?: string;
  entries?: { action: string; tier: string }[];
}
interface Answer {
  status: number;
  body: Reply;
}

const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } }).trim();

/** A repository with one commit, and a bare repository as its `origin` (pushed to), inside a fresh managed root. */
function makeRepo() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-git-')));
  temp.push(root);
  const remote = path.join(root, 'remote.git');
  const repo = path.join(root, 'app');
  fs.mkdirSync(repo);
  git(root, 'init', '--bare', '-b', 'main', remote);
  git(repo, 'init', '-b', 'main');
  git(repo, 'config', 'user.email', 'owner@example.com');
  git(repo, 'config', 'user.name', 'Owner');
  git(repo, 'remote', 'add', 'origin', remote);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'one\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'first');
  git(repo, 'push', '-u', 'origin', 'main');
  return { root, repo, remote };
}

async function start(root: string) {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, fileRoots: [root] });
  const { url } = server;
  const cookie = await ownerCookie(url);
  const authenticator = await addPasskey(url, cookie);
  const call = async (method: string, route: string, body?: unknown, headers: Record<string, string> = {}): Promise<Answer> => {
    const res = await fetch(`${url}${route}`, { method, headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: (text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) : { message: text }) as Reply };
  };
  /** The page's request for a T3: the step-up, a confirmation in which `typed` is typed, and the request. */
  const confirmed = async (method: string, route: string, body: unknown, typed: string): Promise<Answer> => {
    await stepUp(url, cookie, authenticator);
    const minted = await call('POST', '/_caduceus/api/policy/confirmations', { operation: `${method} ${route}`, target: typed, typed, bodySha256: crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex') });
    return call(method, route, body, { 'x-caduceus-confirmation': String(minted.body.token) });
  };
  return { url, call, confirmed, stepUp: () => stepUp(url, cookie, authenticator) };
}

const status = (repo: string) => `/api/git/status?path=${encodeURIComponent(repo)}`;

describe('the repository behind a folder', () => {
  test('shows its branch, its counts and its changed files, and refuses a change in a folder outside the managed root', async () => {
    const { root, repo } = makeRepo();
    const elsewhere = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-git-out-')));
    temp.push(elsewhere);
    git(elsewhere, 'init', '-b', 'main');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n');
    fs.writeFileSync(path.join(repo, 'new.txt'), 'new\n');
    const { call } = await start(root);

    const answer = await call('GET', status(repo));
    const writeOutside = await call('POST', '/api/git/review/stage', { path: elsewhere, file: 'x' });

    expect(answer.body).toMatchObject({ branch: 'main', ahead: 0, unstaged: 2, untracked: 1, staged: 0 });
    expect(answer.body.files?.map((file) => file.path)).toEqual(['a.txt', 'new.txt']);
    expect(writeOutside.body).toMatchObject({ error: 'denied', reason: 'outside-roots' });
    expect((await call('POST', '/api/git/review/revert', { path: elsewhere })).body.reason).toBe('outside-roots');
  });
});

const bodyOf = (repo: string, extra: Record<string, unknown> = {}) => ({ path: repo, ...extra });
const auditOf = async (call: (m: string, r: string) => Promise<Answer>) => (await call('GET', '/_caduceus/api/audit')).body.entries ?? [];

describe('changing the repository', () => {
  test('stage and unstage are T0, a commit is a T1 that commits what is staged, and neither asks for a passkey', async () => {
    const { root, repo } = makeRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\ntwo\n');
    fs.writeFileSync(path.join(repo, 'b.txt'), 'b\n');
    const { call } = await start(root);

    expect((await call('POST', '/api/git/review/stage', bodyOf(repo, { file: 'a.txt' }))).body.ok).toBe(true);
    expect((await call('GET', status(repo))).body).toMatchObject({ staged: 1 });
    expect((await call('POST', '/api/git/review/unstage', bodyOf(repo, { file: 'a.txt' }))).body.ok).toBe(true);
    expect((await call('GET', status(repo))).body).toMatchObject({ staged: 0 });
    await call('POST', '/api/git/review/stage', bodyOf(repo, { file: 'a.txt' }));
    const committed = await call('POST', '/api/git/review/commit', bodyOf(repo, { message: 'Add a second line', push: false }));

    expect(committed.body.ok).toBe(true);
    expect(git(repo, 'log', '-1', '--pretty=%s')).toBe('Add a second line');
    // Only what was staged was committed.
    expect(git(repo, 'status', '--porcelain')).toBe('?? b.txt');
    const audit = await auditOf(call);
    expect(audit).toContainEqual(expect.objectContaining({ action: 'POST /api/git/review/commit', tier: 'T1' }));
    expect(audit.some((entry) => entry.action.includes('stage'))).toBe(false);
  });

  test('a commit that also pushes is a T3, as a push is', async () => {
    const { root, repo, remote } = makeRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), 'changed\n');
    const { call, confirmed } = await start(root);
    const body = bodyOf(repo, { message: 'Change a', push: true });

    const plain = await call('POST', '/api/git/review/commit', body);
    expect(plain.body).toMatchObject({ tier: 'T3' });
    expect(git(repo, 'log', '-1', '--pretty=%s')).toBe('first');

    expect((await confirmed('POST', '/api/git/review/commit', body, 'Change a')).body.ok).toBe(true);
    expect(git(remote, 'log', '-1', '--pretty=%s', 'main')).toBe('Change a');
  });

  test('discard is a T3 that needs the passkey and the typed name, restores tracked files and removes untracked ones', async () => {
    const { root, repo } = makeRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), 'scribble\n');
    fs.writeFileSync(path.join(repo, 'scratch.txt'), 'scratch\n');
    const { call, confirmed } = await start(root);

    const unconfirmed = await call('POST', '/api/git/review/revert', bodyOf(repo, { file: 'a.txt' }));
    expect(unconfirmed.status).toBe(403);
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('scribble\n');

    expect((await confirmed('POST', '/api/git/review/revert', bodyOf(repo, { file: 'a.txt' }), 'a.txt')).body.ok).toBe(true);
    expect((await confirmed('POST', '/api/git/review/revert', bodyOf(repo, { file: 'scratch.txt' }), 'scratch.txt')).body.ok).toBe(true);
    expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('one\n');
    expect(fs.existsSync(path.join(repo, 'scratch.txt'))).toBe(false);
    expect(await auditOf(call)).toContainEqual(expect.objectContaining({ action: 'POST /api/git/review/revert', tier: 'T3' }));
  });

  test('push is a T3 that sends the commits to the remote; one the remote rejects comes back as Hermes’s message', async () => {
    const { root, repo, remote } = makeRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), 'local\n');
    git(repo, 'commit', '-am', 'local change');
    const { call, confirmed } = await start(root);
    expect((await call('GET', status(repo))).body).toMatchObject({ ahead: 1 });

    const pushed = await confirmed('POST', '/api/git/review/push', bodyOf(repo), 'app');
    expect(pushed.body.ok).toBe(true);
    expect(git(remote, 'log', '-1', '--pretty=%s', 'main')).toBe('local change');

    // Someone else moves the remote; this clone's next push is rejected.
    const other = path.join(root, 'other');
    git(root, 'clone', remote, other);
    git(other, 'config', 'user.email', 'o@example.com');
    git(other, 'config', 'user.name', 'O');
    fs.writeFileSync(path.join(other, 'o.txt'), 'o\n');
    git(other, 'add', '.');
    git(other, 'commit', '-m', 'theirs');
    git(other, 'push');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'local again\n');
    git(repo, 'commit', '-am', 'mine');
    const rejected = await confirmed('POST', '/api/git/review/push', bodyOf(repo), 'app');
    expect(rejected.status).toBe(400);
    expect(rejected.body.detail).toMatch(/rejected|non-fast-forward|failed to push/i);
  });

  test('read-only mode stops a commit and a discard, and lets the status and a diff through', async () => {
    const { root, repo } = makeRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), 'scribble\n');
    const { call, stepUp: grant } = await start(root);
    await grant();
    await call('PUT', '/_caduceus/api/policy/read-only', { readOnly: true });

    expect((await call('POST', '/api/git/review/commit', bodyOf(repo, { message: 'x' }))).body.error).toBe('read-only');
    expect((await call('POST', '/api/git/review/revert', bodyOf(repo, { file: 'a.txt' }))).body.error).toBe('read-only');
    expect((await call('GET', status(repo))).status).toBe(200);
    expect((await call('GET', `/api/git/file-diff?path=${encodeURIComponent(repo)}&file=a.txt`)).body.diff).toContain('+scribble');
  });
});

describe('diffs and the commit message context', () => {
  test('gives the unified diff of a file and the diff and recent subjects a commit message is drafted from', async () => {
    const { root, repo } = makeRepo();
    fs.writeFileSync(path.join(repo, 'a.txt'), 'one\nadded line\n');
    const { call } = await start(root);

    const diff = await call('GET', `/api/git/review/diff?path=${encodeURIComponent(repo)}&file=a.txt`);
    const context = await call('GET', `/api/git/review/commit-context?path=${encodeURIComponent(repo)}`);

    expect(diff.body.diff).toContain('+added line');
    expect(context.body.diff).toContain('+added line');
    expect(context.body.recent).toBe('first');
  });
});

describe('branches and worktrees', () => {
  test('lists branches, switches to another, adds a worktree on a new branch and removes it: a dirty one only with force, which is a T3', async () => {
    const { root, repo } = makeRepo();
    git(repo, 'branch', 'feature');
    const { call, confirmed } = await start(root);

    const branches = await call('GET', `/api/git/branches?path=${encodeURIComponent(repo)}`);
    expect(branches.body.branches?.map((branch) => branch.name).sort()).toEqual(['feature', 'main']);
    expect((await call('POST', '/api/git/branch/switch', bodyOf(repo, { branch: 'feature' }))).body.branch).toBe('feature');
    expect(git(repo, 'branch', '--show-current')).toBe('feature');
    expect((await call('POST', '/api/git/branch/switch', bodyOf(repo, { branch: 'main' }))).status).toBe(200);

    const added = await call('POST', '/api/git/worktree/add', bodyOf(repo, { name: 'spike', branch: 'spike-branch', base: 'main' }));
    expect(added.status).toBe(200);
    const listed = await call('GET', `/api/git/worktrees?path=${encodeURIComponent(repo)}`);
    const tree = listed.body.worktrees?.find((worktree) => worktree.branch === 'spike-branch');
    expect(listed.body.worktrees?.length).toBe(2);
    expect(tree).toBeDefined();

    fs.writeFileSync(path.join(tree!.path, 'dirty.txt'), 'wip\n');
    const refused = await call('POST', '/api/git/worktree/remove', bodyOf(repo, { worktreePath: tree!.path, force: false }));
    expect(refused.status).toBe(400);
    expect(fs.existsSync(tree!.path)).toBe(true);
    const forcedUnconfirmed = await call('POST', '/api/git/worktree/remove', bodyOf(repo, { worktreePath: tree!.path, force: true }));
    expect(forcedUnconfirmed.body).toMatchObject({ tier: 'T3' });
    expect((await confirmed('POST', '/api/git/worktree/remove', bodyOf(repo, { worktreePath: tree!.path, force: true }), 'spike')).body.removed).toBeDefined();
    expect(fs.existsSync(tree!.path)).toBe(false);
  });
});
