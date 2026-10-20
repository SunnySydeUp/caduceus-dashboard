// The schedule builder's maths, free of the DOM and of React: what each mode sends to Hermes, and when that fires next in the owner's time
// zone. Hermes takes a schedule as one text (`every 2h`, `0 9 * * 1`, an ISO timestamp); the preview is worked out from that same text, so
// what the owner sees is what Hermes was sent.

export type ScheduleDraft =
  | { mode: 'interval'; every: number; unit: 'minutes' | 'hours' | 'days' }
  | { mode: 'daily'; time: string }
  | { mode: 'weekly'; days: number[]; time: string }
  | { mode: 'monthly'; day: number; time: string }
  /** `at` is a wall-clock time as an `<input type="datetime-local">` gives it: `2026-11-20T14:30`. */
  | { mode: 'once'; at: string }
  | { mode: 'cron'; expression: string };

export type ScheduleMode = ScheduleDraft['mode'];

const MINUTE = 60_000;
const UNIT_LETTER = { minutes: 'm', hours: 'h', days: 'd' } as const;

const formatters = new Map<string, Intl.DateTimeFormat>();

/** The zone's UTC offset at an instant, in minutes. */
function offsetMinutes(instant: number, zone: string): number {
  let format = formatters.get(zone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    formatters.set(zone, format);
  }
  const part = Object.fromEntries(format.formatToParts(new Date(instant)).map((p) => [p.type, Number(p.value)]));
  const wall = Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute, part.second);
  return Math.round((wall - Math.floor(instant / 1000) * 1000) / MINUTE);
}

/** The instant a wall clock reading (as UTC milliseconds, whatever the zone) is in the zone. A repeated hour reads as its first time; a skipped hour as the time after it. */
export function wallToInstant(wall: number, zone: string, fold: 0 | 1 = 0): number {
  const before = offsetMinutes(wall - 86_400_000, zone);
  const after = offsetMinutes(wall + 86_400_000, zone);
  const early = wall - before * MINUTE;
  const late = wall - after * MINUTE;
  if (before === after) return early;
  const earlyHolds = offsetMinutes(early, zone) === before;
  const lateHolds = offsetMinutes(late, zone) === after;
  if (earlyHolds && lateHolds) return fold === 0 ? Math.min(early, late) : Math.max(early, late);
  if (earlyHolds) return early;
  if (lateHolds) return late;
  return fold === 0 ? early : late;
}

const pad = (n: number) => String(Math.abs(n)).padStart(2, '0');

function isoWithOffset(instant: number, zone: string): string {
  const offset = offsetMinutes(instant, zone);
  const wall = new Date(instant + offset * MINUTE).toISOString().slice(0, 19);
  return `${wall}${offset < 0 ? '-' : '+'}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
}

/** `HH:MM` as a cron's minute and hour fields. */
const clock = (time: string): string => {
  const [hour, minute] = time.split(':').map(Number);
  return `${minute} ${hour}`;
};

/** What Hermes is sent for the draft. `zone` is the owner's: a one-time schedule carries its offset, so it means the same instant wherever Hermes's own clock is. */
export function scheduleSpec(draft: ScheduleDraft, zone: string): string {
  switch (draft.mode) {
    case 'interval':
      return `every ${draft.every}${UNIT_LETTER[draft.unit]}`;
    case 'daily':
      return `${clock(draft.time)} * * *`;
    case 'weekly': {
      const days = [...new Set(draft.days)].sort((a, b) => a - b);
      return `${clock(draft.time)} * * ${days.length === 7 ? '*' : days.join(',')}`;
    }
    case 'monthly':
      return `${clock(draft.time)} ${draft.day} * *`;
    case 'once':
      return isoWithOffset(wallToInstant(Date.parse(`${draft.at}:00Z`), zone), zone);
    case 'cron':
      return draft.expression.trim().split(/\s+/).join(' ');
  }
}

// --- Cron ---

/** The values a cron field allows, as a sorted list; or the sentence that says what is wrong with it. */
interface CronField {
  values: number[];
  /** A plain `*` (or `?`): cron treats a day of the month and a weekday together as "either" only when neither is this. */
  any: boolean;
}

interface Cron {
  minute: CronField;
  hour: CronField;
  day: CronField;
  month: CronField;
  weekday: CronField;
}

const NAMES: Record<string, Record<string, number>> = {
  month: { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 },
  weekday: { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 },
};

const FIELDS = [
  { key: 'minute', label: 'minute', min: 0, max: 59 },
  { key: 'hour', label: 'hour', min: 0, max: 23 },
  { key: 'day', label: 'day of the month', min: 1, max: 31 },
  { key: 'month', label: 'month', min: 1, max: 12 },
  { key: 'weekday', label: 'weekday', min: 0, max: 7 },
] as const;

function cronField(text: string, field: (typeof FIELDS)[number]): CronField | string {
  const names = NAMES[field.key] ?? {};
  const number = (item: string): number | undefined => {
    if (/^\d+$/.test(item)) return Number(item);
    return names[item.toLowerCase().slice(0, 3)] !== undefined && item.length >= 3 ? names[item.toLowerCase().slice(0, 3)] : undefined;
  };
  const values = new Set<number>();
  for (const part of text.split(',')) {
    const [range, step, extra] = part.split('/');
    if (extra !== undefined || part === '') return `The ${field.label} field “${text}” is not valid.`;
    let first: number;
    let last: number;
    if (range === '*' || range === '?') {
      [first, last] = [field.min, field.key === 'weekday' ? 6 : field.max];
    } else {
      const [from, to, more] = range.split('-');
      const start = number(from);
      const end = to === undefined ? (step === undefined ? start : field.max) : number(to);
      if (more !== undefined || start === undefined || end === undefined) return `The ${field.label} field “${text}” is not valid.`;
      [first, last] = [start, end];
    }
    const by = step === undefined ? 1 : /^\d+$/.test(step) ? Number(step) : 0;
    if (by < 1) return `The step in the ${field.label} field “${text}” must be a whole number from 1.`;
    if (first < field.min || last > field.max) return `The ${field.label} field “${text}” must be from ${field.min} to ${field.max}.`;
    // A range that runs backwards wraps round the end of the field (`22-2` for the hours is 22, 23, 0, 1, 2), as Hermes's croniter reads it.
    const end = field.key === 'weekday' ? 6 : field.max;
    const span = first <= last ? last - first : end - first + 1 + (last - field.min);
    const size = end - field.min + 1;
    for (let offset = 0; offset <= span; offset += by) {
      const value = field.min + ((first - field.min + offset) % size);
      values.add(field.key === 'weekday' ? value % 7 : value);
    }
  }
  return { values: [...values].sort((a, b) => a - b), any: text === '*' || text === '?' };
}

/** A five-field cron expression, or the sentence that says what is wrong with it. */
export function parseCron(expression: string): Cron | string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5 || parts[0] === '') return 'A cron expression has five fields: minute, hour, day of the month, month and weekday.';
  const cron: Partial<Record<(typeof FIELDS)[number]['key'], CronField>> = {};
  for (const [index, field] of FIELDS.entries()) {
    const parsed = cronField(parts[index], field);
    if (typeof parsed === 'string') return parsed;
    cron[field.key] = parsed;
  }
  return cron as Cron;
}

const DAY = 86_400_000;

/** Whether a day (UTC midnight standing for the date) is one the cron's date fields allow. */
function dayMatches(cron: Cron, day: number): boolean {
  const date = new Date(day);
  if (!cron.month.values.includes(date.getUTCMonth() + 1)) return false;
  const inMonth = cron.day.values.includes(date.getUTCDate());
  const onWeekday = cron.weekday.values.includes(date.getUTCDay());
  return cron.day.any || cron.weekday.any ? inMonth && onWeekday : inMonth || onWeekday;
}

/** The first wall clock reading strictly after `after` that the cron allows (both as UTC milliseconds), or undefined when it never fires within eight years. */
function nextWall(cron: Cron, after: number): number | undefined {
  const start = Math.floor(after / DAY) * DAY;
  for (let day = start; day < start + 8 * 366 * DAY; day += DAY) {
    if (!dayMatches(cron, day)) continue;
    for (const hour of cron.hour.values) {
      for (const minute of cron.minute.values) {
        const wall = day + hour * 3_600_000 + minute * MINUTE;
        if (wall > after) return wall;
      }
    }
  }
  return undefined;
}

/**
 * The instant after `base` a cron fires in `zone`, as Hermes works it out (`cron.jobs.compute_next_run`): the next reading of the wall
 * clock, placed in the zone, whichever of its two possible placements (an hour repeats when the clocks go back) is first after `base`.
 */
function nextCronFire(cron: Cron, base: number, zone: string): number | undefined {
  const baseWall = base + offsetMinutes(base, zone) * MINUTE;
  let wall = nextWall(cron, baseWall);
  for (let attempt = 0; attempt < 2 && wall !== undefined; attempt++) {
    for (const fold of [0, 1] as const) {
      const candidate = wallToInstant(wall, zone, fold);
      if (candidate > base) return candidate;
    }
    wall = nextWall(cron, wall);
  }
  return wall === undefined ? undefined : wallToInstant(wall, zone);
}

/** The next `count` times the schedule text fires after `now`, in the zone; fewer when it ends. Text that is not a schedule the builder makes fires never. */
export function nextFires(spec: string, now: number, zone: string, count = 3): number[] {
  const interval = /^every (\d+)([mhd])$/.exec(spec);
  if (interval) {
    const step = Number(interval[1]) * { m: 1, h: 60, d: 1440 }[interval[2] as 'm' | 'h' | 'd'] * MINUTE;
    return Array.from({ length: count }, (_, i) => now + step * (i + 1));
  }
  const once = /^\d{4}-\d{2}-\d{2}T/.test(spec) ? Date.parse(spec) : Number.NaN;
  if (!Number.isNaN(once)) return once > now ? [once] : [];
  const cron = parseCron(spec);
  if (typeof cron === 'string') return [];
  const fires: number[] = [];
  for (let base = now; fires.length < count; ) {
    const next = nextCronFire(cron, base, zone);
    if (next === undefined) break;
    fires.push(next);
    base = next;
  }
  return fires;
}

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WALL = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

/** What is said of a time of day that is not one; the builder shows it under the time field and not under the day. */
export const TIME_PROBLEM = 'Choose the time of day.';

/** The sentence that says what is wrong with the draft, or undefined when Hermes can be sent it. */
export function scheduleProblem(draft: ScheduleDraft, now: number, zone: string): string | undefined {
  switch (draft.mode) {
    case 'interval':
      return Number.isInteger(draft.every) && draft.every >= 1 ? undefined : 'Every needs a whole number from 1.';
    case 'daily':
      return TIME.test(draft.time) ? undefined : TIME_PROBLEM;
    case 'weekly':
      if (!TIME.test(draft.time)) return TIME_PROBLEM;
      return draft.days.length > 0 ? undefined : 'Choose at least one day of the week.';
    case 'monthly':
      if (!TIME.test(draft.time)) return TIME_PROBLEM;
      return Number.isInteger(draft.day) && draft.day >= 1 && draft.day <= 31 ? undefined : 'Choose a day of the month from 1 to 31.';
    case 'once': {
      if (!WALL.test(draft.at)) return 'Choose the date and time.';
      return nextFires(scheduleSpec(draft, zone), now, zone).length > 0 ? undefined : 'That time has already passed.';
    }
    case 'cron': {
      if (draft.expression.trim() === '') return 'Type a cron expression.';
      const cron = parseCron(draft.expression);
      if (typeof cron === 'string') return cron;
      return nextFires(scheduleSpec(draft, zone), now, zone, 1).length > 0 ? undefined : 'This expression never fires: no month it names has that day.';
    }
  }
}

/** A schedule's fields from a Hermes schedule record (`{ kind: 'interval' | 'cron' | 'once', … }`): the builder mode that makes it, else raw cron. */
export function scheduleDraftOf(schedule: unknown, zone: string): ScheduleDraft {
  const record = typeof schedule === 'object' && schedule !== null ? (schedule as Record<string, unknown>) : {};
  if (record.kind === 'interval' && typeof record.minutes === 'number' && record.minutes >= 1) {
    const minutes = record.minutes;
    if (minutes % 1440 === 0) return { mode: 'interval', every: minutes / 1440, unit: 'days' };
    if (minutes % 60 === 0) return { mode: 'interval', every: minutes / 60, unit: 'hours' };
    return { mode: 'interval', every: minutes, unit: 'minutes' };
  }
  if (record.kind === 'once' && typeof record.run_at === 'string' && !Number.isNaN(Date.parse(record.run_at))) {
    const at = Date.parse(record.run_at);
    return { mode: 'once', at: new Date(at + offsetMinutes(at, zone) * MINUTE).toISOString().slice(0, 16) };
  }
  if (record.kind === 'cron' && typeof record.expr === 'string') {
    const expression = record.expr.trim().split(/\s+/).join(' ');
    const [minute, hour, day, month, weekday] = expression.split(' ');
    if (/^\d+$/.test(minute) && /^\d+$/.test(hour) && month === '*' && Number(minute) < 60 && Number(hour) < 24) {
      const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
      if (day === '*' && weekday === '*') return { mode: 'daily', time };
      if (day === '*' && /^[0-6](,[0-6])*$/.test(weekday)) return { mode: 'weekly', days: weekday.split(',').map(Number), time };
      if (weekday === '*' && /^\d+$/.test(day) && Number(day) >= 1 && Number(day) <= 31) return { mode: 'monthly', day: Number(day), time };
    }
    return { mode: 'cron', expression };
  }
  return { mode: 'daily', time: '09:00' };
}
