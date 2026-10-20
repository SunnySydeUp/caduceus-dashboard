import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { readPlaybook, type Playbook } from '@caduceus/contracts/playbooks';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { runCreatePlan } from '../../web/src/modules/work/brief-save.ts';
import { parseBoard } from '../../web/src/modules/work/board-model.ts';
import { createPlan, fieldsOfTask } from '../../web/src/modules/work/brief-task.ts';
import { startFields, templateDraft } from '../../web/src/modules/work/template-model.ts';
import { parseTaskDetail } from '../../web/src/modules/work/task-model.ts';

// Task templates and their categories (M3 #08): Caduceus-owned one-stage playbooks, kept as YAML files under `<root>/caduceus/playbooks/`
// (categories in the Caduceus store), through the Caduceus server's HTTP API in front of the real Hermes in a throwaway HERMES_HOME.
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

/** The task the Kanban plugin keeps, as far as these tests read it. */
interface Task {
  id: string;
  tenant: string | null;
  created_by: string | null;
  status: string;
}

/** What the routes answer with: the library, one template, one category, the problems of a refusal; and, from the Kanban plugin, tasks. */
interface Reply extends Playbook {
  categories: { id: string; name: string }[];
  templates: Playbook[];
  problems: string[];
  task: Task;
  seeds: Playbook[];
  playbook: Playbook;
  yaml: string;
  versions: number[];
  seed: boolean;
  warnings: { stage: string; message: string; line?: number }[];
  errors: { line?: number; message: string }[];
  lines: (number | null)[];
  error: string;
}

interface Owner {
  url: string;
  cookie: string;
  call(method: string, route: string, body?: unknown): Promise<{ status: number; body: Reply }>;
}

async function start(previous?: Owner): Promise<Owner> {
  server = await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home });
  const { url } = server;
  const cookie = previous ? previous.cookie : await ownerCookie(url);
  const call: Owner['call'] = async (method, route, body) => {
    const res = await fetch(`${url}${route}`, {
      method,
      headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  return { url, cookie, call };
}

const TEMPLATES = '/_caduceus/api/work/playbooks';
const CATEGORIES = '/_caduceus/api/work/template-categories';

/** The twelve templates PatterStage shipped, by name, with the category each is in (the ticket and work model §2.3). */
const SEEDED: Record<string, string[]> = {
  General: ['General task'],
  Engineering: ['Bug hunt', 'Code review', 'Feature build', 'Regression suite'],
  Operations: ['Deploy & verify', 'Infrastructure audit'],
  Data: ['Data analysis'],
  Research: ['Research brief'],
  Content: ['Content draft'],
  Support: ['Support triage'],
  Maintenance: ['Maintenance sweep'],
};

const BRIEF = { name: 'Weekly report', category: 'general', description: 'Summarise the week.', inputs: [{ key: 'week', label: 'Week', required: true }], stages: [{ key: 'main', title: 'Report for {{week}}', brief: { goal: 'Summarise {{week}}.' } }] };

describe('seeded templates', () => {
  test('the twelve templates exist on first run, in their eight categories, and each validates as a one-stage playbook', async () => {
    const owner = await start();
    const { status, body } = await owner.call('GET', TEMPLATES);
    expect(status).toBe(200);
    expect(body.categories.map((category) => category.name)).toEqual(Object.keys(SEEDED));
    const byCategory = (name: string) => body.categories.find((category) => category.name === name)!.id;
    for (const [category, names] of Object.entries(SEEDED)) {
      expect(body.templates.filter((template) => template.category === byCategory(category)).map((template) => template.name)).toEqual(names);
    }
    expect(body.templates).toHaveLength(12);
    for (const template of body.templates) {
      expect(readPlaybook(template), template.name).toEqual({ playbook: template });
      expect(template.stages).toHaveLength(1);
    }
    expect(body.problems).toEqual([]);
  });

  test('they are Caduceus YAML files under caduceus/playbooks, one per template, and a restart neither duplicates nor restores them', async () => {
    const owner = await start();
    const first = (await owner.call('GET', TEMPLATES)).body;
    const dir = path.join(hermes.home, 'caduceus', 'playbooks');
    const files = fs.readdirSync(dir).filter((name) => name.endsWith('.yaml')).sort();
    expect(files).toEqual(first.templates.map((template) => `${template.id}.yaml`).sort());
    expect(readPlaybook(parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'))).playbook?.id).toBe(files[0].replace(/\.yaml$/, ''));

    const bug = first.templates.find((template) => template.name === 'Bug hunt')!;
    expect((await owner.call('DELETE', `${TEMPLATES}/${bug.id}`)).status).toBe(204);
    await server!.close();
    const again = await start(owner);
    const names = (await again.call('GET', TEMPLATES)).body.templates.map((template) => template.name);
    expect(names).toHaveLength(11);
    expect(names).not.toContain('Bug hunt');
  });
});

describe('templates', () => {
  test('the owner makes, edits, duplicates and deletes a template; delete is undone by sending the same definition back', async () => {
    const owner = await start();
    const made = await owner.call('POST', TEMPLATES, BRIEF);
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ id: 'weekly-report', version: 1, name: 'Weekly report', category: 'general', stages: [{ key: 'main', title: 'Report for {{week}}' }], edges: [] });

    const edited = await owner.call('PUT', `${TEMPLATES}/weekly-report`, { ...BRIEF, name: 'Weekly status', description: '' });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({ id: 'weekly-report', version: 2, name: 'Weekly status' });
    expect(edited.body.description).toBeUndefined();

    const copy = await owner.call('POST', TEMPLATES, { ...BRIEF, name: 'Weekly report (copy)' });
    expect(copy.body.id).toBe('weekly-report-copy');
    const twin = await owner.call('POST', TEMPLATES, { ...BRIEF, name: 'Weekly report (copy)' });
    expect(twin.body.id).toBe('weekly-report-copy-2');

    expect((await owner.call('DELETE', `${TEMPLATES}/weekly-report`)).status).toBe(204);
    expect((await owner.call('DELETE', `${TEMPLATES}/weekly-report`)).status).toBe(404);
    expect((await owner.call('PUT', `${TEMPLATES}/weekly-report`, BRIEF)).status).toBe(404);

    const restored = await owner.call('POST', TEMPLATES, { ...edited.body });
    expect(restored.status).toBe(201);
    expect(restored.body).toMatchObject({ id: 'weekly-report', version: 2, name: 'Weekly status' });
    expect((await owner.call('POST', TEMPLATES, { ...edited.body })).status).toBe(409);
  });

  test('a definition that is not a valid playbook is refused with its problems, and nothing is written', async () => {
    const owner = await start();
    const before = fs.readdirSync(path.join(hermes.home, 'caduceus', 'playbooks')).length;
    const bad: [unknown, RegExp][] = [
      [{ ...BRIEF, name: '   ' }, /name/],
      [{ ...BRIEF, category: 'no-such-category' }, /category/],
      [{ ...BRIEF, tenant: 'acme' }, /tenant/],
      [{ ...BRIEF, stages: [] }, /stages must be a list/],
      [{ ...BRIEF, stages: [BRIEF.stages[0], { ...BRIEF.stages[0], key: 'second' }] }, /“second” cannot be reached/],
      [{ ...BRIEF, edges: [{ from: 'main', to: 'main', when: 'always' }] }, /needs max_attempts/],
      [{ ...BRIEF, stages: [{ ...BRIEF.stages[0], title: 'Report for {{month}}' }] }, /month/],
      [{ ...BRIEF, inputs: [{ key: 'week', label: 'Week' }, { key: 'week', label: 'Again' }] }, /week/],
      [{ ...BRIEF, stages: [{ ...BRIEF.stages[0], tenant: 'acme' }] }, /tenant/],
      [{ ...BRIEF, stages: [{ ...BRIEF.stages[0], brief: { goal: 1 } }] }, /goal/],
      ['not an object', /object/],
    ];
    for (const [body, expected] of bad) {
      const reply = await owner.call('POST', TEMPLATES, body);
      expect(reply.status, JSON.stringify(body)).toBe(400);
      expect(reply.body.problems.join('\n'), JSON.stringify(body)).toMatch(expected);
    }
    expect(fs.readdirSync(path.join(hermes.home, 'caduceus', 'playbooks'))).toHaveLength(before);
  });
});

describe('template categories', () => {
  test('the owner creates, renames and reorders categories; a category with templates in it cannot be deleted', async () => {
    const owner = await start();
    const initial = (await owner.call('GET', CATEGORIES)).body.categories ;
    expect(initial.map((category) => category.name)).toEqual(Object.keys(SEEDED));

    const made = await owner.call('POST', CATEGORIES, { name: '  Finance  ' });
    expect(made).toMatchObject({ status: 201, body: { id: 'finance', name: 'Finance' } });
    expect((await owner.call('POST', CATEGORIES, { name: 'finance' })).status).toBe(409);
    expect((await owner.call('POST', CATEGORIES, { name: '' })).status).toBe(400);

    const renamed = await owner.call('PUT', `${CATEGORIES}/finance`, { name: 'Money' });
    expect(renamed).toMatchObject({ status: 200, body: { id: 'finance', name: 'Money' } });
    expect((await owner.call('PUT', `${CATEGORIES}/nothing`, { name: 'x' })).status).toBe(404);

    const ids = [...initial.map((category) => category.id), 'finance'];
    const reordered = ['finance', ...ids.filter((id) => id !== 'finance')];
    const order = await owner.call('PUT', `${CATEGORIES}/order`, { ids: reordered });
    expect(order.status).toBe(200);
    expect(order.body.categories.map((category) => category.id)).toEqual(reordered);
    expect((await owner.call('PUT', `${CATEGORIES}/order`, { ids: reordered.slice(1) })).status).toBe(400);

    await owner.call('POST', TEMPLATES, { ...BRIEF, category: 'finance' });
    expect((await owner.call('DELETE', `${CATEGORIES}/finance`)).status).toBe(409);
    await owner.call('DELETE', `${TEMPLATES}/weekly-report`);
    expect((await owner.call('DELETE', `${CATEGORIES}/finance`)).status).toBe(204);
    expect((await owner.call('GET', CATEGORIES)).body.categories.map((category) => category.name)).toEqual(Object.keys(SEEDED));
  });

  test('a rename changes the name only: the templates in the category keep pointing at its id', async () => {
    const owner = await start();
    const general = (await owner.call('GET', TEMPLATES)).body.categories.find((category) => category.name === 'General')!;
    await owner.call('PUT', `${CATEGORIES}/${general.id}`, { name: 'Everyday' });
    const after = (await owner.call('GET', TEMPLATES)).body;
    expect(after.categories.find((category) => category.id === general.id)!.name).toBe('Everyday');
    expect(after.templates.find((template) => template.name === 'General task')!.category).toBe(general.id);
  });
});

/** The task the Kanban plugin keeps, as far as these tests read it. */
interface Task {
  tenant: string | null;
  created_by: string | null;
  status: string;
}

describe('a template meets Hermes only as the task it makes', () => {
  /** Makes the task a template starts, in the draft mode, the way the Brief editor does; answers with the task as Hermes keeps it. */
  async function startFromTemplate(owner: Owner, name: string, answers: Record<string, string>) {
    const library = (await owner.call('GET', TEMPLATES)).body;
    const playbook = library.templates.find((template) => template.name === name)!;
    const fields = startFields(playbook, answers);
    const plan = createPlan(fields, 'draft');
    const outcome = await runCreatePlan(plan, {
      async send(request) {
        const reply = await owner.call(request.method, request.path, request.body);
        return reply.status >= 200 && reply.status < 300 ? { kind: 'done', body: reply.body } : { kind: 'failed', message: `HTTP ${reply.status}` };
      },
    });
    if (outcome.kind !== 'done') throw new Error(JSON.stringify(outcome));
    const { task } = (await owner.call('GET', `/api/plugins/kanban/tasks/${outcome.id}`)).body;
    return { fields, task, id: outcome.id };
  }

  test('starting from a template sends nothing to Hermes, and the task it makes has no tenant, category or template trace', async () => {
    const owner = await start();
    const before = parseBoard((await owner.call('GET', '/api/plugins/kanban/board')).body).tasks.length;
    const library = (await owner.call('GET', TEMPLATES)).body;
    // Filling the inputs and opening the editor is pure: the board has not changed.
    startFields(library.templates[0], { goal: 'x' });
    expect(parseBoard((await owner.call('GET', '/api/plugins/kanban/board')).body).tasks).toHaveLength(before);

    const { task, fields } = await startFromTemplate(owner, 'Bug hunt', { bug: 'the export drops rows', where: 'export.ts' });
    expect(fields.title).toBe('Fix: the export drops rows');
    expect(task.status).toBe('triage');
    expect(task.tenant).toBeNull();
    expect(JSON.stringify(task)).not.toMatch(/engineering|bug-hunt/);
  });

  test('save as template captures a task’s sections and fields from Hermes, and starting from it gives the same fields back', async () => {
    const owner = await start();
    const made = await owner.call('POST', '/api/plugins/kanban/tasks', {
      title: 'Ship the export',
      body: '## Goal\n\nShip it.\n\n## Expected output\n\nA PR.\n',
      assignee: 'coder',
      priority: 2,
      skills: ['translation'],
      workspace_kind: 'dir',
      workspace_path: '/tmp/caduceus-template-dir',
      max_runtime_seconds: 7200,
      goal_mode: true,
      goal_max_turns: 5,
    });
    const { task } = parseTaskDetail((await owner.call('GET', `/api/plugins/kanban/tasks/${made.body.task.id}`)).body);
    const captured = fieldsOfTask(task);
    const saved = await owner.call('POST', TEMPLATES, templateDraft(captured, { name: 'Export shipper', category: 'engineering' }));
    expect(saved.status).toBe(201);

    const playbook = saved.body;
    expect(startFields(playbook, {})).toEqual({ ...captured, parents: [] });
    expect(captured).toMatchObject({ title: 'Ship the export', assignee: 'coder', priority: 2, maxRuntime: '2h', goalMode: true, goalMaxTurns: 5 });
    // The definition holds the task's settings and nothing of its run state.
    const file = fs.readFileSync(path.join(hermes.home, 'caduceus', 'playbooks', 'export-shipper.yaml'), 'utf8');
    expect(file).not.toMatch(/status|created|started|run_|tenant|t_[0-9a-f]{6}/);
  });
});

const VERSION_DIR = () => path.join(hermes.home, 'caduceus', 'playbooks', 'versions');

describe('playbooks', () => {
  test('the library lists the four seeded playbooks, read-only: they cannot be edited, deleted or overwritten, and duplicating one makes the owner’s own', async () => {
    const owner = await start();
    const { seeds, templates } = (await owner.call('GET', TEMPLATES)).body;
    expect(seeds.map((seed) => [seed.name, seed.stages.length])).toEqual([['Software delivery', 16], ['Research → summarise', 3], ['Draft → review', 3], ['Deep Research', 3]]);
    // Seeds are not files: the twelve templates are the owner's whole folder.
    expect(templates).toHaveLength(12);
    const seed = seeds[2];

    expect((await owner.call('PUT', `${TEMPLATES}/${seed.id}`, seed)).status).toBe(403);
    expect((await owner.call('DELETE', `${TEMPLATES}/${seed.id}`)).status).toBe(403);
    expect((await owner.call('POST', TEMPLATES, { ...seed })).status).toBe(409);
    const detail = (await owner.call('GET', `${TEMPLATES}/${seed.id}`)).body;
    expect(detail).toMatchObject({ seed: true, versions: [1], playbook: { id: 'draft-review', version: 1 } });
    expect(parse(detail.yaml)).toEqual(JSON.parse(JSON.stringify(seed)));

    const { id: _id, version: _version, ...draft } = seed;
    const copy = await owner.call('POST', TEMPLATES, { ...draft, name: 'Draft → review (copy)' });
    expect(copy).toMatchObject({ status: 201, body: { id: 'draft-review-copy', version: 1, name: 'Draft → review (copy)' } });
    expect(copy.body.stages).toHaveLength(3);
    expect((await owner.call('GET', `${TEMPLATES}/draft-review-copy`)).body.seed).toBe(false);
  });

  test('saving writes a new immutable version, older versions stay loadable, and a deleted playbook’s versions stay readable', async () => {
    const owner = await start();
    const first = await owner.call('POST', TEMPLATES, BRIEF);
    const edited = await owner.call('PUT', `${TEMPLATES}/weekly-report`, { ...BRIEF, name: 'Weekly status' });
    expect(edited.body.version).toBe(2);
    expect((await owner.call('PUT', `${TEMPLATES}/weekly-report`, { ...BRIEF, name: 'Weekly review' })).body.version).toBe(3);

    expect((await owner.call('GET', `${TEMPLATES}/weekly-report`)).body).toMatchObject({ versions: [1, 2, 3], playbook: { version: 3, name: 'Weekly review' } });
    expect((await owner.call('GET', `${TEMPLATES}/weekly-report/versions/1`)).body.playbook).toEqual(first.body);
    expect((await owner.call('GET', `${TEMPLATES}/weekly-report/versions/2`)).body.playbook).toMatchObject({ version: 2, name: 'Weekly status' });
    expect((await owner.call('GET', `${TEMPLATES}/weekly-report/versions/9`)).status).toBe(404);
    expect(fs.readdirSync(VERSION_DIR()).filter((name) => name.startsWith('weekly-report@')).sort()).toEqual(['weekly-report@1.yaml', 'weekly-report@2.yaml', 'weekly-report@3.yaml']);

    expect((await owner.call('DELETE', `${TEMPLATES}/weekly-report`)).status).toBe(204);
    expect((await owner.call('GET', `${TEMPLATES}/weekly-report`)).status).toBe(404);
    expect((await owner.call('GET', `${TEMPLATES}/weekly-report/versions/2`)).body.playbook).toMatchObject({ version: 2, name: 'Weekly status' });
  });

  test('a template saved before versions were kept opens, validates and versions here', async () => {
    const owner = await start();
    // M3 #08 wrote the file and nothing else.
    fs.rmSync(VERSION_DIR(), { recursive: true, force: true });
    fs.mkdirSync(VERSION_DIR());
    const bug = (await owner.call('GET', TEMPLATES)).body.templates.find((template) => template.id === 'bug-hunt')!;
    const opened = (await owner.call('GET', `${TEMPLATES}/bug-hunt`)).body;
    expect(opened).toMatchObject({ seed: false, versions: [1], playbook: bug });
    expect((await owner.call('GET', `${TEMPLATES}/bug-hunt/versions/1`)).body.playbook).toEqual(bug);

    const next = await owner.call('PUT', `${TEMPLATES}/bug-hunt`, { ...bug, description: 'Changed.' });
    expect(next.body.version).toBe(2);
    expect((await owner.call('GET', `${TEMPLATES}/bug-hunt/versions/1`)).body.playbook).toEqual(bug);
  });

  test('the YAML view: a valid text saves as the next version, an invalid one is refused with the lines of its problems, and the id cannot move', async () => {
    const owner = await start();
    const draft = (await owner.call('POST', TEMPLATES, { ...(await owner.call('GET', `${TEMPLATES}/draft-review`)).body.playbook, id: undefined, name: 'Review loop', version: undefined })).body;
    const text = (await owner.call('GET', `${TEMPLATES}/${draft.id}`)).body.yaml;

    const saved = await owner.call('PUT', `${TEMPLATES}/${draft.id}`, { yaml: text.replace('name: Review loop', 'name: Review loop v2') });
    expect(saved).toMatchObject({ status: 200, body: { id: draft.id, version: 2, name: 'Review loop v2' } });

    const broken = text.replace('to: finalise', 'to: nowhere');
    const refused = await owner.call('PUT', `${TEMPLATES}/${draft.id}`, { yaml: broken });
    expect(refused.status).toBe(400);
    expect(refused.body.problems).toEqual(['edges[1].to: there is no stage “nowhere”.']);
    expect(refused.body.lines).toEqual([text.split('\n').findIndex((line) => line.includes('to: finalise')) + 1]);
    expect((await owner.call('GET', `${TEMPLATES}/${draft.id}`)).body.playbook.version).toBe(2);

    expect((await owner.call('PUT', `${TEMPLATES}/${draft.id}`, { yaml: 'name: [unclosed' })).body.lines).not.toContain(null);
    expect((await owner.call('PUT', `${TEMPLATES}/${draft.id}`, { yaml: text.replace(`id: ${draft.id}`, 'id: other') })).body.problems[0]).toMatch(/Duplicate it/);
  });

  test('checking a text reports line-level errors, and warns of a profile or skill Hermes does not have', async () => {
    const owner = await start();
    const draft = (await owner.call('GET', `${TEMPLATES}/draft-review`)).body;
    const clean = await owner.call('POST', `${TEMPLATES}/check`, { yaml: draft.yaml });
    expect(clean.body).toEqual({ errors: [], warnings: [] });

    const lines = draft.yaml.split('\n');
    const at = lines.findIndex((line) => line.startsWith('  - key: draft'));
    lines.splice(at + 1, 0, '    assignee: ghost-profile');
    const warned = (await owner.call('POST', `${TEMPLATES}/check`, { yaml: lines.join('\n') })).body;
    expect(warned.errors).toEqual([]);
    expect(warned.warnings).toEqual([{ stage: 'draft', message: 'stages[0].assignee: Hermes has no profile called “ghost-profile”.', line: at + 2 }]);

    const skilled = draft.yaml.replace('    title: ', '    skills:\n      - no-such-skill\n    title: ');
    expect((await owner.call('POST', `${TEMPLATES}/check`, { yaml: skilled })).body.warnings.map((warning) => warning.message)).toEqual(['stages[0].skills[0]: the profile “default” has no skill called “no-such-skill”.']);

    const broken = (await owner.call('POST', `${TEMPLATES}/check`, { yaml: draft.yaml.replace('when: on_approve', 'when: sometimes') })).body;
    expect(broken.errors).toEqual([{ line: expect.any(Number), message: 'edges[1].when must be one of on_done, on_fail, on_approve, on_reject, always.' }]);
    expect((await owner.call('POST', `${TEMPLATES}/check`, { yaml: 'stages: [' })).body.errors[0].line).toBe(1);
  });
});
