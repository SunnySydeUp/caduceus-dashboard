import { describe, expect, test } from 'vitest';
import { otherDrafts } from '../src/modules/chat/draft-index.ts';

// Which drafts wait in chats other than the one on screen (talk audit #8). No DOM.
describe('the drafts waiting in other chats', () => {
  const keys = ['default/s1', 'research/s9', 'default/new', 'default/s2'];

  test('leave out the draft of the chat on screen', () => {
    expect(otherDrafts(keys, { profile: 'default', session: 's1' })).not.toContainEqual({ profile: 'default', session: 's1' });
  });

  test('name the agent’s own other chats before the other agents’', () => {
    expect(otherDrafts(keys, { profile: 'default', session: 's1' })).toEqual([
      { profile: 'default', session: 'new' },
      { profile: 'default', session: 's2' },
      { profile: 'research', session: 's9' },
    ]);
  });

  test('find a draft in another agent from an agent that has none of its own', () => {
    expect(otherDrafts(keys, { profile: 'coder', session: 'new' })).toHaveLength(4);
    expect(otherDrafts(keys, { profile: 'coder', session: 'new' })[0]).toEqual({ profile: 'default', session: 's1' });
  });

  test('are none when the only draft is the one on screen', () => {
    expect(otherDrafts(['default/s1'], { profile: 'default', session: 's1' })).toEqual([]);
    expect(otherDrafts([], { profile: 'default', session: 'new' })).toEqual([]);
  });
});
