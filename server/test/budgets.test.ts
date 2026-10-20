import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { AuditEntry } from '@caduceus/contracts/caduceus-api';
import type { Budget, Budgets } from '@caduceus/contracts/budgets';
import type { InboxItem } from '@caduceus/contracts/inbox';
import type { HermesBackend } from '../src/hermes-backend.ts';
import { startCaduceusServer, type CaduceusServer, type CaduceusServerOptions } from '../src/caduceus-server.ts';
import type { ConfirmRequest } from '../../web/src/palette.ts';
import { createTieredFetch } from '../../web/src/tiered-fetch.ts';
import { createBudgetsClient } from '../../web/src/modules/insights/budgets-model.ts';
import { fakeHermesInstall, launchFakeHermes, scriptFakeHermes } from './fixtures/fake-hermes.ts';
import { ownerCookie } from './fixtures/owner.ts';
import { addPasskey, stepUp } from './fixtures/step-up.ts';
import type { SoftwareAuthenticator } from './fixtures/software-authenticator.ts';
import { startPushStub, type PushStub } from './fixtures/push-stub.ts';

// Budgets (M5 #05) at the Caduceus HTTP seam: definitions are Caduceus's own, spend is whatever Hermes's usage analytics say (a stub upstream here: the
// fake Hermes, whose analytics answers a test scripts), and crossing 80% or 100% of a budget puts one item in the Inbox, once per period, on a clock the
// test moves by hand.
let backend: HermesBackend | undefined;
let server: CaduceusServer | undefined;
let stub: PushStub | undefined;
/** The owner's passkey, made once per store: adding a push subscription is a T2. */
let authenticator: SoftwareAuthenticator | undefined;
let tempDirs: string[] = [];
afterEach(async () => {
  await stub?.close();
  stub = undefined;
  await server?.close();
  await backend?.stop();
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
  server = undefined;
  backend = undefined;
  tempDirs = [];
});

/** Wednesday 14 October 2026, noon UTC. */
const WEDNESDAY = Date.parse('2026-10-14T12:00:00Z');
let clock = WEDNESDAY;

/** `GET /api/analytics/usage` as Hermes answers it for one profile: a row per UTC day. */
const usage = (rows: Record<string, number>) => ({ daily: Object.entries(rows).map(([day, cost]) => ({ day, estimated_cost: cost, actual_cost: 0, input_tokens: 100, output_tokens: 50 })) });
const analytics = (profile: string, rows: Record<string, number>) => ({ [`/api/analytics/usage?days=32&profile=${profile}`]: usage(rows) });

/** A call to the Caduceus API as the signed-in owner; `T` is the body the test expects back. */
type Call = <T = unknown>(method: string, route: string, body?: unknown) => Promise<{ status: number; body: T }>;

interface Owner {
  url: string;
  call: Call;
  backend: HermesBackend;
  hermesRoot: string;
  cookie: string;
}

async function start(options: Partial<CaduceusServerOptions> & { keepRoot?: string } = {}): Promise<Owner> {
  clock = WEDNESDAY;
  backend ??= launchFakeHermes();
  const { keepRoot, ...serverOptions } = options;
  const hermesRoot = keepRoot ?? fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-root-'));
  const hermesInstallDir = fakeHermesInstall();
  tempDirs.push(hermesInstallDir, ...(keepRoot ? [] : [hermesRoot]));
  server = await startCaduceusServer({ backend, hermesRoot, hermesInstallDir, now: () => clock, inboxPollMs: 20, inboxReadMs: 40, budgetReadMs: 40, pushTickMs: 15, allowLoopbackPush: true, ...serverOptions });
  const url = server.url;
  const cookie = await ownerCookie(url);
  if (!keepRoot) authenticator = await addPasskey(url, cookie);
  const call: Call = async <T,>(method: string, route: string, body?: unknown) => {
    const res = await fetch(`${url}${route}`, { method, headers: { origin: url, cookie: `${cookie}; caduceus_device=${'a'.repeat(32)}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    return { status: res.status, body: (text ? JSON.parse(text) : undefined) as T };
  };
  return { url, call, backend: backend!, hermesRoot, cookie };
}

const listed = async (call: Call) => (await call<Budgets>('GET', '/_caduceus/api/budgets')).body.budgets;
/** Used by the alert tests below. */
const inboxItems = async (call: Call) => (await call<{ items: InboxItem[] }>('GET', '/_caduceus/api/inbox')).body.items;

/** Every profile of the fake Hermes (`default`, `coder`, `librarian`) answers usage analytics, with `rows` for `default` and nothing for the others. */
const spend = (rows: Record<string, number>) => ({ ...analytics('default', rows), ...analytics('coder', {}), ...analytics('librarian', {}) });

describe('the page’s budgets client', () => {
  test('asks the Tier 1 confirmation, naming what the budget is, before it adds, changes or deletes one, and does nothing when the owner declines or read-only mode is on', async () => {
    const owner = await start();
    await scriptFakeHermes(owner.backend, spend({ '2026-10-13': 6 }));
    const dialogs: ConfirmRequest[] = [];
    let confirm = true;
    let readOnly = false;
    const send = createTieredFetch({
      fetch: (route, init) => fetch(`${owner.url}${route}`, { ...init, headers: { origin: owner.url, cookie: owner.cookie, ...Object.fromEntries(new Headers(init.headers)) } }),
      confirmer: () => async (request) => {
        dialogs.push(request);
        return confirm ? { typed: request.object ?? request.label } : undefined;
      },
      withStepUp: (request) => request(),
      online: () => true,
      readOnly: () => readOnly,
      sha256: async (text) => crypto.createHash('sha256').update(text).digest('hex'),
    });
    const client = createBudgetsClient({ send, read: async (route) => (await fetch(`${owner.url}${route}`, { headers: { cookie: owner.cookie } })).json() });

    confirm = false;
    expect(await client.add({ amount: 10, period: 'week', profile: undefined })).toEqual({ kind: 'cancelled' });
    expect(await client.list()).toEqual([]);
    confirm = true;
    expect(await client.add({ amount: 10, period: 'week', profile: undefined })).toEqual({ kind: 'done' });
    const [added] = await client.list();
    expect(added).toMatchObject({ amount: 10, period: 'week', spent: 6, periodStart: '2026-10-12' });
    expect(await client.change(added!.id, { amount: 25, period: 'month', profile: 'coder' })).toEqual({ kind: 'done' });
    const [changed] = await client.list();
    expect(changed).toMatchObject({ amount: 25, period: 'month', profile: 'coder', spent: 0 });
    expect(await client.change('b_missing', { amount: 1, period: 'day', profile: undefined })).toEqual({ kind: 'failed', message: 'That budget is already gone. Reload the list.' });
    expect(await client.remove(changed!)).toEqual({ kind: 'done' });
    expect(await client.list()).toEqual([]);

    expect(dialogs.map((dialog) => [dialog.tier, dialog.label])).toEqual([
      ['T1', 'Add this budget?'],
      ['T1', 'Add this budget?'],
      ['T1', 'Change this budget?'],
      ['T1', 'Change this budget?'],
      ['T1', 'Delete this budget?'],
    ]);
    expect(dialogs[0]!.text).toContain('$10.00 weekly for every profile');
    expect(dialogs[2]!.text).toContain('$25.00 monthly for the “coder” profile');

    readOnly = true;
    expect(await client.add({ amount: 1, period: 'day', profile: undefined })).toMatchObject({ kind: 'failed', message: 'Read-only mode is on: Caduceus is not changing anything in Hermes.' });
    expect(await client.list()).toEqual([]);
  });
});

describe('budget input', () => {
  test('refuses what is not a budget (no amount, a fraction of a cent, an unknown period, a profile that is not a name), an unknown id, and more than 50', async () => {
    const { call } = await start();

    const refused = await Promise.all([
      call('POST', '/_caduceus/api/budgets', { period: 'month' }),
      call('POST', '/_caduceus/api/budgets', { amount: 0, period: 'month' }),
      call('POST', '/_caduceus/api/budgets', { amount: 1.005, period: 'month' }),
      call('POST', '/_caduceus/api/budgets', { amount: 5, period: 'year' }),
      call('POST', '/_caduceus/api/budgets', { amount: 5, period: 'day', profile: '../x' }),
      call('PUT', '/_caduceus/api/budgets/b_missing', { amount: 5, period: 'day' }),
      call('DELETE', '/_caduceus/api/budgets/b_missing'),
    ]);

    expect(refused.map((reply) => reply.status)).toEqual([400, 400, 400, 400, 400, 404, 404]);
    for (let n = 0; n < 50; n++) expect((await call('POST', '/_caduceus/api/budgets', { amount: 1, period: 'day' })).status).toBe(201);
    expect((await call('POST', '/_caduceus/api/budgets', { amount: 1, period: 'day' })).status).toBe(409);
  });

  test('shows a budget with no spend when Hermes answers for no profile, and raises no alert from what it cannot know', async () => {
    const { call, backend: hermes } = await start();
    await scriptFakeHermes(hermes, { '/api/profiles': { profiles: [] } });
    await call('POST', '/_caduceus/api/budgets', { amount: 1, period: 'day', profile: 'ghost' });

    const [status] = await listed(call);

    expect(status).toMatchObject({ amount: 1, period: 'day', periodStart: '2026-10-14' });
    expect(status!.spent).toBeUndefined();
    expect((await inboxItems(call)).filter((item) => item.ref.startsWith('budget:'))).toEqual([]);
  });
});

describe('budget definitions', () => {
  test('are made, changed and deleted by the owner, listed with this period’s spend from Hermes’s analytics, and audited as T1', async () => {
    const { call, backend: hermes } = await start();
    await scriptFakeHermes(hermes, { ...analytics('default', { '2026-10-12': 2.5, '2026-10-14': 1, '2026-09-30': 99 }), ...analytics('coder', { '2026-10-13': 4 }) });

    const made = await call<Budget>('POST', '/_caduceus/api/budgets', { amount: 50, period: 'month' });
    const scoped = await call<Budget>('POST', '/_caduceus/api/budgets', { amount: 10, period: 'week', profile: 'coder' });

    expect(made.status).toBe(201);
    expect(scoped.status).toBe(201);
    const [month, week] = [made.body, scoped.body];
    expect(month).toMatchObject({ amount: 50, period: 'month' });
    // Every profile's spend this month (the 30th of September is last month's), and the coder's alone for the week (Monday 12th to Sunday 18th).
    expect(await listed(call)).toEqual([
      { ...month, periodStart: '2026-10-01', periodEnd: '2026-11-01', spent: 7.5, alerted: [] },
      { ...week, periodStart: '2026-10-12', periodEnd: '2026-10-19', spent: 4, alerted: [] },
    ]);

    const changed = await call('PUT', `/_caduceus/api/budgets/${week.id}`, { amount: 20, period: 'day', profile: 'coder' });
    expect(changed.body).toEqual({ id: week.id, amount: 20, period: 'day', profile: 'coder' });
    expect((await call('DELETE', `/_caduceus/api/budgets/${month.id}`)).status).toBe(204);
    expect((await listed(call)).map((budget) => [budget.id, budget.spent])).toEqual([[week.id, 0]]);

    const audit = (await call<{ entries: AuditEntry[] }>('GET', '/_caduceus/api/audit')).body.entries;
    // The audit log lists the newest first.
    expect(audit.filter((entry) => entry.action.includes('/budgets')).map((entry) => [entry.action, entry.tier])).toEqual([
      ['DELETE /_caduceus/api/budgets/{id}', 'T1'],
      ['PUT /_caduceus/api/budgets/{id}', 'T1'],
      ['POST /_caduceus/api/budgets', 'T1'],
      ['POST /_caduceus/api/budgets', 'T1'],
    ]);
  });
});

describe('budget alerts', () => {
  test('at 80% and at 100% each raise one Inbox item and one push per period, however often usage is read and across a restart of Caduceus; the next period raises them again', async () => {
    stub = await startPushStub();
    const owner = await start();
    const { call } = owner;
    await scriptFakeHermes(owner.backend, spend({ '2026-10-12': 3 }));
    const device = stub.subscribe();
    await stepUp(owner.url, owner.cookie, authenticator!);
    const subscribed = await call('PUT', '/_caduceus/api/push/subscription', { subscription: device.subscription, origin: owner.url, settings: { categories: { failures: false } } });
    expect(subscribed.status).toBe(200);
    const budget = (await call<Budget>('POST', '/_caduceus/api/budgets', { amount: 10, period: 'week' })).body;
    const budgetItems = async () => (await inboxItems(call)).filter((item) => item.ref.startsWith('budget:'));
    const [earlier, later] = [`budget:${budget.id}:2026-10-12:80`, `budget:${budget.id}:2026-10-12:100`];

    // 30%: nothing to say.
    expect(await budgetItems()).toEqual([]);

    await scriptFakeHermes(owner.backend, spend({ '2026-10-12': 3, '2026-10-14': 5.5 }));
    const eighty = await device.next();
    expect(eighty.message.notification.title).toBe('80% of a budget is spent');
    expect(eighty.message.notification.body).toContain('$8.50 of the $10.00 weekly budget for every profile');
    expect(await budgetItems()).toMatchObject([{ id: earlier, kind: 'notice', group: 'fyi', category: 'budget', link: { to: '/observe/insights' } }]);

    await scriptFakeHermes(owner.backend, spend({ '2026-10-12': 3, '2026-10-14': 8 }));
    const hundred = await device.next();
    expect(hundred.message.notification.title).toBe('Budget used up: $10.00 this week');
    expect(
      (await budgetItems()).map((item) => [item.id, item.group]).toSorted(),
    ).toEqual([[earlier, 'fyi'], [later, 'failed']].toSorted());
    expect((await listed(call))[0]).toMatchObject({ spent: 11, alerted: [80, 100] });

    // Caduceus restarts on the same store: the alerts are still the Inbox items, and nobody is told again.
    await server!.close();
    const again = await start({ keepRoot: owner.hermesRoot });
    expect((await inboxItems(again.call)).filter((item) => item.ref.startsWith('budget:')).map((item) => item.id).toSorted()).toEqual([earlier, later].toSorted());
    // The next period (Monday 19 October): last week's alerts go with it, and 9 dollars of 10 is 80% of a new week, told once more.
    clock = Date.parse('2026-10-19T08:00:00Z');
    await scriptFakeHermes(owner.backend, spend({ '2026-10-14': 8, '2026-10-19': 9 }));
    const nextWeek = await device.next();

    expect(nextWeek.message.notification.title).toBe('80% of a budget is spent');
    expect((await inboxItems(again.call)).filter((item) => item.ref.startsWith('budget:')).map((item) => item.id)).toEqual([`budget:${budget.id}:2026-10-19:80`]);
    expect(device.received).toBe(3);
  });
});
