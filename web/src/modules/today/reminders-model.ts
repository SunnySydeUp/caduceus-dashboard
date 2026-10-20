// Where Apple Reminders fall on Today's calendar: the day a reminder is on, the weeks of a month with what is due on each day, and one day's list. Pure: no DOM, no
// React and nothing kept (D1). Days are the device's own, written `YYYY-MM-DD`; weeks start on Monday.
import type { Reminder } from '@caduceus/contracts/today';

const two = (n: number) => String(n).padStart(2, '0');

/** A device date as `YYYY-MM-DD`. */
export const dateKey = (date: Date): string => `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`;

/**
 * The day a reminder is on. One with a time is on the day that time falls on where it is read. An all-day one is on the day the Mac named, so that a device in
 * another time zone does not move it a day.
 */
export function dayKey(reminder: Reminder): string {
  return reminder.allDay && reminder.day !== undefined ? reminder.day : dateKey(new Date(reminder.due));
}

export interface DayCell {
  /** `YYYY-MM-DD`. */
  key: string;
  /** The day of the month. */
  date: number;
  /** In the month shown, and not one of the days of the next or the last month that fill its first and last week. */
  inMonth: boolean;
  today: boolean;
  /** Reminders due that day that are not done, and those that are. */
  open: number;
  done: number;
}

export interface MonthRef {
  year: number;
  /** 0 to 11. */
  month: number;
}

export const monthOf = (key: string): MonthRef => ({ year: Number(key.slice(0, 4)), month: Number(key.slice(5, 7)) - 1 });

/** The day `by` days after (or before) a day, built from its date so that a night the clocks change does not repeat or skip one. */
export function shiftDay(key: string, by: number): string {
  return dateKey(new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)) + by));
}

export function shiftMonth({ year, month }: MonthRef, by: number): MonthRef {
  const moved = new Date(year, month + by, 1);
  return { year: moved.getFullYear(), month: moved.getMonth() };
}

/** The weeks (Monday first, four to six of them) that show a month, with what is due on each day. `today` is the device's today as a day key. */
export function monthCells(year: number, month: number, reminders: readonly Reminder[], today: string): DayCell[][] {
  const counts = new Map<string, { open: number; done: number }>();
  for (const reminder of reminders) {
    const key = dayKey(reminder);
    const count = counts.get(key) ?? { open: 0, done: 0 };
    if (reminder.completed) count.done += 1;
    else count.open += 1;
    counts.set(key, count);
  }
  const first = new Date(year, month, 1);
  // Days since Monday: Sunday (0) is the sixth, Monday the first.
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const weeks: DayCell[][] = [];
  for (let offset = 0; offset < lead + days; offset += 7) {
    // Dates are built from the year, month and day and not by adding 24 hours, so a night the clocks change does not repeat or skip a day.
    weeks.push(
      Array.from({ length: 7 }, (_, column) => {
        const date = new Date(year, month, 1 - lead + offset + column);
        const key = dateKey(date);
        return { key, date: date.getDate(), inMonth: date.getMonth() === month, today: key === today, ...(counts.get(key) ?? { open: 0, done: 0 }) };
      }),
    );
  }
  return weeks;
}

/** The week (Monday first) a day is in, with what is due on each day: the calendar's folded state. */
export function weekOf(key: string, reminders: readonly Reminder[], today: string): DayCell[] {
  const { year, month } = monthOf(key);
  return monthCells(year, month, reminders, today).find((week) => week.some((cell) => cell.key === key))!;
}

const time = (reminder: Reminder) => Date.parse(reminder.due);

/** The reminders due on a day: all-day first, then by time; the ones that are done come after the open ones. */
export function remindersOn(reminders: readonly Reminder[], key: string): Reminder[] {
  return reminders
    .filter((reminder) => dayKey(reminder) === key)
    .sort((a, b) => Number(a.completed) - Number(b.completed) || Number(b.allDay) - Number(a.allDay) || time(a) - time(b) || a.id.localeCompare(b.id));
}

/** The reminders that are not done and were due on a day before `today`, oldest first. */
export function overdueBefore(reminders: readonly Reminder[], today: string): Reminder[] {
  return reminders.filter((reminder) => !reminder.completed && dayKey(reminder) < today).sort((a, b) => time(a) - time(b) || a.id.localeCompare(b.id));
}

export interface AgendaDay {
  key: string;
  reminders: Reminder[];
}

/**
 * What is coming, a day at a time, from `today` for `days` days: today always (it says so when nothing is due), then only the days that have something due.
 */
export function agenda(reminders: readonly Reminder[], today: string, days: number): AgendaDay[] {
  const out: AgendaDay[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const key = shiftDay(today, offset);
    const due = remindersOn(reminders, key);
    if (offset === 0 || due.length > 0) out.push({ key, reminders: due });
  }
  return out;
}

/** When on its day a reminder is due, in words. */
export function timeWords(reminder: Reminder): string {
  return reminder.allDay ? 'All day' : new Date(reminder.due).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
