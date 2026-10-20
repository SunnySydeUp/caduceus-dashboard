// The budget guard (M6 #06; work model §2.6, architecture §1): the worker that pauses unattended work when a budget is used up, and what Insights shows of it.
// Caduceus records only what the guard itself paused, so that undoing it resumes exactly that and nothing the owner had stopped.

/** What the guard can pause: the Kanban dispatcher's claims (Hermes's `kanban.dispatch_profiles`, read at every tick) or one scheduled job. */
export type GuardActionKind = 'dispatcher' | 'cron';

/** `paused`: the guard's pause is in place. `resumed`: undone or lifted. `skipped`: the owner changed it since, so the guard left it alone (`reason` says how). */
export type GuardActionStatus = 'paused' | 'resumed' | 'skipped';

export interface GuardAction {
  id: number;
  kind: GuardActionKind;
  /** What it paused, in words: “Kanban dispatcher” or “Nightly report (default)”. */
  label: string;
  status: GuardActionStatus;
  /** Why it was left alone, when `status` is `skipped`. */
  reason?: string;
  /** Milliseconds since the epoch. */
  at: number;
}

export interface GuardTrip {
  id: number;
  budgetId: string;
  /** What the budget was when it tripped, and the first UTC day of the period it tripped in. */
  amount: number;
  period: 'day' | 'week' | 'month';
  periodStart: string;
  profile: string | undefined;
  /** Dollars spent when the guard looked. */
  spent: number;
  at: number;
  actions: GuardAction[];
  /** Every action was undone or lifted (or skipped): nothing of this trip is still paused. */
  settled: boolean;
}

export type GuardMode = 'armed' | 'tripped' | 'disabled';

export interface GuardState {
  mode: GuardMode;
  enabled: boolean;
  /** Whether the guard lifts its own pauses when a new budget period starts. The owner allows it; off until then. */
  liftOnNewPeriod: boolean;
  /** How often the guard reads spend, and so its documented overshoot: what is spent in one interval at the burn rate of the moment. */
  intervalMs: number;
  /** Milliseconds since the epoch of the last time the guard read spend, or `undefined` before the first. */
  lastEvaluation: number | undefined;
  trips: GuardTrip[];
}

/** How many trips Insights lists (the newest). */
export const GUARD_TRIPS_SHOWN = 20;
