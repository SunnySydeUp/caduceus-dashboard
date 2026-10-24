import { describe, expect, test } from 'vitest';
import type { Job } from '../src/modules/work/schedules-model.ts';
import type { ActivityEvent, InboxApproval, InboxClarify, InboxItem, InboxNotice } from '@caduceus/contracts/inbox';
import type { ReadyItem } from '@caduceus/contracts/today';
import { askedBy, awayView, decisionsFor, EMPTY, readyRows, scheduleDay } from '../src/modules/today/today-model.ts';

// What Today makes of Hermes's cron jobs and runs, free of the DOM and of React: the schedule bar, the list under it, the away list, the ready list and the empty
// states. Times are written in the device's own clock, as the screen shows them.
const at = (hour: number, minute = 0, day = 19) => new Date(2026, 9, day, hour, minute).getTime();
const job = (over: Partial<Job> & { id: string }): Job => ({ name: over.id, profile: 'coder', type: 'agent', enabled: true, state: 'scheduled', schedule: 'Every day', scheduleExpression: '', config: {}, ...over });

describe('the schedule bar', () => {
  const now = at(9, 41);

  test('puts Now where the day is: a quarter of the way at 6 am, none of it at midnight, all of it at the end', () => {
    expect(scheduleDay([], at(6)).now).toBeCloseTo(0.25, 5);
    expect(scheduleDay([], at(0)).now).toBe(0);
    expect(scheduleDay([], at(23, 59, 19) + 59_999).now).toBeLessThan(1);
    expect(scheduleDay([], at(12)).now).toBeCloseTo(0.5, 5);
  });

  test('marks a job\'s last run and its next run where they fall today, and leaves out the ones that fall on another day', () => {
    const jobs = [
      job({ id: 'briefing', name: 'Morning briefing', lastRunAt: at(8), nextRunAt: at(8, 0, 20) }),
      job({ id: 'tests', name: 'Nightly tests', profile: 'coder', lastRunAt: at(23, 0, 18), nextRunAt: at(23) }),
    ];
    const { markers } = scheduleDay(jobs, now);
    expect(markers.map(({ id, kind, at: place }) => [id, kind, Number(place.toFixed(3))])).toEqual([
      ['coder:briefing:ran', 'ran', 0.333],
      ['coder:tests:next', 'next', 0.958],
    ]);
  });

  test('lists the runs that are still to come, soonest first, then the ones that have run, latest first, each in words', () => {
    const jobs = [
      job({ id: 'a', name: 'Council watch', profile: 'property', lastRunAt: at(9), lastStatus: 'ok', nextRunAt: at(21) }),
      job({ id: 'b', name: 'Morning briefing', profile: 'general', lastRunAt: at(8), lastStatus: 'ok' }),
      job({ id: 'c', name: 'Nightly tests', nextRunAt: at(23) }),
      job({ id: 'd', name: 'Backup', lastRunAt: at(7), lastStatus: 'error', lastError: 'disk full' }),
    ];
    const { rows } = scheduleDay(jobs, now);
    expect(rows.map((row) => [row.name, row.kind, row.line])).toEqual([
      ['Council watch', 'next', 'Next run in 11 h'],
      ['Nightly tests', 'next', 'Next run in 13 h'],
      ['Council watch', 'ran', 'Ran'],
      ['Morning briefing', 'ran', 'Ran'],
      ['Backup', 'failed', 'Failed: disk full'],
    ]);
  });

  test('shows every profile\'s jobs: Today is always All profiles', () => {
    const jobs = [job({ id: 'a', profile: 'coder', nextRunAt: at(23) }), job({ id: 'b', profile: 'property', nextRunAt: at(22) })];
    expect(scheduleDay(jobs, now).rows.map((row) => row.profile)).toEqual(['property', 'coder']);
  });

  test('a paused or finished job has no next run, and a run that Hermes has no time for is left out', () => {
    const jobs = [job({ id: 'p', enabled: false, nextRunAt: undefined, lastRunAt: undefined }), job({ id: 'q' })];
    expect(scheduleDay(jobs, now)).toMatchObject({ markers: [], rows: [] });
  });

  test('gives each marker the hue of its profile\'s sigil, so a profile has one colour on every screen', () => {
    const [marker] = scheduleDay([job({ id: 'a', profile: 'coder', nextRunAt: at(23) })], now).markers;
    expect(marker?.hue).toBeGreaterThanOrEqual(1);
    expect(marker?.hue).toBeLessThanOrEqual(7);
  });
});

describe('while you were away', () => {
  const now = at(9, 41);
  const run = (seq: number, time: number, over: Partial<ActivityEvent> = {}): ActivityEvent => ({ seq, at: time, profile: 'librarian', storedSessionId: `s${seq}`, title: `Chat ${seq}`, ...over });

  test('the first visit has nothing to be away from, and says so rather than showing an empty list', () => {
    expect(awayView({ since: null, now, activity: [run(1, at(8))], jobs: [] })).toEqual({ kind: 'first-visit' });
  });

  test('is the runs that finished and the routines that ran since the last visit, newest first, and nothing from before it', () => {
    const jobs = [job({ id: 'tests', name: 'Nightly tests', profile: 'coder', lastRunAt: at(6), lastStatus: 'ok' }), job({ id: 'old', name: 'Old', lastRunAt: at(1) })];
    const view = awayView({ since: at(2), now, activity: [run(2, at(7)), run(1, at(1))], jobs });
    expect(view).toMatchObject({ kind: 'rows', more: 0 });
    if (view.kind !== 'rows') return;
    expect(view.rows.map((row) => [row.kind, row.title, row.line, row.profile, row.failed, row.to])).toEqual([
      ['run', 'Chat 2', 'Finished', 'librarian', false, '/chat/s2'],
      ['routine', 'Nightly tests', 'Ran', 'coder', false, undefined],
    ]);
  });

  test('says a routine that failed has failed, with why, and marks it so a screen can show it by more than colour', () => {
    const jobs = [job({ id: 'b', name: 'Backup', lastRunAt: at(5), lastStatus: 'error', lastError: 'disk full' })];
    const view = awayView({ since: at(2), now, activity: [], jobs });
    expect(view).toMatchObject({ kind: 'rows', rows: [{ title: 'Backup', line: 'Failed: disk full', failed: true }] });
  });

  test('is quiet when nothing happened, and shows the runs and routines of every profile', () => {
    expect(awayView({ since: at(2), now, activity: [], jobs: [] })).toEqual({ kind: 'quiet' });
    const jobs = [job({ id: 'a', profile: 'coder', lastRunAt: at(5) }), job({ id: 'b', profile: 'property', lastRunAt: at(6) })];
    const view = awayView({ since: at(2), now, activity: [run(1, at(4), { profile: 'librarian' })], jobs });
    expect(view).toMatchObject({ kind: 'rows', rows: [{ profile: 'property' }, { profile: 'coder' }, { profile: 'librarian' }] });
  });

  test('shows the newest few and counts the rest', () => {
    const activity = Array.from({ length: 9 }, (_, index) => run(index + 1, at(3) + index * 60_000));
    const view = awayView({ since: at(2), now, activity, jobs: [] });
    expect(view).toMatchObject({ kind: 'rows', more: 3 });
    if (view.kind === 'rows') expect(view.rows.map((row) => row.title)).toEqual(['Chat 9', 'Chat 8', 'Chat 7', 'Chat 6', 'Chat 5', 'Chat 4']);
  });
});

describe('ready for review', () => {
  const ready = (id: string, over: Partial<ReadyItem> = {}): ReadyItem => ({ id, stamp: '1', kind: 'task', title: `Title ${id}`, summary: undefined, profile: 'coder', at: 1000, to: `/work/tasks/${id}`, ...over });

  test('says what Hermes says of each result, or that a task or a run finished when it says nothing', () => {
    const rows = readyRows([ready('a', { summary: 'Two packages bumped' }), ready('b'), ready('c', { kind: 'run', to: '/chat/c' })]);
    expect(rows.map((row) => [row.title, row.line])).toEqual([
      ['Title a', 'Two packages bumped'],
      ['Title b', 'Task finished'],
      ['Title c', 'Run finished'],
    ]);
  });

  test('keeps what the server named: which finish it is, and where it opens', () => {
    expect(readyRows([ready('a', { stamp: '42' })])[0]).toMatchObject({ id: 'a', stamp: '42', to: '/work/tasks/a', profile: 'coder' });
  });

  test('shows every profile\'s items, and an item with no profile', () => {
    const items = [ready('a', { profile: 'coder' }), ready('b', { profile: 'property' }), ready('c', { profile: undefined })];
    expect(readyRows(items).map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('what needs you', () => {
  const core = { ref: 'r', stamp: '1', category: 'approvals', profile: 'coder', at: 1000 } as const;
  const approval = (id: string, over: Partial<InboxApproval> = {}): InboxApproval => ({ ...core, id, kind: 'approval', group: 'decision', sessionId: 's', storedSessionId: 'st', sessionTitle: 'Chat', tool: 'terminal', command: 'git push', description: 'Publishes two commits', choices: ['once', 'deny'], ...over });
  const clarify = (id: string, choices: string[][], over: Partial<InboxClarify> = {}): InboxClarify => ({ ...core, id, kind: 'clarify', group: 'decision', category: 'questions', sessionId: 's', storedSessionId: 'st', sessionTitle: 'Chat', expiresAt: undefined, questions: choices.map((list, index) => ({ qid: `q${index}`, question: `Question ${index}`, choices: list, multiSelect: false })), ...over });
  const notice = (id: string, over: Partial<InboxNotice> = {}): InboxNotice => ({ ...core, id, kind: 'notice', group: 'decision', category: 'work', title: 'Review: Draft', detail: undefined, actions: [], link: undefined, ...over });

  test('is every approval, question and choice, longest wait first, and nothing that is only information or has failed', () => {
    const items: InboxItem[] = [approval('new', { at: 3000 }), notice('failed', { group: 'failed', at: 500 }), clarify('old', [['a', 'b']], { at: 1000 }), notice('fyi', { group: 'fyi' }), notice('review', { at: 2000 })];
    expect(decisionsFor(items).map((item) => item.id)).toEqual(['old', 'review', 'new']);
  });

  test('is every profile\'s decisions, and one whose profile Caduceus could not tell', () => {
    const items: InboxItem[] = [approval('a', { profile: 'coder' }), approval('b', { profile: 'property' }), approval('c', { profile: undefined })];
    expect(decisionsFor(items).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  test('says who asks and what: a command, a choice, a question, or a decision about work', () => {
    expect(askedBy(approval('a'))).toEqual({ who: 'coder', what: 'wants to run a command' });
    expect(askedBy(clarify('b', [['x', 'y']]))).toEqual({ who: 'coder', what: 'needs a choice' });
    expect(askedBy(clarify('c', [[]]))).toEqual({ who: 'coder', what: 'is asking' });
    expect(askedBy(clarify('d', [['x'], []]))).toEqual({ who: 'coder', what: 'is asking' });
    expect(askedBy(notice('e', { profile: undefined }))).toEqual({ who: 'An agent', what: 'needs a decision' });
  });
});

describe('an empty block', () => {
  test('says why it is empty and carries the action that fills it', () => {
    for (const block of ['needs', 'ready', 'schedule', 'away-first', 'away-quiet', 'crew'] as const) {
      expect(EMPTY[block].text.length, block).toBeGreaterThan(10);
      expect(EMPTY[block].action.label.length, block).toBeGreaterThan(2);
      expect(['chat', 'work', 'schedules', 'profiles'], block).toContain(EMPTY[block].action.module);
    }
  });
});
