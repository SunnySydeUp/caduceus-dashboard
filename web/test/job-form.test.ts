import { describe, expect, test } from 'vitest';
import { blueprintDefaults, blueprintSchedule, createPlan, draftOfJob, editPlan, jobProblems, newDraft, parseBlueprints, parseProfileHomes, searchBlueprints, type Blueprint, type FormContext, type JobDraft } from '../src/modules/work/job-form.ts';
import { createTaskScript, type TaskFields } from '../src/modules/work/create-task-script.ts';
import { CREATE_TASK_SCRIPT_PREFIX, parseJobs } from '../src/modules/work/schedules-model.ts';

const ZONE = 'Australia/Sydney';
const NOW = Date.parse('2026-06-01T00:00:00Z');

const blueprint = (over: Partial<Blueprint> = {}): Blueprint => ({
  key: 'morning-brief',
  title: 'Morning briefing',
  description: 'A short daily briefing.',
  category: 'daily',
  tags: ['daily', 'briefing'],
  scheduleTemplate: '{minute} {hour} * * *',
  scheduleHuman: 'daily at 08:00',
  fields: [
    { name: 'time', type: 'time', label: 'What time?', default: '08:00', options: [], optional: false, strict: true, help: '' },
    { name: 'deliver', type: 'enum', label: 'Where to deliver?', default: 'origin', options: ['origin', 'local'], optional: false, strict: false, help: '' },
  ],
  ...over,
});

const context = (over: Partial<FormContext> = {}): FormContext => ({ profiles: ['default', 'coder'], blueprints: [blueprint()], now: NOW, zone: ZONE, ...over });

const agent = (over: Partial<JobDraft> = {}): JobDraft => ({ ...newDraft('agent', 'default'), name: 'News digest', prompt: 'Summarise the news', ...over });

describe('what is wrong with a job, before it is sent', () => {
  test('a good job of each type has no problem', () => {
    const task = { ...newDraft('task', 'coder'), name: 'Weekly review', task: { ...newDraft('task', 'coder').task, title: 'Review the week', assignee: 'coder' } };
    const bp = { ...newDraft('blueprint', 'default'), blueprint: { key: 'morning-brief', values: blueprintDefaults(blueprint()) } };

    expect([jobProblems(agent(), context()), jobProblems(task, context()), jobProblems(bp, context())]).toEqual([{}, {}, {}]);
  });

  test('a name, a prompt and a known profile are needed', () => {
    expect(jobProblems(agent({ name: '  ', prompt: '', profile: 'ghost' }), context())).toEqual({
      name: 'Give the schedule a name.',
      prompt: 'Write the prompt the agent answers.',
      profile: 'There is no profile called “ghost”.',
    });
  });

  test('a bad schedule is a problem of the schedule', () => {
    expect(jobProblems(agent({ schedule: { mode: 'cron', expression: '61 * * * *' } }), context())).toEqual({ schedule: 'The minute field “61” must be from 0 to 59.' });
  });

  test('a Create-task job needs a title, a known assignee, and sensible limits', () => {
    const base = newDraft('task', 'default');
    const draft: JobDraft = { ...base, name: 'Review', task: { ...base.task, title: '', assignee: 'ghost', priority: 1.5, maxRuntime: 'soon', maxRetries: 0, workspace: { kind: 'dir', path: 'relative/dir' } } };

    expect(jobProblems(draft, context())).toEqual({
      title: 'Give the task a title.',
      assignee: 'There is no profile called “ghost”.',
      priority: 'Priority is a whole number.',
      maxRuntime: 'Use seconds (300) or a duration such as 90s, 30m, 2h or 1d.',
      maxRetries: 'Retries is a whole number from 1.',
      workspace: 'Give the folder as a full path, such as /Users/you/project.',
    });
  });

  test('a blueprint needs every required input, and a value the blueprint allows', () => {
    const more = blueprint({
      fields: [
        { name: 'time', type: 'time', label: 'What time?', default: '08:00', options: [], optional: false, strict: true, help: '' },
        { name: 'day', type: 'enum', label: 'Which day?', default: 'sunday', options: ['sunday', 'monday'], optional: false, strict: true, help: '' },
        { name: 'topic', type: 'text', label: 'Topic', default: '', options: [], optional: false, strict: true, help: '' },
        { name: 'note', type: 'text', label: 'Note', default: '', options: [], optional: true, strict: true, help: '' },
      ],
    });
    const draft: JobDraft = { ...newDraft('blueprint', 'default'), blueprint: { key: 'morning-brief', values: { time: '8am', day: 'tuesday', topic: '', note: '' } } };

    expect(jobProblems(draft, context({ blueprints: [more] }))).toEqual({
      'value.time': 'Use a time such as 08:00.',
      'value.day': 'Choose one of sunday, monday.',
      'value.topic': 'Fill in “Topic”.',
    });
    expect(jobProblems({ ...draft, blueprint: { key: 'gone', values: {} } }, context())).toEqual({ blueprint: 'Hermes has no blueprint called “gone”.' });
  });
});

describe('the request that creates each type of job', () => {
  test('an Agent prompt job is one POST in its profile, with only what was filled in', () => {
    const plan = createPlan(agent({ profile: 'coder', model: 'gpt-5', skills: ['translation'], schedule: { mode: 'weekly', days: [1], time: '09:00' } }), { zone: ZONE, unique: 'abc123' });

    expect(plan).toEqual({
      job: { method: 'POST', path: '/api/cron/jobs?profile=coder', body: { name: 'News digest', prompt: 'Summarise the news', schedule: '0 9 * * 1', model: 'gpt-5', skills: ['translation'] } },
    });
    expect(createPlan(agent(), { zone: ZONE, unique: 'abc123' }).job.body).toEqual({ name: 'News digest', prompt: 'Summarise the news', schedule: '0 9 * * *' });
  });

  test('a Create-task job saves its script through the guarded script route, then makes a script job named for it', () => {
    const base = newDraft('task', 'coder');
    const fields: TaskFields = { ...base.task, title: 'Review the week', brief: '## Goal\nSummarise', assignee: 'coder' };
    const draft: JobDraft = { ...base, name: 'Weekly review', schedule: { mode: 'weekly', days: [5], time: '16:00' }, task: fields };

    const plan = createPlan(draft, { zone: ZONE, unique: 'abc123' });

    const file = `${CREATE_TASK_SCRIPT_PREFIX}weekly-review-abc123.sh`;
    expect(plan.scriptSaves).toEqual([{ name: file, request: { method: 'PUT', path: '/_caduceus/api/work/scripts', body: { profile: 'coder', name: file, content: createTaskScript(fields) } } }]);
    expect('script' in plan).toBe(false);
    expect(plan.job).toEqual({ method: 'POST', path: '/api/cron/jobs?profile=coder', body: { name: 'Weekly review', schedule: '0 16 * * 5', script: file, no_agent: true } });
  });

  test('a Blueprint job is Hermes’s instantiate, with the inputs', () => {
    const draft: JobDraft = { ...newDraft('blueprint', 'coder'), blueprint: { key: 'morning-brief', values: { time: '07:30', deliver: 'local' } } };

    expect(createPlan(draft, { zone: ZONE, unique: 'abc123' })).toEqual({
      job: { method: 'POST', path: '/api/cron/blueprints/instantiate?profile=coder', body: { blueprint: 'morning-brief', values: { time: '07:30', deliver: 'local' } } },
    });
  });
});

describe('blueprints as Hermes lists them', () => {
  const listed = {
    blueprints: [
      { key: 'morning-brief', title: 'Morning briefing', description: 'A short daily briefing.', category: 'daily', tags: ['daily', 'briefing'], schedule: '{minute} {hour} * * *', scheduleHuman: 'daily at 08:00', fields: [{ name: 'time', type: 'time', label: 'What time?', default: '08:00', options: [], optional: false, strict: true, help: 'HH:MM' }] },
      { key: 'price-watch', title: 'Price watch', description: 'Tell me when a price drops.', category: 'general', tags: ['shopping'], schedule: '0 */{interval_h} * * *', scheduleHuman: 'on a schedule', fields: [{ name: 'interval_h', type: 'enum', label: 'How often?', default: '6', options: ['1', '6'], optional: false, strict: true, help: '' }] },
      { title: 'Not a blueprint' },
    ],
  };

  test('are read, and a row that is not one is left out', () => {
    const blueprints = parseBlueprints(listed);

    expect(blueprints.map((b) => b.key)).toEqual(['morning-brief', 'price-watch']);
    expect(blueprints[0].fields[0]).toEqual({ name: 'time', type: 'time', label: 'What time?', default: '08:00', options: [], optional: false, strict: true, help: 'HH:MM' });
    expect(blueprintDefaults(blueprints[1])).toEqual({ interval_h: '6' });
  });

  test('are found by title, description, category or tag', () => {
    const blueprints = parseBlueprints(listed);

    expect(searchBlueprints(blueprints, '').map((b) => b.key)).toEqual(['morning-brief', 'price-watch']);
    expect(searchBlueprints(blueprints, 'BRIEF').map((b) => b.key)).toEqual(['morning-brief']);
    expect(searchBlueprints(blueprints, 'price drops').map((b) => b.key)).toEqual(['price-watch']);
    expect(searchBlueprints(blueprints, 'shopping').map((b) => b.key)).toEqual(['price-watch']);
    expect(searchBlueprints(blueprints, 'nothing like this')).toEqual([]);
  });

  test('say when they fire, from their inputs', () => {
    const [morning, price] = parseBlueprints(listed);

    expect(blueprintSchedule(morning, { time: '07:05' })).toBe('5 7 * * *');
    expect(blueprintSchedule(price, { interval_h: '12' })).toBe('0 */12 * * *');
    expect(blueprintSchedule(morning, { time: 'early' })).toBeUndefined();
  });
});

describe('a job Hermes holds, back in the form', () => {
  const [agentJob, taskJob] = parseJobs([
    { id: 'a1', name: 'News digest', profile: 'coder', prompt: 'Summarise the news', schedule: { kind: 'cron', expr: '0 9 * * 1' }, schedule_display: '0 9 * * 1', skills: ['translation'], model: 'gpt-5', enabled: true, state: 'scheduled' },
    { id: 't1', name: 'Weekly review', profile: 'coder', hermes_home: '/h/profiles/coder', script: `${CREATE_TASK_SCRIPT_PREFIX}weekly-review-abc123.sh`, no_agent: true, schedule: { kind: 'interval', minutes: 120 }, enabled: true, state: 'scheduled' },
  ]);

  test('an Agent prompt job', () => {
    expect(draftOfJob(agentJob, ZONE)).toMatchObject({ type: 'agent', name: 'News digest', profile: 'coder', prompt: 'Summarise the news', skills: ['translation'], model: 'gpt-5', schedule: { mode: 'weekly', days: [1], time: '09:00' } });
  });

  test('nothing changed is nothing to send', () => {
    expect(editPlan(agentJob, draftOfJob(agentJob, ZONE)!, { zone: ZONE })).toBeUndefined();
  });

  test('only what changed is sent, so a name change does not restart the schedule', () => {
    const draft = { ...draftOfJob(agentJob, ZONE)!, name: 'News digest 2', prompt: 'Summarise the sport', skills: [] };

    expect(editPlan(agentJob, draft, { zone: ZONE })).toEqual({ job: { method: 'PUT', path: '/api/cron/jobs/a1?profile=coder', body: { updates: { name: 'News digest 2', prompt: 'Summarise the sport', skills: [] } } } });
    expect(editPlan(agentJob, { ...draftOfJob(agentJob, ZONE)!, schedule: { mode: 'daily', time: '07:00' } }, { zone: ZONE })).toEqual({
      job: { method: 'PUT', path: '/api/cron/jobs/a1?profile=coder', body: { updates: { schedule: '0 7 * * *' } } },
    });
  });

  test('a Create-task job is opened from the fields in its script', () => {
    const fields: TaskFields = { ...newDraft('task', 'coder').task, title: 'Review the week', assignee: 'coder' };

    const draft = draftOfJob(taskJob, ZONE, fields)!;

    expect(draft).toMatchObject({ type: 'task', name: 'Weekly review', task: fields, schedule: { mode: 'interval', every: 2, unit: 'hours' } });
  });

  test('changing a Create-task job’s fields saves its script again, and its schedule alone does not', () => {
    const fields: TaskFields = { ...newDraft('task', 'coder').task, title: 'Review the week' };
    const draft = draftOfJob(taskJob, ZONE, fields)!;

    const rewritten = editPlan(taskJob, { ...draft, task: { ...fields, brief: 'New brief' } }, { zone: ZONE, original: fields });
    const file = `${CREATE_TASK_SCRIPT_PREFIX}weekly-review-abc123.sh`;
    expect(rewritten).toEqual({ scriptSaves: [{ name: file, request: { method: 'PUT', path: '/_caduceus/api/work/scripts', body: { profile: 'coder', name: file, content: createTaskScript({ ...fields, brief: 'New brief' }) } } }] });

    const later = editPlan(taskJob, { ...draft, schedule: { mode: 'interval', every: 3, unit: 'hours' } }, { zone: ZONE, original: fields });
    expect(later).toEqual({ job: { method: 'PUT', path: '/api/cron/jobs/t1?profile=coder', body: { updates: { schedule: 'every 3h' } } } });
  });
});

describe('the homes of the profiles', () => {
  test('are read from Hermes’s profile list', () => {
    expect(parseProfileHomes({ profiles: [{ name: 'default', path: '/h' }, { name: 'coder', path: '/h/profiles/coder' }, { name: 'broken' }] })).toEqual({ default: '/h', coder: '/h/profiles/coder' });
  });
});
