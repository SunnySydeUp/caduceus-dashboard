import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GATEWAY_METHODS } from '@caduceus/contracts/policy/gateway';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createProjectActions, type ProjectActions } from '../../web/src/modules/work/projects-actions.ts';
import { scanFolder } from '../../web/src/modules/work/projects-scan.ts';
import { boardSlugs, gitSentence, linkedBoards, withOwnedProjects, parseDocText, parseGitSummary, parseProjectTree, parseRecentCommits, projectTasks, repoDocs } from '../../web/src/modules/work/projects-model.ts';
import type { ConfirmRequest } from '../../web/src/palette.ts';
import { seedSession } from './fixtures/seed-session.ts';
import { openGatewayConnection, type TestGatewayConnection } from './fixtures/gateway-client.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';

// Work › Projects (M3 #10): Hermes's projects tree across profiles, creating, renaming and activating a project, discovering repositories, and the
// overview's git summary and documents, all read from a real Hermes in a throwaway HERMES_HOME through the Caduceus server. The page's own model and
// action code (`web/src/modules/work/projects-*.ts`) is run over what Hermes really answers. The dialogs are the web app's: here a stand-in answers.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
let page: TestGatewayConnection | undefined;
const folders: string[] = [];
const hermesCli = (...args: string[]) => hermes.cli(...args);

beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  await hermesCli('profile', 'create', 'work');
}, 90_000);
afterAll(() => hermes.stop());
afterEach(async () => {
  page?.connection.close();
  page = undefined;
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' });

/** A git repository in a temp folder, with a commit for each subject (the first also adds `README.md`). */
function makeRepo(name: string, subjects: string[] = ['Start the project']): string {
  const parent = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-projects-')));
  folders.push(parent);
  const repo = path.join(parent, name);
  fs.mkdirSync(repo);
  git(repo, 'init', '--initial-branch=main');
  fs.writeFileSync(path.join(repo, 'README.md'), `# ${name}\n\nA **small** project.\n`);
  git(repo, 'add', '-A');
  subjects.forEach((subject, index) => {
    fs.writeFileSync(path.join(repo, `change-${index}.txt`), `${subject}\n`);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', subject);
  });
  return repo;
}

interface Owner {
  actions: ProjectActions;
  /** What the confirmation dialog was asked, in order. */
  dialogs: ConfirmRequest[];
  /** What the owner answers it (they confirm unless this is set to false). */
  answer: { confirm: boolean };
  /** Reads a Hermes route through Caduceus, as the page does. */
  read(route: string): Promise<unknown>;
}

async function openOwner(): Promise<Owner> {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const cookie = await ownerCookie(server.url);
  page = openGatewayConnection(server.url, cookie);
  await page.until((status) => status.state === 'connected');
  const dialogs: ConfirmRequest[] = [];
  const answer = { confirm: true };
  const actions = createProjectActions({
    connection: page.connection,
    confirm: async (request) => {
      dialogs.push(request);
      return answer.confirm;
    },
    readOnly: () => false,
  });
  return { actions, dialogs, answer, read: (route) => page!.rest(route) };
}

describe('the projects tree', () => {
  test('lists the projects of every profile as Hermes builds them: a project made in one profile is there beside another profile’s, with its folder as a repository', async () => {
    const site = makeRepo('site');
    const docs = makeRepo('docs');
    // Hermes builds the tree from each profile's sessions, so a profile with none has no projects in it: one each.
    await seedSession(hermes.home, 'tree-default', [{ role: 'user', content: 'hello' }]);
    await seedSession(path.join(hermes.home, 'profiles', 'work'), 'tree-work', [{ role: 'user', content: 'hello' }]);
    const owner = await openOwner();

    const made = await owner.actions.create('default', { name: 'Site', folder: site });
    const other = await owner.actions.create('work', { name: 'Docs', folder: docs });
    expect(made.kind).toBe('created');
    expect(other.kind).toBe('created');

    const tree = parseProjectTree(await owner.read('/api/profiles/projects/tree'));
    expect(tree.errors).toEqual([]);
    const named = tree.projects.filter((project) => !project.isAuto && !project.isHome);
    expect(named.map((project) => [project.name, project.path]).sort()).toEqual([
      ['Docs', docs],
      ['Site', site],
    ]);
    expect(named.find((project) => project.name === 'Site')!.repos.map((repo) => repo.path)).toEqual([site]);
  });
});

/** The profile's projects as Hermes lists them, read through the gateway the page uses. */
const hermesProjects = async (profile: string, only: RegExp = /./) => {
  const answer = await page!.connection.client.request<{ projects: { id: string; name: string; primary_path: string | null }[]; active_id: string | null }>('projects.list', { profile });
  // The Hermes of this file is shared by its tests, so a test reads the projects it made.
  return { ...answer, projects: answer.projects.filter((project) => only.test(project.name)) };
};

describe('a profile with no sessions', () => {
  test('has its projects missing from Hermes’s tree, so the page adds the profile’s own projects to it', async () => {
    await hermesCli('profile', 'create', 'fresh');
    const repo = makeRepo('fresh-site');
    const owner = await openOwner();
    const made = await owner.actions.create('fresh', { name: 'Fresh site', folder: repo });
    if (made.kind !== 'created') throw new Error(JSON.stringify(made));

    const tree = parseProjectTree(await owner.read('/api/profiles/projects/tree'));
    expect(tree.projects.some((project) => project.id === made.id)).toBe(false);
    const owned = await owner.actions.list('fresh');
    const merged = withOwnedProjects(tree.projects, owned.projects);
    expect(merged.find((project) => project.id === made.id)).toMatchObject({ name: 'Fresh site', path: repo, isAuto: false, sessionCount: 0, repos: [{ path: repo, label: 'fresh-site' }] });
    // A project the tree already has is not added twice.
    expect(withOwnedProjects(merged, owned.projects)).toHaveLength(merged.length);
  });
});

describe('creating, renaming and activating a project', () => {
  test('are Tier 1 gateway calls the owner confirms: declining sends nothing, Hermes holds what was confirmed, and read-only mode stops them before the dialog', async () => {
    // The policy map is the contract: create, rename (update), activate (set_active) and add-folder are T1; deleting a project is T2.
    expect(['projects.create', 'projects.update', 'projects.set_active'].map((method) => GATEWAY_METHODS[method]!.tier)).toEqual(['T1', 'T1', 'T1']);

    const trip = makeRepo('trip');
    const owner = await openOwner();

    owner.answer.confirm = false;
    expect((await owner.actions.create('default', { name: 'Trip', folder: trip })).kind).toBe('cancelled');
    expect((await hermesProjects('default', /Trip|Blocked|Nothing/)).projects).toEqual([]);

    owner.answer.confirm = true;
    const created = await owner.actions.create('default', { name: '  Trip  ', folder: trip });
    if (created.kind !== 'created') throw new Error(JSON.stringify(created));
    expect(owner.dialogs.at(-1)).toMatchObject({ tier: 'T1', action: 'projects.create', label: 'Create the project “Trip”?', profile: 'default' });
    expect((await hermesProjects('default', /Trip|Blocked|Nothing/)).projects).toEqual([expect.objectContaining({ id: created.id, name: 'Trip', primary_path: trip })]);

    expect(await owner.actions.rename('default', { id: created.id, name: 'Trip' }, 'Trip 2026')).toEqual({ kind: 'done' });
    expect(owner.dialogs.at(-1)).toMatchObject({ tier: 'T1', action: 'projects.update', label: 'Rename “Trip”?' });
    expect(await owner.actions.activate('default', { id: created.id, name: 'Trip 2026' })).toEqual({ kind: 'done' });
    expect(owner.dialogs.at(-1)).toMatchObject({ tier: 'T1', action: 'projects.set_active', label: 'Make “Trip 2026” the active project?' });
    const afterwards = await hermesProjects('default', /Trip|Blocked|Nothing/);
    expect(afterwards.projects[0]!.name).toBe('Trip 2026');
    expect(afterwards.active_id).toBe(created.id);
    expect((await owner.actions.list('default')).activeId).toBe(created.id);

    expect(await owner.actions.activate('default', undefined)).toEqual({ kind: 'done' });
    expect((await hermesProjects('default', /Trip|Blocked|Nothing/)).active_id).toBeNull();

    // Hermes refuses a name it cannot use, in its own words, and the dialog was still the owner's.
    const refused = await owner.actions.rename('default', { id: 'p_missing', name: 'Nothing' }, 'Nothing else');
    expect(refused).toEqual({ kind: 'failed', message: expect.stringMatching(/no such project/i) });

    const dialogsBefore = owner.dialogs.length;
    const readOnlyActions = createProjectActions({ connection: page!.connection, confirm: async () => true, readOnly: () => true });
    expect(await readOnlyActions.create('default', { name: 'Blocked', folder: trip })).toEqual({ kind: 'failed', message: 'Read-only mode is on: Caduceus is not changing anything in Hermes.' });
    expect(owner.dialogs).toHaveLength(dialogsBefore);
    expect((await hermesProjects('default', /Trip|Blocked|Nothing/)).projects.map((project) => project.name)).toEqual(['Trip 2026']);
  });
});

describe('discovering repositories', () => {
  test('lists the repositories Hermes finds in the folders it scans, marks one that is already a project, and adds the chosen ones as projects after one confirmation', async () => {
    const found = makeRepo('found-one');
    const second = path.join(path.dirname(found), 'found-two');
    fs.cpSync(found, second, { recursive: true });
    const known = path.join(path.dirname(found), 'known');
    fs.cpSync(found, known, { recursive: true });
    // Hermes scans the folders its `desktop.repo_scan_roots` names (none by default).
    const saved = await hermes.backend.fetch('/api/config/raw', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ yaml_text: `desktop:\n  repo_scan_roots:\n    - ${JSON.stringify(path.dirname(found))}\n` }) });
    expect(saved.ok).toBe(true);
    const owner = await openOwner();
    await owner.actions.create('default', { name: 'Known already', folder: known });

    const candidates = await owner.actions.discover('default');
    const roots = candidates.map((candidate) => candidate.path).filter((root) => root.startsWith(path.dirname(found)));
    expect(roots.sort()).toEqual([found, known, second].sort());
    expect(candidates.find((candidate) => candidate.path === found)).toMatchObject({ label: 'found-one', sessions: 0 });
    expect((await owner.actions.list('default')).folders.get(known)).toBe('Known already');

    const dialogs = owner.dialogs.length;
    const chosen = candidates.filter((candidate) => candidate.path === found || candidate.path === second);
    expect(await owner.actions.addRepos('default', chosen)).toEqual({ kind: 'added', made: 2, failed: [] });
    expect(owner.dialogs).toHaveLength(dialogs + 1);
    expect(owner.dialogs.at(-1)).toMatchObject({ tier: 'T1', label: 'Add 2 repositories as projects?', profile: 'default' });
    const listed = await hermesProjects('default', /found-/);
    expect(listed.projects.map((project) => [project.name, project.primary_path]).sort()).toEqual([
      ['found-one', found],
      ['found-two', second],
    ]);

    owner.answer.confirm = false;
    expect(await owner.actions.addRepos('default', chosen)).toEqual({ kind: 'cancelled' });
    expect(await owner.actions.addRepos('default', [])).toEqual({ kind: 'failed', message: 'Choose at least one repository.' });
    expect((await hermesProjects('default', /found-/)).projects).toHaveLength(2);
  });
});

describe('looking in a folder for repositories', () => {
  test('asks Hermes about the folders inside the one chosen and keeps those that are repositories themselves, not folders inside one and not hidden ones', async () => {
    const alpha = makeRepo('alpha');
    const parent = path.dirname(alpha);
    const beta = path.join(parent, 'beta');
    fs.cpSync(alpha, beta, { recursive: true });
    fs.mkdirSync(path.join(parent, 'plain'));
    fs.mkdirSync(path.join(alpha, 'src'));
    fs.mkdirSync(path.join(parent, '.hidden-repo'));
    fs.cpSync(alpha, path.join(parent, '.hidden-repo', 'inner'), { recursive: true });
    const owner = await openOwner();

    const scan = await scanFolder(parent, owner.read);
    expect(scan.repos.map((repo) => [repo.label, repo.path])).toEqual([
      ['alpha', alpha],
      ['beta', beta],
    ]);
    expect(scan.truncated).toBe(false);
    // Inside a repository the folders are not repositories; a missing folder and a file are told apart.
    expect((await scanFolder(alpha, owner.read)).repos).toEqual([]);
    expect((await scanFolder(path.join(parent, 'nowhere'), owner.read)).problem).toMatch(/does not find/);
    expect((await scanFolder(path.join(alpha, 'README.md'), owner.read)).problem).toMatch(/is a file/);
  });
});

describe('a project’s overview', () => {
  test('reads the repository’s branch, how far it is from its upstream, its changed files, its recent commits, its README and docs, and a folder that is no repository says so', async () => {
    const repo = makeRepo('overview', ['Add the parser', 'Fix the parser', 'Document the parser']);
    fs.mkdirSync(path.join(repo, 'docs'));
    fs.writeFileSync(path.join(repo, 'docs', 'guide.md'), '# Guide\n\n- one\n- two\n');
    fs.writeFileSync(path.join(repo, 'docs', 'notes.txt'), 'not markdown');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'Add the guide');
    // An upstream, then one commit it does not have and one file that is not committed.
    const upstream = path.join(path.dirname(repo), 'upstream.git');
    git(path.dirname(repo), 'init', '--bare', '--initial-branch=main', upstream);
    git(repo, 'remote', 'add', 'origin', upstream);
    git(repo, 'push', '-u', 'origin', 'main');
    fs.writeFileSync(path.join(repo, 'ahead.txt'), 'ahead');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-m', 'Work not pushed yet');
    fs.writeFileSync(path.join(repo, 'change-0.txt'), 'edited');
    fs.writeFileSync(path.join(repo, 'new.txt'), 'new');
    const owner = await openOwner();
    const ask = (route: string, folder: string) => owner.read(`${route}?path=${encodeURIComponent(folder)}`);

    const git_ = parseGitSummary(await ask('/api/git/status', repo));
    expect(git_).toMatchObject({ branch: 'main', defaultBranch: 'main', detached: false, ahead: 1, behind: 0, dirty: 2, staged: 0, untracked: 1, conflicted: 0 });
    expect(gitSentence(git_!)).toBe('1 ahead · 2 changed files');
    expect(parseRecentCommits(await ask('/api/git/review/commit-context', repo)).slice(0, 5)).toEqual(['Work not pushed yet', 'Add the guide', 'Document the parser', 'Fix the parser', 'Add the parser']);

    const docs = repoDocs(await ask('/api/fs/list', repo), await ask('/api/fs/list', path.join(repo, 'docs')));
    expect(docs.map((doc) => [doc.where, doc.path])).toEqual([
      ['README.md', path.join(repo, 'README.md')],
      ['docs/guide.md', path.join(repo, 'docs', 'guide.md')],
    ]);
    expect(parseDocText(await ask('/api/fs/read-text', docs[0]!.path))).toEqual({ kind: 'text', text: '# overview\n\nA **small** project.\n', truncated: false });
    expect(parseDocText(await ask('/api/fs/read-text', path.join(repo, 'docs', 'notes.txt')))).toMatchObject({ kind: 'text' });
    expect(parseDocText({ error: 'x' })).toEqual({ kind: 'unreadable' });

    const plain = path.join(path.dirname(repo), 'plain');
    fs.mkdirSync(plain);
    expect(parseGitSummary(await ask('/api/git/status', plain))).toBeUndefined();
    expect(repoDocs(await ask('/api/fs/list', plain), await ask('/api/fs/list', path.join(plain, 'docs')))).toEqual([]);
  });

  test('finds the boards Hermes links to the project and the tasks that name it, on those boards and on others', async () => {
    const repo = makeRepo('linked');
    const owner = await openOwner();
    const { id } = (await owner.actions.create('default', { name: 'Linked', folder: repo })) as { id: string };
    const post = async (route: string, body: unknown) => {
      const res = await hermes.backend.fetch(`/api/plugins/kanban${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      expect(res.ok, `${route}: HTTP ${res.status}`).toBe(true);
    };
    await post('/boards', { slug: 'linked-board', name: 'Linked board', project_id: id });
    await post('/boards', { slug: 'other-board', name: 'Other board' });
    await post('/tasks?board=linked-board', { title: 'On the linked board' });
    await post('/tasks?board=other-board', { title: 'Names the project', project_id: id });
    await post('/tasks?board=other-board', { title: 'Unrelated' });

    const boards = await owner.read('/api/plugins/kanban/boards');
    expect(boardSlugs(boards)).toEqual(expect.arrayContaining(['linked-board', 'other-board']));
    expect(linkedBoards(boards, id)).toEqual([{ slug: 'linked-board', name: 'Linked board' }]);
    const tasks = [
      ...projectTasks(await owner.read('/api/plugins/kanban/board?board=linked-board'), id, 'linked-board'),
      ...projectTasks(await owner.read('/api/plugins/kanban/board?board=other-board'), id, 'other-board'),
    ];
    expect(tasks.map((task) => [task.title, task.board])).toEqual([
      ['On the linked board', 'linked-board'],
      ['Names the project', 'other-board'],
    ]);
    expect(projectTasks({ nonsense: true }, id, 'x')).toEqual([]);
  });
});
