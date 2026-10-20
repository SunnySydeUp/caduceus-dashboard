// The budget guard (M6 #06; work model §2.6, architecture §1, risk R9): a Caduceus worker that reads spend against the budgets of Insights (M5 #05) at a set
// interval and, when a budget is used up, pauses what runs without the owner (`unattended.ts`): the Kanban dispatcher's claims and the scheduled jobs that are
// not exempt. It records only what it paused itself, each with what it takes to put it back, so Undo and the automatic lift at a new period resume exactly that
// and skip, with a reason, whatever the owner has changed since. It holds a single-writer lease like the playbook engine, so two Caduceus processes never both act.
//
// How each pause is made in Hermes 0.21.4:
//   - the dispatcher: `kanban.dispatch_profiles` in `config.yaml` is read at every dispatch tick and fails closed, so an empty list claims nothing at once while
//     workers already running finish. (`kanban.dispatch_in_gateway` is read only when the gateway starts, so it cannot stop a running dispatcher.) The key is
//     edited in the raw config text and put back as it was, absent included.
//   - a scheduled job: Hermes's own `POST /api/cron/jobs/{id}/pause` and `resume`.
// A chat session is never touched: nothing here calls anything that could pause one.
import YAML from 'yaml';
import type { Hono } from 'hono';
import { GUARD_TRIPS_SHOWN, type GuardAction, type GuardActionKind, type GuardActionStatus, type GuardMode, type GuardState, type GuardTrip } from '@caduceus/contracts/budget-guard';
import type { BudgetStatus } from '@caduceus/contracts/budgets';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { AuthEnv } from './auth-routes.ts';
import type { BudgetService } from './budgets.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { createPolledSource, type NoticeDraft, type PolledSource } from './inbox-source.ts';
import type { Lease } from './playbook-lease.ts';
import { gateRequest } from './policy-gate.ts';
import type { RestPolicy } from './policy.ts';
import { cronJobsOf, isUnattendedJob, type CronJob } from './unattended.ts';

const ROUTE = '/_caduceus/api/budget-guard';
const BODY = 4_096;
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
const DISPATCH_KEY = ['kanban', 'dispatch_profiles'] as const;
const money = (amount: number): string => `$${amount.toFixed(2)}`;

export interface GuardDeps {
  backend: HermesBackend;
  store: CaduceusStore;
  policy: RestPolicy;
  budgets: BudgetService;
  lease: Lease;
  now: () => number;
  /** How often spend is read. 0 turns the timer off (a test calls `evaluate`). */
  intervalMs: number;
  onFailure(error: Error): void;
}

export interface BudgetGuard {
  source: PolledSource;
  mount(app: Hono<AuthEnv>): void;
  /** Reads spend once now and acts on any budget that is used up (and lifts what a new period ends). Resolves when it is done. */
  evaluate(): Promise<void>;
  state(): GuardState;
  /** Whether the owner keeps a job running through a trip. */
  exempt(profile: string, jobId: string): boolean;
  begin(): void;
  stop(): Promise<void>;
}

interface TripRow { id: number; budget_id: string; amount: number; period: GuardTrip['period']; period_start: string; profile: string | null; spent: number; at: number; done: number }
interface ActionRow { id: number; trip_id: number; kind: GuardActionKind; target: string; label: string; status: GuardActionStatus; reason: string | null; at: number }

/** What a dispatcher pause needs to be put back: the claim list before it, or that there was none. */
type DispatcherTarget = { prior: { absent: true } | { list: unknown[] } };
type CronTarget = { profile: string; jobId: string; pausedAt: string | undefined };

export function createBudgetGuard({ backend, store, policy, budgets, lease, now, intervalMs, onFailure }: GuardDeps): BudgetGuard {
  const { db } = store;
  const setting = (key: string): string | undefined => (db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value;
  const put = (key: string, value: string) => db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(key, value);
  const enabled = () => setting('guard.disabled') !== '1';
  const lifts = () => setting('guard.lift-on-new-period') === '1';
  const exempt = (profile: string, jobId: string) => db.prepare('SELECT 1 FROM guard_exempt_jobs WHERE profile = ? AND job_id = ?').get(profile, jobId) !== undefined;

  const tripRows = () => db.prepare('SELECT * FROM guard_trips ORDER BY id DESC').all() as unknown as TripRow[];
  const actionRows = (tripId: number) => db.prepare('SELECT * FROM guard_actions WHERE trip_id = ? ORDER BY id').all(tripId) as unknown as ActionRow[];
  const paused = (tripId: number) => actionRows(tripId).filter((action) => action.status === 'paused');
  const holdsDispatcher = (): boolean => db.prepare("SELECT 1 FROM guard_actions WHERE kind = 'dispatcher' AND status = 'paused'").get() !== undefined;

  const record = (tripId: number, kind: GuardActionKind, target: DispatcherTarget | CronTarget, label: string) => {
    db.prepare("INSERT INTO guard_actions (trip_id, kind, target, label, status, at) VALUES (?, ?, ?, ?, 'paused', ?)").run(tripId, kind, JSON.stringify(target), label, now());
  };
  const finish = (action: ActionRow, status: GuardActionStatus, reason?: string) => {
    db.prepare('UPDATE guard_actions SET status = ?, reason = ?, at = ? WHERE id = ?').run(status, reason ?? null, now(), action.id);
  };

  const hermes = async (route: string, init?: RequestInit): Promise<Response> => backend.fetch(route, { signal: AbortSignal.timeout(20_000), ...init });

  /** The raw config as an editable document, with the claim list as it is now (`undefined` when the key is not there). */
  async function readClaims(): Promise<{ doc: YAML.Document.Parsed; claims: unknown }> {
    const res = await hermes('/api/config/raw');
    const body: unknown = await res.json().catch(() => undefined);
    if (!res.ok || !isRecord(body) || typeof body.yaml !== 'string') throw new Error(`Hermes did not give its configuration (HTTP ${res.status}).`);
    const doc = YAML.parseDocument(body.yaml, { merge: true });
    if (doc.errors.length > 0) throw new Error('Hermes’s configuration cannot be read as YAML, so the dispatcher was left alone.');
    return { doc, claims: doc.hasIn([...DISPATCH_KEY]) ? (doc.getIn([...DISPATCH_KEY]) as unknown) : undefined };
  }
  /** `getIn` answers a YAML collection for a list: the plain items. */
  const itemsOf = (value: unknown): unknown[] | undefined => (YAML.isSeq(value) ? (value.toJSON() as unknown[]) : Array.isArray(value) ? value : undefined);

  async function writeConfig(doc: YAML.Document.Parsed): Promise<void> {
    const res = await hermes('/api/config/raw', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ yaml_text: String(doc) }) });
    if (!res.ok) throw new Error(`Hermes did not take the configuration back (HTTP ${res.status}).`);
  }

  /** Sets the claim list, making the `kanban` section first when the file has none (or an empty one). */
  const setClaims = (doc: YAML.Document.Parsed, list: unknown[]) => {
    if (!YAML.isMap(doc.getIn(['kanban'], true))) doc.setIn(['kanban'], doc.createNode({}));
    doc.setIn([...DISPATCH_KEY], doc.createNode(list));
  };

  /** Stops the dispatcher claiming anything: an empty claim list. Nothing is recorded when it was already stopped that way (the owner's) or the guard holds it. */
  async function pauseDispatcher(tripId: number): Promise<void> {
    if (holdsDispatcher()) return;
    const { doc, claims } = await readClaims();
    const list = itemsOf(claims);
    // Present and empty (or null, or blank) claims nothing already: the owner's own stop.
    if (claims !== undefined && (list?.length === 0 || claims === null || (YAML.isScalar(claims) && (claims.value === null || claims.value === '')))) return;
    setClaims(doc, []);
    await writeConfig(doc);
    record(tripId, 'dispatcher', { prior: claims === undefined ? { absent: true } : { list: list ?? [YAML.isScalar(claims) ? claims.value : claims] } } satisfies DispatcherTarget, 'Kanban dispatcher');
  }

  async function restoreDispatcher(action: ActionRow): Promise<{ status: GuardActionStatus; reason?: string }> {
    const target = JSON.parse(action.target) as DispatcherTarget;
    const { doc, claims } = await readClaims();
    if (itemsOf(claims)?.length !== 0) return { status: 'skipped', reason: 'The dispatcher’s claim list was changed after the guard stopped it, so it was left as it is.' };
    if ('absent' in target.prior) doc.deleteIn([...DISPATCH_KEY]);
    else setClaims(doc, target.prior.list);
    await writeConfig(doc);
    return { status: 'resumed' };
  }

  const jobQuery = (profile: string) => `?profile=${encodeURIComponent(profile)}`;

  async function pauseJobs(tripId: number, scope: string | undefined): Promise<void> {
    const res = await hermes('/api/cron/jobs?profile=all');
    if (!res.ok) throw new Error(`Hermes did not list its scheduled jobs (HTTP ${res.status}).`);
    for (const job of cronJobsOf(await res.json().catch(() => undefined))) {
      if ((scope !== undefined && job.profile !== scope) || !isUnattendedJob(job, exempt)) continue;
      const done = await hermes(`/api/cron/jobs/${encodeURIComponent(job.id)}/pause${jobQuery(job.profile)}`, { method: 'POST' });
      if (!done.ok) throw new Error(`Hermes did not pause the job “${job.name}” (HTTP ${done.status}).`);
      const after = cronJobsOf([await done.json().catch(() => undefined)])[0];
      record(tripId, 'cron', { profile: job.profile, jobId: job.id, pausedAt: after?.pausedAt } satisfies CronTarget, `${job.name} (${job.profile})`);
    }
  }

  async function resumeJob(action: ActionRow): Promise<{ status: GuardActionStatus; reason?: string }> {
    const target = JSON.parse(action.target) as CronTarget;
    const res = await hermes(`/api/cron/jobs/${encodeURIComponent(target.jobId)}${jobQuery(target.profile)}`);
    if (res.status === 404) return { status: 'skipped', reason: 'The job no longer exists.' };
    const current: CronJob | undefined = cronJobsOf([await res.json().catch(() => undefined)])[0];
    if (current === undefined || !current.paused) return { status: 'skipped', reason: 'The owner resumed it already.' };
    if (target.pausedAt !== undefined && current.pausedAt !== target.pausedAt) return { status: 'skipped', reason: 'The owner paused it again after the guard did, so it was left paused.' };
    const done = await hermes(`/api/cron/jobs/${encodeURIComponent(target.jobId)}/resume${jobQuery(target.profile)}`, { method: 'POST' });
    if (!done.ok) throw new Error(`Hermes did not resume the job “${action.label}” (HTTP ${done.status}).`);
    return { status: 'resumed' };
  }

  /** Puts back exactly what a trip paused; whatever the owner changed since is skipped and says so. */
  async function undoTrip(tripId: number): Promise<void> {
    for (const action of paused(tripId)) {
      const outcome = action.kind === 'dispatcher' ? await restoreDispatcher(action) : await resumeJob(action);
      finish(action, outcome.status, outcome.reason);
    }
  }

  async function act(trip: TripRow): Promise<void> {
    await pauseDispatcher(trip.id);
    await pauseJobs(trip.id, trip.profile ?? undefined);
    db.prepare('UPDATE guard_trips SET done = 1 WHERE id = ?').run(trip.id);
  }

  let lastEvaluation: number | undefined = Number(setting('guard.last-evaluation')) || undefined;
  let running: Promise<void> = Promise.resolve();

  async function evaluateNow(): Promise<void> {
    if (!lease.acquire()) return;
    lastEvaluation = now();
    put('guard.last-evaluation', String(lastEvaluation));
    if (!enabled()) return;
    // A trip that did not get to the end (Hermes failed half way) is finished first.
    for (const trip of tripRows().filter((row) => row.done === 0)) await act(trip);
    const statuses: BudgetStatus[] = await budgets.statuses();
    for (const status of statuses) {
      if (status.spent === undefined || status.spent < status.amount) continue;
      const made = db.prepare('INSERT OR IGNORE INTO guard_trips (budget_id, amount, period, period_start, profile, spent, at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(status.id, status.amount, status.period, status.periodStart, status.profile ?? null, status.spent, now());
      if (made.changes === 0) continue;
      await act(db.prepare('SELECT * FROM guard_trips WHERE id = ?').get(made.lastInsertRowid) as unknown as TripRow);
      source.refresh();
    }
    if (lifts()) {
      const current = new Map(statuses.map((status) => [status.id, status.periodStart]));
      for (const trip of tripRows()) {
        if (trip.done === 1 && paused(trip.id).length > 0 && current.get(trip.budget_id) !== trip.period_start) {
          await undoTrip(trip.id);
          source.refresh();
        }
      }
    }
  }

  function evaluate(): Promise<void> {
    running = running.then(() => evaluateNow()).catch((error: unknown) => onFailure(error instanceof Error ? error : new Error(String(error))));
    return running;
  }

  const actionOf = (row: ActionRow): GuardAction => ({ id: row.id, kind: row.kind, label: row.label, status: row.status, ...(row.reason === null ? {} : { reason: row.reason }), at: row.at });
  const tripOf = (row: TripRow): GuardTrip => {
    const actions = actionRows(row.id).map(actionOf);
    return { id: row.id, budgetId: row.budget_id, amount: row.amount, period: row.period, periodStart: row.period_start, profile: row.profile ?? undefined, spent: row.spent, at: row.at, actions, settled: row.done === 1 && actions.every((action) => action.status !== 'paused') };
  };

  function state(): GuardState {
    const trips = tripRows().slice(0, GUARD_TRIPS_SHOWN).map(tripOf);
    const mode: GuardMode = !enabled() ? 'disabled' : trips.some((trip) => !trip.settled) ? 'tripped' : 'armed';
    return { mode, enabled: enabled(), liftOnNewPeriod: lifts(), intervalMs, lastEvaluation, trips };
  }

  const source = createPolledSource({
    now,
    pollMs: 60_000,
    firstReadMs: 1,
    read: async () =>
      tripRows()
        .map(tripOf)
        .filter((trip) => !trip.settled)
        .map((trip): NoticeDraft => {
          const id = `budget:guard:${trip.id}`;
          const scope = trip.profile === undefined ? 'every profile' : `the “${trip.profile}” profile`;
          const held = trip.actions.filter((action) => action.status === 'paused').map((action) => action.label);
          return {
            id,
            ref: id,
            stamp: '',
            group: 'failed',
            category: 'budget',
            profile: trip.profile,
            at: trip.at,
            title: `Budget used up: unattended work is paused`,
            detail: `${money(trip.spent)} spent against the ${money(trip.amount)} ${trip.period === 'day' ? 'daily' : trip.period === 'week' ? 'weekly' : 'monthly'} budget for ${scope}. The budget guard paused ${held.length === 0 ? 'nothing (it was already stopped)' : held.join(', ')}. Chats are not affected.`,
            actions: [
              { id: 'raise', label: 'Raise budget', request: { method: 'POST', path: `${ROUTE}/raise`, body: { budgetId: trip.budgetId } }, confirm: { title: 'Raise this budget?', text: `The new amount replaces ${money(trip.amount)}. Nothing is resumed until you undo the guard’s actions.`, object: 'the budget', confirmLabel: 'Raise budget' }, input: { field: 'amount', label: 'New amount (USD)', required: true } },
              { id: 'undo', label: 'Undo guard actions', request: { method: 'POST', path: `${ROUTE}/undo`, body: { tripId: trip.id } }, confirm: { title: 'Undo the guard’s actions?', text: held.length === 0 ? 'Nothing is paused by the guard.' : `This resumes exactly what the guard paused: ${held.join(', ')}. Anything you changed since is left as it is.`, object: 'the guard’s pauses', confirmLabel: 'Resume' }, primary: true },
            ],
            link: { label: 'Open spend', to: '/observe/insights' },
          };
        }),
  });

  let timer: NodeJS.Timeout | undefined;

  return {
    source,
    evaluate,
    state,
    exempt,
    begin() {
      if (intervalMs > 0 && timer === undefined) {
        timer = setInterval(() => void evaluate(), intervalMs);
        timer.unref();
      }
      void evaluate();
    },
    async stop() {
      clearInterval(timer);
      timer = undefined;
      await running;
      lease.release();
    },
    mount(app) {
      app.get(ROUTE, (c) => c.json(state()));

      app.post(`${ROUTE}/enable`, async (c) => {
        const gated = await gateRequest(policy, c, 'POST', BODY);
        if ('refusal' in gated) return gated.refusal;
        put('guard.disabled', '0');
        void evaluate();
        return c.json(state());
      });
      app.post(`${ROUTE}/disable`, async (c) => {
        const gated = await gateRequest(policy, c, 'POST', BODY);
        if ('refusal' in gated) return gated.refusal;
        put('guard.disabled', '1');
        return c.json(state());
      });
      app.put(`${ROUTE}/settings`, async (c) => {
        const gated = await gateRequest(policy, c, 'PUT', BODY);
        if ('refusal' in gated) return gated.refusal;
        if (!isRecord(gated.body) || typeof gated.body.liftOnNewPeriod !== 'boolean') return c.json({ error: 'bad-request' }, 400);
        put('guard.lift-on-new-period', gated.body.liftOnNewPeriod ? '1' : '0');
        return c.json(state());
      });

      /** Undo guard actions: every trip that still holds a pause, or one trip. The owner confirms (T1); the dialog names what resumes. */
      app.post(`${ROUTE}/undo`, async (c) => {
        const gated = await gateRequest(policy, c, 'POST', BODY);
        if ('refusal' in gated) return gated.refusal;
        const only = isRecord(gated.body) && typeof gated.body.tripId === 'number' ? gated.body.tripId : undefined;
        try {
          for (const trip of tripRows().filter((row) => only === undefined || row.id === only)) await undoTrip(trip.id);
        } catch (error) {
          return c.json({ error: 'hermes-unavailable', message: error instanceof Error ? error.message : 'Hermes did not answer.' }, 502);
        }
        source.refresh();
        return c.json(state());
      });

      /** Raises a budget from the Inbox item (T1). The amount comes as the owner typed it. */
      app.post(`${ROUTE}/raise`, async (c) => {
        const gated = await gateRequest(policy, c, 'POST', BODY);
        if ('refusal' in gated) return gated.refusal;
        const body = gated.body;
        const amount = isRecord(body) ? Number(body.amount) : Number.NaN;
        const budget = isRecord(body) && typeof body.budgetId === 'string' ? budgets.get(body.budgetId) : undefined;
        if (!isRecord(body) || budget === undefined) return c.json({ error: 'not-found', message: 'That budget is gone.' }, 404);
        if (!Number.isFinite(amount) || amount <= budget.amount || Math.round(amount * 100) !== amount * 100 || amount > 1_000_000) return c.json({ error: 'bad-request', message: `Give an amount above ${money(budget.amount)}, to the cent.` }, 400);
        db.prepare('UPDATE budgets SET amount = ? WHERE id = ?').run(amount, budget.id);
        db.prepare('DELETE FROM budget_alerts WHERE budget_id = ?').run(budget.id);
        void evaluate();
        return c.json({ ...budget, amount });
      });

      app.get('/_caduceus/api/work/jobs/:profile/:jobId/guard-exempt', (c) => {
        const { profile, jobId } = c.req.param();
        if (!NAME.test(profile) || !NAME.test(jobId)) return c.json({ error: 'bad-request' }, 400);
        return c.json({ exempt: exempt(profile, jobId) });
      });
      app.put('/_caduceus/api/work/jobs/:profile/:jobId/guard-exempt', async (c) => {
        const gated = await gateRequest(policy, c, 'PUT', BODY);
        if ('refusal' in gated) return gated.refusal;
        const { profile, jobId } = c.req.param();
        if (!NAME.test(profile) || !NAME.test(jobId) || !isRecord(gated.body) || typeof gated.body.exempt !== 'boolean') return c.json({ error: 'bad-request' }, 400);
        if (gated.body.exempt) db.prepare('INSERT OR IGNORE INTO guard_exempt_jobs (profile, job_id) VALUES (?, ?)').run(profile, jobId);
        else db.prepare('DELETE FROM guard_exempt_jobs WHERE profile = ? AND job_id = ?').run(profile, jobId);
        return c.json({ exempt: gated.body.exempt });
      });
    },
  };
}
