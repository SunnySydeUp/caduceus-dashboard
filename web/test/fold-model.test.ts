import { describe, expect, test } from 'vitest';
import type { InboxApproval } from '@caduceus/contracts/inbox';
import { type HeldCard, shownDecisions, stillListed } from '../src/modules/today/fold-model.ts';

// What Needs you draws while answers go and cards fold away: the Inbox's stream can drop an item before its answer's reply is back, and can list it a moment after it has folded.
const approval = (id: string): InboxApproval => ({
  ref: 'r',
  stamp: '',
  at: 1000,
  id,
  kind: 'approval',
  group: 'decision',
  category: 'approvals',
  profile: 'coder',
  sessionId: `rt-${id}`,
  storedSessionId: `stored-${id}`,
  sessionTitle: 'Chat',
  tool: 'terminal',
  command: 'git push',
  description: '',
  choices: ['once', 'deny'],
});
const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);
const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(approval);
const held = (...cards: HeldCard[]) => new Map(cards.map((card) => [card.item.id, card]));

describe('the decisions Needs you draws', () => {
  test('are what the stream lists when no answer is on its way and none has folded', () => {
    expect(ids(shownDecisions([a, b, c], held(), new Set()))).toEqual(['a', 'b', 'c']);
  });

  test('leave out a card that has folded away, though the stream still lists it', () => {
    expect(ids(shownDecisions([a, b, c], held(), new Set(['b'])))).toEqual(['a', 'c']);
  });

  test('keep a card whose answer is on its way where it stood after the stream drops it', () => {
    expect(ids(shownDecisions([a, c], held({ item: b, at: 1 }), new Set()))).toEqual(['a', 'b', 'c']);
    expect(ids(shownDecisions([b, c], held({ item: a, at: 0 }), new Set()))).toEqual(['a', 'b', 'c']);
    expect(ids(shownDecisions([a, b], held({ item: c, at: 2 }), new Set()))).toEqual(['a', 'b', 'c']);
  });

  test('put several dropped cards back each in its place', () => {
    expect(ids(shownDecisions([b, d], held({ item: c, at: 2 }, { item: a, at: 0 }), new Set()))).toEqual(['a', 'b', 'c', 'd']);
  });

  test('draw the stream’s own copy of a held card the stream still lists, once', () => {
    const newer = { ...b, description: 'newer' };

    const shown = shownDecisions([a, newer, c], held({ item: b, at: 1 }), new Set());

    expect(ids(shown)).toEqual(['a', 'b', 'c']);
    expect(shown[1]).toBe(newer);
  });

  test('put a place back at the end when the list has become shorter than it was', () => {
    expect(ids(shownDecisions([a], held({ item: d, at: 3 }), new Set()))).toEqual(['a', 'd']);
  });

  test('leave out a held card that has folded', () => {
    expect(ids(shownDecisions([a], held({ item: b, at: 1 }), new Set(['b'])))).toEqual(['a']);
  });
});

describe('the folded cards that are kept', () => {
  test('are those the stream still lists: once it drops one there is nothing left to hide, and the same id asked again shows', () => {
    expect([...stillListed(new Set(['a', 'b']), [a, c])]).toEqual(['a']);
    expect([...stillListed(new Set(['a']), [])]).toEqual([]);
  });

  test('are the same set when the stream dropped none, so that keeping it in state renders nothing again', () => {
    const folded = new Set(['a', 'b']);

    expect(stillListed(folded, [a, b, c])).toBe(folded);
  });
});
