import { describe, expect, test } from 'vitest';
import type { InboxApproval, InboxItem } from '@caduceus/contracts/inbox';
import { groupItems, inCategory, noticesIn, initialSelection, noticesSearch, readNoticesView, snoozeUntil, stepSelection } from '../src/modules/notices/notices-model.ts';

// Notices' pure part (M2 #01, M8 #08): the notices and the activity feed the Inbox kept in Control: how they are grouped and filtered, what the address holds, where j / k
// move, and when a snooze ends. What counts as a decision (and so lives on Today) is `today-model.test.ts`.
describe('moving through the list', () => {
  const ids = ['a', 'b', 'c'];

  test('j and k step down and up, and stop at the ends', () => {
    expect(stepSelection(ids, 'a', 1)).toBe('b');
    expect(stepSelection(ids, 'b', -1)).toBe('a');
    expect(stepSelection(ids, 'c', 1)).toBe('c');
    expect(stepSelection(ids, 'a', -1)).toBe('a');
  });

  test('with nothing selected, either key lands on the first item; an empty list selects nothing', () => {
    expect(stepSelection(ids, undefined, 1)).toBe('a');
    expect(stepSelection(ids, 'gone', -1)).toBe('a');
    expect(stepSelection([], undefined, 1)).toBeUndefined();
  });

  test('a wide screen opens on the link it was given, or the first item', () => {
    expect(initialSelection(ids, 'b')).toBe('b');
    expect(initialSelection(ids, 'gone')).toBe('a');
    expect(initialSelection(ids, undefined)).toBe('a');
    expect(initialSelection([], 'b')).toBeUndefined();
  });
});

const notice = (id: string, group: InboxItem['group'], category: InboxItem['category']): InboxItem => ({ kind: 'notice', id, ref: id, stamp: '', group, category, profile: 'work', at: 1, title: id, detail: undefined, actions: [], link: undefined });


describe('what Notices lists', () => {
  const approval = { kind: 'approval', id: 'ap', ref: 'ap', stamp: '', group: 'decision', category: 'approvals', profile: 'work', at: 1, sessionId: 'rt', storedSessionId: undefined, sessionTitle: 'Chat', tool: undefined, command: 'ls', description: '', choices: ['once'] } satisfies InboxApproval;
  const items = [approval, notice('failed-work', 'failed', 'automation'), notice('pairing', 'decision', 'pairing'), { ...notice('fyi-other', 'fyi', 'system'), profile: 'coder' } as InboxItem, { ...notice('fyi-none', 'fyi', 'system'), profile: undefined } as InboxItem];

  test('is every notice that needs no decision: a decision is answered on Today, in the Talk tray, and not here', () => {
    expect(noticesIn(items, 'all').map((item) => item.id)).toEqual(['failed-work', 'fyi-other', 'fyi-none']);
  });

  test('is the chosen profile\'s own, and never hides one Caduceus could not place', () => {
    expect(noticesIn(items, 'work').map((item) => item.id)).toEqual(['failed-work', 'fyi-none']);
  });
});

describe('groups and categories', () => {
  const items = [notice('a', 'failed', 'automation'), notice('b', 'decision', 'pairing'), notice('c', 'fyi', 'system'), notice('d', 'failed', 'system')];

  test('the groups are Failed and FYI in that order, each with its own items, even when one is empty; what needs a decision is on Today', () => {
    expect(groupItems(items).map(({ title, items: inGroup }) => [title, inGroup.map((item) => item.id)])).toEqual([['Failed', ['a', 'd']], ['FYI', ['c']]]);
    expect(groupItems([]).map((group) => group.items.length)).toEqual([0, 0]);
  });

  test('a category keeps its own items, and none keeps all', () => {
    expect(inCategory(items, 'system').map((item) => item.id)).toEqual(['c', 'd']);
    expect(inCategory(items, undefined)).toHaveLength(4);
  });

  test('the filter and the view live in the address, and a value that is not one is left out', () => {
    expect(noticesSearch({ view: 'activity', category: 'system' })).toEqual({ view: 'activity', category: 'system' });
    expect(noticesSearch({ view: 'notices' })).toEqual({});
    expect(readNoticesView({ view: 'activity', category: 'automation' })).toEqual({ view: 'activity', category: 'automation' });
    expect(readNoticesView({ view: 'x', category: 'toString' })).toEqual({ view: 'notices' });
  });
});

describe('snoozing', () => {
  const at = (iso: string) => new Date(iso);
  test('an hour is an hour; tonight is 8 pm, or tomorrow\'s 8 pm once it is past; tomorrow is 9 am the next day', () => {
    const noon = at('2026-10-19T12:00:00');
    expect(snoozeUntil('1h', noon)).toBe(noon.getTime() + 3_600_000);
    expect(snoozeUntil('tonight', noon)).toBe(at('2026-10-19T20:00:00').getTime());
    expect(snoozeUntil('tonight', at('2026-10-19T21:30:00'))).toBe(at('2026-10-20T20:00:00').getTime());
    expect(snoozeUntil('tomorrow', at('2026-10-19T08:00:00'))).toBe(at('2026-10-20T09:00:00').getTime());
  });
});
