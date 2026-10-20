import { describe, expect, test } from 'vitest';
import { accessOf, ACTIVE_WINDOW_S, readOnlyNote } from '../src/modules/chat/session-access.ts';

// Whether Caduceus may continue a session it opens (M1 #16). Hermes has no lock to ask: a session another process is writing to, or one a Kanban
// worker owns, must be read and never resumed, because a second writer would interleave with the first. The facts are Hermes's own (the session
// row's source and ended_at, the time of its last activity, and whether this Hermes runs the session); the rule is Caduceus's.
const NOW = 1_800_000_000;
const facts = (over: Partial<Parameters<typeof accessOf>[0]> = {}) => ({ source: 'telegram', endedAt: null, lastActive: NOW - 10, ...over });

describe('which sessions Caduceus may continue', () => {
  test('a session that is open and was active a moment ago in another tool belongs to that process: read-only', () => {
    expect(accessOf(facts(), { now: NOW, live: false })).toEqual({ mode: 'read-only', reason: 'other-process' });
    expect(accessOf(facts({ source: 'cli', lastActive: NOW - ACTIVE_WINDOW_S + 1 }), { now: NOW, live: false })).toEqual({ mode: 'read-only', reason: 'other-process' });
  });

  test('a session that ended, or has been quiet for the active window, can be continued', () => {
    expect(accessOf(facts({ endedAt: NOW - 5 }), { now: NOW, live: false })).toEqual({ mode: 'continue' });
    expect(accessOf(facts({ lastActive: NOW - ACTIVE_WINDOW_S }), { now: NOW, live: false })).toEqual({ mode: 'continue' });
  });

  test('a session this Hermes is running, or one Caduceus made, is Caduceus’s to continue however recent it is', () => {
    expect(accessOf(facts(), { now: NOW, live: true })).toEqual({ mode: 'continue' });
    expect(accessOf(facts({ source: 'caduceus' }), { now: NOW, live: false })).toEqual({ mode: 'continue' });
  });

  test('a Kanban worker’s session is read-only whether it is running or not', () => {
    expect(accessOf(facts({ source: 'kanban', endedAt: NOW - 3600, lastActive: NOW - 3600 }), { now: NOW, live: false })).toEqual({ mode: 'read-only', reason: 'kanban' });
  });

  test('the banner says why, in words', () => {
    expect(readOnlyNote({ mode: 'read-only', reason: 'kanban' })).toMatch(/Kanban worker/);
    expect(readOnlyNote({ mode: 'read-only', reason: 'other-process' })).toMatch(/Another program/);
  });
});
