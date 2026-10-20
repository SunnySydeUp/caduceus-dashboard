// Budgets as the Insights page shows and changes them (M5 #05), free of the DOM and of React. The list and its spend come from the Caduceus server
// (`/_caduceus/api/budgets`, which reads Hermes's usage analytics each time); making, changing and deleting a budget are Tier 1.
import { BUDGET_PERIODS, BUDGET_THRESHOLDS, percentSpent, spendPace, type BudgetInput, type BudgetPeriod, type BudgetStatus, type BudgetThreshold } from '@caduceus/contracts/budgets';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { TieredRequest, TieredResult } from '../../tiered-fetch.ts';

const ROUTE = '/_caduceus/api/budgets';

export const PERIOD_WORDS: Record<BudgetPeriod, { noun: string; adjective: string; current: string }> = {
  day: { noun: 'day', adjective: 'Daily', current: 'today' },
  week: { noun: 'week', adjective: 'Weekly', current: 'this week' },
  month: { noun: 'month', adjective: 'Monthly', current: 'this month' },
};

export const dollars = (usd: number): string => `$${usd >= 100 ? Math.round(usd).toLocaleString('en') : usd.toFixed(2)}`;

/** The list the server answered; a row that is not a budget is left out. */
export function parseBudgets(body: unknown): BudgetStatus[] {
  const rows = isRecord(body) && Array.isArray(body.budgets) ? body.budgets : [];
  return rows.flatMap((row): BudgetStatus[] => {
    if (!isRecord(row) || typeof row.id !== 'string' || typeof row.amount !== 'number' || typeof row.periodStart !== 'string' || typeof row.periodEnd !== 'string') return [];
    if (typeof row.period !== 'string' || !(BUDGET_PERIODS as readonly string[]).includes(row.period)) return [];
    const alerted = Array.isArray(row.alerted) ? row.alerted.filter((value): value is BudgetThreshold => (BUDGET_THRESHOLDS as readonly number[]).includes(Number(value))) : [];
    return [{ id: row.id, amount: row.amount, period: row.period as BudgetPeriod, profile: typeof row.profile === 'string' ? row.profile : undefined, periodStart: row.periodStart, periodEnd: row.periodEnd, spent: typeof row.spent === 'number' ? row.spent : undefined, alerted }];
  });
}

export interface BudgetView {
  /** The name the list shows: "Monthly · every profile". */
  title: string;
  /** Percent of the amount spent (can pass 100), or `undefined` when Hermes could not say. */
  percent: number | undefined;
  tone: 'ok' | 'warning' | 'danger' | 'unknown';
  /** One line: "$8.50 of $10.00 this week". */
  summary: string;
  /** Where spending is heading at this pace: "On this pace $14.20 by the end of the week", or `undefined` with no spend to project. */
  pace: string | undefined;
  /** Whether the pace goes over the amount. */
  paceOver: boolean;
}

export function budgetView(budget: BudgetStatus, now: number): BudgetView {
  const words = PERIOD_WORDS[budget.period];
  const title = `${words.adjective} · ${budget.profile === undefined ? 'every profile' : budget.profile}`;
  if (budget.spent === undefined) return { title, percent: undefined, tone: 'unknown', summary: `Hermes did not say what was spent ${words.current}. Budget ${dollars(budget.amount)}.`, pace: undefined, paceOver: false };
  const percent = percentSpent(budget.spent, budget.amount);
  const { projected } = spendPace(budget.spent, { start: budget.periodStart, end: budget.periodEnd }, now);
  return {
    title,
    percent,
    tone: percent >= 100 ? 'danger' : percent >= 80 ? 'warning' : 'ok',
    summary: `${dollars(budget.spent)} of ${dollars(budget.amount)} ${words.current}`,
    pace: budget.spent > 0 ? `At this pace ${dollars(projected)} by the end of the ${words.noun}` : undefined,
    paceOver: projected > budget.amount,
  };
}

/** The words of a form's budget, for the confirmation dialog and the toast. */
export const describeBudget = (input: BudgetInput): string => `${dollars(input.amount)} ${PERIOD_WORDS[input.period].adjective.toLowerCase()} for ${input.profile === undefined ? 'every profile' : `the “${input.profile}” profile`}`;

export type BudgetOutcome = { kind: 'done' } | { kind: 'cancelled' } | { kind: 'failed'; message: string };

const GENERIC: Record<string, string> = {
  'bad-request': 'Caduceus did not accept that budget. Give an amount above zero, in dollars and cents.',
  'not-found': 'That budget is already gone. Reload the list.',
  'too-many-budgets': 'There are too many budgets. Delete some first.',
};

export interface BudgetsClient {
  list(): Promise<BudgetStatus[]>;
  add(input: BudgetInput): Promise<BudgetOutcome>;
  change(id: string, input: BudgetInput): Promise<BudgetOutcome>;
  remove(budget: BudgetStatus): Promise<BudgetOutcome>;
}

export interface BudgetsClientDeps {
  /** Sends a Caduceus request through the policy (`fetchTiered`): it asks the dialog for the Tier 1 first. */
  send(request: TieredRequest): Promise<TieredResult>;
  /** Reads a Caduceus route as parsed JSON; throws when it does not answer. */
  read(route: string): Promise<unknown>;
}

export function createBudgetsClient({ send, read }: BudgetsClientDeps): BudgetsClient {
  async function run(sending: Promise<TieredResult>): Promise<BudgetOutcome> {
    const result = await sending;
    if (result.kind === 'cancelled') return { kind: 'cancelled' };
    if (result.kind === 'refused') return { kind: 'failed', message: result.refusal.message };
    if (result.response.ok) return { kind: 'done' };
    const body: unknown = await result.response.json().catch(() => undefined);
    const code = isRecord(body) && typeof body.error === 'string' ? body.error : '';
    return { kind: 'failed', message: isRecord(body) && typeof body.message === 'string' ? body.message : (GENERIC[code] ?? `Caduceus did not do that (HTTP ${result.response.status}).`) };
  }
  const bodyOf = (input: BudgetInput): Record<string, unknown> => ({ amount: input.amount, period: input.period, ...(input.profile === undefined ? {} : { profile: input.profile }) });
  return {
    async list() {
      return parseBudgets(await read(ROUTE));
    },
    add: (input) =>
      run(send({ method: 'POST', path: ROUTE, body: bodyOf(input), confirm: { title: 'Add this budget?', text: `Caduceus tells you in Notices, and by push if you allow it, when spending reaches 80% and 100% of ${describeBudget(input)}. It does not stop anything.`, confirmLabel: 'Add budget' } })),
    change: (id, input) =>
      run(send({ method: 'PUT', path: `${ROUTE}/${encodeURIComponent(id)}`, body: bodyOf(input), confirm: { title: 'Change this budget?', text: `It becomes ${describeBudget(input)}. Alerts raised for the old amount are cleared, and Caduceus looks again.`, confirmLabel: 'Change budget' } })),
    remove: (budget) =>
      run(send({ method: 'DELETE', path: `${ROUTE}/${encodeURIComponent(budget.id)}`, confirm: { title: 'Delete this budget?', text: `Caduceus stops watching ${describeBudget(budget)}. Your spending is not touched.`, object: budgetView(budget, 0).title, confirmLabel: 'Delete budget' } })),
  };
}
