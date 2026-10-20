// Budgets (M5 #05; Caduceus-owned, R9): an amount per period, optionally for one profile. Caduceus keeps the definitions and which alerts it has raised and
// nothing of what was spent: spend is read from Hermes's usage analytics every time it is asked for (D1). When a period's spend reaches 80% or 100% of a
// budget an item goes to the Inbox (a notice whose `ref` starts `budget:`, which the push watcher sends under the Budget category). The alert is written to
// the store the first time usage is seen at or over the threshold, and is the item for as long as the period lasts, so it is raised once per period however
// often usage is read, and a restart of Caduceus neither forgets nor repeats it. Enforcement (the hard stop) is M6 #06 and not here.
import { randomBytes } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { BUDGET_THRESHOLDS, MAX_BUDGETS, periodBounds, percentSpent, readBudgetInput, spentSince, type Budget, type BudgetInput, type BudgetPeriod, type BudgetStatus, type BudgetThreshold, type Budgets } from '@caduceus/contracts/budgets';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { authClient, type AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import type { GatewayObserver } from './gateway-observer.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { readBody } from './hermes-proxy.ts';
import { createPolledSource, type NoticeDraft, type PolledSource } from './inbox-source.ts';
import type { RestPolicy } from './policy.ts';

const ROUTE = '/_caduceus/api/budgets';
const MAX_BODY = 4_096;
/** Usage is asked for this many days back: a month is at most 31 days, and Hermes counts back from now. */
const LOOKBACK_DAYS = 32;

interface BudgetRow {
  id: string;
  amount: number;
  period: BudgetPeriod;
  profile: string | null;
}

const toBudget = (row: BudgetRow): Budget => ({ id: row.id, amount: row.amount, period: row.period, profile: row.profile ?? undefined });

const PERIOD_WORDS: Record<BudgetPeriod, string> = { day: 'daily', week: 'weekly', month: 'monthly' };
const money = (amount: number): string => `$${amount.toFixed(2)}`;

export interface BudgetService {
  /** The Inbox's source of budget alerts. */
  source: PolledSource;
  mount(app: Hono<AuthEnv>): void;
  /** Every budget with what its period has cost, read from Hermes now. */
  statuses(): Promise<BudgetStatus[]>;
  /** A budget's definition, or `undefined` when it is gone. */
  get(id: string): Budget | undefined;
}

export interface BudgetDeps {
  backend: HermesBackend;
  store: CaduceusStore;
  policy: RestPolicy;
  observer: GatewayObserver;
  now: () => number;
  /** How often usage is read again besides when Hermes says sessions moved. */
  pollMs: number;
}

export function createBudgets({ backend, store, policy, observer, now, pollMs }: BudgetDeps): BudgetService {
  const { db } = store;
  const rows = () => db.prepare('SELECT id, amount, period, profile FROM budgets ORDER BY rowid').all() as unknown as BudgetRow[];
  const find = (id: string) => db.prepare('SELECT id, amount, period, profile FROM budgets WHERE id = ?').get(id) as BudgetRow | undefined;

  const askHermes = async (route: string): Promise<unknown> => {
    const res = await backend.fetch(route, { signal: AbortSignal.timeout(20_000) }).catch(() => undefined);
    return res?.ok ? await res.json().catch(() => undefined) : undefined;
  };

  /** Usage analytics of every profile the budgets need (all of them for a budget that names none), by name; `undefined` for a profile Hermes did not answer for. */
  async function readUsage(budgets: readonly Budget[]): Promise<Map<string, unknown>> {
    const names = new Set<string>();
    for (const budget of budgets) if (budget.profile !== undefined) names.add(budget.profile);
    if (budgets.some((budget) => budget.profile === undefined)) {
      const listed = await askHermes('/api/profiles');
      for (const entry of isRecord(listed) && Array.isArray(listed.profiles) ? listed.profiles : []) if (isRecord(entry) && typeof entry.name === 'string') names.add(entry.name);
    }
    const answers = await Promise.all([...names].map(async (name) => [name, await askHermes(`/api/analytics/usage?days=${LOOKBACK_DAYS}&profile=${encodeURIComponent(name)}`)] as const));
    return new Map(answers);
  }

  /**
   * What the budget's period has cost so far, over the profiles Hermes answered for (one it cannot read, a profile that has no sessions database yet, counts
   * as nothing spent); `undefined` when Hermes answered for none of the profiles the budget covers.
   */
  function spentIn(budget: Budget, start: string, usage: ReadonlyMap<string, unknown>): number | undefined {
    const covered = budget.profile === undefined ? [...usage.values()] : [usage.get(budget.profile)];
    const answered = covered.filter((answer) => answer !== undefined);
    return answered.length === 0 ? undefined : spentSince(answered, start);
  }

  const alertsOf = (id: string, start: string) => (db.prepare('SELECT threshold, at FROM budget_alerts WHERE budget_id = ? AND period_start = ? ORDER BY threshold').all(id, start) as unknown as { threshold: BudgetThreshold; at: number }[]);

  async function statuses(): Promise<BudgetStatus[]> {
    const budgets = rows().map(toBudget);
    const usage = await readUsage(budgets);
    return budgets.map((budget) => {
      const { start, end } = periodBounds(budget.period, now());
      return { ...budget, periodStart: start, periodEnd: end, spent: spentIn(budget, start, usage), alerted: alertsOf(budget.id, start).map((alert) => alert.threshold) };
    });
  }

  /** Writes the alerts that usage has reached and no earlier look had, and says what every alert of a current period is. */
  async function alerts(): Promise<NoticeDraft[]> {
    const current = await statuses();
    for (const status of current) {
      if (status.spent === undefined) continue;
      for (const threshold of BUDGET_THRESHOLDS) {
        if (percentSpent(status.spent, status.amount) >= threshold) db.prepare('INSERT OR IGNORE INTO budget_alerts (budget_id, period_start, threshold, at) VALUES (?, ?, ?, ?)').run(status.id, status.periodStart, threshold, now());
      }
    }
    return current.flatMap((status) =>
      alertsOf(status.id, status.periodStart).map(({ threshold, at }): NoticeDraft => {
        const id = `budget:${status.id}:${status.periodStart}:${threshold}`;
        const scope = status.profile === undefined ? 'every profile' : `the “${status.profile}” profile`;
        const spent = status.spent === undefined ? '' : `${money(status.spent)} of the `;
        return {
          id,
          ref: id,
          stamp: '',
          group: threshold >= 100 ? 'failed' : 'fyi',
          category: 'budget',
          profile: status.profile,
          at,
          title: threshold >= 100 ? `Budget used up: ${money(status.amount)} ${status.period === 'day' ? 'today' : `this ${status.period}`}` : `${threshold}% of a budget is spent`,
          detail: `${spent}${money(status.amount)} ${PERIOD_WORDS[status.period]} budget for ${scope}, counted from ${status.periodStart} (UTC). Caduceus tells you; it does not stop anything.`,
          actions: [],
          link: { label: 'Open Insights', to: '/observe/insights' },
        };
      }),
    );
  }

  const source = createPolledSource({ read: alerts, now, pollMs, wake: (refresh) => observer.onEvent((type) => type === 'sessions.changed' && refresh()) });

  /** Runs the request through the policy (its tier, read-only mode, the audit entry) and reads its JSON body, or says what refused it. */
  async function gate(c: Context<AuthEnv, string>, method: string): Promise<{ refusal: Response } | { body: unknown }> {
    const url = new URL(c.req.url);
    const requester = { sessionId: c.get('session')?.id, source: authClient(c).source };
    const prepared = policy.prepare(method, url.pathname, requester);
    if (!prepared.allow) return { refusal: c.json(prepared.body, prepared.status) };
    const raw = await readBody(c.req.raw, MAX_BODY);
    if (raw === 'too-large') return { refusal: c.json({ error: 'payload-too-large' }, 413) };
    const decision = await policy.decide(prepared, { method, search: url.search, contentType: c.req.header('content-type'), confirmation: c.req.header('x-caduceus-confirmation'), body: raw }, requester);
    if (!decision.allow) return { refusal: c.json(decision.body, decision.status) };
    try {
      return { body: raw.length === 0 ? undefined : (JSON.parse(Buffer.from(raw).toString('utf8')) as unknown) };
    } catch {
      return { body: undefined };
    }
  }

  const store_ = (input: BudgetInput) => [input.amount, input.period, input.profile ?? null] as const;

  return {
    source,
    statuses,
    get: (id) => {
      const row = find(id);
      return row === undefined ? undefined : toBudget(row);
    },
    mount(app) {
      app.get(ROUTE, async (c) => c.json({ budgets: await statuses() } satisfies Budgets));

      app.post(ROUTE, async (c) => {
        const gated = await gate(c, 'POST');
        if ('refusal' in gated) return gated.refusal;
        const input = readBudgetInput(gated.body);
        if (!input) return c.json({ error: 'bad-request' }, 400);
        if (rows().length >= MAX_BUDGETS) return c.json({ error: 'too-many-budgets', message: `Caduceus keeps up to ${MAX_BUDGETS} budgets.` }, 409);
        const budget: Budget = { id: `b_${randomBytes(5).toString('hex')}`, ...input };
        db.prepare('INSERT INTO budgets (id, amount, period, profile, created_at) VALUES (?, ?, ?, ?, ?)').run(budget.id, ...store_(input), now());
        source.refresh();
        return c.json(budget, 201);
      });

      app.put(`${ROUTE}/:id`, async (c) => {
        const gated = await gate(c, 'PUT');
        if ('refusal' in gated) return gated.refusal;
        const input = readBudgetInput(gated.body);
        if (!input) return c.json({ error: 'bad-request' }, 400);
        const id = c.req.param('id');
        if (!find(id)) return c.json({ error: 'not-found' }, 404);
        // A different amount, period or profile is a different budget: what was alerted for the old one says nothing about it.
        db.prepare('UPDATE budgets SET amount = ?, period = ?, profile = ? WHERE id = ?').run(...store_(input), id);
        db.prepare('DELETE FROM budget_alerts WHERE budget_id = ?').run(id);
        source.refresh();
        return c.json({ id, ...input } satisfies Budget);
      });

      app.delete(`${ROUTE}/:id`, async (c) => {
        const gated = await gate(c, 'DELETE');
        if ('refusal' in gated) return gated.refusal;
        const { changes } = db.prepare('DELETE FROM budgets WHERE id = ?').run(c.req.param('id'));
        source.refresh();
        return changes === 0 ? c.json({ error: 'not-found' }, 404) : c.body(null, 204);
      });
    },
  };
}
