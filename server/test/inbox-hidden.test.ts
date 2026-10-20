import { describe, expect, test } from 'vitest';
import type { InboxItem } from '@caduceus/contracts/inbox';
import { applyHidden, type HiddenRow } from '../src/inbox-hidden.ts';

// What a device has put aside (M2 #02): a snooze hides an item until its time, a dismissal until its Hermes state changes again.
// Pure: the rows are what the store holds; the items are what the sources derived.
const notice = (ref: string, stamp: string): InboxItem => ({ kind: 'notice', id: `id-${ref}`, ref, stamp, group: 'failed', category: 'automation', profile: 'work', at: 1000, title: ref, detail: undefined, actions: [], link: undefined });
const ids = (items: readonly InboxItem[]) => items.map((item) => item.ref);

describe('what a device has put aside', () => {
  test('an item nobody has touched is shown', () => {
    expect(ids(applyHidden([notice('cron:a', '1')], [], 5000).shown)).toEqual(['cron:a']);
  });

  test('a dismissed item stays away while its Hermes state is the one that was dismissed', () => {
    const rows: HiddenRow[] = [{ ref: 'cron:a', stamp: '1', until: null }];
    expect(applyHidden([notice('cron:a', '1'), notice('cron:b', '1')], rows, 5000)).toMatchObject({ snoozed: [] });
    expect(ids(applyHidden([notice('cron:a', '1'), notice('cron:b', '1')], rows, 5000).shown)).toEqual(['cron:b']);
  });

  test('a dismissed item comes back when its Hermes state changes again', () => {
    const rows: HiddenRow[] = [{ ref: 'cron:a', stamp: '1', until: null }];
    expect(ids(applyHidden([notice('cron:a', '2')], rows, 5000).shown)).toEqual(['cron:a']);
  });

  test('a snoozed item is listed with when it comes back, and is shown again once that time has passed', () => {
    const rows: HiddenRow[] = [{ ref: 'cron:a', stamp: '1', until: 9000 }];
    const asleep = applyHidden([notice('cron:a', '1')], rows, 5000);
    expect(asleep.shown).toEqual([]);
    expect(asleep.snoozed.map(({ item, until }) => [item.ref, until])).toEqual([['cron:a', 9000]]);
    expect(ids(applyHidden([notice('cron:a', '1')], rows, 9000).shown)).toEqual(['cron:a']);
  });

  test('a snooze of a state that has changed since is not one: the new state is shown', () => {
    const rows: HiddenRow[] = [{ ref: 'cron:a', stamp: '1', until: 9000 }];
    expect(ids(applyHidden([notice('cron:a', '2')], rows, 5000).shown)).toEqual(['cron:a']);
  });
});
