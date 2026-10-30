import { afterEach, describe, expect, test } from 'vitest';
import type { InboxApproval } from '@caduceus/contracts/inbox';
import { foldAway, foldState, holdCard, pruneFolded, releaseCard } from '../src/modules/today/fold-store.ts';
import { shownDecisions } from '../src/modules/today/fold-model.ts';

// The cards that are answering or have folded away are kept for the whole page, so that leaving Today and coming back while the Inbox's stream still lists an answered card
// does not draw it again. The lists these make are `fold-model.test.ts`'s; here is how they change.
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
const [a, b] = ['a', 'b'].map(approval);
const ids = (items: readonly { id: string }[]) => items.map((item) => item.id);

afterEach(() => {
  for (const id of ['a', 'b']) releaseCard(id);
  pruneFolded([]);
});

describe('the cards that are answering or folded', () => {
  test('a held card stays in its place after the stream drops it, and goes back to the stream once released', () => {
    holdCard(b, 1);

    expect(ids(shownDecisions([a], foldState().held, foldState().folded))).toEqual(['a', 'b']);

    releaseCard('b');

    expect(ids(shownDecisions([a], foldState().held, foldState().folded))).toEqual(['a']);
  });

  test('a card that folded away is no longer held, and stays hidden while the stream lists it', () => {
    holdCard(a, 0);
    foldAway('a');

    expect(foldState().held.has('a')).toBe(false);
    expect(ids(shownDecisions([a, b], foldState().held, foldState().folded))).toEqual(['b']);
  });

  test('the same id asked again shows once the stream has dropped it', () => {
    foldAway('a');
    pruneFolded([a, b]);
    expect(foldState().folded.has('a')).toBe(true);

    pruneFolded([b]);

    expect(foldState().folded.has('a')).toBe(false);
    expect(ids(shownDecisions([a, b], foldState().held, foldState().folded))).toEqual(['a', 'b']);
  });

  test('keeps the same state when nothing changes, so that nothing renders again', () => {
    foldAway('a');
    const before = foldState();

    pruneFolded([a]);
    releaseCard('b');

    expect(foldState()).toBe(before);
  });
});
