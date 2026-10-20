import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { runCreatePlan, type BriefTransport, type CreateOutcome } from '../../web/src/modules/work/brief-save.ts';
import { createPlan, editRequest, fieldsOfTask, lockedChanges, newBriefFields, type BriefFields, type CreateOptions, type DispatchMode } from '../../web/src/modules/work/brief-task.ts';
import { emptySections, type BriefSections } from '../../web/src/modules/work/brief.ts';
import { folderProblem, parentFolder, parseBranches, parseGitRoot, parseListing } from '../../web/src/modules/work/workspace-model.ts';
import { parseTaskDetail } from '../../web/src/modules/work/task-model.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// The Brief editor (M3 #07) in front of the real Hermes: what creating and editing a task writes, and what the task page reads back.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
}, 60_000);
afterAll(() => hermes.stop());
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

async function start() {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, hermesInstallDir: hermes.install.dir });
  const cookie = await ownerCookie(server.url);
  return { url: server.url, cookie };
}

interface Reply {
  status: number;
  body: unknown;
}

/** What Caduceus and Hermes answer to a create: the new task's id (the CLI route) or the task (the REST route). */
const idOf = (body: unknown): string => {
  const record = body as { id?: string; task?: { id: string } };
  return record.id ?? record.task!.id;
};

/** The task row Hermes keeps, as the fields these tests read. */
interface TaskRow {
  title: string;
  body: string | null;
  status: string;
  assignee: string | null;
  priority: number;
  workspace_kind: string;
  workspace_path: string | null;
  branch_name: string | null;
  project_id: string | null;
  max_runtime_seconds: number | null;
  max_retries: number | null;
  skills: string[] | null;
  model_override: string | null;
  provider_override: string | null;
  reasoning_effort: string | null;
  goal_mode: boolean;
  goal_max_turns: number | null;
  completion_contract: string | null;
  created_by: string | null;
}

/** Sends a JSON request the way the page does: with the owner's cookie, to Caduceus. */
async function send(url: string, cookie: string, method: string, route: string, body?: unknown): Promise<Reply> {
  const response = await fetch(`${url}${route}`, { method, headers: { cookie, origin: url, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, body: await response.json().catch(() => undefined) };
}

const detail = async (url: string, cookie: string, id: string, board = ''): Promise<TaskRow> => ((await send(url, cookie, 'GET', `/api/plugins/kanban/tasks/${id}${board}`)).body as { task: TaskRow }).task;

/** Sends what the editor sends, the way the page does: to Caduceus, with the owner's cookie. Every step answers in words, like `fetchTiered`'s runner. */
function transport(url: string, cookie: string): BriefTransport {
  return {
    async send(request) {
      const reply = await send(url, cookie, request.method, request.path, request.body);
      if (reply.status >= 200 && reply.status < 300) return { kind: 'done', body: reply.body };
      const message = (reply.body as { message?: string; detail?: string } | undefined)?.message ?? (reply.body as { detail?: string } | undefined)?.detail ?? `HTTP ${reply.status}`;
      return { kind: 'failed', message };
    },
  };
}

/** Saves `fields` as a new task in `mode` through the plan, then reads the task back the way the task page does. */
async function save(fields: BriefFields, mode: Exclude<DispatchMode, 'schedule'> = 'queue', options: CreateOptions = {}) {
  const { url, cookie } = await start();
  const plan = createPlan(fields, mode, options);
  const outcome: CreateOutcome = await runCreatePlan(plan, transport(url, cookie));
  if (outcome.kind !== 'done') throw new Error(JSON.stringify(outcome));
  const query = options.board ? `?board=${options.board}` : '';
  const read = parseTaskDetail((await send(url, cookie, 'GET', `/api/plugins/kanban/tasks/${outcome.id}${query}`)).body);
  return { url, cookie, plan, id: outcome.id, outcome, detail: read, readBack: fieldsOfTask(read.task, read.links.parents) };
}

const sectioned = (text: Partial<BriefSections>): BriefFields['brief'] => ({ kind: 'sections', sections: { ...emptySections(), ...text } });

describe('every field of the Brief is written to Hermes and read back on the task page', () => {
  const base = newBriefFields();
  // Each case is one field set on its own; Hermes keeps it and the page's reading of it gives the same field again.
  const cases: [name: string, fields: BriefFields, via: 'rest' | 'cli'][] = [
    ['title and the six sections', { ...base, title: 'Ship the export', brief: sectioned({ goal: 'Ship it.', context: 'Rows drop.', references: '- spec', constraints: 'No deps.', expected: 'A PR.', scope: 'Read only.' }) }, 'rest'],
    ['a brief that is one free section', { ...base, title: 'Free', brief: { kind: 'free', text: 'Just do it.\n\n## Acceptance criteria\nIt works.' } }, 'rest'],
    ['assignee', { ...base, title: 'A', assignee: 'coder' }, 'rest'],
    ['priority', { ...base, title: 'P', priority: 3 }, 'rest'],
    ['model and provider', { ...base, title: 'M', model: 'gpt-5', provider: 'openai' }, 'rest'],
    ['reasoning effort', { ...base, title: 'R', reasoningEffort: 'high' }, 'rest'],
    ['skills', { ...base, title: 'S', skills: ['github-code-review', 'translation'] }, 'rest'],
    ['workspace: a folder', { ...base, title: 'D', workspace: { kind: 'dir', path: '/tmp/caduceus-brief-dir' } }, 'rest'],
    ['workspace: a worktree in a repository', { ...base, title: 'W', workspace: { kind: 'worktree', path: '/tmp/caduceus-brief-wt' } }, 'rest'],
    ['maximum run time', { ...base, title: 'T', maxRuntime: '2h' }, 'rest'],
    ['goal mode with its turns', { ...base, title: 'G', goalMode: true, goalMaxTurns: 7 }, 'rest'],
    ['branch name', { ...base, title: 'B', workspace: { kind: 'worktree', branch: 'wt/export' } }, 'cli'],
    ['maximum retries', { ...base, title: 'Re', maxRetries: 4 }, 'cli'],
    ['completion contract: a repository', { ...base, title: 'C', completionContract: 'acme/widgets' }, 'cli'],
    ['completion contract: a pull request', { ...base, title: 'C2', completionContract: 'https://github.com/acme/widgets/pull/12' }, 'cli'],
    ['reasoning effort on a task the CLI made', { ...base, title: 'RC', reasoningEffort: 'low', maxRetries: 2 }, 'cli'],
  ];

  test.each(cases)('%s', async (_name, fields, via) => {
    const { plan, readBack, detail: read } = await save(fields);

    expect(plan.via).toBe(via);
    expect(readBack).toEqual(fields);
    expect(read.task.createdBy).toBe('dashboard');
  });

  test('a task that waits for a parent is read back with it', async () => {
    const parent = await save({ ...base, title: 'Parent' });
    const child = await save({ ...base, title: 'Child', parents: [parent.id] });

    expect(child.readBack.parents).toEqual([parent.id]);
    expect(child.detail.task.status).toBe('todo');
  });
});

describe('the workspace pickers read Hermes’s file and git endpoints', () => {
  let repo: string;
  beforeAll(() => {
    repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-brief-ws-')));
    execFileSync('git', ['init', '-q', '-b', 'main', repo]);
    execFileSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=x', 'commit', '-q', '--allow-empty', '-m', 'first'], { cwd: repo });
    execFileSync('git', ['branch', 'feat/export'], { cwd: repo });
    fs.mkdirSync(path.join(repo, 'src'));
    fs.mkdirSync(path.join(repo, 'docs'));
    fs.writeFileSync(path.join(repo, 'README.md'), 'hi');
  });
  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  const read = async (route: string) => {
    const { url, cookie } = await start();
    return (await send(url, cookie, 'GET', route)).body;
  };

  test('a folder lists its sub-folders for the directory picker, and says how many files it holds', async () => {
    const listing = parseListing(await read(`/api/fs/list?path=${encodeURIComponent(repo)}`));

    expect(listing).toEqual({ kind: 'folder', folders: [{ name: 'docs', path: path.join(repo, 'docs') }, { name: 'src', path: path.join(repo, 'src') }], files: 1 });
    expect(parentFolder(path.join(repo, 'src'))).toBe(repo);
    expect(parentFolder('/Users')).toBe('/');
    expect(parentFolder('/')).toBeUndefined();
  });

  test('a folder that is not there, or is a file, is told apart before the task is saved', async () => {
    const missing = parseListing(await read(`/api/fs/list?path=${encodeURIComponent(path.join(repo, 'nothere'))}`));
    const file = parseListing(await read(`/api/fs/list?path=${encodeURIComponent(path.join(repo, 'README.md'))}`));

    expect(missing).toEqual({ kind: 'missing' });
    expect(folderProblem(missing)).toContain('does not find');
    expect(file).toEqual({ kind: 'not-a-folder' });
    expect(folderProblem(file)).toContain('is a file');
    expect(folderProblem(parseListing(await read(`/api/fs/list?path=${encodeURIComponent(repo)}`)))).toBeUndefined();
  });

  test('a repository’s branches come with the default first; a folder outside any repository has none', async () => {
    const branches = parseBranches(await read(`/api/git/branches?path=${encodeURIComponent(path.join(repo, 'src'))}`));

    expect(branches).toEqual([
      { name: 'main', isDefault: true, isRemote: false, checkedOut: true },
      { name: 'feat/export', isDefault: false, isRemote: false, checkedOut: false },
    ]);
    expect(parseBranches(await read(`/api/git/branches?path=${encodeURIComponent(os.tmpdir())}`))).toEqual([]);
    expect(parseGitRoot(await read(`/api/fs/git-root?path=${encodeURIComponent(path.join(repo, 'src'))}`))).toBe(repo);
    expect(parseGitRoot(await read(`/api/fs/git-root?path=${encodeURIComponent(os.tmpdir())}`))).toBeUndefined();
  });
});

describe('each dispatch mode leaves the task in the state work model §2.1 gives it', () => {
  const task = { ...newBriefFields(), title: 'Mode' };

  test.each([
    ['Save draft, waiting in Triage for a specifier', 'draft', { draft: 'triage' as const }, 'triage'],
    ['Save draft, waiting in Todo', 'draft', { draft: 'todo' as const }, 'todo'],
    ['Queue', 'queue', {}, 'ready'],
  ])('%s', async (_name, mode, options, status) => {
    const { detail: read } = await save(task, mode as 'draft' | 'queue', options);

    expect(read.task.status).toBe(status);
  });

  test('a draft saved through the CLI route waits in Todo too, and its first request never makes it ready', async () => {
    const { detail: read, plan } = await save({ ...task, maxRetries: 2 }, 'draft', { draft: 'todo' });

    expect(plan.via).toBe('cli');
    expect(plan.create.body).toMatchObject({ triage: true });
    expect(read.task.status).toBe('todo');
  });

  test('Run now makes it ready and then nudges the dispatcher, once, after the task exists', async () => {
    const { url, cookie } = await start();
    const sent: string[] = [];
    const real = transport(url, cookie);
    const recording: BriefTransport = { send: (request, options) => (sent.push(`${request.method} ${request.path.split('?')[0]}`), real.send(request, options)) };

    // Nobody is assigned, so the dispatcher has no worker to start and no model is called: it still reports what it saw.
    const outcome = await runCreatePlan(createPlan(task, 'run-now'), recording);

    expect(outcome.kind).toBe('done');
    const id = (outcome as { id: string }).id;
    expect(sent).toEqual(['POST /api/plugins/kanban/tasks', 'POST /api/plugins/kanban/dispatch']);
    expect((await detail(url, cookie, id)).status).toBe('ready');
  });

  test('a step after the create that fails says the task was made, and which one', async () => {
    const { url, cookie } = await start();
    const real = transport(url, cookie);
    const failing: BriefTransport = { send: (request, options) => (request.path.includes('/dispatch') ? Promise.resolve({ kind: 'failed', message: 'HTTP 500' }) : real.send(request, options)) };

    const outcome = await runCreatePlan(createPlan(task, 'run-now'), failing);

    expect(outcome).toMatchObject({ kind: 'failed', message: expect.stringContaining('The task was made') });
    expect((await detail(url, cookie, (outcome as { id: string }).id)).status).toBe('ready');
  });
});

describe('editing a task that exists uses the same editor and sends only what changed', () => {
  const original: BriefFields = { ...newBriefFields(), title: 'Edit me', brief: sectioned({ goal: 'First goal.', context: 'Old context.' }), assignee: 'coder', priority: 1, model: 'gpt-5', provider: 'openai', reasoningEffort: 'low', maxRetries: 3, skills: ['translation'] };

  async function edit(change: (fields: BriefFields) => BriefFields) {
    const made = await save(original);
    const changed = change(made.readBack);
    const request = editRequest(made.detail.task, changed);
    const reply = request && (await send(made.url, made.cookie, request.method, request.path, request.body));
    const after = parseTaskDetail((await send(made.url, made.cookie, 'GET', `/api/plugins/kanban/tasks/${made.id}`)).body);
    return { request, reply, changed, after, readBack: fieldsOfTask(after.task, after.links.parents), made };
  }

  test('title, brief sections, assignee, priority, model and reasoning are written, and read back as edited', async () => {
    const { request, reply, changed, readBack } = await edit((fields) => ({
      ...fields,
      title: 'Edited',
      brief: sectioned({ goal: 'Second goal.', constraints: 'New limit.' }),
      assignee: 'reviewer',
      priority: 5,
      model: 'claude-opus',
      provider: 'anthropic',
      reasoningEffort: 'high',
    }));

    expect(reply?.status).toBe(200);
    expect(request?.body).toMatchObject({ title: 'Edited', assignee: 'reviewer', priority: 5, model_override: 'claude-opus', provider_override: 'anthropic', reasoning_effort: 'high' });
    expect(readBack).toEqual(changed);
  });

  test('clearing the model and the reasoning effort gives the task back to its profile’s', async () => {
    const { reply, readBack } = await edit((fields) => ({ ...fields, model: '', provider: '', reasoningEffort: '' }));

    expect(reply?.status).toBe(200);
    expect(readBack).toMatchObject({ model: '', provider: '', reasoningEffort: '' });
  });

  test('nothing changed sends nothing, and a body the Brief did not change is never rewritten', async () => {
    const { request } = await edit((fields) => fields);
    expect(request).toBeUndefined();

    const cliBody = 'Rotate the keys.\n\nTell me when done.';
    const { url, cookie } = await start();
    const created = await send(url, cookie, 'POST', '/api/plugins/kanban/tasks', { title: 'CLI style', body: cliBody });
    const read = parseTaskDetail((await send(url, cookie, 'GET', `/api/plugins/kanban/tasks/${idOf(created.body)}`)).body);
    const fields = fieldsOfTask(read.task);
    expect(fields.brief).toEqual({ kind: 'free', text: cliBody });
    expect(editRequest(read.task, { ...fields, title: 'Renamed' })?.body).toEqual({ title: 'Renamed' });
  });

  test('the fields Hermes cannot change after creation are named when the form would change them', async () => {
    const made = await save(original);

    expect(lockedChanges(made.detail.task, made.readBack)).toEqual([]);
    expect(lockedChanges(made.detail.task, { ...made.readBack, maxRetries: 9, skills: [], workspace: { kind: 'dir', path: '/tmp' } })).toEqual(['workspace', 'skills', 'maxRetries']);
  });
});

describe('a project and a board scope where the task is made', () => {
  test('a project anchors a worktree under its repository, and the project reads back', async () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-brief-repo-'));
    try {
      execFileSync('git', ['init', '-q', repo]);
      await hermes.cli('project', 'create', 'Brief site', repo);
      const { url, cookie } = await start();
      const listed = (await send(url, cookie, 'GET', '/api/plugins/kanban/projects')).body as { projects: { id: string; slug: string }[] };
      const project = listed.projects.find((candidate) => candidate.slug === 'brief-site')!;

      const { readBack, detail: read } = await save({ ...newBriefFields(), title: 'In a project', workspace: { kind: 'worktree' }, project: project.id });

      expect(readBack.project).toBe(project.id);
      expect(read.task.workspaceKind).toBe('worktree');
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  test('a task made through the CLI route lands on the board named, and not on the current one', async () => {
    await hermes.cli('kanban', 'boards', 'create', 'brief-other');

    const { id, url, cookie } = await save({ ...newBriefFields(), title: 'On another board', maxRetries: 2 }, 'queue', { board: 'brief-other' });

    expect((await send(url, cookie, 'GET', `/api/plugins/kanban/tasks/${id}?board=brief-other`)).status).toBe(200);
    expect((await send(url, cookie, 'GET', `/api/plugins/kanban/tasks/${id}`)).status).toBe(404);
  });

  test('a profile scopes the CLI command: the task is made, with the profile’s own settings, on the shared board', async () => {
    await hermes.cli('profile', 'create', 'brief-profile');

    const { readBack } = await save({ ...newBriefFields(), title: 'From a profile tab', assignee: 'brief-profile', maxRetries: 2 }, 'queue', { profile: 'brief-profile' });

    expect(readBack.assignee).toBe('brief-profile');
  });
});

describe('creating a task through the Caduceus server, with the fields the Kanban REST API cannot set', () => {
  test('branch, retries and completion contract reach Hermes through `hermes kanban create`, and the brief arrives as typed', async () => {
    const { url, cookie } = await start();
    const body = '## Goal\n\nShip it: $(whoami) `date` "quoted"\n';

    const made = await send(url, cookie, 'POST', '/_caduceus/api/work/tasks', {
      title: 'Ship the export',
      body,
      workspace_kind: 'worktree',
      branch_name: 'wt/export',
      max_retries: 3,
      completion_contract: 'acme/widgets',
      priority: 2,
      skills: ['github-code-review'],
      goal_mode: true,
      goal_max_turns: 7,
      model_override: 'gpt-5',
      provider_override: 'openai',
      max_runtime_seconds: 7200,
    });

    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const task = await detail(url, cookie, idOf(made.body));
    expect(task).toMatchObject({
      title: 'Ship the export',
      body,
      status: 'ready',
      workspace_kind: 'worktree',
      branch_name: 'wt/export',
      max_retries: 3,
      completion_contract: 'acme/widgets',
      priority: 2,
      skills: ['github-code-review'],
      goal_mode: true,
      goal_max_turns: 7,
      model_override: 'gpt-5',
      provider_override: 'openai',
      max_runtime_seconds: 7200,
      created_by: 'dashboard',
    });
  });
});

describe('the create route is a fixed command line, never a shell', () => {
  test('a title that looks like options and shell syntax is one title, a profile and a board scope the command, and Hermes’s own refusal is passed on', async () => {
    const { url, cookie } = await start();
    const title = '--assignee=evil $(touch /tmp/caduceus-pwned) `id` ; "x"';

    const made = await send(url, cookie, 'POST', '/_caduceus/api/work/tasks', { title, max_retries: 2 });

    expect(made.status).toBe(201);
    expect((await detail(url, cookie, idOf(made.body))).title).toBe(title);
    expect(fs.existsSync('/tmp/caduceus-pwned')).toBe(false);

    const unknownParent = await send(url, cookie, 'POST', '/_caduceus/api/work/tasks', { title: 'Child', parents: ['t_nothere'], max_retries: 2 });
    expect(unknownParent.status).toBe(422);
    expect((unknownParent.body as { message: string }).message).toContain('t_nothere');
  });

  test.each([
    ['an option in place of a branch', { title: 'x', workspace_kind: 'worktree', branch_name: '--upload-pack=x' }],
    ['a branch for a task that has no worktree', { title: 'x', branch_name: 'wt/x' }],
    ['a field Hermes’s CLI has no flag for', { title: 'x', reasoning_effort: 'high' }],
    ['a field that is not the owner’s to set', { title: 'x', created_by: 'someone' }],
    ['a title of several lines', { title: 'a\nb' }],
    ['no title', { body: 'only a body' }],
    ['a retry limit that is not a number', { title: 'x', max_retries: '3; rm -rf /' }],
    ['a contract that is neither a repository nor a pull request', { title: 'x', completion_contract: 'https://evil.example/pull/1' }],
    ['a provider without a model', { title: 'x', provider_override: 'openai' }],
  ])('refuses %s before anything runs', async (_name, body) => {
    const { url, cookie } = await start();

    expect((await send(url, cookie, 'POST', '/_caduceus/api/work/tasks', body)).status).toBe(400);
  });

  test.each([
    ['board', '?board=../etc'],
    ['profile', '?profile=-p'],
  ])('refuses a %s that is not a name', async (_name, query) => {
    const { url, cookie } = await start();

    expect((await send(url, cookie, 'POST', `/_caduceus/api/work/tasks${query}`, { title: 'x' })).status).toBe(400);
  });

  test('is the owner’s alone, and read-only mode stops it', async () => {
    const { url, cookie } = await start();

    expect((await send(url, '', 'POST', '/_caduceus/api/work/tasks', { title: 'x' })).status).toBe(401);
    await stepUp(url, cookie, await addPasskey(url, cookie));
    expect((await send(url, cookie, 'PUT', '/_caduceus/api/policy/read-only', { readOnly: true })).status).toBe(200);
    const refused = await send(url, cookie, 'POST', '/_caduceus/api/work/tasks', { title: 'x' });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ error: 'read-only' });
  });
});
