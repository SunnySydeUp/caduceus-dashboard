import { describe, expect, test } from 'vitest';
import type { ActivityEvent } from '@caduceus/contracts/inbox';
import type { ReadyItem } from '@caduceus/contracts/today';
import { AWAY_GAP_MS, READY_WINDOW_MS, readyItems, recordVisit, runCandidates, taskCandidates } from '../src/today-review.ts';

// The rules behind Today's review state (M8 #03), at their exported functions: what is ready for review, what a visit is, and how Hermes's finished work becomes items.
const item = (id: string, at: number, stamp = '1'): ReadyItem => ({ id, stamp, kind: 'task', title: id, summary: undefined, profile: undefined, at, to: '/work' });
const NOW = 1_800_000_000_000;
const BEGAN = NOW - 3_600_000;

describe('what is ready for review', () => {
  test('finished work that was not opened is ready, newest first', () => {
    const items = readyItems([item('a', BEGAN + 1000), item('b', BEGAN + 5000)], [], { began: BEGAN, now: NOW });
    expect(items.map(({ id }) => id)).toEqual(['b', 'a']);
  });

  test('work opened at the stamp it has is not ready; at a newer stamp (it finished again) it is ready again', () => {
    const items = [item('a', BEGAN + 1000, '10'), item('b', BEGAN + 2000, '20')];
    expect(readyItems(items, [{ id: 'a', stamp: '10' }], { began: BEGAN, now: NOW }).map(({ id }) => id)).toEqual(['b']);
    expect(readyItems(items, [{ id: 'a', stamp: '9' }], { began: BEGAN, now: NOW }).map(({ id }) => id)).toEqual(['b', 'a']);
  });

  test('work finished before Today began is never offered, but one finished in the very second it began is', () => {
    const began = NOW - 5_400;
    const items = [item('before', Math.floor(began / 1000) * 1000 - 1000), item('same second', Math.floor(began / 1000) * 1000)];
    expect(readyItems(items, [], { began, now: NOW }).map(({ id }) => id)).toEqual(['same second']);
  });

  test('work older than the window is no longer offered, whatever began Today', () => {
    const now = NOW + READY_WINDOW_MS * 2;
    const items = [item('old', NOW), item('recent', now - 1000)];
    expect(readyItems(items, [], { began: NOW - 1000, now }).map(({ id }) => id)).toEqual(['recent']);
  });
});

describe('a visit to Today', () => {
  test('the first visit has nothing before it', () => {
    expect(recordVisit({ visitAt: undefined, previousVisitAt: undefined }, 1000)).toEqual({ state: { visitAt: 1000, previousVisitAt: undefined }, visit: { since: null, at: 1000 } });
  });

  test('a visit after a pause is away since the last one; a visit soon after is the same stretch and keeps what it was away since', () => {
    const away = recordVisit({ visitAt: 1000, previousVisitAt: undefined }, 1000 + AWAY_GAP_MS);
    expect(away.visit).toEqual({ since: 1000, at: 1000 + AWAY_GAP_MS });
    const reload = recordVisit(away.state, 1000 + AWAY_GAP_MS + 1000);
    expect(reload.visit).toEqual({ since: 1000, at: 1000 + AWAY_GAP_MS + 1000 });
  });

  test('visits that each follow the last within the gap are one long stretch', () => {
    let state = { visitAt: 0 as number | undefined, previousVisitAt: undefined as number | undefined };
    state = recordVisit(state, 10 * 3_600_000).state;
    for (let step = 1; step <= 5; step++) state = recordVisit(state, 10 * 3_600_000 + step * (AWAY_GAP_MS - 1)).state;
    expect(state.previousVisitAt).toBe(0);
  });
});

describe('how Hermes\'s finished work becomes items', () => {
  const task = (over: Record<string, unknown>) => ({ id: 't1', title: 'Write it', status: 'done', completed_at: 1_800_000_100.5, assignee: 'writer', latest_summary: 'All written', ...over });

  test('a task in the Done column is an item stamped with its finish; any other column is not', () => {
    const [done] = taskCandidates([{ slug: 'ops', tasks: [task({}), task({ id: 't2', status: 'review' }), task({ id: 't3', completed_at: undefined })] }]);
    expect(done).toEqual({ id: 'task:ops:t1', stamp: '1800000100.5', kind: 'task', title: 'Write it', summary: 'All written', profile: 'writer', at: 1_800_000_100_500, to: '/work/tasks/t1?board=ops' });
    expect(taskCandidates([{ slug: 'ops', tasks: [task({ id: 't2', status: 'review' }), task({ id: 't3', completed_at: undefined }), 'not a task'] }])).toEqual([]);
  });

  test('a summary that repeats the title says nothing more and is left out', () => {
    expect(taskCandidates([{ slug: 'default', tasks: [task({ latest_summary: 'Write it' })] }])[0]?.summary).toBeUndefined();
  });

  const run = (seq: number, storedSessionId: string | undefined, title = 'A chat'): ActivityEvent => ({ seq, at: seq * 10, profile: 'coder', storedSessionId, title });

  test('a chat that finished is an item for its latest finish; a run with no stored chat has nothing to open and is left out', () => {
    const items = runCandidates([run(30, 'abc'), run(20, undefined), run(10, 'abc', 'Older')]);
    expect(items).toEqual([{ id: 'run:abc', stamp: '30', kind: 'run', title: 'A chat', summary: undefined, profile: 'coder', at: 300, to: '/chat/abc' }]);
  });
});
