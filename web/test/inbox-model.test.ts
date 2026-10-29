import { describe, expect, test } from 'vitest';
import type { InboxAction, InboxApproval, InboxClarify, InboxItem } from '@caduceus/contracts/inbox';
import { ageWords, badgeLabel, clarifyAnswer, confirmWithWords, doneWords, inScope, newActivity, previewOf } from '../src/modules/inbox/inbox-model.ts';

// The Inbox's pure part (M2 #01): which items a profile chip shows, what a card says, and how a question's answer is put to Hermes. What the server derives and Hermes does with a decision is `server/test/inbox.test.ts`.
const approval = (id: string, profile: string | undefined, command = 'rm -rf /tmp/x'): InboxApproval => ({
  kind: 'approval',
  group: 'decision',
  ref: id,
  stamp: '',
  category: 'approvals',
  id,
  profile,
  sessionId: 'rt1',
  storedSessionId: 'stored-1',
  sessionTitle: 'Clean up',
  at: 1000,
  tool: 'terminal',
  command,
  description: 'delete in root path',
  choices: ['once', 'session', 'always', 'deny'],
});
const clarify = (questions: InboxClarify['questions']): InboxClarify => ({
  kind: 'clarify',
  group: 'decision',
  ref: 'srq-q',
  stamp: '',
  category: 'questions',
  id: 'srq-q',
  profile: 'work',
  sessionId: 'rt2',
  storedSessionId: undefined,
  sessionTitle: 'Pizza',
  at: 2000,
  questions,
  expiresAt: undefined,
});

describe('which items a profile chip shows', () => {
  const items: InboxItem[] = [approval('srq-a', 'default'), approval('srq-b', 'work'), approval('srq-c', undefined)];

  test('every profile shows everything', () => {
    expect(inScope(items, 'all').map((item) => item.id)).toEqual(['srq-a', 'srq-b', 'srq-c']);
  });

  test('one profile shows its own items, and never hides one Caduceus could not place', () => {
    expect(inScope(items, 'work').map((item) => item.id)).toEqual(['srq-b', 'srq-c']);
  });

  test('a scope that is not known yet shows everything rather than nothing', () => {
    expect(inScope(items, undefined)).toHaveLength(3);
  });
});

describe('the badge', () => {
  test('says what it counts, in the singular and the plural', () => {
    expect(badgeLabel(1)).toBe('1 item needs a decision');
    expect(badgeLabel(4)).toBe('4 items need a decision');
  });
});

describe('what a card says', () => {
  test('an approval is its command, a question is its first question', () => {
    expect(previewOf(approval('srq-a', 'work', 'git push --force'))).toBe('git push --force');
    expect(previewOf(clarify([{ qid: 'q0', question: 'Which colour?', choices: [], multiSelect: false }]))).toBe('Which colour?');
    expect(previewOf(clarify([{ qid: 'a', question: 'Toppings?', choices: [], multiSelect: false }, { qid: 'b', question: 'Size?', choices: [], multiSelect: false }]))).toBe('Toppings? (and 1 more)');
  });

  test.each([
    [10_000, 'just now'],
    [90_000, '1 min ago'],
    [3 * 3_600_000, '3 h ago'],
    [2 * 86_400_000, '2 d ago'],
  ])('%i ms ago reads "%s"', (elapsed, words) => {
    expect(ageWords(1000, 1000 + elapsed)).toBe(words);
  });
});

describe('answering a question', () => {
  // Hermes 0.22 takes `{answers}` by question id for every question, a single one included: a result without `answers` is a cancel-all.
  test('a single question is `{answers}` too, typed words winning over a pick, and nothing given is a skip', () => {
    const one = clarify([{ qid: 'q0', question: 'Which colour?', choices: ['Red', 'Blue'], multiSelect: false }]);
    expect(clarifyAnswer(one, { q0: ['Blue'] }, {})).toEqual({ answers: { q0: 'Blue' } });
    expect(clarifyAnswer(one, { q0: ['Blue'] }, { q0: '  Teal  ' })).toEqual({ answers: { q0: 'Teal' } });
    expect(clarifyAnswer(one, {}, {})).toEqual({ answers: { q0: '' } });
  });

  test('several questions are answered by question id, and a multiple-choice pick is a JSON list as Hermes reads it', () => {
    const form = clarify([
      { qid: 'q1', question: 'Toppings?', choices: ['Ham', 'Olives'], multiSelect: true },
      { qid: 'q2', question: 'Avoid?', choices: [], multiSelect: false },
    ]);
    expect(clarifyAnswer(form, { q1: ['Ham', 'Olives'] }, { q2: 'Anchovies' })).toEqual({ answers: { q1: '["Ham","Olives"]', q2: 'Anchovies' } });
  });
});

const notice = (id: string, group: InboxItem['group'], category: InboxItem['category']): InboxItem => ({ kind: 'notice', id, ref: id, stamp: '', group, category, profile: 'work', at: 1, title: id, detail: undefined, actions: [], link: undefined });

describe('what a card says (notices)', () => {
  test('a notice says its detail on the card, or else its title', () => {
    expect(previewOf({ ...notice('a', 'failed', 'automation'), detail: 'The model did not answer.' } as InboxItem)).toBe('The model did not answer.');
    expect(previewOf(notice('a', 'failed', 'automation'))).toBe('a');
  });
});

describe('the activity feed', () => {
  test('what is new is what is past the last event a page has heard of', () => {
    const events = [{ seq: 30, at: 1, profile: undefined, storedSessionId: undefined, title: 'c' }, { seq: 20, at: 1, profile: undefined, storedSessionId: undefined, title: 'b' }];
    expect(newActivity(events, 20).map((event) => event.title)).toEqual(['c']);
    expect(newActivity(events, 30)).toEqual([]);
  });
});

describe('what the owner confirms after writing words first', () => {
  const answer: InboxAction = { id: 'answer', label: 'Answer', request: { method: 'POST', path: '/x' }, input: { field: 'answer', label: 'Your answer', required: true }, confirm: { title: 'Answer “Pick a database”?', text: 'Your answer is posted as a comment and the task goes back to work.', confirmLabel: 'Send answer' } };

  test('says the words back, so the second step shows what is about to be sent', () => {
    const confirm = confirmWithWords(answer, 'Use Postgres, it is already on the server');
    expect(confirm).toMatchObject({ title: 'Answer “Pick a database”?', confirmLabel: 'Send answer' });
    expect(confirm.text).toBe('Your answer: “Use Postgres, it is already on the server”. Your answer is posted as a comment and the task goes back to work.');
  });

  test('names a note and a profile in their own words, and cuts a long answer at a whole word', () => {
    expect(confirmWithWords({ ...answer, input: { field: 'note', label: 'What needs to change?', required: true } }, 'Shorter').text).toMatch(/^Your note: “Shorter”\./);
    expect(confirmWithWords({ ...answer, input: { field: 'profile', label: 'Profile to give it to', required: true } }, 'writer').text).toMatch(/^Give it to: “writer”\./);
    const long = confirmWithWords(answer, 'word '.repeat(100)).text ?? '';
    expect(long).toMatch(/^Your answer: “(word )+word…”\./);
    expect(long.length).toBeLessThan(400);
  });

  test('an action with no words to say, or no confirmation of its own, still gets a question', () => {
    expect(confirmWithWords({ ...answer, input: undefined }, undefined)).toEqual(answer.confirm);
    expect(confirmWithWords({ id: 'retry', label: 'Retry', request: { method: 'POST', path: '/y' } }, undefined)).toEqual({ title: 'Retry?' });
  });
});

describe('what the owner is told once an action on a notice has gone', () => {
  const action = (id: string, label: string): InboxAction => ({ id, label, request: { method: 'POST', path: '/x' } });

  test('says what happens next to the task, and to whom it went', () => {
    expect(doneWords(action('answer', 'Answer'), 'default')).toEqual({ message: 'Answer sent to default', detail: 'The task is back in work.' });
    expect(doneWords(action('answer', 'Answer'), undefined)).toEqual({ message: 'Answer sent', detail: 'The task is back in work.' });
    expect(doneWords(action('approve', 'Approve'), 'coder').message).toBe('Approved');
    expect(doneWords(action('reject', 'Reject + note'), 'coder')).toEqual({ message: 'Sent back to coder', detail: 'It is back in work, with your note.' });
    expect(doneWords(action('retry', 'Retry'), 'coder').detail).toBe('A worker picks it up again.');
    expect(doneWords(action('decline', 'Decline'), undefined).message).toBe('Declined');
  });

  test('an action it has nothing more to say about is simply sent', () => {
    expect(doneWords(action('run-now', 'Run now'), 'work')).toEqual({ message: 'Run now: sent' });
  });
});
