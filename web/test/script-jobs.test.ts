import { describe, expect, test } from 'vitest';
import { createPlan, draftOfJob, editPlan, jobProblems, newDraft, type FormContext, type JobDraft } from '../src/modules/work/job-form.ts';
import { savePlan, type SaveConfirmation, type SaveTransport } from '../src/modules/work/job-save.ts';
import { parseJobs } from '../src/modules/work/schedules-model.ts';
import type { JobRequest } from '../src/modules/work/job-actions.ts';

// Script jobs and the advanced job options (M3 #12), as the pure part of the builder: what is wrong with a draft before it is sent, the requests that
// make or change the job (the script is saved first, through the guarded route; what Hermes's create route has no field for is set once the job exists),
// and what a job Hermes holds is in the form again. What Hermes does with them is checked against the real Hermes in server/test/script-jobs-hermes.test.ts.
const ZONE = 'Australia/Sydney';
const NOW = Date.parse('2026-06-01T00:00:00Z');
const context: FormContext = { profiles: ['default', 'coder'], blueprints: [], now: NOW, zone: ZONE };
const create = { zone: ZONE, unique: 'x1y2z3' };

const script = (over: Partial<JobDraft['script']> = {}, rest: Partial<JobDraft> = {}): JobDraft => {
  const base = newDraft('script', 'coder');
  return { ...base, name: 'Nightly report', script: { file: 'report.sh', content: 'echo "report"\n', mode: 'output', ...over }, ...rest };
};
const withAdvanced = (draft: JobDraft, over: Partial<JobDraft['advanced']>): JobDraft => ({ ...draft, advanced: { ...draft.advanced, ...over } });

describe('what is wrong with a Script job, before it is sent', () => {
  test('a script that is named, written and run without an agent has no problem; neither has one whose output goes to an agent with a prompt', () => {
    expect(jobProblems(script(), context)).toEqual({});
    expect(jobProblems(script({ mode: 'context' }, { prompt: 'Summarise the report' }), context)).toEqual({});
  });

  test('a script needs a name that is a file name, and some code', () => {
    expect(jobProblems(script({ file: '', content: '  ' }), context)).toEqual({
      scriptFile: 'A script that runs without an agent needs a script file.',
      scriptContent: 'Write the script.',
    });
    expect(jobProblems(script({ file: '../escape.sh' }), context)).toEqual({ scriptFile: 'A script file’s name is letters, digits, dots, dashes and underscores, such as report.sh.' });
    expect(jobProblems(script({ file: 'two words.sh' }), context)).toMatchObject({ scriptFile: expect.stringContaining('letters, digits') });
    expect(jobProblems(script({ file: '' , mode: 'context' }, { prompt: 'x' }), context)).toMatchObject({ scriptFile: 'Name the script file, such as report.sh or check.py.' });
  });

  test('a script whose output goes to an agent needs the prompt the agent answers', () => {
    expect(jobProblems(script({ mode: 'context' }), context)).toEqual({ prompt: 'Write the prompt the agent answers with the script’s output.' });
  });

  test('Hermes’s rule that a monitor cannot go with a script that runs without an agent is a problem of the monitor', () => {
    const draft = withAdvanced(script(), { monitor: { kind: 'url', value: 'https://example.com/feed', file: '', content: '' } });

    expect(jobProblems(draft, context)).toEqual({ monitor: 'A monitor decides whether the agent runs, so it cannot go with a script that runs without one. Let the script’s output go to an agent, or take the monitor off.' });
    expect(jobProblems({ ...draft, script: { ...draft.script, mode: 'context' }, prompt: 'p' }, context)).toEqual({});
  });
});

describe('what is wrong with the advanced options', () => {
  const agent = (over: Partial<JobDraft['advanced']> = {}): JobDraft => withAdvanced({ ...newDraft('agent', 'default'), name: 'Digest', prompt: 'Summarise' }, over);

  test('a monitor needs what it watches: a script that is written, or an address that is http or https', () => {
    expect(jobProblems(agent({ monitor: { kind: 'script', value: '', file: '', content: '' } }), context)).toEqual({
      monitorFile: 'Name the monitor script, such as check.sh.',
      monitorContent: 'Write the monitor script.',
    });
    expect(jobProblems(agent({ monitor: { kind: 'script', value: '', file: 'a b.sh', content: 'true' } }), context)).toMatchObject({ monitorFile: expect.stringContaining('letters, digits') });
    expect(jobProblems(agent({ monitor: { kind: 'url', value: 'ftp://example.com', file: '', content: '' } }), context)).toEqual({ monitorUrl: 'Give an address that starts with http:// or https://.' });
    expect(jobProblems(agent({ monitor: { kind: 'url', value: 'https://example.com/feed', file: '', content: '' } }), context)).toEqual({});
    expect(jobProblems(agent({ monitor: { kind: 'script', value: '', file: 'check.sh', content: 'curl -s example.com' } }), context)).toEqual({});
  });

  test('a working folder is a full path, or nothing', () => {
    expect(jobProblems(agent({ workdir: 'relative/dir' }), context)).toEqual({ workdir: 'Give the folder as a full path, such as /Users/you/project.' });
    expect(jobProblems(agent({ workdir: '/Users/me/project' }), context)).toEqual({});
    expect(jobProblems(agent({ workdir: '' }), context)).toEqual({});
  });
});

describe('the requests that make a Script job', () => {
  test('the script is saved first, through the guarded route, and the job runs it without an agent', () => {
    const plan = createPlan(script({}, { schedule: { mode: 'daily', time: '09:00' } }), create);

    expect(plan.scriptSaves).toEqual([{ name: 'report.sh', request: { method: 'PUT', path: '/_caduceus/api/work/scripts', body: { profile: 'coder', name: 'report.sh', content: 'echo "report"\n' } } }]);
    expect(plan.job).toEqual({ method: 'POST', path: '/api/cron/jobs?profile=coder', body: { name: 'Nightly report', schedule: '0 9 * * *', script: 'report.sh', no_agent: true } });
    expect(plan.after).toBeUndefined();
  });

  test('a script whose output goes to an agent is a job with a prompt and a script, and no `no_agent`', () => {
    const plan = createPlan(script({ mode: 'context' }, { prompt: 'Summarise the report', model: 'm1', skills: ['git'] }), create);

    expect(plan.job.body).toEqual({ name: 'Nightly report', schedule: '0 9 * * *', script: 'report.sh', prompt: 'Summarise the report', model: 'm1', skills: ['git'] });
  });

  test('the options Hermes’s create route takes are in it, and those it has no field for are set once the job exists', () => {
    const draft = withAdvanced(script({ mode: 'context' }, { prompt: 'Go' }), {
      contextFrom: ['abc123', 'self'],
      deliver: ['telegram:home', 'local'],
      failureDeliver: ['discord:alerts'],
      attachToSession: 'attach',
      workdir: '/Users/me/project',
      monitor: { kind: 'url', value: 'https://example.com/feed', file: '', content: '' },
    });

    const plan = createPlan(draft, create);

    expect(plan.job.body).toMatchObject({ context_from: ['abc123', 'self'], deliver: 'telegram:home,local', workdir: '/Users/me/project' });
    expect(plan.job.body).not.toHaveProperty('monitor_url');
    expect(plan.after).toEqual({ monitor_url: 'https://example.com/feed', failure_deliver: 'discord:alerts', attach_to_session: true });
  });

  test('a monitor script is saved too, before the job', () => {
    const draft = withAdvanced({ ...newDraft('agent', 'default'), name: 'Digest', prompt: 'Summarise' }, { monitor: { kind: 'script', value: '', file: 'check.sh', content: 'curl -s example.com\n' } });

    const plan = createPlan(draft, create);

    expect(plan.scriptSaves?.map((save) => save.request.body)).toEqual([{ profile: 'default', name: 'check.sh', content: 'curl -s example.com\n' }]);
    expect(plan.after).toEqual({ monitor_script: 'check.sh' });
  });

  test('an Agent prompt job with no advanced option is what it was: one POST, no extras', () => {
    const plan = createPlan({ ...newDraft('agent', 'default'), name: 'Digest', prompt: 'Summarise' }, create);

    expect(plan).toEqual({ job: { method: 'POST', path: '/api/cron/jobs?profile=default', body: { name: 'Digest', prompt: 'Summarise', schedule: '0 9 * * *' } } });
  });
});

const hermesJob = (over: Record<string, unknown> = {}) => ({
  id: 'j1',
  name: 'Nightly report',
  profile: 'coder',
  prompt: '',
  skills: [],
  script: 'report.sh',
  no_agent: true,
  schedule: { kind: 'cron', expr: '0 9 * * *', display: '0 9 * * *' },
  schedule_display: '0 9 * * *',
  enabled: true,
  state: 'scheduled',
  deliver: 'local',
  context_from: null,
  workdir: null,
  next_run_at: '2026-06-02T09:00:00+10:00',
  ...over,
});
const jobOf = (over: Record<string, unknown> = {}) => parseJobs([hermesJob(over)])[0]!;

describe('a Script job Hermes holds, back in the form', () => {
  test('is the script’s name and code, how it runs, and the options Hermes stores', () => {
    const job = jobOf({ no_agent: false, prompt: 'Summarise it', deliver: 'telegram:home,local', context_from: ['a1'], failure_deliver: 'discord:alerts', attach_to_session: false, workdir: '/w', monitor_url: 'https://example.com/feed' });

    const draft = draftOfJob(job, ZONE, undefined, 'echo hi\n')!;

    expect(draft).toMatchObject({
      type: 'script',
      name: 'Nightly report',
      prompt: 'Summarise it',
      script: { file: 'report.sh', content: 'echo hi\n', mode: 'context' },
      advanced: { contextFrom: ['a1'], deliver: ['telegram:home', 'local'], failureDeliver: ['discord:alerts'], attachToSession: 'detach', workdir: '/w', monitor: { kind: 'url', value: 'https://example.com/feed' } },
    });
  });

  test('delivering to “local”, the default, is no choice, and a job with none of the options has the defaults', () => {
    const draft = draftOfJob(jobOf(), ZONE, undefined, 'x')!;

    expect(draft.script.mode).toBe('output');
    expect(draft.advanced).toEqual({ monitor: { kind: 'none', value: '', file: '', content: '' }, contextFrom: [], deliver: [], failureDeliver: [], attachToSession: 'default', workdir: '' });
  });

  test('nothing changed is nothing to send', () => {
    const job = jobOf();
    const draft = draftOfJob(job, ZONE, undefined, 'echo hi\n')!;

    expect(editPlan(job, draft, { zone: ZONE, scriptContent: 'echo hi\n' })).toBeUndefined();
  });

  test('changed code is saved through the guarded route, under the same name, and the job itself is left alone', () => {
    const job = jobOf();
    const draft = { ...draftOfJob(job, ZONE, undefined, 'echo hi\n')!, script: { file: 'report.sh', content: 'echo bye\n', mode: 'output' as const } };

    const plan = editPlan(job, draft, { zone: ZONE, scriptContent: 'echo hi\n' });

    expect(plan).toEqual({ scriptSaves: [{ name: 'report.sh', request: { method: 'PUT', path: '/_caduceus/api/work/scripts', body: { profile: 'coder', name: 'report.sh', content: 'echo bye\n' } } }] });
  });

  test('only the options that changed are sent, in one update; an option put back to its default is cleared', () => {
    const job = jobOf({ no_agent: false, prompt: 'p', failure_deliver: 'discord:alerts', attach_to_session: true, workdir: '/w', monitor_url: 'https://example.com/feed' });
    const before = draftOfJob(job, ZONE, undefined, 'x')!;
    const draft = withAdvanced(before, { failureDeliver: [], attachToSession: 'default', workdir: '', monitor: { kind: 'none', value: '', file: '', content: '' }, contextFrom: ['a1'], deliver: ['telegram:home'] });

    const plan = editPlan(job, draft, { zone: ZONE, scriptContent: 'x' })!;

    expect(plan.job).toEqual({
      method: 'PUT',
      path: '/api/cron/jobs/j1?profile=coder',
      body: { updates: { context_from: ['a1'], deliver: 'telegram:home', failure_deliver: '', attach_to_session: null, workdir: '', monitor_url: '' } },
    });
  });

  test('how the script runs can be changed: a prompt turns it into a script that feeds an agent, and the no-agent flag goes', () => {
    const job = jobOf();
    const before = draftOfJob(job, ZONE, undefined, 'x')!;

    const plan = editPlan(job, { ...before, prompt: 'Summarise', script: { ...before.script, mode: 'context' } }, { zone: ZONE, scriptContent: 'x' })!;

    expect(plan.job?.body).toEqual({ updates: { prompt: 'Summarise', no_agent: false } });
  });

  test('a monitor script’s code is saved too when it changed, before the update that names it', () => {
    const job = jobOf({ no_agent: false, prompt: 'p', monitor_script: 'check.sh' });
    const before = draftOfJob(job, ZONE, undefined, 'x', 'curl a\n')!;
    expect(before.advanced.monitor).toEqual({ kind: 'script', value: 'check.sh', file: 'check.sh', content: 'curl a\n' });

    const plan = editPlan(job, withAdvanced(before, { monitor: { ...before.advanced.monitor, content: 'curl b\n' } }), { zone: ZONE, scriptContent: 'x', monitorContent: 'curl a\n' })!;

    expect(plan.scriptSaves?.map((save) => save.request.body)).toEqual([{ profile: 'coder', name: 'check.sh', content: 'curl b\n' }]);
    expect(plan.job).toBeUndefined();
  });
});

describe('a job that runs a script is a Script job', () => {
  test('whether the script is the job (no agent) or feeds an agent’s prompt, but not a script that makes tasks', () => {
    const type = (over: Record<string, unknown>) => jobOf(over).type;

    expect(type({})).toBe('script');
    expect(type({ no_agent: false, prompt: 'p' })).toBe('script');
    expect(type({ script: 'caduceus-create-task-x-a1b2c3.sh' })).toBe('task');
    expect(type({ script: null, no_agent: false, prompt: 'p' })).toBe('agent');
  });
});

describe('saving the plan', () => {
  /** A transport that records what it is asked, and gives each job an id. */
  function recording() {
    const sent: { request: JobRequest; confirm: SaveConfirmation }[] = [];
    const transport: SaveTransport = {
      send: async (request, confirm) => {
        sent.push({ request, confirm });
        return { kind: 'done', body: { id: 'newjob' } };
      },
    };
    return { sent, transport };
  }

  test('the scripts first (each a confirmation with its own name to type), then the job, then the options of the job that now exists', async () => {
    const { sent, transport } = recording();
    const draft = withAdvanced(script({ mode: 'context' }, { prompt: 'Go' }), { monitor: { kind: 'script', value: '', file: 'check.sh', content: 'true\n' }, attachToSession: 'attach' });

    const outcome = await savePlan(createPlan(draft, create), { name: draft.name, profile: 'coder', change: 'create' }, transport);

    expect(outcome).toEqual({ kind: 'done', body: { id: 'newjob' } });
    expect(sent.map(({ request }) => `${request.method} ${request.path}`)).toEqual([
      'PUT /_caduceus/api/work/scripts',
      'PUT /_caduceus/api/work/scripts',
      'POST /api/cron/jobs?profile=coder',
      'PUT /api/cron/jobs/newjob?profile=coder',
    ]);
    expect(sent.map(({ confirm }) => confirm.object)).toEqual(['report.sh', 'check.sh', 'report.sh', 'report.sh']);
    expect(sent[3]!.request.body).toEqual({ updates: { monitor_script: 'check.sh', attach_to_session: true } });
  });

  test('it stops at the first step that does not work, so no job is made around a script that was not saved', async () => {
    const sent: string[] = [];
    const transport: SaveTransport = {
      send: async (request) => {
        sent.push(request.path);
        return request.path.includes('/scripts') ? { kind: 'cancelled' } : { kind: 'done', body: {} };
      },
    };

    const outcome = await savePlan(createPlan(script(), create), { name: 'Nightly report', profile: 'coder', change: 'create' }, transport);

    expect(outcome).toEqual({ kind: 'cancelled' });
    expect(sent).toEqual(['/_caduceus/api/work/scripts']);
  });
});
