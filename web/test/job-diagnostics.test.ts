import { describe, expect, test } from 'vitest';
import { diagnosticsText, redactText } from '../src/modules/work/job-diagnostics.ts';
import { parseJobs, schedulerStatus } from '../src/modules/work/schedules-model.ts';

describe('redacting a text for a bug report', () => {
  test('hides what looks like a secret and keeps the words around it', () => {
    const secrets = [
      'sk-proj-abcdefghijklmnopqrstuvwx',
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
      // Built from two parts so secret scanners (GitHub push protection) do not take the fixture for a real Slack token.
      ['xoxb', '123456789012-abcdefghijkl'].join('-'),
      'AKIAABCDEFGHIJKLMNOP',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl',
      'hunter2hunter2',
      'a3f5c9d2b1e84f60a7c3d9e1f2b4a6c8d0e2f4a6',
      'p4ssw0rd',
    ];
    const text = [
      `The key is ${secrets[0]} and the token ${secrets[1]}.`,
      `slack ${secrets[2]} aws ${secrets[3]}`,
      `curl -H "Authorization: Bearer ${secrets[4]}" https://api.example.com`,
      `OPENAI_API_KEY=${secrets[5]}`,
      `{"client_secret": "${secrets[5]}", "name": "visible"}`,
      `sha ${secrets[6]}`,
      `postgres://admin:${secrets[7]}@db.internal:5432/app`,
    ].join('\n');

    const redacted = redactText(text);

    for (const secret of secrets) expect(redacted).not.toContain(secret);
    expect(redacted).toContain('Authorization: Bearer [redacted]');
    expect(redacted).toContain('OPENAI_API_KEY=[redacted]');
    expect(redacted).toContain('"name": "visible"');
    expect(redacted).toContain('postgres://admin:[redacted]@db.internal:5432/app');
    expect(redacted).toContain('The key is');
  });

  test('leaves ordinary text, paths, ids and times as they are', () => {
    const text = 'Job 1dabfcf66754 ran at 2026-10-18 21:06:16 from /Users/me/.hermes/scripts/disk-check.sh and said: disk ok (42% used)';
    expect(redactText(text)).toBe(text);
  });
});

describe('the diagnostics bundle', () => {
  const [job] = parseJobs([
    {
      id: '1dabfcf66754',
      name: 'Nightly report',
      profile: 'coder',
      profile_name: 'coder',
      hermes_home: '/Users/me/.hermes/profiles/coder',
      prompt: 'Summarise the day. Use token ghp_abcdefghijklmnopqrstuvwxyz0123456789 to read the repo.',
      schedule: { kind: 'cron', expr: '0 9 * * 1-5', display: '0 9 * * 1-5' },
      schedule_display: '0 9 * * 1-5',
      enabled: true,
      state: 'scheduled',
      next_run_at: '2026-10-19T09:00:00+10:00',
      last_run_at: '2026-10-18T09:00:02+10:00',
      last_status: 'error',
      last_error: 'Provider said 401 for key sk-proj-abcdefghijklmnopqrstuvwx',
      failure_streak: 2,
      deliver: 'local',
      model: 'gpt-x',
      origin: { platform: 'telegram', chat_id: '9876543210' },
      scheduler_heartbeat_age_s: 12,
    },
  ]);

  const bundle = diagnosticsText({
    job,
    runs: [
      { run: { id: 'cron_1dabfcf66754_20261018_090002', source: 'session', startedAt: Date.parse('2026-10-18T09:00:02+10:00'), endedAt: Date.parse('2026-10-18T09:00:09+10:00'), durationMs: 7000, status: 'incomplete', statusLabel: 'Did not finish' }, output: 'Fetching… Authorization: Bearer abcdefghijklmnop1234567890 failed' },
      { run: { id: 'cron_1dabfcf66754_20261017_090001', source: 'session', startedAt: Date.parse('2026-10-17T09:00:01+10:00'), endedAt: Date.parse('2026-10-17T09:00:04+10:00'), durationMs: 3000, status: 'ok', statusLabel: 'Finished' }, output: 'All done.' },
    ],
    scheduler: schedulerStatus([job]),
    now: Date.parse('2026-10-18T10:00:00+10:00'),
  });

  test('has the job’s configuration, its latest runs with their output, and the scheduler’s state, as plain text', () => {
    expect(bundle).toContain('Caduceus diagnostics: schedule');
    expect(bundle).toContain('Job: Nightly report (1dabfcf66754)');
    expect(bundle).toContain('Profile: coder');
    expect(bundle).toContain('Type: Agent prompt');
    expect(bundle).toContain('Schedule: Weekdays at 09:00 (0 9 * * 1-5)');
    expect(bundle).toContain('State: scheduled, enabled');
    expect(bundle).toContain('Last result: error');
    expect(bundle).toContain('Failure streak: 2');
    expect(bundle).toContain('Scheduler: ticking; the last tick was 12 s ago and 1 job is waiting to run');
    expect(bundle).toContain('Run 1: Did not finish, 7 s, cron_1dabfcf66754_20261018_090002');
    expect(bundle).toContain('Run 2: Finished, 3 s');
    expect(bundle).toContain('All done.');
  });

  test('has no secret: not in the prompt, the error or a run’s output, and nothing of the job’s origin or home directory', () => {
    for (const secret of ['ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'sk-proj-abcdefghijklmnopqrstuvwx', 'abcdefghijklmnop1234567890']) expect(bundle).not.toContain(secret);
    expect(bundle).not.toContain('9876543210');
    expect(bundle).not.toContain('/Users/me');
    expect(bundle).toContain('Summarise the day.');
  });
});
