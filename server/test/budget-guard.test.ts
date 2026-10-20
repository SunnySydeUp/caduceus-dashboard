import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { GuardState } from '@caduceus/contracts/budget-guard';
import type { InboxItem, InboxNotice } from '@caduceus/contracts/inbox';
import os from 'node:os';
import { startCaduceusServer, type CaduceusServer } from '../src/caduceus-server.ts';
import { createBudgetGuard, type BudgetGuard } from '../src/budget-guard.ts';
import { openCaduceusStore } from '../src/caduceus-store.ts';
import { createLease } from '../src/playbook-lease.ts';
import type { RestPolicy } from '../src/policy.ts';
import type { BudgetService } from '../src/budgets.ts';
import type { HermesBackend } from '../src/hermes-backend.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';

// The budget guard (M6 #06) at the Caduceus HTTP seam, in front of a real Hermes in a throwaway HERMES_HOME: its config, its scheduled jobs and its Kanban
// dispatch are the real ones (no job ever runs: nothing ticks them, and no model is called). Only what Hermes's usage analytics say is scripted, through
// a wrapper around the backend that answers that one route, so a budget can be used up on a clock the test moves by hand.
let hermes: TestHermes;
let originalConfig: string | undefined;
let server: CaduceusServer | undefined;
beforeAll(async () => {
  hermes = await launchTestHermes();
  await hermes.backend.ready();
  const config = path.join(hermes.home, 'config.yaml');
  originalConfig = fs.existsSync(config) ? fs.readFileSync(config, 'utf8') : undefined;
}, 60_000);
afterAll(() => hermes.stop());

/** Wednesday 14 October 2026, noon UTC. */
const WEDNESDAY = Date.parse('2026-10-14T12:00:00Z');
const clock = { now: WEDNESDAY };
let spend: Record<string, number> = {};
/** Every Hermes route the Caduceus server called while a test ran, as `METHOD /path` (without the query). */
const calls: string[] = [];

/** The real backend, except that usage analytics answer what `spend` says: a row per UTC day. */
function withSpend(backend: HermesBackend): HermesBackend {
  return new Proxy(backend, {
    get(target, property) {
      if (property === 'fetch') {
        return (route: string, init?: RequestInit) => {
          calls.push(`${init?.method ?? 'GET'} ${route.split('?')[0]}`);
          if (route.startsWith('/api/analytics/usage')) return Promise.resolve(Response.json({ daily: Object.entries(spend).map(([day, cost]) => ({ day, estimated_cost: cost, actual_cost: 0 })) }));
          return target.fetch(route, init);
        };
      }
      const value = Reflect.get(target, property, target) as unknown;
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

interface Owner {
  url: string;
  cookie: string;
  guard: BudgetGuard;
  call<T = any>(method: string, route: string, body?: unknown): Promise<{ status: number; body: T }>;
  state(): Promise<GuardState>;
}

async function start(): Promise<Owner> {
  clock.now = WEDNESDAY;
  spend = {};
  calls.length = 0;
  let guard!: BudgetGuard;
  server = await startCaduceusServer({
    backend: withSpend(hermes.backend),
    hermesRoot: hermes.home,
    now: () => clock.now,
    inboxPollMs: 60_000,
    inboxReadMs: 60_000,
    budgetReadMs: 60_000,
    budgetGuard: { intervalMs: 0, ready: (made) => (guard = made), failed: (error) => { throw error; } },
  });
  const { url } = server;
  const cookie = await ownerCookie(url);
  const call: Owner['call'] = async (method, route, body) => {
    const res = await fetch(`${url}${route}`, { method, headers: { origin: url, cookie, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : undefined };
  };
  return { url, cookie, guard, call, state: async () => (await call<GuardState>('GET', '/_caduceus/api/budget-guard')).body };
}

afterEach(async () => {
  await server?.close();
  server = undefined;
  fs.rmSync(path.join(hermes.home, 'caduceus'), { recursive: true, force: true });
  for (const job of ((await (await hermes.backend.fetch('/api/cron/jobs?profile=all')).json()) as { id: string }[])) await hermes.backend.fetch(`/api/cron/jobs/${job.id}`, { method: 'DELETE' });
  // The claim list is the guard's to put back; a failed test must not leave Hermes stopped for the next.
  if (originalConfig === undefined) fs.rmSync(path.join(hermes.home, 'config.yaml'), { force: true });
  else fs.writeFileSync(path.join(hermes.home, 'config.yaml'), originalConfig);
});

const job = async (name: string): Promise<string> => {
  const res = await hermes.backend.fetch('/api/cron/jobs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt: `say ${name}`, schedule: 'every 1h', name }) });
  expect(res.status).toBe(200);
  return ((await res.json()) as { id: string }).id;
};
const jobState = async (id: string): Promise<string> => ((await (await hermes.backend.fetch(`/api/cron/jobs/${id}`)).json()) as { state: string }).state;
const pause = (id: string) => hermes.backend.fetch(`/api/cron/jobs/${id}/pause`, { method: 'POST' });
const resume = (id: string) => hermes.backend.fetch(`/api/cron/jobs/${id}/resume`, { method: 'POST' });

/** What Hermes's own dispatcher would do with a ready task now: it would start a worker for it, or it holds no claim on it. Nothing starts: a dry run. */
async function dispatchWould(): Promise<'start' | 'not-claimed'> {
  const made = await hermes.backend.fetch('/api/plugins/kanban/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: `guard probe ${clock.now}`, assignee: 'default' }) });
  const { task } = (await made.json()) as { task: { id: string } };
  try {
    const report = JSON.parse(await hermes.cli('kanban', 'dispatch', '--dry-run', '--json')) as { spawned?: unknown[]; skipped_nonspawnable?: unknown[] };
    return (report.spawned ?? []).length > 0 ? 'start' : 'not-claimed';
  } finally {
    await hermes.backend.fetch(`/api/plugins/kanban/tasks/${task.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'archived' }) });
  }
}

const DAY_BUDGET = { amount: 5, period: 'day', profile: 'default' };
const usedUp = () => (spend = { '2026-10-14': 6 });

describe('tripping', () => {
  test('a used-up budget stops the dispatcher claiming and pauses the unattended jobs; a job the owner already paused or exempted, and the claim list the owner had, are left alone and not recorded', async () => {
    const owner = await start();
    const nightly = await job('Nightly report');
    const exempted = await job('Keep running');
    const ownerPaused = await job('Owner paused');
    await pause(ownerPaused);
    expect((await owner.call('PUT', `/_caduceus/api/work/jobs/default/${exempted}/guard-exempt`, { exempt: true })).body).toEqual({ exempt: true });
    await owner.call('POST', '/_caduceus/api/budgets', DAY_BUDGET);
    expect(await dispatchWould()).toBe('start');

    spend = { '2026-10-14': 2 };
    await owner.guard.evaluate();
    expect((await owner.state()).mode).toBe('armed');
    expect(await jobState(nightly)).not.toBe('paused');

    usedUp();
    await owner.guard.evaluate();
    const state = await owner.state();
    expect(state.mode).toBe('tripped');
    expect(state.trips).toHaveLength(1);
    expect(state.trips[0]).toMatchObject({ amount: 5, spent: 6, period: 'day', periodStart: '2026-10-14', profile: 'default', settled: false });
    expect(state.trips[0].actions.map((action) => [action.kind, action.label, action.status])).toEqual([['dispatcher', 'Kanban dispatcher', 'paused'], ['cron', 'Nightly report (default)', 'paused']]);
    expect(await jobState(nightly)).toBe('paused');
    expect(await jobState(exempted)).not.toBe('paused');
    expect(await jobState(ownerPaused)).toBe('paused');
    expect(await dispatchWould()).toBe('not-claimed');

    // Looking again changes nothing: one trip, nothing recorded twice.
    await owner.guard.evaluate();
    expect((await owner.state()).trips).toHaveLength(1);
    expect((await owner.state()).trips[0].actions).toHaveLength(2);
  });

  test('it only calls the dispatcher’s claim list and a job’s pause: a chat session and its tool runs are never touched', async () => {
    const owner = await start();
    await job('Nightly report');
    await owner.call('POST', '/_caduceus/api/budgets', DAY_BUDGET);
    usedUp();
    await owner.guard.evaluate();
    // Whatever else the server reads, the only changes it made in Hermes are the claim list and the pause of the one job.
    const changes = [...new Set(calls.filter((entry) => !entry.startsWith('GET ')))].map((entry) => entry.replace(/\/api\/cron\/jobs\/[^/]+\//, '/api/cron/jobs/{id}/'));
    expect(changes.sort()).toEqual(['POST /api/cron/jobs/{id}/pause', 'PUT /api/config/raw']);
  });

  test('a profile’s budget pauses that profile’s jobs only', async () => {
    const owner = await start();
    const mine = await job('Default job');
    await owner.call('POST', '/_caduceus/api/budgets', { amount: 5, period: 'day', profile: 'default' });
    usedUp();
    await owner.guard.evaluate();
    expect(await jobState(mine)).toBe('paused');
    expect((await owner.state()).trips[0].actions.some((action) => action.label.endsWith('(default)'))).toBe(true);
  });
});

describe('the Inbox and push', () => {
  test('a breach raises one Inbox item with Open spend, Raise budget and Undo guard actions, once however often the guard looks', async () => {
    const owner = await start();
    await owner.call('POST', '/_caduceus/api/budgets', DAY_BUDGET);
    usedUp();
    await owner.guard.evaluate();
    await owner.guard.evaluate();
    const items = (await owner.call<{ items: InboxItem[] }>('GET', '/_caduceus/api/inbox')).body.items.filter((item): item is InboxNotice => item.kind === 'notice' && item.ref.startsWith('budget:guard:'));
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Budget used up: unattended work is paused');
    expect(items[0].link).toEqual({ label: 'Open spend', to: '/observe/insights' });
    expect(items[0].actions.map((action) => action.label)).toEqual(['Raise budget', 'Undo guard actions']);
    expect(items[0].actions[1].confirm?.text).toContain('Kanban dispatcher');
  });
});

describe('undoing', () => {
  test('Undo resumes exactly what the guard paused and skips, with the reason, what the owner changed since; the Inbox item goes', async () => {
    const owner = await start();
    const first = await job('First');
    const second = await job('Second');
    const third = await job('Third');
    await owner.call('POST', '/_caduceus/api/budgets', DAY_BUDGET);
    usedUp();
    await owner.guard.evaluate();
    expect(await Promise.all([first, second, third].map(jobState))).toEqual(['paused', 'paused', 'paused']);
    // The owner resumes one himself and pauses another again, later than the guard did.
    await resume(first);
    await resume(second);
    await new Promise((done) => setTimeout(done, 1100));
    await pause(second);

    const undone = await owner.call<GuardState>('POST', '/_caduceus/api/budget-guard/undo', {});
    expect(undone.status).toBe(200);
    const actions = Object.fromEntries(undone.body.trips[0].actions.map((action) => [action.label.split(' (')[0], [action.status, action.reason]]));
    expect(actions['Kanban dispatcher']).toEqual(['resumed', undefined]);
    expect(actions.First).toEqual(['skipped', 'The owner resumed it already.']);
    expect(actions.Second).toEqual(['skipped', 'The owner paused it again after the guard did, so it was left paused.']);
    expect(actions.Third).toEqual(['resumed', undefined]);
    expect(await Promise.all([first, second, third].map(jobState))).not.toContain('never');
    expect(await jobState(third)).not.toBe('paused');
    expect(await jobState(second)).toBe('paused');
    expect(undone.body.mode).toBe('armed');
    expect(await dispatchWould()).toBe('start');
    expect(fs.readFileSync(path.join(hermes.home, 'config.yaml'), 'utf8')).not.toMatch(/dispatch_profiles/);
    const items = (await owner.call<{ items: InboxItem[] }>('GET', '/_caduceus/api/inbox')).body.items;
    expect(items.some((item) => item.ref.startsWith('budget:guard:'))).toBe(false);
    // The owner undid it: the same budget in the same period does not trip again.
    await owner.guard.evaluate();
    expect((await owner.state()).trips).toHaveLength(1);
    expect(await jobState(third)).not.toBe('paused');
  });

  test('a claim list the owner set after the guard stopped the dispatcher is left as it is', async () => {
    const owner = await start();
    await owner.call('POST', '/_caduceus/api/budgets', DAY_BUDGET);
    usedUp();
    await owner.guard.evaluate();
    const config = path.join(hermes.home, 'config.yaml');
    fs.writeFileSync(config, fs.readFileSync(config, 'utf8').replace(/dispatch_profiles:.*/, 'dispatch_profiles: [coder]'));
    const undone = await owner.call<GuardState>('POST', '/_caduceus/api/budget-guard/undo', {});
    expect(undone.body.trips[0].actions[0]).toMatchObject({ kind: 'dispatcher', status: 'skipped', reason: 'The dispatcher’s claim list was changed after the guard stopped it, so it was left as it is.' });
    expect(fs.readFileSync(config, 'utf8')).toMatch(/dispatch_profiles:\s*\n?\s*-?\s*\[?coder/);
  });

  test('a claim list the owner had before is put back as it was', async () => {
    const owner = await start();
    const config = path.join(hermes.home, 'config.yaml');
    fs.appendFileSync(config, '\nkanban:\n  dispatch_profiles: [default]\n');
    await owner.call('POST', '/_caduceus/api/budgets', DAY_BUDGET);
    usedUp();
    await owner.guard.evaluate();
    expect(await dispatchWould()).toBe('not-claimed');
    await owner.call('POST', '/_caduceus/api/budget-guard/undo', {});
    expect(await dispatchWould()).toBe('start');
    expect(fs.readFileSync(config, 'utf8')).toMatch(/dispatch_profiles:\s*\n?\s*-?\s*\[?default/);
  });

  test('when a new period starts the guard lifts its own pauses by itself, but only if the owner allowed it', async () => {
    const owner = await start();
    const nightly = await job('Nightly report');
    await owner.call('POST', '/_caduceus/api/budgets', DAY_BUDGET);
    usedUp();
    await owner.guard.evaluate();
    expect(await jobState(nightly)).toBe('paused');

    clock.now = Date.parse('2026-10-15T01:00:00Z');
    spend = { '2026-10-14': 6, '2026-10-15': 1 };
    await owner.guard.evaluate();
    expect(await jobState(nightly)).toBe('paused');
    expect((await owner.state()).mode).toBe('tripped');

    expect((await owner.call('PUT', '/_caduceus/api/budget-guard/settings', { liftOnNewPeriod: true })).body.liftOnNewPeriod).toBe(true);
    await owner.guard.evaluate();
    expect(await jobState(nightly)).not.toBe('paused');
    const state = await owner.state();
    expect(state.mode).toBe('armed');
    expect(state.trips[0].actions.map((action) => action.status)).toEqual(['resumed', 'resumed']);
    expect(await dispatchWould()).toBe('start');
  });
});

describe('disabling', () => {
  test('the guard can be switched off (a T2: it needs a passkey), and a guard that is off pauses nothing', async () => {
    const owner = await start();
    const nightly = await job('Nightly report');
    await owner.call('POST', '/_caduceus/api/budgets', DAY_BUDGET);
    expect((await owner.call('POST', '/_caduceus/api/budget-guard/disable')).status).toBe(403);
    await stepUp(owner.url, owner.cookie, await addPasskey(owner.url, owner.cookie));
    const off = await owner.call<GuardState>('POST', '/_caduceus/api/budget-guard/disable');
    expect(off.body).toMatchObject({ mode: 'disabled', enabled: false });
    usedUp();
    await owner.guard.evaluate();
    expect(await jobState(nightly)).not.toBe('paused');
    expect((await owner.state()).trips).toEqual([]);
    expect((await owner.call<GuardState>('POST', '/_caduceus/api/budget-guard/enable')).body.mode).toBe('armed');
  });
});

describe('the state Insights shows', () => {
  test('armed with its interval and last evaluation, and the overshoot bound that follows from them', async () => {
    const owner = await start();
    await owner.guard.evaluate();
    expect(await owner.state()).toEqual({ mode: 'armed', enabled: true, liftOnNewPeriod: false, intervalMs: 0, lastEvaluation: WEDNESDAY, trips: [] });
    clock.now += 90_000;
    await owner.guard.evaluate();
    expect((await owner.state()).lastEvaluation).toBe(WEDNESDAY + 90_000);
  });
});

describe('the lease', () => {
  test('of two Caduceus processes on one folder, only the one holding the lease reads spend and acts on a breach, and the other takes over when it lets go', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-guard-'));
    const store = openCaduceusStore(dir);
    try {
      spend = { '2026-10-14': 6 };
      clock.now = WEDNESDAY;
      const reads: string[] = [];
      const status = { id: 'b_1', amount: 5, period: 'day' as const, profile: 'default', periodStart: '2026-10-14', periodEnd: '2026-10-15', spent: 6, alerted: [] };
      const process = (owner: string) => {
        const budgets = { statuses: async () => (reads.push(owner), [status]), get: () => undefined, source: undefined, mount: () => undefined } as unknown as BudgetService;
        return createBudgetGuard({ backend: withSpend(hermes.backend), store, policy: {} as RestPolicy, budgets, lease: createLease({ file: path.join(dir, 'budget-guard.lease'), owner, ttlMs: 30_000, now: () => clock.now }), now: () => clock.now, intervalMs: 0, onFailure: (error) => { throw error; } });
      };
      const a = process('process-a');
      const b = process('process-b');
      const nightly = await job('Nightly report');
      await Promise.all([a.evaluate(), b.evaluate()]);
      expect(reads).toEqual(['process-a']);
      expect(a.state().trips).toHaveLength(1);
      expect(await jobState(nightly)).toBe('paused');

      await a.stop();
      await b.evaluate();
      expect(reads).toEqual(['process-a', 'process-b']);
      expect(b.state().trips).toHaveLength(1);
      expect(b.state().trips[0].actions).toHaveLength(2);
    } finally {
      store.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
