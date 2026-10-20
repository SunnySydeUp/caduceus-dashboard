import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { classifyRest, resolveTier } from '@caduceus/contracts/policy/rest';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { blueprintDefaults, blueprintSchedule, createPlan, draftOfJob, editPlan, jobProblems, newDraft, parseBlueprints, parseProfileHomes, type FormContext, type JobDraft, type JobPlan } from '../../web/src/modules/work/job-form.ts';
import { savePlan, type SaveTransport } from '../../web/src/modules/work/job-save.ts';
import { readCreateTaskScript, type TaskFields } from '../../web/src/modules/work/create-task-script.ts';
import { fieldsOfTask, newBriefFields, scheduledFields, type BriefFields } from '../../web/src/modules/work/brief-task.ts';
import { parseTaskDetail } from '../../web/src/modules/work/task-model.ts';
import { parseBlueprintTitles, parseJobs, type Job } from '../../web/src/modules/work/schedules-model.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// The schedule builder's jobs against the real Hermes (a real `hermes serve` in a throwaway HERMES_HOME), through a Caduceus server that
// enforces the policy. Only script jobs ever run, and they call no model. Hermes's own answers are the independent source: the jobs it
// stores, the blueprints it lists, the Kanban tasks that a run leaves behind.
const ZONE = 'America/New_York';
let hermes: TestHermes;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes({ env: { HERMES_TIMEZONE: ZONE } });
  await hermes.backend.ready();
  await hermes.cli('profile', 'create', 'coder');
}, 60_000);
afterAll(async () => {
  await hermes.stop();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  // The owner and passkey Caduceus keeps in this home belong to one test.
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

/** The page's side: reads, and sends through the policy the way `fetchTiered` does, recording the tier each request was given. */
async function client() {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, hermesInstallDir: hermes.install.dir });
  const url = server.url;
  const cookie = await ownerCookie(url);
  const authenticator = await addPasskey(url, cookie);
  const tiers: { operation: string; tier: string; typed?: string }[] = [];
  const read = async (route: string): Promise<unknown> => {
    const response = await fetch(`${url}${route}`, { headers: { cookie } });
    if (!response.ok) throw new Error(`GET ${route}: HTTP ${response.status} ${await response.text()}`);
    return response.json();
  };
  const transport: SaveTransport = {
    send: async (request, confirm) => {
      const target = new URL(request.path, 'http://x');
      const match = classifyRest(request.method, target.pathname);
      if (!match.ok) throw new Error(`unclassified ${request.method} ${request.path}`);
      const tier = resolveTier(match, { query: target.searchParams, body: request.body }).tier;
      const typed = tier === 'T3' ? (confirm.object ?? confirm.title) : undefined;
      tiers.push({ operation: match.operation, tier, ...(typed ? { typed } : {}) });
      const body = request.body === undefined ? undefined : JSON.stringify(request.body);
      let confirmation: Record<string, string> = {};
      if (tier === 'T3') {
        await stepUp(url, cookie, authenticator);
        const minted = await fetch(`${url}/_caduceus/api/policy/confirmations`, {
          method: 'POST',
          headers: { origin: url, cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ operation: `${request.method} ${request.path}`, target: typed, typed, ...(body ? { bodySha256: crypto.createHash('sha256').update(body).digest('hex') } : {}) }),
        });
        confirmation = { 'x-caduceus-confirmation': ((await minted.json()) as { token: string }).token };
      }
      const response = await fetch(`${url}${request.path}`, { method: request.method, headers: { origin: url, cookie, ...(body ? { 'content-type': 'application/json' } : {}), ...confirmation }, body });
      const answer: unknown = await response.json().catch(() => undefined);
      return response.ok ? { kind: 'done', body: answer } : { kind: 'failed', message: `Hermes answered HTTP ${response.status}: ${JSON.stringify(answer)}` };
    },
  };
  const jobs = async (): Promise<Job[]> => parseJobs(await read('/api/cron/jobs?profile=all'), parseBlueprintTitles(await read('/api/cron/blueprints')));
  const context = async (): Promise<FormContext> => ({
    profiles: Object.keys(parseProfileHomes(await read('/api/profiles'))),
    blueprints: parseBlueprints(await read('/api/cron/blueprints')),
    now: Date.now(),
    zone: ZONE,
  });
  const save = async (plan: JobPlan, name: string, profile: string, change: 'create' | 'edit' = 'create') => savePlan(plan, { name, profile, change }, transport);
  return { read, jobs, context, save, tiers, runNow: (job: Job) => fetch(`${url}/api/cron/jobs/${job.id}/trigger?profile=${job.profile}`, { method: 'POST', headers: { origin: url, cookie } }) };
}

/** Every task on Hermes's board, with the fields Hermes keeps for it. */
async function tasks(): Promise<Record<string, unknown>[]> {
  const board = (await (await hermes.backend.fetch('/api/plugins/kanban/board')).json()) as { columns: { tasks: { id: string }[] }[] };
  const ids = board.columns.flatMap((column) => column.tasks.map((task) => task.id));
  return Promise.all(ids.map(async (id) => ((await (await hermes.backend.fetch(`/api/plugins/kanban/tasks/${id}`)).json()) as { task: Record<string, unknown> }).task));
}

const taskDraft = (profile: string, fields: Partial<TaskFields> = {}, over: Partial<JobDraft> = {}): JobDraft => {
  const base = newDraft('task', profile);
  return { ...base, name: 'Friday review task', schedule: { mode: 'weekly', days: [5], time: '16:00' }, task: { ...base.task, title: 'Review the week', ...fields }, ...over };
};

describe('an Agent prompt job', () => {
  test('is created and edited through the policy, and the list shows it with its badge', async () => {
    const { jobs, context, save, tiers } = await client();
    const draft: JobDraft = { ...newDraft('agent', 'coder'), name: 'News digest', prompt: 'Summarise the news', model: '', skills: [], schedule: { mode: 'weekly', days: [1, 3], time: '09:15' } };
    expect(jobProblems(draft, await context())).toEqual({});

    const created = await save(createPlan(draft, { zone: ZONE, unique: 'x1y2z3' }), draft.name, draft.profile);

    expect(created.kind).toBe('done');
    const [job] = (await jobs()).filter((candidate) => candidate.name === 'News digest');
    expect(job).toMatchObject({ type: 'agent', profile: 'coder', enabled: true, schedule: 'Every Monday and Wednesday at 09:15' });
    expect(job.config).toMatchObject({ prompt: 'Summarise the news', schedule: { kind: 'cron', expr: '15 9 * * 1,3' } });

    const edited = { ...draftOfJob(job, ZONE)!, name: 'News digest (sport)', prompt: 'Summarise the sport news', schedule: { mode: 'interval' as const, every: 3, unit: 'hours' as const } };
    const plan = editPlan(job, edited, { zone: ZONE })!;
    expect((await save(plan, edited.name, edited.profile, 'edit')).kind).toBe('done');

    const [after] = (await jobs()).filter((candidate) => candidate.id === job.id);
    expect(after).toMatchObject({ name: 'News digest (sport)', type: 'agent', schedule: 'Every 3 hours' });
    expect(after.config).toMatchObject({ prompt: 'Summarise the sport news', schedule: { kind: 'interval', minutes: 180 } });
    // The tier the policy gives a cron write that runs no script: T1, with no typed confirmation.
    expect(tiers).toEqual([
      { operation: 'POST /api/cron/jobs', tier: 'T1' },
      { operation: 'PUT /api/cron/jobs/{job_id}', tier: 'T1' },
    ]);
  });
});

describe('a Create-task job', () => {
  test('is created as a script in the profile’s folder, listed as Create task, and edited', async () => {
    const { jobs, save, tiers, read } = await client();
    const fields: TaskFields = { ...newDraft('task', 'coder').task, title: 'Review the week', brief: '## Goal\nSummarise what shipped.', assignee: 'coder' };
    const draft = taskDraft('coder', fields);
    const plan = createPlan(draft, { zone: ZONE, unique: 'a1b2c3' });
    // A new profile has no scripts folder yet: the guarded route makes it.
    expect(fs.existsSync(path.join(hermes.home, 'profiles', 'coder', 'scripts'))).toBe(false);

    expect((await save(plan, draft.name, draft.profile)).kind).toBe('done');

    const file = path.join(hermes.home, 'profiles', 'coder', 'scripts', 'caduceus-create-task-friday-review-task-a1b2c3.sh');
    expect(readCreateTaskScript(fs.readFileSync(file, 'utf8'))).toEqual(fields);
    const [job] = (await jobs()).filter((candidate) => candidate.name === 'Friday review task');
    expect(job).toMatchObject({ type: 'task', profile: 'coder', schedule: 'Every Friday at 16:00' });
    expect(job.config).toMatchObject({ no_agent: true, script: 'caduceus-create-task-friday-review-task-a1b2c3.sh' });
    // The script is saved through the guarded route (T3, its file's name typed), and the job runs a script: a T3 with the same name typed.
    const typedFile = 'caduceus-create-task-friday-review-task-a1b2c3.sh';
    expect(tiers).toEqual([
      { operation: 'PUT /_caduceus/api/work/scripts', tier: 'T3', typed: typedFile },
      { operation: 'POST /api/cron/jobs', tier: 'T3', typed: typedFile },
    ]);

    // Opened again, the editor has the fields back from the script, and changing one writes the script again.
    const text = (await read(`/api/fs/read-text?path=${encodeURIComponent(file)}`)) as { text: string };
    const original = readCreateTaskScript(text.text)!;
    const edited = { ...draftOfJob(job, ZONE, original)!, task: { ...original, brief: '## Goal\nSummarise the sport.' } };
    tiers.length = 0;
    expect((await save(editPlan(job, edited, { zone: ZONE, original })!, edited.name, edited.profile, 'edit')).kind).toBe('done');
    expect(readCreateTaskScript(fs.readFileSync(file, 'utf8'))?.brief).toBe('## Goal\nSummarise the sport.');
    expect(tiers).toEqual([{ operation: 'PUT /_caduceus/api/work/scripts', tier: 'T3', typed: typedFile }]);

    // Its schedule alone is a T1 and does not touch the script.
    const later = { ...edited, schedule: { mode: 'daily' as const, time: '07:00' } };
    tiers.length = 0;
    expect((await save(editPlan(job, later, { zone: ZONE, original: edited.task })!, later.name, later.profile, 'edit')).kind).toBe('done');
    expect(tiers).toEqual([{ operation: 'PUT /api/cron/jobs/{job_id}', tier: 'T1' }]);
  });

  test('run now puts a task on the board with the configured fields', async () => {
    const { jobs, save, runNow } = await client();
    const fields: TaskFields = {
      title: 'Nightly check of “the” build',
      brief: '## Goal\nCheck $HOME and `date`.\n\nDone when the build is green.',
      assignee: 'coder',
      triage: false,
      priority: 4,
      skills: [],
      model: '',
      workspace: { kind: 'scratch' },
      maxRuntime: '2h',
    };
    const draft = taskDraft('default', fields, { name: 'Nightly build check' });
    expect((await save(createPlan(draft, { zone: ZONE, unique: 'run123' }), draft.name, draft.profile)).kind).toBe('done');
    const [job] = (await jobs()).filter((candidate) => candidate.name === 'Nightly build check');

    const response = await runNow(job);

    expect(response.status, await response.clone().text()).toBe(200);
    const made = (await tasks()).filter((task) => task.title === fields.title);
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ title: fields.title, body: fields.brief, assignee: 'coder', priority: 4, max_runtime_seconds: 7200, created_by: 'caduceus-schedule' });
    expect((await jobs()).find((candidate) => candidate.id === job.id)?.lastStatus).toBe('ok');
  });

  test('a draft goes to triage, and a job in another profile still puts its task on the shared board', async () => {
    const { jobs, save, runNow } = await client();
    const draft = taskDraft('coder', { title: 'Sketch an idea', triage: true }, { name: 'Idea sketch' });
    expect((await save(createPlan(draft, { zone: ZONE, unique: 'tri123' }), draft.name, draft.profile)).kind).toBe('done');
    const [job] = (await jobs()).filter((candidate) => candidate.name === 'Idea sketch');

    expect((await runNow(job)).status).toBe(200);

    const made = (await tasks()).filter((task) => task.title === 'Sketch an idea');
    expect(made).toHaveLength(1);
    expect(made[0]).toMatchObject({ status: 'triage' });
  });
});

describe('the Brief editor’s Schedule mode', () => {
  test('makes a Create-task job that the list shows, and each run puts the Brief’s task on the board with every field it carries', async () => {
    const { jobs, save, runNow } = await client();
    const brief: BriefFields = {
      ...newBriefFields(),
      title: 'Weekly “digest”',
      brief: { kind: 'sections', sections: { goal: 'Summarise the week.', context: '', references: '', constraints: 'Under 300 words.', expected: 'A short report.', scope: '' } },
      assignee: 'coder',
      model: 'gpt-5',
      provider: 'openai',
      skills: ['translation'],
      workspace: { kind: 'worktree', branch: 'wt/digest' },
      maxRuntime: '30m',
      maxRetries: 2,
      goalMode: true,
      goalMaxTurns: 6,
      completionContract: 'acme/widgets',
      priority: 2,
    };
    const base = newDraft('task', 'default');
    const draft: JobDraft = { ...base, name: 'Weekly digest', schedule: { mode: 'weekly', days: [1], time: '08:00' }, task: scheduledFields(brief) };

    expect((await save(createPlan(draft, { zone: ZONE, unique: 'brf123' }), draft.name, draft.profile)).kind).toBe('done');
    const [job] = (await jobs()).filter((candidate) => candidate.name === 'Weekly digest');
    expect(job.type).toBe('task');
    expect((await runNow(job)).status).toBe(200);

    const made = (await tasks()).filter((task) => task.title === 'Weekly “digest”');
    expect(made).toHaveLength(1);
    const read = parseTaskDetail(await (await hermes.backend.fetch(`/api/plugins/kanban/tasks/${made[0].id as string}`)).json());
    expect(fieldsOfTask(read.task)).toEqual(brief);
    expect(read.task.createdBy).toBe('caduceus-schedule');
  });
});

describe('a Blueprint job', () => {
  test('is made from Hermes’s blueprint and the inputs, is listed as Blueprint, and its schedule is the one the form said', async () => {
    const { jobs, context, save } = await client();
    const [blueprint] = (await context()).blueprints.filter((candidate) => candidate.key === 'weekly-review');
    const values = { ...blueprintDefaults(blueprint), time: '17:45', day: 'friday', deliver: 'local' };
    const draft: JobDraft = { ...newDraft('blueprint', 'coder'), blueprint: { key: blueprint.key, values } };
    expect(jobProblems(draft, await context())).toEqual({});

    expect((await save(createPlan(draft, { zone: ZONE, unique: 'bp1' }), blueprint.title, 'coder')).kind).toBe('done');

    const job = (await jobs()).find((candidate) => candidate.name === blueprint.title);
    expect(job).toMatchObject({ type: 'blueprint', profile: 'coder' });
    expect(job?.config).toMatchObject({ schedule: { kind: 'cron', expr: blueprintSchedule(blueprint, values) } });

    // Edited, it is the job it is: its schedule and prompt change, and its name (which is how the list knows it) stays.
    const edited = { ...draftOfJob(job!, ZONE)!, schedule: { mode: 'weekly' as const, days: [6], time: '10:00' } };
    expect((await save(editPlan(job!, edited, { zone: ZONE })!, blueprint.title, 'coder', 'edit')).kind).toBe('done');
    expect((await jobs()).find((candidate) => candidate.id === job!.id)).toMatchObject({ type: 'blueprint', schedule: 'Every Saturday at 10:00' });
  });

  test('every blueprint Hermes lists says the same schedule as Hermes makes, and the form refuses what Hermes refuses', async () => {
    const { context } = await client();
    const form = await context();
    expect(form.blueprints.length).toBeGreaterThanOrEqual(16);

    // Every request is independent, so they go to Hermes together: one after another (and a delete after each) is 64 round trips, which a busy machine stretches past the test's time.
    const cases = form.blueprints.flatMap((blueprint) => {
      // The blueprint's own defaults, then every choice moved to its last option and every time to 06:05.
      const defaults = blueprintDefaults(blueprint);
      const moved = Object.fromEntries(blueprint.fields.map((field) => [field.name, field.type === 'time' ? '06:05' : field.options.length > 0 && field.strict ? field.options[field.options.length - 1] : field.default]));
      return [defaults, moved].map((inputs) => ({ blueprint, values: { ...inputs, deliver: 'local' } }));
    });
    const answers = await Promise.all(cases.map(async ({ blueprint, values }) => {
      const response = await hermes.backend.fetch('/api/cron/blueprints/instantiate?profile=default', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ blueprint: blueprint.key, values }) });
      const body = await response.text();
      const job: { id: string; schedule: { expr: string } } | null = response.status === 200 ? JSON.parse(body) : null; // Hermes's own answer to a request it accepted
      return { blueprint, values, status: response.status, body, job };
    }));

    try {
      for (const { blueprint, values, status, body, job } of answers) {
        const draft: JobDraft = { ...newDraft('blueprint', 'default'), blueprint: { key: blueprint.key, values } };
        if (Object.keys(jobProblems(draft, form)).length > 0) {
          // Hermes's own default can be one it does not accept (competitor-watch asks for `monday` from a list without it): the form says so before submit.
          expect(status, `${blueprint.key} ${JSON.stringify(values)}`).toBe(422);
          continue;
        }
        expect(status, `${blueprint.key}: ${body}`).toBe(200);
        expect(job?.schedule.expr, blueprint.key).toBe(blueprintSchedule(blueprint, values));
      }
    } finally {
      await Promise.all(answers.flatMap(({ job }) => (job ? [hermes.backend.fetch(`/api/cron/jobs/${job.id}?profile=default`, { method: 'DELETE' })] : [])));
    }
  });
});
