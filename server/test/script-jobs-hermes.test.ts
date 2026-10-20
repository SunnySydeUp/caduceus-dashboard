import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { classifyRest, resolveTier } from '@caduceus/contracts/policy/rest';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createPlan, draftOfJob, editPlan, jobProblems, newDraft, parseProfileHomes, type AdvancedDraft, type FormContext, type JobDraft, type JobPlan } from '../../web/src/modules/work/job-form.ts';
import { savePlan, type SaveTransport } from '../../web/src/modules/work/job-save.ts';
import { parseJobs, type Job } from '../../web/src/modules/work/schedules-model.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';

// Script jobs and the advanced job options (M3 #12) against the real Hermes (a real `hermes serve` in a throwaway HERMES_HOME), through a Caduceus server that
// enforces the policy. The form's own model (`job-form.ts`, `job-save.ts`) makes every request, so what is sent here is what the page sends. Hermes's own
// answers are the independent source: the output it files for a run, the prompt its model is given, the job it stores.
const ZONE = 'America/New_York';
let hermes: TestHermes;
let llm: StubLlm;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes({ env: { HERMES_TIMEZONE: ZONE } });
  await hermes.backend.ready();
  await hermes.cli('profile', 'create', 'coder');
  llm = await startStubLlm();
  await llm.connect(hermes, 'coder');
}, 90_000);
afterAll(async () => {
  await llm.close();
  await hermes.stop();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
});

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
  const jobs = async (): Promise<Job[]> => parseJobs(await read('/api/cron/jobs?profile=all'));
  const homes = async () => parseProfileHomes(await read('/api/profiles'));
  const context = async (): Promise<FormContext> => ({ profiles: Object.keys(await homes()), blueprints: [], now: Date.now(), zone: ZONE });
  const save = (plan: JobPlan, draft: JobDraft, change: 'create' | 'edit' = 'create') => savePlan(plan, { name: draft.name, profile: draft.profile, change }, transport);
  const created = async (draft: JobDraft): Promise<Job> => {
    expect(jobProblems(draft, await context())).toEqual({});
    const outcome = await save(createPlan(draft, { zone: ZONE, unique: 'u1v2w3' }), draft);
    expect(outcome.kind).toBe('done');
    const found = (await jobs()).find((job) => job.name === draft.name && job.profile === draft.profile);
    return found!;
  };
  const trigger = (job: Job) => fetch(`${url}/api/cron/jobs/${job.id}/trigger?profile=${job.profile}`, { method: 'POST', headers: { origin: url, cookie } });
  return { read, jobs, homes, context, save, created, trigger, tiers, url, cookie };
}

const outputOf = (job: Job): string[] => {
  const folder = path.join(hermes.home, 'profiles', job.profile, 'cron', 'output', job.id);
  return fs.existsSync(folder) ? fs.readdirSync(folder).map((file) => fs.readFileSync(path.join(folder, file), 'utf8')) : [];
};

const script = (name: string, content: string, mode: 'output' | 'context', over: Partial<JobDraft> = {}): JobDraft => ({
  ...newDraft('script', 'coder'),
  name,
  script: { file: `${name.toLowerCase().replaceAll(' ', '-')}.sh`, content, mode },
  ...over,
});
const withAdvanced = (draft: JobDraft, over: Partial<AdvancedDraft>): JobDraft => ({ ...draft, advanced: { ...draft.advanced, ...over } });

describe('both forms of a Script job run end to end', () => {
  test('a script that runs without an agent delivers what it prints, as it prints it, and uses no model', async () => {
    const { created, trigger, tiers } = await client();
    const before = llm.completions.length;
    const job = await created(script('Print job', 'echo "line one"\necho "line two"\n', 'output'));

    expect(job).toMatchObject({ type: 'script', profile: 'coder' });
    expect(job.config).toMatchObject({ no_agent: true, script: 'print-job.sh' });
    expect(fs.readFileSync(path.join(hermes.home, 'profiles', 'coder', 'scripts', 'print-job.sh'), 'utf8')).toBe('echo "line one"\necho "line two"\n');
    expect((await trigger(job)).status).toBe(200);

    const [output] = outputOf(job);
    expect(output).toContain('Mode:** no_agent (script)');
    expect(output!.split('---\n\n')[1]).toBe('line one\nline two\n');
    expect(llm.completions).toHaveLength(before);
    // Saving the script and creating the job that runs it are both T3, with the script’s name typed.
    expect(tiers.filter((entry) => entry.tier === 'T3').map((entry) => `${entry.operation} ${entry.typed}`)).toEqual(['PUT /_caduceus/api/work/scripts print-job.sh', 'POST /api/cron/jobs print-job.sh']);
  });

  test('a script whose output goes to an agent puts what it prints into the prompt the model is given', async () => {
    const { created, trigger } = await client();
    const job = await created(script('Context job', 'echo "ORDER-4711 shipped"\n', 'context', { prompt: 'Summarise the script output' }));
    const before = llm.completions.length;

    expect((await trigger(job)).status).toBe(200);

    const given = llm.completions.slice(before).flatMap((completion) => completion.messages.map((message) => String(message.content)));
    expect(given.some((text) => text.includes('ORDER-4711 shipped') && text.includes('Summarise the script output'))).toBe(true);
    expect(job.config).toMatchObject({ no_agent: false, script: 'context-job.sh', prompt: 'Summarise the script output' });
  });

  test('editing the code saves the script again, and what runs next is the new code', async () => {
    const { created, trigger, save, jobs } = await client();
    const job = await created(script('Edit job', 'echo old\n', 'output'));
    const draft = { ...draftOfJob(job, ZONE, undefined, 'echo old\n')!, script: { file: 'edit-job.sh', content: 'echo new\n', mode: 'output' as const } };

    const plan = editPlan(job, draft, { zone: ZONE, scriptContent: 'echo old\n' })!;
    expect((await save(plan, draft, 'edit')).kind).toBe('done');
    await trigger((await jobs()).find((candidate) => candidate.id === job.id)!);

    expect(outputOf(job).at(-1)!.split('---\n\n')[1]).toBe('new\n');
  });
});

describe('Hermes’s rules, which the form says before it is sent', () => {
  test('a monitor cannot go with a script that runs without an agent, and Hermes refuses it too', async () => {
    const { created, context, url, cookie } = await client();
    const job = await created(script('Rule job', 'echo x\n', 'output'));
    const wrong = withAdvanced(script('Rule job', 'echo x\n', 'output'), { monitor: { kind: 'url', value: 'https://example.com/feed', file: '', content: '' } });

    expect(Object.keys(jobProblems(wrong, await context()))).toEqual(['monitor']);
    const sent = await fetch(`${url}/api/cron/jobs/${job.id}?profile=coder`, { method: 'PUT', headers: { origin: url, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ updates: { monitor_url: 'https://example.com/feed' } }) });
    expect(sent.status).toBe(400);
    expect(JSON.stringify(await sent.json())).toContain('cannot be combined with no_agent');
  });

  test('a script that runs without an agent needs a script, and Hermes refuses it too', async () => {
    const { context } = await client();
    const empty = script('Empty', '', 'output', { script: { file: '', content: '', mode: 'output' } });

    expect(jobProblems(empty, await context())).toMatchObject({ scriptFile: 'A script that runs without an agent needs a script file.' });
    // Sent to Hermes itself: through Caduceus a job that runs without an agent is a T3, and what is being checked is Hermes's rule.
    const sent = await hermes.backend.fetch('/api/cron/jobs?profile=coder', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Empty', schedule: 'every 60m', no_agent: true }) });
    expect(sent.status).toBe(400);
    expect(JSON.stringify(await sent.json())).toContain('no_agent=True requires a script');
  });
});

describe('each advanced option goes through Hermes unchanged', () => {
  const base = (name: string): JobDraft => ({ ...newDraft('agent', 'coder'), name, prompt: 'Summarise' });

  test.each<[string, (id: string) => Partial<AdvancedDraft>, (job: Job) => unknown, unknown]>([
    ['deliver', () => ({ deliver: ['bot-chat:default', 'local'] }), (job) => job.config.deliver, 'bot-chat:default,local'],
    // Hermes stores the folder as the real path it resolves to.
    ['workdir', () => ({ workdir: fs.realpathSync('/tmp') }), (job) => job.config.workdir, fs.realpathSync('/tmp')],
    ['context_from', (id) => ({ contextFrom: [id, 'self'] }), (job) => job.config.context_from, undefined],
    ['monitor_url', () => ({ monitor: { kind: 'url' as const, value: 'https://example.com/feed', file: '', content: '' } }), (job) => job.config.monitor_url, 'https://example.com/feed'],
    ['monitor_script', () => ({ monitor: { kind: 'script' as const, value: 'check.sh', file: 'check.sh', content: 'echo checking\n' } }), (job) => job.config.monitor_script, 'check.sh'],
    ['failure_deliver', () => ({ failureDeliver: ['bot-chat:default'] }), (job) => job.config.failure_deliver, 'bot-chat:default'],
    ['attach_to_session', () => ({ attachToSession: 'attach' as const }), (job) => job.config.attach_to_session, true],
  ])('%s', async (field, options, stored, expected) => {
    const { created, jobs } = await client();
    const anchor = await created({ ...base(`Anchor for ${field}`) });
    const draft = withAdvanced(base(`Option ${field}`), options(anchor.id));

    const job = await created(draft);

    expect(stored(job)).toEqual(field === 'context_from' ? [anchor.id, 'self'] : expected);
    // Opened again, the form holds the same option, and nothing is left to send.
    const again = (await jobs()).find((candidate) => candidate.id === job.id)!;
    const reopened = draftOfJob(again, ZONE, undefined, '', field === 'monitor_script' ? 'echo checking\n' : '')!;
    expect(reopened.advanced).toMatchObject(options(anchor.id));
    expect(editPlan(again, reopened, { zone: ZONE, monitorContent: field === 'monitor_script' ? 'echo checking\n' : '' })).toBeUndefined();
  });

  test('an option put back to its default is cleared in Hermes', async () => {
    const { created, save, jobs } = await client();
    const job = await created(withAdvanced(base('Clear me'), { failureDeliver: ['bot-chat:default'], attachToSession: 'attach', workdir: fs.realpathSync('/tmp'), monitor: { kind: 'url', value: 'https://example.com/feed', file: '', content: '' } }));
    const draft = withAdvanced(draftOfJob(job, ZONE)!, { failureDeliver: [], attachToSession: 'default', workdir: '', monitor: { kind: 'none', value: '', file: '', content: '' } });

    expect((await save(editPlan(job, draft, { zone: ZONE })!, draft, 'edit')).kind).toBe('done');

    const after = (await jobs()).find((candidate) => candidate.id === job.id)!;
    expect([after.config.failure_deliver, after.config.workdir, after.config.monitor_url, after.config.attach_to_session ?? null]).toEqual([null, null, null, null]);
  });
});
