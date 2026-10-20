import { describe, expect, test } from 'vitest';
import type { InboxItem } from '@caduceus/contracts/inbox';
import { digestDue, inQuietHours, pushCategoryOf } from '../src/push-rules.ts';

// Quiet hours and the digest are counted on a device's own clock (M2 #03): the hour of the day in its time zone, across midnight and across a change
// of clocks. The instants below are written in UTC and the expectations from the zones' own offsets.
const at = (iso: string) => Date.parse(iso);
const night = { enabled: true, start: '22:00', end: '07:00' };

describe('quiet hours', () => {
  test('are off unless switched on', () => {
    expect(inQuietHours({ ...night, enabled: false }, 'UTC', at('2026-10-07T23:00:00Z'))).toBe(false);
  });

  test('run over midnight when the window ends before it starts, start included and end excluded', () => {
    expect(inQuietHours(night, 'UTC', at('2026-10-07T21:59:00Z'))).toBe(false);
    expect(inQuietHours(night, 'UTC', at('2026-10-07T22:00:00Z'))).toBe(true);
    expect(inQuietHours(night, 'UTC', at('2026-10-08T03:00:00Z'))).toBe(true);
    expect(inQuietHours(night, 'UTC', at('2026-10-08T06:59:00Z'))).toBe(true);
    expect(inQuietHours(night, 'UTC', at('2026-10-08T07:00:00Z'))).toBe(false);
  });

  test('are the device\'s own hours: 23:30 in Paris (UTC+2 in October) is 21:30 UTC', () => {
    expect(inQuietHours(night, 'Europe/Paris', at('2026-10-07T21:30:00Z'))).toBe(true);
    expect(inQuietHours(night, 'Europe/Paris', at('2026-10-07T19:30:00Z'))).toBe(false);
    // Los Angeles is UTC-7 in October: 04:59 UTC is 21:59 there, 05:00 UTC is 22:00.
    expect(inQuietHours(night, 'America/Los_Angeles', at('2026-10-08T04:59:00Z'))).toBe(false);
    expect(inQuietHours(night, 'America/Los_Angeles', at('2026-10-08T05:00:00Z'))).toBe(true);
  });

  test('a window inside one day, and one that is empty', () => {
    const lunch = { enabled: true, start: '12:00', end: '13:00' };
    expect(inQuietHours(lunch, 'UTC', at('2026-10-07T12:30:00Z'))).toBe(true);
    expect(inQuietHours(lunch, 'UTC', at('2026-10-07T13:00:00Z'))).toBe(false);
    expect(inQuietHours({ enabled: true, start: '08:00', end: '08:00' }, 'UTC', at('2026-10-07T08:00:00Z'))).toBe(false);
  });
});

describe('the digest', () => {
  test('never goes out when it is off', () => {
    expect(digestDue('off', 'UTC', at('2026-10-07T10:00:00Z'), at('2026-10-09T10:00:00Z'))).toBe(false);
  });

  test('an hourly digest goes when the device\'s clock reaches the next hour after what it holds first, never in the same hour', () => {
    expect(digestDue('hourly', 'UTC', at('2026-10-07T10:05:00Z'), at('2026-10-07T10:05:00Z'))).toBe(false);
    expect(digestDue('hourly', 'UTC', at('2026-10-07T10:05:00Z'), at('2026-10-07T10:59:00Z'))).toBe(false);
    expect(digestDue('hourly', 'UTC', at('2026-10-07T10:05:00Z'), at('2026-10-07T11:00:00Z'))).toBe(true);
    expect(digestDue('hourly', 'UTC', at('2026-10-07T23:30:00Z'), at('2026-10-08T00:00:00Z'))).toBe(true);
  });

  test('a daily digest goes at the next 09:00 on the device\'s clock after what it holds first', () => {
    // 03:00 in Paris (UTC+2): the digest is due at 09:00 the same day, which is 07:00 UTC.
    expect(digestDue('daily', 'Europe/Paris', at('2026-10-07T01:00:00Z'), at('2026-10-07T06:59:00Z'))).toBe(false);
    expect(digestDue('daily', 'Europe/Paris', at('2026-10-07T01:00:00Z'), at('2026-10-07T07:00:00Z'))).toBe(true);
    // 10:00 in Paris: not today, tomorrow at 09:00.
    expect(digestDue('daily', 'Europe/Paris', at('2026-10-07T08:00:00Z'), at('2026-10-07T20:00:00Z'))).toBe(false);
    expect(digestDue('daily', 'Europe/Paris', at('2026-10-07T08:00:00Z'), at('2026-10-08T06:59:00Z'))).toBe(false);
    expect(digestDue('daily', 'Europe/Paris', at('2026-10-07T08:00:00Z'), at('2026-10-08T07:00:00Z'))).toBe(true);
    // Held over a few days, it is simply overdue.
    expect(digestDue('daily', 'UTC', at('2026-10-07T10:00:00Z'), at('2026-10-11T02:00:00Z'))).toBe(true);
  });
});

describe('the push category of Work items', () => {
  const task = (group: 'decision' | 'failed'): InboxItem => ({ kind: 'notice', id: 'task:default:t_1', ref: 'task:default:t_1', stamp: 's', group, category: 'work', profile: 'work', at: 1, title: 't', detail: undefined, actions: [], link: undefined });
  test('a task for review or with a question is Reviews & blocked tasks; one that gave up is a Failure, as is a failed job', () => {
    expect(pushCategoryOf(task('decision'))).toBe('reviews');
    expect(pushCategoryOf(task('failed'))).toBe('failures');
    expect(pushCategoryOf({ ...task('failed'), ref: 'cron:work:abc', category: 'automation' })).toBe('failures');
  });
});
