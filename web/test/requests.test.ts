import { describe, expect, test } from 'vitest';
import type { TurnSegment } from '../src/modules/chat/activity.ts';
import { approvalParams, cancelledApprovals, toolBehind, clarifyDeadline, clarifyResult, countdownOf, denyNote, needsStepUp, requestOf, settledOf, type ApprovalRequest, type ClarifyRequest } from '../src/modules/chat/requests.ts';

// Approvals and clarify questions (M1 #06): the pure part. What Hermes sends is read into a card, and what the owner decides is turned
// into what Hermes takes. The Hermes side (a held command really waits, an answer really releases it) is `server/test/approvals.test.ts`.
const approval = (params: Record<string, unknown> = {}): ApprovalRequest => {
  const card = requestOf('srq-1', 'approval', { session_id: 'rt1', request_id: 'held-1', command: 'rm -rf /tmp/x', description: 'delete in root path', choices: ['once', 'session', 'always', 'deny'], ...params }, 1000);
  if (card?.kind !== 'approval') throw new Error('not an approval');
  return card;
};
const clarify = (questions: Record<string, unknown>[]): ClarifyRequest => {
  const card = requestOf('srq-2', 'clarify', { session_id: 'rt1', questions }, 5_000);
  if (card?.kind !== 'clarify') throw new Error('not a clarify');
  return card;
};

describe('the payload of each approval decision', () => {
  test.each([
    ['once', { choice: 'once' as const }],
    ['session', { choice: 'session' as const }],
    ['always', { choice: 'always' as const }],
    ['deny', { choice: 'deny' as const }],
    ['deny with a reason', { choice: 'deny' as const, reason: 'not that folder' }],
  ])('%s names the session, the held call and the choice, and nothing else (Hermes rejects what it does not know)', (_name, decision) => {
    expect(approvalParams(approval(), decision, { profile: 'work' })).toEqual({ session_id: 'rt1', choice: decision.choice, request_id: 'held-1', profile: 'work' });
  });

  test('leaves out the held call when Hermes did not name one, which means the oldest', () => {
    expect(approvalParams(approval({ request_id: undefined }), { choice: 'once' })).toEqual({ session_id: 'rt1', choice: 'once' });
  });

  test('puts a denial\'s reason in a note to the agent', () => {
    expect(denyNote('  not that folder ')).toBe('I denied that action. My reason: not that folder');
  });
});

describe('reading an approval', () => {
  test('offers what Hermes offers, in the card\'s order, and always the way to say no', () => {
    expect(approval({ choices: ['deny', 'once'] }).choices).toEqual(['once', 'deny']);
    expect(approval({ choices: ['once', 'deny'] }).choices).toEqual(['once', 'deny']);
    expect(approval({ choices: undefined }).choices).toEqual(['once', 'deny']);
    expect(approval({ choices: ['once', 'bogus'] }).choices).toEqual(['once', 'deny']);
    expect(approval({ choices: ['once', 'session', 'always'] }).choices).toEqual(['once', 'session', 'always', 'deny']);
  });

  test('takes the command, why it is held and the tool when Hermes names one', () => {
    expect(approval({ tool_name: 'terminal' })).toMatchObject({ id: 'srq-1', sessionId: 'rt1', requestId: 'held-1', tool: 'terminal', command: 'rm -rf /tmp/x', description: 'delete in root path', status: 'open' });
  });

  test('ignores requests it does not answer', () => {
    expect(requestOf('srq-3', 'secret', { session_id: 'rt1', env_var: 'KEY' }, 0)).toBeUndefined();
  });
});

describe('answering a clarify question', () => {
  // Hermes 0.22 sends every clarify as `questions` (a single question is a one-entry list) and takes `{answers}` by question id only: a result with
  // no `answers` is a cancel-all, so a single question answered with `{answer}` would reach the agent as cancelled.
  test('a single question is answered with {answers}: the text trimmed, a skip (`\'\'`) when nothing was given', () => {
    const card = clarify([{ qid: 'q0', question: 'Which?', choices: ['A', 'B'] }]);
    expect(card.questions.map((question) => question.qid)).toEqual(['q0']);
    expect(clarifyResult(card, { q0: ' B ' })).toEqual({ answers: { q0: 'B' } });
    expect(clarifyResult(card, {})).toEqual({ answers: { q0: '' } });
  });

  test('several questions are answered together by question id, every question present', () => {
    const card = clarify([{ qid: 'q0', question: 'Toppings?', choices: ['Ham', 'Basil'], multi_select: true }, { qid: 'q1', question: 'Avoid?' }, { qid: 'q2', question: '   ' }]);
    expect(card.questions.map((question) => question.qid)).toEqual(['q0', 'q1']);
    expect(clarifyResult(card, { q0: ['Ham', 'Basil'] })).toEqual({ answers: { q0: '["Ham","Basil"]', q1: '' } });
  });

  test('multiple choice needs choices', () => {
    expect(clarify([{ qid: 'q0', question: 'Which?', multi_select: true }]).questions[0]!.multiSelect).toBe(false);
    expect(clarify([{ qid: 'q0', question: 'Which?', choices: ['A'], multi_select: true }]).questions[0]!.multiSelect).toBe(true);
  });

  test('a request with no question to read is no card (the single-question form of Hermes 0.21 is gone)', () => {
    expect(requestOf('srq-2', 'clarify', { session_id: 'rt1', question: 'Which?', choices: ['A'] }, 0)).toBeUndefined();
    expect(requestOf('srq-2', 'clarify', { session_id: 'rt1', questions: [{ qid: 'q0', question: '  ' }] }, 0)).toBeUndefined();
  });
});

describe('the countdown', () => {
  const card = clarify([{ qid: 'q0', question: 'Which?' }]);

  test('runs from the moment the page first saw the question to the end of Hermes\'s wait; a wait of zero or less never ends', () => {
    expect(clarifyDeadline(card, 300)).toBe(305_000);
    expect(clarifyDeadline(card, 0)).toBeUndefined();
    expect(clarifyDeadline(card, -1)).toBeUndefined();
  });

  test.each([
    [305_000, 5_000, '5:00', false],
    [305_000, 5_001, '5:00', false],
    [305_000, 6_000, '4:59', false],
    [305_000, 304_001, '0:01', false],
    [305_000, 3_605_000, '0:00', true],
    [305_000, 400_000, '0:00', true],
    [3_605_000, 5_000, '1:00:00', false],
    [3_605_000, 3_000_000, '10:05', false],
  ])('to %i at %i shows %s (lapsed: %s)', (deadline, now, label, lapsed) => {
    expect(countdownOf(deadline, now)).toEqual({ label, lapsed });
  });
});

describe('how a request ended', () => {
  const held = approval();
  const question = clarify([{ qid: 'q0', question: 'Which?' }]);

  test('says it was answered elsewhere when Hermes resolved it and the owner did not', () => {
    expect(settledOf(held, 'resolved')).toEqual({ id: 'srq-1', kind: 'approval', outcome: 'answered-elsewhere', text: 'Answered elsewhere.' });
  });

  test('says what Hermes did when time ran out: refused an approval, went on without an answer to a question', () => {
    expect(settledOf(held, 'timeout')).toMatchObject({ outcome: 'expired', text: 'Time ran out: Hermes refused it and did not run the command.' });
    expect(settledOf(question, 'timeout')).toMatchObject({ outcome: 'expired', text: 'Time ran out: Hermes carried on without an answer.' });
  });

  test('says why a request was withdrawn', () => {
    expect(settledOf(held, 'interrupted')).toMatchObject({ outcome: 'withdrawn', text: 'This approval is closed: the turn was stopped.' });
    expect(settledOf(question, 'session_closed')).toMatchObject({ outcome: 'withdrawn', text: 'This question is closed: the session ended.' });
    expect(settledOf(question, 'gone')).toMatchObject({ text: 'This question is closed: Hermes is no longer waiting for it.' });
    expect(settledOf(held, 'something_new')).toMatchObject({ text: 'This approval is closed: Hermes withdrew it (something_new).' });
  });
});

describe('approvals Hermes dropped without a withdrawal of their own', () => {
  // `approval.cancelled` is broadcast when an interrupt, a reap or a teardown drops the approvals a session holds; the wait is then a refusal, and a card left
  // open would offer a button that does nothing.
  const two = [approval({ request_id: 'held-1' }), { ...approval({ request_id: 'held-2' }), id: 'srq-2' }];
  const other = { ...approval({ request_id: 'held-1' }), id: 'srq-9', sessionId: 'rt2' };

  test('the cards it names are closed, with why', () => {
    expect(cancelledApprovals([...two, other], { session_id: 'rt1', reason: 'interrupt', request_ids: ['held-2'] })).toEqual([{ id: 'srq-2', reason: 'interrupted' }]);
  });

  test('with no ids on the wire, every approval of that session is closed and no other session’s', () => {
    expect(cancelledApprovals([...two, other], { session_id: 'rt1', reason: 'tui_shutdown', request_ids: [] })).toEqual([
      { id: 'srq-1', reason: 'shutdown' },
      { id: 'srq-2', reason: 'shutdown' },
    ]);
  });

  test('a reason Hermes adds later is passed on as it is, and a question is never closed by it', () => {
    const question = clarify([{ qid: 'q0', question: 'Which?' }]);
    expect(cancelledApprovals([two[0]!, question], { session_id: 'rt1', reason: 'reaped', request_ids: [] })).toEqual([{ id: 'srq-1', reason: 'reaped' }]);
  });
});

describe('a refusal that asks for a passkey', () => {
  test('is the policy\'s step-up-required error', () => {
    expect(needsStepUp(Object.assign(new Error('This needs a fresh passkey confirmation.'), { data: { error: 'step-up-required', tier: 'T2' } }))).toBe(true);
    expect(needsStepUp(Object.assign(new Error('Read-only'), { data: { error: 'read-only' } }))).toBe(false);
    expect(needsStepUp(new Error('boom'))).toBe(false);
    expect(needsStepUp(undefined)).toBe(false);
  });
});

describe('the tool behind an approval', () => {
  const tool = (name: string, status: 'running' | 'done', args: Record<string, unknown>): TurnSegment => ({ kind: 'activity', items: [{ kind: 'tool', key: `k-${name}`, id: name, name, status, args }] });

  test('is the tool call the turn is running now', () => {
    expect(toolBehind([{ kind: 'text', text: 'Looking.' }, tool('read_file', 'done', { path: 'a' }), tool('terminal', 'running', { command: 'rm -rf x' })])).toEqual({ name: 'terminal', args: { command: 'rm -rf x' } });
  });

  test('is nothing when no call is running (the page opened mid-turn and has not seen it)', () => {
    expect(toolBehind([tool('read_file', 'done', {})])).toBeUndefined();
    expect(toolBehind([])).toBeUndefined();
    expect(toolBehind(undefined)).toBeUndefined();
  });
});
