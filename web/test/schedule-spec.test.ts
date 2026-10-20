import { describe, expect, test } from 'vitest';
import { nextFires, scheduleDraftOf, scheduleProblem, scheduleSpec, type ScheduleDraft } from '../src/modules/work/schedule-spec.ts';

const SYDNEY = 'Australia/Sydney';

describe('each schedule mode makes the text Hermes takes', () => {
  const spec = (draft: ScheduleDraft) => scheduleSpec(draft, SYDNEY);

  test('interval: every N minutes, hours or days', () => {
    expect([
      spec({ mode: 'interval', every: 30, unit: 'minutes' }),
      spec({ mode: 'interval', every: 2, unit: 'hours' }),
      spec({ mode: 'interval', every: 1, unit: 'days' }),
    ]).toEqual(['every 30m', 'every 2h', 'every 1d']);
  });

  test('daily, weekly and monthly are cron expressions', () => {
    expect([
      spec({ mode: 'daily', time: '09:05' }),
      spec({ mode: 'weekly', days: [5, 1, 3], time: '18:30' }),
      spec({ mode: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], time: '07:00' }),
      spec({ mode: 'monthly', day: 15, time: '00:00' }),
    ]).toEqual(['5 9 * * *', '30 18 * * 1,3,5', '0 7 * * *', '0 0 15 * *']);
  });

  test('once is the instant, with the owner’s offset on that day', () => {
    expect(spec({ mode: 'once', at: '2026-11-20T14:30' })).toBe('2026-11-20T14:30:00+11:00');
    expect(spec({ mode: 'once', at: '2026-07-20T14:30' })).toBe('2026-07-20T14:30:00+10:00');
  });

  test('raw cron is sent as typed, with the spaces tidied', () => {
    expect(spec({ mode: 'cron', expression: '  */15  9-17 * *   mon-fri ' })).toBe('*/15 9-17 * * mon-fri');
  });
});

describe('when a schedule fires next, in the owner’s zone', () => {
  const NEW_YORK = 'America/New_York';
  const fires = (spec: string, now: string, zone = NEW_YORK) => nextFires(spec, Date.parse(now), zone).map((at) => new Date(at).toISOString());

  test('an interval counts on from now, whatever the clocks do', () => {
    expect(fires('every 90m', '2026-03-08T05:00:00Z')).toEqual(['2026-03-08T06:30:00.000Z', '2026-03-08T08:00:00.000Z', '2026-03-08T09:30:00.000Z']);
    // A day is 24 hours of elapsed time, as Hermes adds it: across the spring-forward night the wall clock moves an hour.
    expect(fires('every 1d', '2026-03-07T14:00:00Z')).toEqual(['2026-03-08T14:00:00.000Z', '2026-03-09T14:00:00.000Z', '2026-03-10T14:00:00.000Z']);
  });

  test('a daily time keeps its wall clock across the clocks changing', () => {
    // 09:00 New York: EST (UTC-5) until 8 March 2026, EDT (UTC-4) after.
    expect(fires('0 9 * * *', '2026-03-07T12:00:00Z')).toEqual(['2026-03-07T14:00:00.000Z', '2026-03-08T13:00:00.000Z', '2026-03-09T13:00:00.000Z']);
    expect(fires('0 9 * * *', '2026-10-31T12:00:00Z')).toEqual(['2026-10-31T13:00:00.000Z', '2026-11-01T14:00:00.000Z', '2026-11-02T14:00:00.000Z']);
  });

  test('a time the spring-forward night skips fires at the same reading an hour later, as Hermes does', () => {
    expect(fires('30 2 * * *', '2026-03-07T12:00:00Z')).toEqual(['2026-03-08T07:30:00.000Z', '2026-03-09T06:30:00.000Z', '2026-03-10T06:30:00.000Z']);
  });

  test('a time the fall-back night repeats fires once, at its first reading', () => {
    expect(fires('30 1 * * *', '2026-10-31T12:00:00Z')).toEqual(['2026-11-01T05:30:00.000Z', '2026-11-02T06:30:00.000Z', '2026-11-03T06:30:00.000Z']);
  });

  test('weekly: the listed weekdays, in order', () => {
    // 2026-03-04 is a Wednesday.
    expect(fires('30 18 * * 1,3,5', '2026-03-04T12:00:00Z')).toEqual(['2026-03-04T23:30:00.000Z', '2026-03-06T23:30:00.000Z', '2026-03-09T22:30:00.000Z']);
  });

  test('monthly: the day of the month, skipping months that do not have it', () => {
    expect(fires('0 8 31 * *', '2026-01-15T00:00:00Z')).toEqual(['2026-01-31T13:00:00.000Z', '2026-03-31T12:00:00.000Z', '2026-05-31T12:00:00.000Z']);
  });

  test('a day of the month and a weekday together mean either, as in cron', () => {
    // 1st of the month or a Monday; 2026-03-01 is a Sunday.
    expect(fires('0 0 1 * 1', '2026-02-27T12:00:00Z')).toEqual(['2026-03-01T05:00:00.000Z', '2026-03-02T05:00:00.000Z', '2026-03-09T04:00:00.000Z']);
  });

  test('raw cron: steps, ranges and names', () => {
    expect(fires('*/20 9-10 * jan mon-fri', '2026-01-05T14:00:00Z')).toEqual(['2026-01-05T14:20:00.000Z', '2026-01-05T14:40:00.000Z', '2026-01-05T15:00:00.000Z']);
  });

  test('once: the instant, and nothing once it has passed', () => {
    expect(fires('2026-11-20T14:30:00+11:00', '2026-11-01T00:00:00Z', 'Australia/Sydney')).toEqual(['2026-11-20T03:30:00.000Z']);
    expect(fires('2026-11-20T14:30:00+11:00', '2026-11-21T00:00:00Z', 'Australia/Sydney')).toEqual([]);
  });
});

describe('what is wrong with a schedule, before it is sent', () => {
  const NOW = Date.parse('2026-06-01T00:00:00Z');
  const problem = (draft: ScheduleDraft) => scheduleProblem(draft, NOW, SYDNEY);

  test('a good one has no problem', () => {
    expect([
      problem({ mode: 'interval', every: 5, unit: 'minutes' }),
      problem({ mode: 'daily', time: '00:00' }),
      problem({ mode: 'weekly', days: [0], time: '23:59' }),
      problem({ mode: 'monthly', day: 31, time: '12:00' }),
      problem({ mode: 'once', at: '2026-06-01T12:00' }),
      problem({ mode: 'cron', expression: '0 9 * * 1-5' }),
    ]).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  test('an interval is a whole number of at least one', () => {
    expect(problem({ mode: 'interval', every: 0, unit: 'hours' })).toBe('Every needs a whole number from 1.');
    expect(problem({ mode: 'interval', every: 1.5, unit: 'hours' })).toBe('Every needs a whole number from 1.');
    expect(problem({ mode: 'interval', every: Number.NaN, unit: 'days' })).toBe('Every needs a whole number from 1.');
  });

  test('a time of day is a time', () => {
    expect(problem({ mode: 'daily', time: '' })).toBe('Choose the time of day.');
    expect(problem({ mode: 'weekly', days: [1], time: '25:00' })).toBe('Choose the time of day.');
  });

  test('a weekly schedule needs a day, and a monthly one a real day of the month', () => {
    expect(problem({ mode: 'weekly', days: [], time: '09:00' })).toBe('Choose at least one day of the week.');
    expect(problem({ mode: 'monthly', day: 0, time: '09:00' })).toBe('Choose a day of the month from 1 to 31.');
    expect(problem({ mode: 'monthly', day: 32, time: '09:00' })).toBe('Choose a day of the month from 1 to 31.');
  });

  test('a one-time schedule needs a time that has not passed', () => {
    expect(problem({ mode: 'once', at: '' })).toBe('Choose the date and time.');
    expect(problem({ mode: 'once', at: '2026-05-31T09:00' })).toBe('That time has already passed.');
  });

  test('raw cron says what is wrong with it, and refuses what can never fire', () => {
    expect(problem({ mode: 'cron', expression: '' })).toBe('Type a cron expression.');
    expect(problem({ mode: 'cron', expression: '* * *' })).toBe('A cron expression has five fields: minute, hour, day of the month, month and weekday.');
    expect(problem({ mode: 'cron', expression: '61 * * * *' })).toBe('The minute field “61” must be from 0 to 59.');
    expect(problem({ mode: 'cron', expression: '0 0 30 2 *' })).toBe('This expression never fires: no month it names has that day.');
  });
});

describe('a schedule Hermes holds, back in the builder', () => {
  const draft = (schedule: unknown) => scheduleDraftOf(schedule, SYDNEY);

  test('intervals use the biggest whole unit', () => {
    expect([draft({ kind: 'interval', minutes: 45 }), draft({ kind: 'interval', minutes: 120 }), draft({ kind: 'interval', minutes: 2880 })]).toEqual([
      { mode: 'interval', every: 45, unit: 'minutes' },
      { mode: 'interval', every: 2, unit: 'hours' },
      { mode: 'interval', every: 2, unit: 'days' },
    ]);
  });

  test('a cron expression a mode makes comes back as that mode; any other stays raw', () => {
    expect([
      draft({ kind: 'cron', expr: '5 9 * * *' }),
      draft({ kind: 'cron', expr: '30 18 * * 1,3,5' }),
      draft({ kind: 'cron', expr: '0 0 15 * *' }),
      draft({ kind: 'cron', expr: '*/15 9-17 * * mon-fri' }),
    ]).toEqual([
      { mode: 'daily', time: '09:05' },
      { mode: 'weekly', days: [1, 3, 5], time: '18:30' },
      { mode: 'monthly', day: 15, time: '00:00' },
      { mode: 'cron', expression: '*/15 9-17 * * mon-fri' },
    ]);
  });

  test('a one-time schedule is read in the owner’s zone', () => {
    expect(draft({ kind: 'once', run_at: '2026-11-20T03:30:00+00:00' })).toEqual({ mode: 'once', at: '2026-11-20T14:30' });
  });

  test('what it cannot read starts as a fresh raw expression', () => {
    expect(draft(undefined)).toEqual({ mode: 'daily', time: '09:00' });
  });
});
