import { describe, expect, test } from 'vitest';
import type { ActivityEvent, InboxApproval, InboxClarify, InboxNotice } from '@caduceus/contracts/inbox';
import type { ReadyItem } from '@caduceus/contracts/today';
import { finishSeqIn, readyToOpen } from '../src/modules/chat/talk-review.ts';
import { TRAY_FACES, trayView } from '../src/modules/chat/decide-tray.ts';

// The decide-anywhere tray's pure part (M8 #05): which of the waiting decisions it lists in a thread, the faces and the words on its pill, and when it is
// hidden. Who may answer and how is the Inbox's (`inbox-model.test.ts`, `server/test/inbox.test.ts`); nothing here pins Hermes's own data.
const core = { ref: 'r', stamp: '', at: 1000 } as const;
const approval = (id: string, profile: string | undefined, over: Partial<InboxApproval> = {}): InboxApproval => ({
  ...core,
  id,
  kind: 'approval',
  group: 'decision',
  category: 'approvals',
  profile,
  sessionId: `rt-${id}`,
  storedSessionId: `stored-${id}`,
  sessionTitle: 'Chat',
  tool: 'terminal',
  command: 'git push',
  description: '',
  choices: ['once', 'deny'],
  ...over,
});
const clarify = (id: string, profile: string | undefined, over: Partial<InboxClarify> = {}): InboxClarify => ({
  ...core,
  id,
  kind: 'clarify',
  group: 'decision',
  category: 'questions',
  profile,
  sessionId: `rt-${id}`,
  storedSessionId: `stored-${id}`,
  sessionTitle: 'Chat',
  expiresAt: undefined,
  questions: [{ qid: 'q0', question: 'Which slot?', choices: ['Thu', 'Fri'], multiSelect: false }],
  ...over,
});
const notice = (id: string, group: InboxNotice['group'], profile: string | undefined): InboxNotice => ({ ...core, id, kind: 'notice', group, category: 'pairing', profile, title: 'A pairing request', detail: undefined, actions: [], link: undefined });

describe('what the tray lists', () => {
  test('lists the decisions of every other session, those of the same agent included, and leaves out the open session\'s own, which stays inline in its transcript', () => {
    const view = trayView({ items: [approval('a', 'coder'), approval('b', 'homeassistant'), clarify('c', 'general'), approval('d', 'coder')], storedId: 'stored-a' });
    expect(view.items.map((item) => item.id)).toEqual(['b', 'c', 'd']);
  });

  test('lists a decision of the same agent that waits in a session other than the open one, and a new chat has none of its own', () => {
    const elsewhere = approval('e', 'coder', { storedSessionId: 'another', sessionTitle: 'Fix the build' });
    expect(trayView({ items: [elsewhere], storedId: 'open-one' }).items).toEqual([elsewhere]);
    expect(trayView({ items: [elsewhere], storedId: undefined }).items).toEqual([elsewhere]);
  });

  test('lists a decision about work that names the open agent: no transcript holds it', () => {
    const view = trayView({ items: [notice('review', 'decision', 'coder')], storedId: 'stored-a' });
    expect(view.items.map((item) => item.id)).toEqual(['review']);
  });

  test('leaves out a decision of the open session even when Caduceus could not tell which profile it belongs to', () => {
    const view = trayView({ items: [approval('a', undefined, { storedSessionId: 'open-one' }), approval('b', 'general')], storedId: 'open-one' });
    expect(view.items.map((item) => item.id)).toEqual(['b']);
  });

  test('lists only what needs a decision, the longest wait first', () => {
    const view = trayView({ items: [approval('late', 'general', { at: 3000 }), notice('failed', 'failed', 'general'), notice('pairing', 'decision', undefined), approval('early', 'homeassistant', { at: 500 })], storedId: undefined });
    expect(view.items.map((item) => item.id)).toEqual(['early', 'pairing', 'late']);
  });
});

describe('the pill', () => {
  test('is hidden when nothing else waits, however many decisions the open thread itself holds', () => {
    expect(trayView({ items: [], storedId: undefined })).toMatchObject({ hidden: true, items: [], faces: [] });
    expect(trayView({ items: [approval('a', 'coder', { storedSessionId: 'open-one' }), clarify('b', 'coder', { storedSessionId: 'open-one' })], storedId: 'open-one' }).hidden).toBe(true);
  });

  test('counts decisions in words, in the singular and the plural', () => {
    const one = trayView({ items: [approval('a', 'general')], storedId: undefined });
    expect(one).toMatchObject({ hidden: false, label: '1 more needs you elsewhere' });
    const two = trayView({ items: [approval('a', 'general'), approval('b', 'general')], storedId: undefined });
    expect(two.label).toBe('2 more need you elsewhere');
  });

  test('shows each waiting agent once, the one waiting longest first, and no more faces than fit', () => {
    const items = [approval('a', 'general', { at: 100 }), approval('b', 'general', { at: 200 }), approval('c', 'homeassistant', { at: 300 }), approval('d', 'property', { at: 400 }), approval('e', 'work', { at: 500 }), notice('f', 'decision', undefined)];
    const view = trayView({ items, storedId: undefined });
    expect(view.faces).toEqual(['general', 'homeassistant', 'property'].slice(0, TRAY_FACES));
    expect(view.faces.length).toBeLessThanOrEqual(TRAY_FACES);
  });

  test('gives a decision that names no agent the empty face', () => {
    const view = trayView({ items: [notice('p', 'decision', undefined)], storedId: undefined });
    expect(view.faces).toEqual([undefined]);
  });
});

describe('when opening a session clears it from Ready for review', () => {
  const ready = (id: string, over: Partial<ReadyItem> = {}): ReadyItem => ({ id, stamp: '7', kind: 'run', title: 'A run', summary: undefined, profile: 'coder', at: 1, to: '/chat/x', ...over });

  test('marks the finished run of the session the owner opened, at the finish they were shown', () => {
    expect(readyToOpen('s1', [ready('run:s0'), ready('run:s1', { stamp: '12' })])).toEqual({ id: 'run:s1', stamp: '12' });
  });

  test('marks nothing for a session that is not waiting for review, for a new chat and for a task of the same name', () => {
    expect(readyToOpen('s2', [ready('run:s1')])).toBeUndefined();
    expect(readyToOpen(undefined, [ready('run:s1')])).toBeUndefined();
    expect(readyToOpen('s1', [ready('task:main:s1', { kind: 'task' })])).toBeUndefined();
  });
});

describe('when a run that finishes in the open chat is marked opened', () => {
  const finished = (seq: number, storedSessionId: string | undefined): ActivityEvent => ({ seq, at: seq, profile: 'coder', storedSessionId, title: 'A run' });

  test('is told by the newest finish of the open session in the activity feed (newest first), so that each new finish calls for another look at Ready for review', () => {
    expect(finishSeqIn('s1', [finished(30, 's2'), finished(20, 's1'), finished(10, 's1')])).toBe(20);
    expect(finishSeqIn('s1', [finished(40, 's1'), finished(30, 's2'), finished(20, 's1')])).toBe(40);
  });

  test('is nothing for a session with no finish in the feed, for a finish that names no session and for a new chat', () => {
    expect(finishSeqIn('s3', [finished(20, 's1')])).toBeUndefined();
    expect(finishSeqIn('s1', [finished(20, undefined)])).toBeUndefined();
    expect(finishSeqIn(undefined, [finished(20, 's1')])).toBeUndefined();
    expect(finishSeqIn('s1', [])).toBeUndefined();
  });
});
