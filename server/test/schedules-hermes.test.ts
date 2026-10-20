import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import { setTimeout as sleep } from 'node:timers/promises';
import fs from 'node:fs';
import path from 'node:path';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { parseBlueprintTitles, parseJobs, schedulerStatus, type Job } from '../../web/src/modules/work/schedules-model.ts';
import { outputDirectory, parseFileOutput, parseOutputFiles, parseRuns, parseSessionOutput, runOfFile } from '../../web/src/modules/work/job-runs.ts';
import { actionRequest, canRestore, duplicateRequest, restoreRequest, type JobRequest } from '../../web/src/modules/work/job-actions.ts';
import { startStubLlm, type StubLlm } from './fixtures/stub-llm.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';
import crypto from 'node:crypto';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';

// Work › Schedules (M3 #05) in front of the real Hermes (a real `hermes serve` in a throwaway HERMES_HOME). Every job is created
// through Hermes itself, and none of them is ever run by an agent: the jobs that run are scripts, which call no model. Hermes's
// own answers (the `Next run` its CLI prints when a job is created, the names of its blueprints) are the independent source.
let hermes: TestHermes;
let server: CaduceusServer | undefined;
let stub: StubLlm;
beforeAll(async () => {
  hermes = await launchTestHermes();
  stub = await startStubLlm();
  await stub.connect(hermes);
  await hermes.backend.ready();
  await hermes.cli('profile', 'create', 'coder');
}, 60_000);
afterAll(async () => {
  await stub.close();
  await hermes.stop();
});
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const json = { 'content-type': 'application/json' };

/** A job made through Hermes's own REST (no confirmation dialog: that is the web app's business); returns its id. */
async function create(body: Record<string, unknown>, profile = 'default'): Promise<{ id: string; next_run_at: string | null }> {
  const response = await hermes.backend.fetch(`/api/cron/jobs?profile=${profile}`, { method: 'POST', headers: json, body: JSON.stringify(body) });
  expect(response.status, await response.clone().text()).toBe(200);
  return response.json();
}

/** A script in the profile's `scripts/` folder, the only place Hermes runs scripts from. */
function writeScript(profile: string, name: string, text: string) {
  const dir = path.join(hermes.home, profile === 'default' ? '' : path.join('profiles', profile), 'scripts');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), text, { mode: 0o755 });
}

/** The page's two reads, through a Caduceus server, the way the browser makes them. */
async function read() {
  server ??= await startCaduceusServer({ backend: hermes.backend, hermesRoot: hermes.home, hermesInstallDir: hermes.install.dir });
  const cookie = await ownerCookie(server.url);
  const get = async (route: string) => {
    const response = await fetch(`${server!.url}${route}`, { headers: { cookie } });
    expect(response.status).toBe(200);
    return response.json();
  };
  let authenticator: Awaited<ReturnType<typeof addPasskey>> | undefined;
  const post = (route: string) => fetch(`${server!.url}${route}`, { method: 'POST', headers: { origin: server!.url, cookie } });
  return {
    jobs: async (): Promise<Job[]> => parseJobs(await get('/api/cron/jobs?profile=all'), parseBlueprintTitles(await get('/api/cron/blueprints'))),
    runsOf: async (id: string, profile = 'default') => parseRuns(await get(`/api/cron/jobs/${id}/runs?profile=${profile}`)),
    outputOf: async (runId: string, profile = 'default') => parseSessionOutput(await get(`/api/sessions/${runId}/messages?profile=${profile}`)),
    /** Run now, through Caduceus. */
    /** A script job's runs, newest first, from the output files in its profile: Hermes lists the folder and reads each file. */
    fileRunsOf: async (job: Job) => {
      const files = parseOutputFiles(await get(`/api/fs/list?path=${encodeURIComponent(outputDirectory(job)!)}`));
      return Promise.all(files.map(async (file) => {
        const output = parseFileOutput(await get(`/api/fs/read-text?path=${encodeURIComponent(file.path)}`));
        return { run: runOfFile(file, output), output: output.text };
      }));
    },
    /** Sends a request the way the web app does: a T3 carries the typed confirmation the server minted for exactly this request. */
    send: async (request: JobRequest, typed?: string) => {
      const body = request.body === undefined ? undefined : JSON.stringify(request.body);
      let confirmation: Record<string, string> = {};
      if (typed !== undefined) {
        authenticator ??= await addPasskey(server!.url, cookie);
        await stepUp(server!.url, cookie, authenticator);
        const minted = await fetch(`${server!.url}/_caduceus/api/policy/confirmations`, {
          method: 'POST',
          headers: { origin: server!.url, cookie, 'content-type': 'application/json' },
          body: JSON.stringify({ operation: `${request.method} ${request.path}`, target: typed, typed, ...(body ? { bodySha256: crypto.createHash('sha256').update(body).digest('hex') } : {}) }),
        });
        confirmation = { 'x-caduceus-confirmation': ((await minted.json()) as { token: string }).token };
      }
      const response = await fetch(`${server!.url}${request.path}`, { method: request.method, headers: { origin: server!.url, cookie, ...(body ? { 'content-type': 'application/json' } : {}), ...confirmation }, body });
      return { status: response.status, body: (await response.json().catch(() => undefined)) as Record<string, unknown> | undefined };
    },
    runNow: (id: string, profile = 'default') => post(`/api/cron/jobs/${id}/trigger?profile=${profile}`),
  };
}

describe('the job list, against Hermes', () => {
  test('lists the jobs of every profile with their type, profile, schedule and next fire time', async () => {
    writeScript('default', 'disk-check.sh', '#!/bin/sh\necho disk ok\n');
    writeScript('coder', 'caduceus-create-task-weekly-review.sh', '#!/bin/sh\nhermes kanban create "Weekly review"\n');
    const agent = await create({ prompt: 'Summarise the news', schedule: 'every 2h', name: 'News digest' });
    const script = await create({ schedule: '0 9 * * *', script: 'disk-check.sh', no_agent: true, name: 'Disk check' });
    const task = await create({ schedule: 'every monday 9am', script: 'caduceus-create-task-weekly-review.sh', no_agent: true, name: 'Weekly review task' }, 'coder');
    const blueprint = await (
      await hermes.backend.fetch('/api/cron/blueprints/instantiate?profile=coder', { method: 'POST', headers: json, body: JSON.stringify({ blueprint: 'morning-brief', values: { time: '07:30', deliver: 'local' } }) })
    ).json();
    const paused = await create({ prompt: 'Check the backups', schedule: '30m', name: 'Backup check', paused: true }, 'coder');

    const { jobs } = await read();
    const listed = await jobs();

    const byId = Object.fromEntries(listed.map((job) => [job.id, job]));
    expect(listed).toHaveLength(5);
    expect(byId[agent.id]).toMatchObject({ name: 'News digest', type: 'agent', profile: 'default', enabled: true, schedule: 'Every 2 hours' });
    expect(byId[script.id]).toMatchObject({ name: 'Disk check', type: 'script', profile: 'default', schedule: 'Every day at 09:00' });
    expect(byId[task.id]).toMatchObject({ name: 'Weekly review task', type: 'task', profile: 'coder', schedule: 'Every Monday at 09:00' });
    expect(byId[blueprint.id]).toMatchObject({ name: 'Morning briefing', type: 'blueprint', profile: 'coder', schedule: 'Every day at 07:30' });
    expect(byId[paused.id]).toMatchObject({ name: 'Backup check', type: 'agent', profile: 'coder', enabled: false, state: 'paused', schedule: 'Every 30 minutes' });
    // The next fire time is Hermes's own, as an instant: the one Hermes returned when it created the job.
    for (const made of [agent, script, task]) expect(byId[made.id].nextRunAt).toBe(Date.parse(made.next_run_at!));
    expect(byId[paused.id].nextRunAt).toBeUndefined();
  });
});

describe('the stale-scheduler warning, against Hermes', () => {
  test('appears when the heartbeat Hermes keeps is older than the threshold, and goes when ticks resume', async () => {
    await create({ prompt: 'say hello', schedule: 'every 1h', name: 'Heartbeat watcher' });
    const { jobs } = await read();
    const heartbeat = path.join(hermes.home, 'cron', 'ticker_heartbeat');
    fs.mkdirSync(path.dirname(heartbeat), { recursive: true });
    const stamp = (secondsAgo: number) => fs.writeFileSync(heartbeat, String(Date.now() / 1000 - secondsAgo));

    // The default profile's ticker, as its scheduler thread writes it: seconds since the epoch in `<home>/cron/ticker_heartbeat`.
    fs.rmSync(heartbeat, { force: true });
    const never = schedulerStatus(await jobs());
    stamp(3 * 3600);
    const stale = schedulerStatus(await jobs());
    stamp(190);
    const slack = schedulerStatus(await jobs());
    stamp(0);
    const resumed = schedulerStatus(await jobs());

    expect(never).toMatchObject({ state: 'unknown' });
    expect(stale).toMatchObject({ state: 'stale' });
    expect(stale.state === 'stale' && Math.round(stale.ageSeconds / 3600)).toBe(3);
    // 190 s is three missed ticks and some slack, which Hermes's own dashboard still calls alive.
    expect(slack.state).toBe('ok');
    expect(resumed.state).toBe('ok');
  });
});

describe('a job’s run history, against Hermes', () => {
  test('lists the runs newest first with status and duration, and reads each run’s output', async () => {
    const { id } = await create({ prompt: 'Say something', schedule: 'every 6h', name: 'History job' });
    const { runsOf, outputOf, runNow } = await read();

    // Run now is Hermes's trigger, and it answers once the run is over. A run is named by the second it starts in, and a run that
    // starts in the same second as another is added to it: the wall clock is the OS fact the second run waits on (a bounded poll).
    for (const answer of ['First answer', 'Second answer']) {
      const last = (await runsOf(id))[0];
      for (let polls = 0; last && Math.floor(Date.now() / 1000) <= Math.floor(last.startedAt / 1000) && polls < 40; polls++) await sleep(50);
      stub.nextReply({ chunks: [answer] });
      expect((await runNow(id)).status).toBe(200);
    }
    const runs = await runsOf(id);

    expect(runs).toHaveLength(2);
    expect(runs[0].startedAt).toBeGreaterThan(runs[1].startedAt);
    for (const run of runs) {
      expect(run).toMatchObject({ status: 'ok', statusLabel: 'Finished' });
      expect(run.durationMs).toBeGreaterThanOrEqual(0);
      expect(run.durationMs).toBe((run.endedAt ?? 0) - run.startedAt);
    }
    expect(await outputOf(runs[0].id)).toBe('Second answer');
    expect(await outputOf(runs[1].id)).toBe('First answer');
  });
});

describe('the run history of a script job, against Hermes', () => {
  test('reads the runs of a job that starts no agent from the output files Hermes saves, with their status and output', async () => {
    writeScript('default', 'report.sh', '#!/bin/sh\necho "all clear"\necho "second line"\n');
    writeScript('default', 'broken.sh', '#!/bin/sh\necho "oops" >&2\nexit 3\n');
    const good = await create({ schedule: 'every 6h', script: 'report.sh', no_agent: true, name: 'Report script' });
    const bad = await create({ schedule: 'every 6h', script: 'broken.sh', no_agent: true, name: 'Broken script' });
    const { jobs, runNow, fileRunsOf, runsOf } = await read();

    for (const id of [good.id, bad.id]) expect((await runNow(id)).status).toBe(200);
    const listed = await jobs();
    const ofGood = await fileRunsOf(listed.find((job) => job.id === good.id)!);
    const ofBad = await fileRunsOf(listed.find((job) => job.id === bad.id)!);

    // Hermes starts no session for a script. Since 0.22 its run list has one row per fire, made from the same files; Caduceus reads the files itself, which also give the status and the output.
    expect(await runsOf(good.id)).toHaveLength(1);
    expect(ofGood).toHaveLength(1);
    expect(ofGood[0].run).toMatchObject({ source: 'file', status: 'ok', statusLabel: 'Finished' });
    expect(ofGood[0].output).toBe('all clear\nsecond line');
    expect(ofBad[0].run).toMatchObject({ source: 'file', status: 'failed', statusLabel: 'Failed' });
    expect(ofBad[0].output).toBe('Script exited with code 3\nstderr:\noops');
    // The file is named for the second the run started in (Hermes's clock), which is within a minute of now.
    expect(Math.abs(ofGood[0].run.startedAt - Date.now())).toBeLessThan(60_000);
  });
});

describe('a job’s actions, through the policy', () => {
  test('Pause and Resume are T1 and move the job; Duplicate makes a paused copy; a script job’s copy is T3 like any script job', async () => {
    writeScript('default', 'copy-me.sh', '#!/bin/sh\necho copied\n');
    const agent = await create({ prompt: 'Review the inbox', schedule: '0 8 * * 1-5', name: 'Inbox review', skills: [], deliver: 'local' });
    const script = await create({ schedule: 'every 12h', script: 'copy-me.sh', no_agent: true, name: 'Copy me' });
    const { jobs, send } = await read();
    const find = async (id: string) => (await jobs()).find((job) => job.id === id)!;

    const paused = await send(actionRequest(await find(agent.id), 'pause'));
    const afterPause = await find(agent.id);
    const resumed = await send(actionRequest(afterPause, 'resume'));
    const afterResume = await find(agent.id);
    const copy = await send(duplicateRequest(afterResume));
    const scriptWithout = await send(duplicateRequest(await find(script.id)));
    const scriptCopy = await send(duplicateRequest(await find(script.id)), 'Copy me (copy)');
    const all = await jobs();

    expect([paused.status, resumed.status]).toEqual([200, 200]);
    expect(afterPause).toMatchObject({ enabled: false, state: 'paused' });
    expect(afterResume).toMatchObject({ enabled: true, state: 'scheduled' });
    // The copy has what the original has, and waits to be switched on.
    expect(copy.status).toBe(200);
    expect(all.find((job) => job.id === copy.body!.id)).toMatchObject({ name: 'Inbox review (copy)', type: 'agent', enabled: false, state: 'paused', schedule: 'Weekdays at 08:00', profile: 'default' });
    expect(all.find((job) => job.id === copy.body!.id)!.config).toMatchObject({ prompt: 'Review the inbox', deliver: 'local' });
    // No passkey step-up, no confirmation: Hermes is never reached, so the job is not created.
    expect(scriptWithout).toMatchObject({ status: 403, body: { error: 'step-up-required' } });
    expect(scriptCopy.status).toBe(200);
    expect(all.find((job) => job.id === scriptCopy.body!.id)).toMatchObject({ name: 'Copy me (copy)', type: 'script', enabled: false });
    expect(all.filter((job) => job.name.startsWith('Copy me'))).toHaveLength(2);
  });

  test('Delete removes the job, and a job Hermes can create again is restored from what was shown; a script job cannot be', async () => {
    writeScript('default', 'gone.sh', '#!/bin/sh\necho gone\n');
    const agent = await create({ prompt: 'Water the plants', schedule: 'every 90m', name: 'Plant reminder', skills: [], deliver: 'local', paused: true });
    const script = await create({ schedule: 'every 90m', script: 'gone.sh', no_agent: true, name: 'Gone script' });
    const { jobs, send } = await read();
    const before = await jobs();
    const agentJob = before.find((job) => job.id === agent.id)!;
    const scriptJob = before.find((job) => job.id === script.id)!;

    const deleted = await send(actionRequest(agentJob, 'delete'));
    const afterDelete = await jobs();
    const restored = await send(restoreRequest(agentJob));
    const afterRestore = await jobs();

    expect(deleted.status).toBe(200);
    expect(afterDelete.some((job) => job.id === agent.id)).toBe(false);
    expect(canRestore(agentJob)).toBe(true);
    expect(canRestore(scriptJob)).toBe(false);
    expect(restored.status).toBe(200);
    // A new id, and the job as it was: its name, schedule, prompt and that it was paused.
    const back = afterRestore.find((job) => job.id === restored.body!.id)!;
    expect(back.id).not.toBe(agent.id);
    expect(back).toMatchObject({ name: 'Plant reminder', type: 'agent', enabled: false, schedule: 'Every 90 minutes' });
    expect(back.config).toMatchObject({ prompt: 'Water the plants' });
  });
});
