import { describe, expect, test } from 'vitest';
import type { Reminder } from '@caduceus/contracts/today';
import { agenda, dateKey, dayKey, monthCells, monthOf, overdueBefore, remindersOn, shiftDay, shiftMonth, timeWords, weekOf } from '../src/modules/today/reminders-model.ts';

// Where a reminder falls on the calendar, free of the DOM: the day of a timed and of an all-day reminder, the weeks of a month, and the list of one day. Dates are
// written in the device's own clock, as the screen shows them, so these hold in any time zone.
const reminder = (over: Partial<Reminder> & { id: string }): Reminder => ({ title: over.id, list: 'Reminders', due: new Date(2026, 9, 20, 9, 0).toISOString(), allDay: false, day: undefined, completed: false, ...over });
const at = (month: number, day: number, hour = 9, minute = 0) => new Date(2026, month, day, hour, minute).toISOString();

describe('dayKey', () => {
  test('puts a timed reminder on the day its time falls on where it is read', () => {
    expect(dayKey(reminder({ id: 'a', due: at(9, 31, 23, 30) }))).toBe('2026-10-31');
    expect(dayKey(reminder({ id: 'b', due: at(10, 1, 0, 5) }))).toBe('2026-11-01');
  });

  test('puts an all-day reminder on the day the Mac named, whatever this device\'s time zone does to the instant', () => {
    // The instant is far from that day on this device's clock (or the same in some zones): the named day is what counts.
    expect(dayKey(reminder({ id: 'c', allDay: true, day: '2026-11-03', due: '2026-11-01T00:00:00Z' }))).toBe('2026-11-03');
  });

  test('falls back to the instant for an all-day reminder with no named day', () => {
    expect(dayKey(reminder({ id: 'd', allDay: true, due: at(10, 3, 0, 0) }))).toBe('2026-11-03');
  });
});

describe('monthCells', () => {
  const today = '2026-10-20';

  test('lays October 2026 out in weeks that start on Monday, with the days of the months either side filling the first and last week', () => {
    const weeks = monthCells(2026, 9, [], today);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    // 1 Oct 2026 is a Thursday: the first week is Mon 28 Sep to Sun 4 Oct.
    expect(weeks[0]!.map((c) => c.key)).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    expect(weeks[0]!.map((c) => c.inMonth)).toEqual([false, false, false, true, true, true, true]);
    // 31 Oct is a Saturday: the last week ends on Sun 1 Nov.
    expect(weeks.at(-1)!.map((c) => c.key)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    expect(weeks).toHaveLength(5);
  });

  test('has only four weeks for a February that starts on a Monday, and six when a long month starts late in the week', () => {
    expect(monthCells(2027, 1, [], today)).toHaveLength(4); // Feb 2027: Mon 1 to Sun 28
    expect(monthCells(2026, 7, [], today)).toHaveLength(6); // Aug 2026: Sat 1 to Mon 31
  });

  test('marks today, and counts open and done reminders on each day', () => {
    const weeks = monthCells(
      2026,
      9,
      [reminder({ id: 'a', due: at(9, 20) }), reminder({ id: 'b', due: at(9, 20, 15) }), reminder({ id: 'c', due: at(9, 20, 8), completed: true }), reminder({ id: 'd', due: at(9, 22) })],
      today,
    );
    const cells = weeks.flat();
    expect(cells.filter((c) => c.today).map((c) => c.key)).toEqual(['2026-10-20']);
    expect(cells.find((c) => c.key === '2026-10-20')).toMatchObject({ date: 20, open: 2, done: 1 });
    expect(cells.find((c) => c.key === '2026-10-22')).toMatchObject({ open: 1, done: 0 });
    expect(cells.find((c) => c.key === '2026-10-21')).toMatchObject({ open: 0, done: 0 });
  });

  test('counts a reminder on a day of the next month that shows in the last week', () => {
    const cells = monthCells(2026, 9, [reminder({ id: 'x', due: at(10, 1, 10) })], today).flat();
    expect(cells.find((c) => c.key === '2026-11-01')).toMatchObject({ inMonth: false, open: 1 });
  });
});

describe('shiftMonth', () => {
  test('moves by months across a year', () => {
    expect(shiftMonth({ year: 2026, month: 11 }, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth({ year: 2026, month: 0 }, -1)).toEqual({ year: 2025, month: 11 });
    expect(shiftMonth({ year: 2026, month: 9 }, 0)).toEqual({ year: 2026, month: 9 });
  });
});

describe('monthOf', () => {
  test('is the year and the 0-based month of a day key', () => {
    expect(monthOf('2026-01-31')).toEqual({ year: 2026, month: 0 });
    expect(monthOf('2026-12-01')).toEqual({ year: 2026, month: 11 });
  });
});

describe('shiftDay', () => {
  test('moves by days across the end of a month and of a year', () => {
    expect(shiftDay('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDay('2026-12-29', 7)).toBe('2027-01-05');
    expect(shiftDay('2026-03-01', -1)).toBe('2026-02-28');
  });

  test('moves one day across the nights the clocks change (Europe, the US, Australia), whatever the zone the tests run in', () => {
    for (const [from, to] of [['2026-03-28', '2026-03-29'], ['2026-03-29', '2026-03-30'], ['2026-10-24', '2026-10-25'], ['2026-10-25', '2026-10-26'], ['2026-03-08', '2026-03-09'], ['2026-11-01', '2026-11-02'], ['2026-10-04', '2026-10-05'], ['2026-04-05', '2026-04-06']]) {
      expect(shiftDay(from!, 1)).toBe(to);
      expect(shiftDay(to!, -1)).toBe(from);
    }
  });
});

describe('weekOf', () => {
  test('is the Monday-first week a day is in, also when it runs into the next month, with its counts', () => {
    const week = weekOf('2026-10-29', [reminder({ id: 'x', due: at(10, 1, 10) })], '2026-10-20');
    expect(week.map((c) => c.key)).toEqual(['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
    expect(week.at(-1)).toMatchObject({ open: 1 });
  });
});

describe('agenda', () => {
  test('lists today even when nothing is due, then only the days of the span that have something due, each in its day order', () => {
    const list = [
      reminder({ id: 'tomorrow-late', due: at(9, 21, 17) }),
      reminder({ id: 'tomorrow-early', due: at(9, 21, 8) }),
      reminder({ id: 'sunday', due: at(9, 25, 10) }),
      reminder({ id: 'beyond', due: at(9, 27, 10) }),
      reminder({ id: 'yesterday', due: at(9, 19, 10) }),
    ];
    expect(agenda(list, '2026-10-20', 7).map(({ key, reminders }) => [key, reminders.map((r) => r.id)])).toEqual([
      ['2026-10-20', []],
      ['2026-10-21', ['tomorrow-early', 'tomorrow-late']],
      ['2026-10-25', ['sunday']],
    ]);
    // The block's own span, today and tomorrow, stops before Sunday.
    expect(agenda(list, '2026-10-20', 2).map(({ key }) => key)).toEqual(['2026-10-20', '2026-10-21']);
  });
});

describe('remindersOn', () => {
  test('lists a day\'s reminders: all-day first, then by time, with the done ones after the open ones', () => {
    const list = [
      reminder({ id: 'late', due: at(9, 20, 17) }),
      reminder({ id: 'done', due: at(9, 20, 7), completed: true }),
      reminder({ id: 'early', due: at(9, 20, 8) }),
      reminder({ id: 'allday', allDay: true, day: '2026-10-20', due: at(9, 20, 0) }),
      reminder({ id: 'other', due: at(9, 21, 8) }),
    ];
    expect(remindersOn(list, '2026-10-20').map((r) => r.id)).toEqual(['allday', 'early', 'late', 'done']);
  });
});

describe('overdueBefore', () => {
  test('lists the open reminders due on an earlier day, oldest first, and leaves out done ones, today\'s and later ones', () => {
    const list = [
      reminder({ id: 'older', due: at(9, 3) }),
      reminder({ id: 'yesterday', due: at(9, 19, 23) }),
      reminder({ id: 'done', due: at(9, 10), completed: true }),
      reminder({ id: 'today', due: at(9, 20, 0, 1) }),
      reminder({ id: 'later', due: at(9, 25) }),
    ];
    expect(overdueBefore(list, '2026-10-20').map((r) => r.id)).toEqual(['older', 'yesterday']);
  });
});

describe('timeWords', () => {
  test('says All day for an all-day reminder and the clock otherwise', () => {
    expect(timeWords(reminder({ id: 'a', allDay: true, day: '2026-10-20' }))).toBe('All day');
    expect(timeWords(reminder({ id: 'b', due: at(9, 20, 14, 5) }))).toMatch(/2:05/);
  });
});

describe('dateKey', () => {
  test('writes a device date as YYYY-MM-DD', () => {
    expect(dateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});
