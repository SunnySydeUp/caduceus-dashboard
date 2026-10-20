import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import path from 'node:path';
import { runProgram } from './fixtures/run-program.ts';
import { hermesPython } from './fixtures/seed-session.ts';
import { launchTestHermes, type TestHermes } from './fixtures/real-hermes.ts';
import { nextFires, parseCron, scheduleSpec, type ScheduleDraft } from '../../web/src/modules/work/schedule-spec.ts';

// The schedule builder against the real Hermes (a real `hermes serve` in a throwaway HERMES_HOME). Hermes's own answers are the independent
// source: whether it accepts what each mode sends, the `next_run_at` it stores, and its own `compute_next_run` for days the clocks change.
// Hermes works in one zone, set here, and the preview is worked out in the same zone.
const ZONE = 'America/New_York';
let hermes: TestHermes;
beforeAll(async () => {
  hermes = await launchTestHermes({ env: { HERMES_TIMEZONE: ZONE } });
  await hermes.backend.ready();
}, 60_000);
afterAll(async () => {
  await hermes.stop();
});

const json = { 'content-type': 'application/json' };

/** Asks Hermes to create a prompt job paused (nothing can run it) on the spec; returns its answer. */
async function createJob(schedule: string) {
  const response = await hermes.backend.fetch('/api/cron/jobs?profile=default', { method: 'POST', headers: json, body: JSON.stringify({ name: `spec ${schedule}`, prompt: 'Say hello', schedule, paused: false }) });
  return { status: response.status, job: (await response.json()) as { id?: string; next_run_at?: string | null; detail?: unknown } };
}

/** Hermes's own `compute_next_run` for a spec, chained from `base` (an ISO instant) the way a recurring job re-arms after each run. */
async function hermesFires(spec: string, base: string, count = 3): Promise<number[]> {
  const python = hermesPython();
  const code = [
    'import json, sys',
    'from cron.jobs import compute_next_run, parse_schedule',
    'schedule = parse_schedule(sys.argv[1])',
    'last, out = sys.argv[2], []',
    `for _ in range(${count}):`,
    '    last = compute_next_run(schedule, last)',
    '    out.append(last)',
    'print(json.dumps(out))',
  ].join('\n');
  const out = await runProgram(python, ['-c', code, spec, base], { cwd: hermes.install.dir, env: { ...process.env, HERMES_HOME: hermes.home, HERMES_TIMEZONE: ZONE } });
  return (JSON.parse(out) as string[]).map((at) => Date.parse(at));
}

describe('every schedule mode is accepted by Hermes, and the preview is its next fire time', () => {
  const drafts: Record<string, ScheduleDraft> = {
    interval: { mode: 'interval', every: 90, unit: 'minutes' },
    daily: { mode: 'daily', time: '09:05' },
    weekly: { mode: 'weekly', days: [1, 3, 5], time: '18:30' },
    monthly: { mode: 'monthly', day: 15, time: '07:45' },
    once: { mode: 'once', at: '2099-01-02T03:04' },
    cron: { mode: 'cron', expression: '*/20 9-17 * * mon-fri' },
  };

  test.each(Object.entries(drafts))('%s', async (_mode, draft) => {
    const spec = scheduleSpec(draft, ZONE);
    const asked = Date.now();

    const { status, job } = await createJob(spec);

    expect(status, JSON.stringify(job)).toBe(200);
    const [preview] = nextFires(spec, asked, ZONE);
    // An interval counts from the moment Hermes made the job, a few milliseconds after `asked`; every other mode lands on a clock reading.
    expect(Math.abs(Date.parse(job.next_run_at!) - preview)).toBeLessThan(draft.mode === 'interval' ? 10_000 : 1);
  });
});

describe('the days the clocks change', () => {
  // Each base is an instant just before a New York change (8 March and 1 November 2026) or a day away from it, as a job's last run.
  const cases: [name: string, spec: string, base: string][] = [
    ['daily 09:00 over spring forward', '0 9 * * *', '2026-03-07T12:00:00-05:00'],
    ['daily 02:30, a time spring forward skips', '30 2 * * *', '2026-03-07T12:00:00-05:00'],
    ['daily 09:00 over fall back', '0 9 * * *', '2026-10-31T12:00:00-04:00'],
    ['daily 01:30, a time fall back repeats', '30 1 * * *', '2026-10-31T12:00:00-04:00'],
    ['hourly over fall back', '0 * * * *', '2026-11-01T00:10:00-04:00'],
    ['hourly over spring forward', '0 * * * *', '2026-03-08T00:10:00-05:00'],
    ['weekly Sunday 02:30 over spring forward', '30 2 * * 0', '2026-03-01T12:00:00-05:00'],
    ['monthly the 8th at 02:15 over spring forward', '15 2 8 * *', '2026-02-20T12:00:00-05:00'],
    ['every 1d over spring forward', 'every 1d', '2026-03-07T12:00:00-05:00'],
    ['every 2h over fall back', 'every 2h', '2026-11-01T00:30:00-04:00'],
    ['a range that wraps past midnight', '10 22-2 * * *', '2026-03-07T12:00:00-05:00'],
    ['a weekday range that wraps past Saturday', '0 9 * * fri-mon', '2026-03-08T12:00:00-04:00'],
  ];

  test.each(cases)('%s', async (_name, spec, base) => {
    expect(nextFires(spec, Date.parse(base), ZONE)).toEqual(await hermesFires(spec, base));
  });
});

describe('what the form says is wrong, Hermes says too', () => {
  const bad = ['61 * * * *', '* * *', '*/0 * * * *', '0 25 * * *', '0 0 32 * *', '0 0 * 13 *', '0 0 * * 8', 'a b c d e'];
  const good = ['* * * * *', '0 0 29 2 *', '0 9 * * 7', '0 9 * * sun', '1-5/2 0-23/6 1,15 jan-mar mon,fri', '*/5 * * * *'];

  test.each(bad)('refuses %s', async (expression) => {
    expect(typeof parseCron(expression)).toBe('string');
    expect((await createJob(expression)).status).toBe(400);
  });

  test.each(good)('accepts %s', async (expression) => {
    expect(typeof parseCron(expression)).toBe('object');
    expect((await createJob(expression)).status).toBe(200);
  });
});
