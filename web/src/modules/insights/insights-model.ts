// What Observe › Insights shows, free of the DOM and of React (M5 #05). Every number is read from what Hermes answered on this load (D1): its usage analytics
// (`GET /api/analytics/usage`, one answer per profile), its session list (for the source and hour-of-day views, which the analytics do not break down),
// and the account limits of `session.usage`. Nothing is kept.
import { isRecord } from '@caduceus/contracts/policy/guards';

/** The periods the picker offers at one tap; any whole number of days from 1 to 365 may be chosen. */
export const PERIOD_CHOICES = [7, 30, 90, 365] as const;
export const MIN_DAYS = 1;
export const MAX_DAYS = 365;

/** A period as the owner typed or picked it, made a whole number of days Hermes accepts. */
/** The period from the page's `?days=`: the owner's choice survives a reload. */
export function daysFromSearch(search: Record<string, unknown>): number {
  const value = typeof search.days === 'string' || typeof search.days === 'number' ? Number(search.days) : Number.NaN;
  return clampDays(value);
}
export const clampDays = (days: number): number => (Number.isFinite(days) ? Math.min(MAX_DAYS, Math.max(MIN_DAYS, Math.round(days))) : 30);

export const usagePath = (profile: string, days: number): string => `/api/analytics/usage?days=${days}&profile=${encodeURIComponent(profile)}`;

const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** Tokens and money of a day, a model, a profile or the whole period. */
export interface Amounts {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  reasoningTokens: number;
  /** Hermes's own estimate from its price table. */
  estimatedCost: number;
  /** What the provider billed, where it says. */
  actualCost: number;
  sessions: number;
  apiCalls: number;
}

const DAY_MS = 86_400_000;

const NONE: Amounts = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, reasoningTokens: 0, estimatedCost: 0, actualCost: 0, sessions: 0, apiCalls: 0 };

const amountsOf = (row: Record<string, unknown>): Amounts => ({
  inputTokens: num(row.input_tokens ?? row.total_input),
  outputTokens: num(row.output_tokens ?? row.total_output),
  cacheReadTokens: num(row.cache_read_tokens ?? row.total_cache_read),
  reasoningTokens: num(row.reasoning_tokens ?? row.total_reasoning),
  estimatedCost: num(row.estimated_cost ?? row.total_estimated_cost),
  actualCost: num(row.actual_cost ?? row.total_actual_cost),
  sessions: num(row.sessions ?? row.total_sessions),
  apiCalls: num(row.api_calls ?? row.total_api_calls),
});

const plus = (a: Amounts, b: Amounts): Amounts => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  reasoningTokens: a.reasoningTokens + b.reasoningTokens,
  estimatedCost: a.estimatedCost + b.estimatedCost,
  actualCost: a.actualCost + b.actualCost,
  sessions: a.sessions + b.sessions,
  apiCalls: a.apiCalls + b.apiCalls,
});

/** What a row cost: what the provider billed when it says, else Hermes's estimate (the rule Talk's spend uses too). */
export const costOf = (amounts: Amounts): number => (amounts.actualCost > 0 ? amounts.actualCost : amounts.estimatedCost);

export const tokensOf = (amounts: Amounts): number => amounts.inputTokens + amounts.outputTokens;

/** Share of the prompt that came from the provider's cache, in percent; `undefined` when nothing was read. */
export const cacheShare = (amounts: Amounts): number | undefined => (amounts.inputTokens + amounts.cacheReadTokens > 0 ? (amounts.cacheReadTokens / (amounts.inputTokens + amounts.cacheReadTokens)) * 100 : undefined);

export interface DayRow extends Amounts {
  /** The UTC day, `YYYY-MM-DD`. */
  day: string;
}

export interface ModelRow extends Amounts {
  model: string;
}

export interface SkillRow {
  skill: string;
  views: number;
  edits: number;
  total: number;
}

/** One profile's usage analytics answer, read. A field Hermes does not send is as if it were empty. */
export interface ProfileUsage {
  profile: string;
  totals: Amounts;
  /** What the period cost, day by day: a day's billed cost where Hermes has one, else its estimate (the rule Talk's spend and the budgets use). */
  cost: number;
  daily: DayRow[];
  models: ModelRow[];
  skills: SkillRow[];
}

export function readUsage(profile: string, answer: unknown): ProfileUsage {
  const body = isRecord(answer) ? answer : {};
  const rows = (value: unknown) => (Array.isArray(value) ? value.filter(isRecord) : []);
  const skills = isRecord(body.skills) ? rows(body.skills.top_skills) : [];
  const daily = rows(body.daily).flatMap((row): DayRow[] => (/^\d{4}-\d{2}-\d{2}$/.test(text(row.day)) ? [{ day: text(row.day), ...amountsOf(row) }] : []));
  return {
    profile,
    totals: isRecord(body.totals) ? amountsOf(body.totals) : NONE,
    cost: daily.reduce((sum, row) => sum + costOf(row), 0),
    daily,
    models: rows(body.by_model).flatMap((row): ModelRow[] => (text(row.model) === '' ? [] : [{ model: text(row.model), ...amountsOf(row) }])),
    skills: skills.flatMap((row): SkillRow[] => (text(row.skill) === '' ? [] : [{ skill: text(row.skill), views: num(row.view_count), edits: num(row.manage_count), total: num(row.total_count) }])),
  };
}

export interface ProfileRow extends Amounts {
  profile: string;
  cost: number;
}

/** The period as the page shows it: every profile's analytics added together, and broken down by day, model, profile and skill. */
export interface Insights {
  totals: Amounts;
  /** What the period cost over every profile (see `ProfileUsage.cost`): not `costOf(totals)`, which would count a single billed session as the whole period's bill. */
  cost: number;
  daily: DayRow[];
  models: ModelRow[];
  profiles: ProfileRow[];
  skills: SkillRow[];
}

/** Adds profiles' analytics together. Models are the same model wherever it ran; the largest (by tokens) comes first, as Hermes lists them. */
export function combine(usages: readonly ProfileUsage[]): Insights {
  const days = new Map<string, DayRow>();
  const models = new Map<string, ModelRow>();
  const skills = new Map<string, SkillRow>();
  for (const usage of usages) {
    for (const row of usage.daily) days.set(row.day, { day: row.day, ...plus(days.get(row.day) ?? NONE, row) });
    for (const row of usage.models) models.set(row.model, { model: row.model, ...plus(models.get(row.model) ?? NONE, row) });
    for (const row of usage.skills) {
      const seen = skills.get(row.skill);
      skills.set(row.skill, { skill: row.skill, views: (seen?.views ?? 0) + row.views, edits: (seen?.edits ?? 0) + row.edits, total: (seen?.total ?? 0) + row.total });
    }
  }
  return {
    totals: usages.reduce((sum, usage) => plus(sum, usage.totals), NONE),
    cost: usages.reduce((sum, usage) => sum + usage.cost, 0),
    daily: [...days.values()].toSorted((a, b) => a.day.localeCompare(b.day)),
    models: [...models.values()].toSorted((a, b) => tokensOf(b) - tokensOf(a) || a.model.localeCompare(b.model)),
    profiles: usages.map((usage) => ({ profile: usage.profile, cost: usage.cost, ...usage.totals })).toSorted((a, b) => b.cost - a.cost || tokensOf(b) - tokensOf(a) || a.profile.localeCompare(b.profile)),
    skills: [...skills.values()].toSorted((a, b) => b.total - a.total || b.views - a.views || a.skill.localeCompare(b.skill)),
  };
}

/** A session as the source and hour-of-day views need it: when it started, where it came from, what it used. */
export interface SessionRow extends Amounts {
  source: string;
  startedAt: number;
}

/** The rows of one page of Hermes's session list (`GET /api/profiles/sessions`). */
export function readSessions(body: unknown): { rows: SessionRow[]; total: number } {
  const list = isRecord(body) && Array.isArray(body.sessions) ? body.sessions.filter(isRecord) : [];
  return {
    rows: list.flatMap((row): SessionRow[] => {
      const startedAt = num(row.started_at);
      if (startedAt === 0) return [];
      // A session's cost is its billed cost where it has one, else the estimate, so that rows added together (a source) never mix a bill with an estimate.
      const billed = num(row.actual_cost_usd);
      return [{ source: text(row.source) || 'unknown', startedAt, ...amountsOf({ ...row, estimated_cost: billed > 0 ? billed : row.estimated_cost_usd, actual_cost: 0, sessions: 1, api_calls: row.api_call_count }) }];
    }),
    total: isRecord(body) ? num(body.total) : 0,
  };
}

export interface SourceRow extends Amounts {
  source: string;
}

/** Where the sessions of the period came from (`cli`, `telegram`, `caduceus`, `cron`…), the one that cost most first. */
export function bySource(rows: readonly SessionRow[], since: number): SourceRow[] {
  const sources = new Map<string, SourceRow>();
  for (const row of rows) {
    if (row.startedAt < since) continue;
    sources.set(row.source, { source: row.source, ...plus(sources.get(row.source) ?? NONE, row) });
  }
  return [...sources.values()].toSorted((a, b) => costOf(b) - costOf(a) || tokensOf(b) - tokensOf(a) || b.sessions - a.sessions || a.source.localeCompare(b.source));
}

/** How many sessions started in each hour of the day (24 numbers, hour 0 first), on the clock `hourOf` gives (the device's own by default). */
export function hourOfDay(rows: readonly SessionRow[], since: number, hourOf: (seconds: number) => number = (seconds) => new Date(seconds * 1000).getHours()): number[] {
  const hours = Array.from({ length: 24 }, () => 0);
  for (const row of rows) if (row.startedAt >= since) hours[hourOf(row.startedAt)]! += 1;
  return hours;
}

/** One row for every UTC day of the last `days` days up to today (a day Hermes has no row for is empty), oldest first: what the per-day chart draws. */
export function dailySeries(daily: readonly DayRow[], days: number, now: number): DayRow[] {
  const byDay = new Map(daily.map((row) => [row.day, row]));
  const today = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`);
  return Array.from({ length: days }, (_, index) => {
    const day = new Date(today - (days - 1 - index) * DAY_MS).toISOString().slice(0, 10);
    return byDay.get(day) ?? { day, ...NONE };
  });
}

export interface HeatCell {
  /** The UTC day. */
  day: string;
  sessions: number;
  /** 0 (none) to 4 (the busiest quarter), against the busiest day of the period. */
  level: 0 | 1 | 2 | 3 | 4;
}

/**
 * The activity heatmap: a cell per UTC day of the last `days` days up to today, in weeks (Monday first, so a column is a week and a row a weekday).
 * A week that begins before the period is padded with `undefined`.
 */
export function heatmap(daily: readonly DayRow[], days: number, now: number): (HeatCell | undefined)[][] {
  const bySessions = new Map(daily.map((row) => [row.day, row.sessions]));
  const busiest = Math.max(1, ...daily.map((row) => row.sessions));
  const today = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00Z`);
  const first = today - (days - 1) * DAY_MS;
  const weeks: (HeatCell | undefined)[][] = [];
  const mondayOfFirst = first - ((new Date(first).getUTCDay() + 6) % 7) * DAY_MS;
  for (let monday = mondayOfFirst; monday <= today; monday += 7 * DAY_MS) {
    weeks.push(
      Array.from({ length: 7 }, (_, offset): HeatCell | undefined => {
        const at = monday + offset * DAY_MS;
        if (at < first || at > today) return undefined;
        const day = new Date(at).toISOString().slice(0, 10);
        const sessions = bySessions.get(day) ?? 0;
        const level = sessions === 0 ? 0 : (Math.min(4, Math.max(1, Math.ceil((sessions / busiest) * 4))) as HeatCell['level']);
        return { day, sessions, level };
      }),
    );
  }
  return weeks;
}

/** One limit window of an account (a provider's quota), as `session.usage` words it. */
export interface QuotaWindow {
  label: string;
  /** `undefined` when the provider says the window is unavailable. */
  usedPercent: number | undefined;
  /** When it resets, in Hermes's words (`in 2h 10m`), or what else it says of the window. */
  note: string | undefined;
}

export interface Quota {
  title: string;
  provider: string | undefined;
  windows: QuotaWindow[];
  /** Lines that are not windows: details and why something is unavailable. */
  details: string[];
}

/**
 * The provider quota card, from `session.usage`'s `account_lines` (the same rendering Hermes's CLI shows): a title line, `Provider: <name> (<plan>)`, a line
 * per window (`Session: 40% remaining (60% used) • resets in 2h`) and loose detail lines. `undefined` when the provider has no account limits to show, which the
 * card says as "not available".
 */
export function readQuota(lines: unknown): Quota | undefined {
  const given = Array.isArray(lines) ? lines.filter((line): line is string => typeof line === 'string' && line.trim() !== '') : [];
  if (given.length === 0) return undefined;
  const title = given[0]!.replace(/^\p{Extended_Pictographic}\uFE0F?\s*/u, '').replace(/\*\*/g, '').trim();
  let provider: string | undefined;
  const windows: QuotaWindow[] = [];
  const details: string[] = [];
  for (const line of given.slice(1)) {
    const named = /^Provider:\s*(.+)$/.exec(line);
    const open = /^(.+?):\s*(\d+)% remaining \((\d+)% used\)(?:\s*•\s*(.+))?$/.exec(line);
    const closed = /^(.+?):\s*unavailable(?:\s*•\s*(.+))?$/.exec(line);
    if (named) provider = named[1]!.trim();
    else if (open) windows.push({ label: open[1]!.trim(), usedPercent: Number(open[3]), note: open[4]?.trim() });
    else if (closed) windows.push({ label: closed[1]!.trim(), usedPercent: undefined, note: closed[2]?.trim() });
    else details.push(line.trim());
  }
  return windows.length === 0 && details.length === 0 ? undefined : { title, provider, windows, details };
}
