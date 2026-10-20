import { isRecord } from './policy/guards.ts';

// Budgets (M5 #05): Caduceus-owned spend limits. A budget is an amount of money per period, for one profile or for every profile. Caduceus keeps
// the definitions and which alerts it has raised; what was spent always comes from Hermes's usage analytics (D1). The server checks a definition with
// `readBudgetInput` before it stores one, and the web app reads the same shapes, so the two never disagree about what a budget may hold.

export const BUDGET_PERIODS = ['day', 'week', 'month'] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

/** The shares of a budget at which Caduceus raises an Inbox item and sends a push, once each per period. */
export const BUDGET_THRESHOLDS = [80, 100] as const;
export type BudgetThreshold = (typeof BUDGET_THRESHOLDS)[number];

export const MAX_BUDGETS = 50;
/** The most a budget may be for (a typo guard, not a policy). */
export const MAX_BUDGET_AMOUNT = 1_000_000;

export interface BudgetInput {
  /** US dollars, to the cent. */
  amount: number;
  period: BudgetPeriod;
  /** One profile's spend, or every profile's when `undefined`. */
  profile: string | undefined;
}

export interface Budget extends BudgetInput {
  id: string;
}

/** A budget with what has been spent in its current period, as `GET /_caduceus/api/budgets` lists it. */
export interface BudgetStatus extends Budget {
  /** The first UTC day of the current period (`YYYY-MM-DD`), and the first day after it. Hermes counts its days in UTC. */
  periodStart: string;
  periodEnd: string;
  /** Dollars spent in the period so far; `undefined` when Hermes could not say. */
  spent: number | undefined;
  /** The thresholds (percent) whose alert has been raised in this period. */
  alerted: BudgetThreshold[];
}

export interface Budgets {
  budgets: BudgetStatus[];
}

const DAY_MS = 86_400_000;

const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * The UTC days a budget period covers at `now`: its first day, and the first day after it. A day is that UTC day; a week runs Monday to Sunday;
 * a month is the calendar month. (Hermes groups its sessions by the UTC day they started, so a period is counted the same way.)
 */
export function periodBounds(period: BudgetPeriod, now: number): { start: string; end: string } {
  const today = Date.parse(`${isoDay(now)}T00:00:00Z`);
  if (period === 'day') return { start: isoDay(today), end: isoDay(today + DAY_MS) };
  if (period === 'week') {
    const sinceMonday = (new Date(today).getUTCDay() + 6) % 7;
    const monday = today - sinceMonday * DAY_MS;
    return { start: isoDay(monday), end: isoDay(monday + 7 * DAY_MS) };
  }
  const date = new Date(today);
  return { start: isoDay(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1)), end: isoDay(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1)) };
}

/** The length of a period in days. */
export const periodDays = ({ start, end }: { start: string; end: string }): number => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS);

/** The share of the amount spent, in percent (not capped). */
export const percentSpent = (spent: number, amount: number): number => (amount > 0 ? (spent / amount) * 100 : 0);

/**
 * Where the period's spending is heading: what it comes to by the end if it goes on at the pace so far. `elapsed` is the part of the period that is
 * gone (the days before today plus the part of today that has passed, by `now`); it is never less than a tenth of a day, so the first minutes of a
 * period do not project to infinity.
 */
export function spendPace(spent: number, bounds: { start: string; end: string }, now: number): { projected: number; elapsedDays: number; totalDays: number } {
  const totalDays = periodDays(bounds);
  const elapsedDays = Math.min(totalDays, Math.max(0.1, (now - Date.parse(`${bounds.start}T00:00:00Z`)) / DAY_MS));
  return { projected: (spent / elapsedDays) * totalDays, elapsedDays, totalDays };
}

const PROFILE_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/** A budget as an owner may give it, or `undefined` when it is not one: an amount above zero (cents at most), a known period, and a profile name or none. */
export function readBudgetInput(value: unknown): BudgetInput | undefined {
  if (!isRecord(value)) return undefined;
  const { amount, period, profile } = value;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > MAX_BUDGET_AMOUNT || Math.round(amount * 100) !== amount * 100) return undefined;
  if (typeof period !== 'string' || !(BUDGET_PERIODS as readonly string[]).includes(period)) return undefined;
  if (profile !== undefined && profile !== null && (typeof profile !== 'string' || !PROFILE_NAME.test(profile))) return undefined;
  return { amount, period: period as BudgetPeriod, profile: typeof profile === 'string' ? profile : undefined };
}

/** The cost of one `daily` row of Hermes's usage analytics: what the provider billed, else Hermes's estimate. */
export function dailyCost(row: unknown): number {
  if (!isRecord(row)) return 0;
  const num = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
  return num(row.actual_cost) > 0 ? num(row.actual_cost) : num(row.estimated_cost);
}

/** What was spent from `start` (a UTC day) on, from the `daily` rows of usage analytics answers (one per profile). An answer that is not usable counts as nothing. */
export function spentSince(answers: readonly unknown[], start: string): number {
  let spent = 0;
  for (const answer of answers) {
    const daily = isRecord(answer) && Array.isArray(answer.daily) ? answer.daily : [];
    for (const row of daily) {
      if (isRecord(row) && typeof row.day === 'string' && row.day >= start) spent += dailyCost(row);
    }
  }
  return spent;
}
