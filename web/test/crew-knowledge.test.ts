import { describe, expect, test } from 'vitest';
import type { InboxApproval } from '@caduceus/contracts/inbox';
import { crewStateWords, deriveCrew } from '../src/modules/crew/crew-state.ts';
import { isPending, knowledge, type KnowledgeInput } from '../src/modules/crew/knowledge.ts';
import { STILL_READING_WORDS } from '../src/read-ladder.ts';

// When a screen may say "nothing": the crew's idle line and Needs you's empty answer wait for the reads they are made of.
const ANSWERED: KnowledgeInput = { feed: 'live', hermesUp: true, ready: 'answered', stage: 'reading' };
const members = (input: KnowledgeInput, items: InboxApproval[] = []) => deriveCrew({ profiles: ['coder'], items, running: [], ready: [], knowledge: knowledge(input) });
const asking: InboxApproval = {
  kind: 'approval',
  group: 'decision',
  ref: 'approval:make',
  stamp: '',
  category: 'approvals',
  id: 'approval:make',
  profile: 'coder',
  sessionId: 'rt1',
  storedSessionId: undefined,
  sessionTitle: 'Release',
  at: 1,
  tool: 'terminal',
  command: 'make deploy',
  description: '',
  choices: ['once', 'deny'],
};

describe('what the crew and Needs you know', () => {
  test('is pending while the Inbox stream has not come up, so nothing is claimed', () => {
    const [coder] = members({ ...ANSWERED, feed: 'connecting' });

    expect(isPending(knowledge({ ...ANSWERED, feed: 'connecting' }))).toBe(true);
    expect(coder?.line).not.toBe('Nothing going on');
    expect(coder && crewStateWords(coder)).not.toBe('Idle');
  });

  test('is pending while the ready list has not answered, so nothing is claimed', () => {
    const [coder] = members({ ...ANSWERED, ready: 'waiting' });

    expect(coder?.line).not.toBe('Nothing going on');
    expect(coder && crewStateWords(coder)).not.toBe('Idle');
  });

  test('says it is still reading once the wait is long, and only then has words', () => {
    const [quick] = members({ ...ANSWERED, ready: 'waiting', stage: 'reading' });
    const [slow] = members({ ...ANSWERED, ready: 'waiting', stage: 'still-reading' });

    expect(quick?.line).toBe('');
    expect(slow?.line).toBe(STILL_READING_WORDS);
  });

  test('is known when everything answered and nothing is going on: that is when "nothing" is true', () => {
    expect(knowledge(ANSWERED)).toBe('known');
    expect(members(ANSWERED)).toEqual([{ profile: 'coder', state: 'idle', line: 'Nothing going on', since: undefined }]);
  });

  test('cannot be checked once a read failed, the ladder gave up, or the device went offline while a read was on its way', () => {
    expect(knowledge({ ...ANSWERED, ready: 'failed' })).toBe('unread');
    expect(knowledge({ ...ANSWERED, feed: 'offline' })).toBe('unread');
    expect(knowledge({ ...ANSWERED, hermesUp: false })).toBe('unread');
    expect(knowledge({ ...ANSWERED, ready: 'waiting', stage: 'failed' })).toBe('unread');
    expect(knowledge({ ...ANSWERED, feed: 'connecting', stage: 'offline' })).toBe('unread');
    expect(members({ ...ANSWERED, ready: 'waiting', stage: 'failed' })).toMatchObject([{ line: 'Can’t check', blind: true }]);
  });

  test('keeps what is known true while a read is pending: a request that is open still shows', () => {
    expect(members({ ...ANSWERED, feed: 'connecting' }, [asking])).toMatchObject([{ state: 'waiting', line: 'Wants to run make deploy' }]);
  });
});
