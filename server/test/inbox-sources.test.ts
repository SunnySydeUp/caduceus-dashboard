import { describe, expect, test } from 'vitest';
import type { Repair } from '@caduceus/contracts/caduceus-api';
import { SCHEDULER_STALE_AFTER_S } from '@caduceus/contracts/scheduler';
import { createActivityFeed, createRunTracker } from '../src/inbox-activity.ts';
import { cronNotices, OVERDUE_AFTER_MS } from '../src/inbox-cron.ts';
import { workNotices } from '../src/inbox-work.ts';
import { pairingNotices } from '../src/inbox-pairing.ts';
import type { LiveSession } from '../src/inbox-requests.ts';
import { repairNotices, updateNotice } from '../src/inbox-system.ts';

// What each source of the Inbox (M2 #02) makes of what Hermes says: pure, over answers shaped as Hermes's (recorded from its REST API), with the
// time given. That each one reads Hermes, and goes when Hermes's state moves, is `inbox.test.ts` over the real Hermes.
const NOW = Date.parse('2026-10-19T12:00:00Z');
const job = (overrides: Record<string, unknown> = {}) => ({ id: 'abc123', name: 'Nightly report', profile: 'work', state: 'scheduled', enabled: true, last_status: 'ok', last_run_at: '2026-10-19T03:00:00+00:00', next_run_at: '2026-10-20T03:00:00+00:00', scheduler_heartbeat_age_s: 20, ...overrides });

describe('cron jobs', () => {
  test('a job whose last run failed is a failure with Run now and Pause, which name the job and its profile, and a link to its output', () => {
    const [notice] = cronNotices([job({ last_status: 'error', last_error: 'The model did not answer.' })], NOW);

    expect(notice).toMatchObject({ id: 'cron-failed:work:abc123', ref: 'cron:work:abc123', group: 'failed', category: 'automation', profile: 'work', title: '“Nightly report” failed', detail: 'The model did not answer.' });
    expect(notice?.actions.map(({ id, request }) => [id, request.method, request.path])).toEqual([
      ['run-now', 'POST', '/api/cron/jobs/abc123/trigger?profile=work'],
      ['pause', 'POST', '/api/cron/jobs/abc123/pause?profile=work'],
    ]);
    expect(notice?.actions.every((action) => action.confirm?.object === 'Nightly report' && action.confirm.text?.includes('work'))).toBe(true);
    expect(notice?.link).toEqual({ label: 'Open output', to: '/work/schedules/abc123?profile=work' });
  });

  test('its next failure is another state: the stamp says which run failed, so a dismissal of the last one does not hide it', () => {
    const [first] = cronNotices([job({ last_status: 'error', last_run_at: 'run-1' })], NOW);
    const [second] = cronNotices([job({ last_status: 'error', last_run_at: 'run-2' })], NOW);
    expect(first?.ref).toBe(second?.ref);
    expect(first?.stamp).not.toBe(second?.stamp);
  });

  test('a job that ran well again, or was paused, is not an item', () => {
    expect(cronNotices([job()], NOW)).toEqual([]);
    expect(cronNotices([job({ last_status: 'error', state: 'paused', enabled: false })], NOW)).toEqual([]);
  });

  test('a job that is late by more than a slow run is overdue, with Run now; one that is a little late is not', () => {
    const late = (ms: number) => job({ next_run_at: new Date(NOW - ms).toISOString() });
    expect(cronNotices([late(OVERDUE_AFTER_MS + 60_000)], NOW)).toMatchObject([{ id: 'cron-overdue:work:abc123', group: 'failed', title: '“Nightly report” is overdue' }]);
    expect(cronNotices([late(OVERDUE_AFTER_MS - 60_000)], NOW)).toEqual([]);
  });

  test('jobs are not overdue one by one when the scheduler is not ticking: that is one problem, and the system source says it', () => {
    expect(cronNotices([job({ next_run_at: new Date(NOW - 3_600_000).toISOString(), scheduler_heartbeat_age_s: SCHEDULER_STALE_AFTER_S + 1 })], NOW)).toEqual([]);
  });

  test('a job whose notifications the owner switched off is not an item, failed or overdue; the others still are', () => {
    const muted = (profile: string, id: string) => profile === 'work' && id === 'abc123';
    expect(cronNotices([job({ last_status: 'error' }), job({ id: 'late', next_run_at: new Date(NOW - 3_600_000).toISOString() })], NOW, muted).map((notice) => notice.ref)).toEqual(['cron:work:late']);
  });

  test('anything that is not a job in the list is left out', () => {
    expect(cronNotices('nope', NOW)).toEqual([]);
    expect(cronNotices([null, { name: 'no id' }, job({ id: undefined })], NOW)).toEqual([]);
  });
});

describe('pairing requests', () => {
  const answer = { pending: [{ platform: 'telegram', request_id: 'req-1', user_id: '4711', user_name: 'Ada', age_minutes: 3 }, { platform: 'discord', request_id: '', user_id: '99', user_name: '', age_minutes: 0 }], approved: [] };

  test('a stranger waiting to be approved is a decision, with Approve naming the person, the platform and the profile', () => {
    const [ada] = pairingNotices(answer, 'work');

    expect(ada).toMatchObject({ id: 'pairing:work:telegram:req-1', group: 'decision', category: 'pairing', profile: 'work', title: 'Ada (4711) wants to talk to your Telegram bot' });
    expect(ada?.actions).toEqual([
      expect.objectContaining({ id: 'approve', request: { method: 'POST', path: '/api/pairing/approve', body: { platform: 'telegram', request_id: 'req-1', profile: 'work' } }, confirm: expect.objectContaining({ title: expect.stringContaining('Ada') }) }),
    ]);
    expect(ada?.link).toEqual({ label: 'Open Pairing', to: '/connect/pairing?profile=work' });
  });

  test('a request an older Hermes wrote without an id cannot be approved from here, so it only links to the Pairing screen', () => {
    const [, old] = pairingNotices(answer, 'work');
    expect(old?.actions).toEqual([]);
    expect(old?.link?.to).toBe('/connect/pairing?profile=work');
  });

  test('the only person waiting can be declined: Hermes has no way to refuse one request, only to clear the profile\'s waiting list, which is the same thing for one', () => {
    const alone = { pending: [answer.pending[0]], approved: [] };
    const [ada] = pairingNotices(alone, 'work');
    expect(ada?.actions.map((action) => action.id)).toEqual(['approve', 'decline']);
    const decline = ada?.actions.find((action) => action.id === 'decline');
    expect(decline?.request).toEqual({ method: 'POST', path: '/api/pairing/clear-pending?profile=work' });
    expect(decline?.confirm?.text).toContain('Ada');
    // With two people waiting, one card must not clear the other, so there is no Decline: Pairing has the whole list.
    expect(pairingNotices(answer, 'work').flatMap((notice) => notice.actions.map((action) => action.id))).not.toContain('decline');
  });

  test('an answer with nothing waiting is no items', () => {
    expect(pairingNotices({ pending: [], approved: [{ platform: 'telegram' }] }, 'work')).toEqual([]);
    expect(pairingNotices(undefined, 'work')).toEqual([]);
  });
});

describe('what Health says is wrong', () => {
  const repair = (overrides: Partial<Repair>): Repair => ({ id: 'gateway-not-running', severity: 'warning', subsystem: 'gateway', title: 'The messaging gateway is not running', cause: 'Hermes is not receiving messages.', link: { label: 'Open Gateway', to: '/connect/gateway' }, ...overrides });

  test('a Repair is a failure that goes when the Repair goes, with Health\'s own link, or a link to Health', () => {
    const [gateway, key] = repairNotices([repair({}), repair({ id: 'model-key-missing', subsystem: 'providers', title: 'No key', link: undefined })]);
    expect(gateway).toMatchObject({ id: 'health:gateway-not-running', group: 'failed', category: 'system', title: 'The messaging gateway is not running', link: { label: 'Open Gateway', to: '/connect/gateway' } });
    expect(key?.link).toEqual({ label: 'Open Health', to: '/observe/health' });
  });

  test('a stuck gateway can be restarted from the item, which is a T2 on the route and names the profile', () => {
    const [stuck] = repairNotices([repair({ id: 'gateway-unresponsive' })]);
    expect(stuck?.actions).toEqual([expect.objectContaining({ id: 'restart-gateway', request: { method: 'POST', path: '/api/gateway/restart?profile=default' }, confirm: expect.objectContaining({ object: 'default' }) })]);
  });

  test('a Repair that is only for information is for information', () => {
    expect(repairNotices([repair({ severity: 'info' })])[0]?.group).toBe('fyi');
  });

  test('an update waiting is for information, and nothing is said when Hermes is up to date or could not say', () => {
    expect(updateNotice({ update_available: true, behind: 12, current_version: '0.21.4' })).toMatchObject([{ id: 'update:hermes', group: 'fyi', category: 'system', stamp: '12', title: 'A Hermes update is available' }]);
    expect(updateNotice({ update_available: false, behind: 0 })).toEqual([]);
    expect(updateNotice({ update_available: false, behind: null })).toEqual([]);
    expect(updateNotice(undefined)).toEqual([]);
  });
});

describe('finished runs', () => {
  const session = (status: string, overrides: Partial<LiveSession> = {}): LiveSession => ({ id: 'rt1', key: 'stored-1', title: 'Clean up', preview: '', status, lastActive: 0, ...overrides });
  const profileOf = async () => 'work';

  test('a session that was working and is idle has finished a run; one first seen idle has not, and a run still going has not', async () => {
    let now = 1000;
    const feed = createActivityFeed(() => now);
    const observe = createRunTracker(feed, () => now);

    await observe([session('idle')], profileOf);
    expect(feed.events()).toEqual([]);
    await observe([session('working')], profileOf);
    await observe([session('working')], profileOf);
    expect(feed.events()).toEqual([]);
    now = 5000;
    await observe([session('idle')], profileOf);

    expect(feed.events()).toEqual([{ seq: 5000, at: 5000, profile: 'work', storedSessionId: 'stored-1', title: 'Clean up' }]);
    // Idle stays idle: one run, one event.
    await observe([session('idle')], profileOf);
    expect(feed.events()).toHaveLength(1);
  });

  test('a run that waited for the owner and then finished has finished, and the feed is newest first with a sequence that only goes up', async () => {
    const feed = createActivityFeed(() => 100);
    const observe = createRunTracker(feed, () => 100);
    await observe([session('waiting'), session('working', { id: 'rt2', key: 'stored-2', title: '', preview: 'Summarise the report' })], profileOf);
    await observe([session('idle'), session('idle', { id: 'rt2', key: 'stored-2', title: '', preview: 'Summarise the report' })], profileOf);

    expect(feed.events().map((event) => event.title)).toEqual(['Summarise the report', 'Clean up']);
    const [newest, oldest] = feed.events();
    // Two events at the same millisecond still have different sequences, and the later one is greater.
    expect(newest!.seq).toBeGreaterThan(oldest!.seq);
  });

  test('a session that goes away without finishing leaves no event', async () => {
    const feed = createActivityFeed(() => 1);
    const observe = createRunTracker(feed, () => 1);
    await observe([session('working')], profileOf);
    await observe([], profileOf);
    expect(feed.events()).toEqual([]);
  });
});

describe('Kanban tasks', () => {
  const task = (overrides: Record<string, unknown> = {}) => ({ id: 't_1', title: 'Write the report', status: 'review', assignee: 'work', consecutive_failures: 0, ...overrides });
  const boards = (...tasks: Record<string, unknown>[]) => [{ slug: 'default', tasks }];

  test('a task in review is a decision with Approve and Reject + note, which name the task and board', () => {
    const [notice] = workNotices(boards(task()));
    expect(notice).toMatchObject({ id: 'task:default:t_1', ref: 'task:default:t_1', group: 'decision', category: 'work', profile: 'work', title: 'Review: Write the report' });
    expect(notice?.actions.map(({ id, request }) => [id, request.method, request.path])).toEqual([
      ['approve', 'POST', '/_caduceus/api/work/tasks/t_1/approve?board=default'],
      ['reject', 'POST', '/_caduceus/api/work/tasks/t_1/reject?board=default'],
    ]);
    expect(notice?.actions.find((a) => a.id === 'reject')?.input).toEqual({ field: 'note', label: 'What needs to change?', required: true });
    expect(notice?.link).toEqual({ label: 'Open task', to: '/work/tasks/t_1?board=default' });
  });

  test('a blocked task that needs input is a decision with Answer', () => {
    const [notice] = workNotices(boards(task({ status: 'blocked', block_kind: 'needs_input', latest_summary: 'Which year?' })));
    expect(notice).toMatchObject({ group: 'decision', title: 'Needs input: Write the report', detail: 'Which year?' });
    expect(notice?.actions.map((a) => a.id)).toEqual(['answer']);
    expect(notice?.actions[0]?.request.path).toBe('/_caduceus/api/work/tasks/t_1/answer?board=default');
  });

  test('a task that gave up is a failure with Retry and Reassign', () => {
    const [notice] = workNotices(boards(task({ status: 'blocked', block_kind: 'transient', consecutive_failures: 3, last_failure_error: 'worker crashed' })));
    expect(notice).toMatchObject({ group: 'failed', title: 'Gave up: Write the report', detail: 'worker crashed' });
    expect(notice?.actions.map(({ id, request }) => [id, request.path])).toEqual([
      ['retry', '/_caduceus/api/work/tasks/t_1/retry?board=default'],
      ['reassign', '/api/plugins/kanban/tasks/t_1/reassign?board=default'],
    ]);
  });

  test('the confirmations say what the owner is deciding on: the worker\'s note with Approve, the task with a rejection, and neither is cut in the middle of a word', () => {
    const long = `${'The migration is written and the tests pass. '.repeat(12)}Last sentence.`;
    const [review] = workNotices(boards(task({ latest_summary: long })));
    const approve = review?.actions.find((a) => a.id === 'approve')?.confirm;
    expect(approve?.text).toMatch(/^The worker says: “The migration is written/);
    expect(approve?.text).toMatch(/…” Approving marks the task done/);
    // The cut falls after a whole word of the sentence, never inside one.
    expect(review?.detail).toMatch(/(?:^|\s)(?:The|migration|is|written|and|the|tests|pass)…$/);
    const reject = review?.actions.find((a) => a.id === 'reject')?.confirm;
    expect(reject).toMatchObject({ title: 'Send “Write the report” back?', confirmLabel: 'Send back' });
    const [plain] = workNotices(boards(task()));
    expect(plain?.actions.find((a) => a.id === 'approve')?.confirm?.text).toBe('Approving marks the task done, with your approval as its result.');
  });

  test('a worker that ended without reporting is said in plain words, not in Hermes\'s protocol', () => {
    const [notice] = workNotices(boards(task({ status: 'blocked', block_kind: 'transient', consecutive_failures: 2, last_failure_error: 'worker exited rc=0 without kanban_complete' })));
    expect(notice?.detail).toBe('The worker stopped before it finished.');
  });

  test('a task that is simply waiting, running or done is not an item; the stamp changes when the state does', () => {
    expect(workNotices(boards(task({ status: 'running' }), task({ id: 't_2', status: 'blocked', block_kind: 'dependency' }), task({ id: 't_3', status: 'done' })))).toEqual([]);
    const a = workNotices(boards(task({ completed_at: null, updated_at: 1 })))[0];
    const b = workNotices(boards(task({ status: 'blocked', block_kind: 'needs_input' })))[0];
    expect(a?.stamp).not.toBe(b?.stamp);
  });
});
