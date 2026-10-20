import { describe, expect, test } from 'vitest';
import { SCHEDULER_STALE_AFTER_S } from '@caduceus/contracts/scheduler';
import { parseJobs, readSchedulesView, relativeTime, scheduleInWords, schedulerStatus, schedulerSummary, schedulesSearch, selectJobs, sortJobs, type Job } from '../src/modules/work/schedules-model.ts';

describe('a schedule in words', () => {
  const interval = (minutes: number) => scheduleInWords({ kind: 'interval', minutes });
  const cron = (expr: string) => scheduleInWords({ kind: 'cron', expr });

  test('intervals use the biggest whole unit', () => {
    expect([interval(1), interval(30), interval(60), interval(90), interval(120), interval(1440), interval(2880)]).toEqual(['Every minute', 'Every 30 minutes', 'Every hour', 'Every 90 minutes', 'Every 2 hours', 'Every day', 'Every 2 days']);
  });

  test('the cron expressions people write are said as they are meant', () => {
    expect([cron('* * * * *'), cron('*/15 * * * *'), cron('0 */6 * * *'), cron('0 * * * *'), cron('30 * * * *'), cron('5 4 * * *'), cron('0 9 * * 1'), cron('0 9 * * mon'), cron('0 9 * * 1-5'), cron('0 10 * * 0,6'), cron('15 8 * * 1,3,5'), cron('0 9 1 * *'), cron('0 9 22 * *')]).toEqual([
      'Every minute',
      'Every 15 minutes',
      'Every 6 hours',
      'Every hour',
      'Every hour at :30',
      'Every day at 04:05',
      'Every Monday at 09:00',
      'Every Monday at 09:00',
      'Weekdays at 09:00',
      'Weekends at 10:00',
      'Every Monday, Wednesday and Friday at 08:15',
      'The 1st of every month at 09:00',
      'The 22nd of every month at 09:00',
    ]);
  });

  test('one that is not simple, a one-shot and a damaged record are shown as Hermes stored them', () => {
    expect(cron('0 9 1 6 *')).toBe('Cron 0 9 1 6 *');
    expect(cron('0 0 9 * * 1')).toBe('Cron 0 0 9 * * 1');
    expect(scheduleInWords({ kind: 'once', run_at: '2026-12-24T14:30:00+10:00' })).toBe('Once at 2026-12-24 14:30');
    expect(scheduleInWords(undefined, 'every 5m')).toBe('every 5m');
    expect(scheduleInWords({ kind: 'sometimes', display: 'now and then' })).toBe('now and then');
    expect(scheduleInWords(null)).toBe('No schedule');
  });
});

/** A job as Hermes lists it, with just what a test changes. */
const hermesJob = (fields: Record<string, unknown>) => ({
  id: 'job',
  name: 'Job',
  profile: 'default',
  prompt: 'do it',
  script: null,
  no_agent: false,
  schedule: { kind: 'interval', minutes: 60, display: 'every 60m' },
  schedule_display: 'every 60m',
  enabled: true,
  state: 'scheduled',
  next_run_at: '2026-10-19T09:00:00+10:00',
  last_run_at: null,
  last_status: null,
  scheduler_heartbeat_age_s: null,
  ...fields,
});

describe('the scheduler’s state', () => {
  const jobs = (...fields: Record<string, unknown>[]) => parseJobs(fields.map((f, index) => hermesJob({ id: `job${index}`, ...f })));

  test('is stale just past the threshold Health uses, and ok up to it', () => {
    expect(schedulerStatus(jobs({ scheduler_heartbeat_age_s: SCHEDULER_STALE_AFTER_S })).state).toBe('ok');
    expect(schedulerStatus(jobs({ scheduler_heartbeat_age_s: SCHEDULER_STALE_AFTER_S + 1 }))).toMatchObject({ state: 'stale', waiting: 1 });
  });

  test('is judged by the oldest heartbeat of a job that waits; paused and finished jobs need no tick', () => {
    expect(schedulerStatus(jobs({ scheduler_heartbeat_age_s: 10 }, { profile: 'coder', scheduler_heartbeat_age_s: 4000 })).state).toBe('stale');
    expect(schedulerStatus(jobs({ scheduler_heartbeat_age_s: 10 }, { enabled: false, state: 'paused', scheduler_heartbeat_age_s: 4000 }, { state: 'completed', scheduler_heartbeat_age_s: 4000 })).state).toBe('ok');
    expect(schedulerStatus(jobs({ enabled: false, state: 'paused' }, { state: 'completed' }))).toEqual({ state: 'idle' });
    expect(schedulerStatus([])).toEqual({ state: 'idle' });
  });

  test('is unknown while no profile has ticked', () => {
    expect(schedulerStatus(jobs({}, { profile: 'coder' }))).toEqual({ state: 'unknown', waiting: 2 });
  });

  test('is said in a sentence', () => {
    expect(schedulerSummary({ state: 'stale', ageSeconds: 3 * 3600, waiting: 2 })).toBe('not ticking; the last tick was 3 h ago, though it ticks every minute, and 2 jobs are waiting to run');
    expect(schedulerSummary({ state: 'unknown', waiting: 1 })).toBe('no tick recorded yet; 1 job is waiting to run');
  });
});

describe('filtering and ordering the list', () => {
  const listed: Job[] = parseJobs([
    hermesJob({ id: 'a', name: 'Alpha', profile: 'default', next_run_at: '2026-10-19T12:00:00+10:00' }),
    hermesJob({ id: 'b', name: 'Bravo', profile: 'coder', script: 'x.sh', no_agent: true, next_run_at: '2026-10-19T08:00:00+10:00', last_status: 'error' }),
    hermesJob({ id: 'c', name: 'Charlie', profile: 'coder', enabled: false, state: 'paused', next_run_at: null }),
    hermesJob({ id: 'd', name: 'Delta', profile: 'writer', state: 'completed', enabled: false, next_run_at: null, last_status: 'ok' }),
    hermesJob({ id: 'e', name: 'Echo', profile: 'writer', next_run_at: '2026-10-19T10:00:00+10:00', last_status: 'error' }),
  ]);
  const names = (jobs: readonly Job[]) => jobs.map((job) => job.name);

  test('by profile, type and status, each alone and together', () => {
    expect(names(selectJobs(listed, { profile: 'coder' }))).toEqual(['Bravo', 'Charlie']);
    expect(names(selectJobs(listed, { type: 'script' }))).toEqual(['Bravo']);
    expect(names(selectJobs(listed, { status: 'paused' }))).toEqual(['Charlie']);
    expect(names(selectJobs(listed, { status: 'active' }))).toEqual(['Alpha', 'Bravo', 'Echo']);
    expect(names(selectJobs(listed, { status: 'failed' }))).toEqual(['Bravo', 'Echo']);
    expect(names(selectJobs(listed, { status: 'finished' }))).toEqual(['Delta']);
    expect(names(selectJobs(listed, { profile: 'coder', status: 'failed' }))).toEqual(['Bravo']);
    expect(names(selectJobs(listed, {}))).toHaveLength(5);
  });

  test('the next to fire comes first, then jobs with nothing due, by name', () => {
    expect(names(sortJobs(listed))).toEqual(['Bravo', 'Echo', 'Alpha', 'Charlie', 'Delta']);
  });

  test('the filter is in the address and reads back; a damaged address is no filter', () => {
    const view = { profile: 'coder', type: 'task', status: 'failed' } as const;
    expect(schedulesSearch(view)).toEqual({ for: 'coder', type: 'task', status: 'failed' });
    expect(readSchedulesView(schedulesSearch(view))).toEqual(view);
    expect(schedulesSearch({})).toEqual({});
    expect(readSchedulesView({ for: ['a', 'b'], type: 'cake', status: 'busy' })).toEqual({});
  });
});

describe('when something is, from now', () => {
  test('is said in the biggest unit that fits, ahead or behind', () => {
    const now = Date.parse('2026-10-18T10:00:00Z');
    expect([relativeTime(now + 5 * 60_000 + 20_000, now), relativeTime(now - 3 * 3_600_000, now), relativeTime(now + 12_000, now), relativeTime(now - 2 * 86_400_000, now), relativeTime(now, now)]).toEqual(['in 5 min', '3 h ago', 'in 12 s', '2 d ago', 'now']);
  });
});
