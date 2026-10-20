import { describe, expect, test } from 'vitest';
import { PAGE_SIZE, aroundUrl, fromAround, fromLatest, latestUrl, mergeLatest, newerUrl, olderUrl, withNewer, withOlder, type HistoryBody } from '../src/modules/chat/history-window.ts';
import { entriesOf } from '../src/modules/chat/activity.ts';

/** A page the way Hermes's `/messages` returns it: rows with ids, oldest first. */
const rows = (from: number, to: number, role = (id: number) => (id % 2 === 1 ? 'user' : 'assistant')): HistoryBody['messages'] => Array.from({ length: to - from + 1 }, (_, index) => ({ id: from + index, role: role(from + index), content: `m${from + index}` }));
const page = (messages: HistoryBody['messages'], limit = PAGE_SIZE): HistoryBody => ({ messages, pagination: { limit, offset: 0, order: 'latest', returned: messages.length } });
const ids = (window: { rows: { id: number }[] }) => window.rows.map((row) => row.id);

describe('what a transcript shows of Hermes\'s rows', () => {
  test('user and assistant text are bubbles; a tool call is a card between them (never a bubble); empty assistant rows and hidden rows show nothing', () => {
    const window = fromLatest(
      page([
        { id: 1, role: 'user', content: 'hi' },
        { id: 2, role: 'assistant', content: '', tool_calls: [{ id: 'c', function: { name: 'terminal', arguments: '{}' } }] },
        { id: 3, role: 'tool', content: '{"ok":true}', tool_call_id: 'c' },
        { id: 4, role: 'assistant', content: 'done' },
        { id: 5, role: 'user', content: 'secret scaffold', display_kind: 'hidden' },
        { id: 6, role: 'user', content: [{ type: 'text', text: 'with' }, { type: 'image_url', image_url: { url: 'x' } }, { type: 'text', text: 'image' }] },
      ]),
    );
    expect(entriesOf(window.rows).map((entry) => (entry.kind === 'bubble' ? [entry.id, entry.role, entry.text] : [entry.items.map((item) => item.kind)]))).toEqual([
      [1, 'user', 'hi'],
      [['tool']],
      [4, 'assistant', 'done'],
      [6, 'user', 'with\nimage'],
    ]);
  });
});

describe('the newest page, and load earlier', () => {
  test('a full newest page says there is more before it; the older request counts every row loaded from the newest', () => {
    const window = fromLatest(page(rows(901, 1000)));
    expect(window).toMatchObject({ hasOlder: true, hasNewer: false });
    expect(latestUrl('abc', 'work')).toBe(`/api/sessions/abc/messages?profile=work&order=latest&limit=${PAGE_SIZE}`);
    expect(olderUrl('abc', 'work', window)).toBe(`/api/sessions/abc/messages?profile=work&order=latest&limit=${PAGE_SIZE}&offset=100`);
  });

  test('a short page is the whole transcript: nothing earlier', () => {
    expect(fromLatest(page(rows(1, 7))).hasOlder).toBe(false);
  });

  test('the older page goes in front, without a row twice, and the window says when it has reached the start', () => {
    let window = fromLatest(page(rows(901, 1000)));
    window = withOlder(window, page(rows(801, 900)));
    expect(ids(window)).toEqual([...rows(801, 1000).map((row) => row.id)]);
    expect(window.hasOlder).toBe(true);
    window = withOlder(window, page(rows(795, 800)));
    expect(window.hasOlder).toBe(false);
    expect(ids(window)).toHaveLength(206);
    expect(olderUrl('abc', undefined, window)).toBe(`/api/sessions/abc/messages?order=latest&limit=${PAGE_SIZE}&offset=206`);
  });

  test('a page that overlaps what is loaded adds only the rows it does not have', () => {
    const window = fromLatest(page(rows(901, 1000)));
    expect(ids(withOlder(window, page(rows(850, 905)))).slice(0, 3)).toEqual([850, 851, 852]);
    expect(ids(withOlder(window, page(rows(850, 905))))).toHaveLength(151);
  });

  test('the newest page read again after a turn: it replaces the newest rows, and what was loaded before it stays', () => {
    let window = fromLatest(page(rows(901, 1000)));
    window = withOlder(window, page(rows(801, 900)));
    const grown = mergeLatest(window, page([...rows(951, 1000), ...rows(1001, 1002)]));
    expect(ids(grown)).toEqual(rows(801, 1002).map((row) => row.id));
    expect(grown.hasOlder).toBe(true);
  });
});

describe('opening around a message', () => {
  const body = {
    messages: rows(1201, 1320),
    pagination: { row_id: 1201, limit: 120, returned: 120, order: 'oldest', offset: 1200, total: 2000, has_older: true, has_newer: true },
  };

  test('the request asks for the page that starts at the prompt', () => {
    expect(aroundUrl('abc', 'work', 1201)).toBe('/api/sessions/abc/messages/around?profile=work&row_id=1201&limit=120');
  });

  test('the window knows what is before and after it, and where it starts', () => {
    const window = fromAround(body);
    expect(window).toMatchObject({ hasOlder: true, hasNewer: true, start: 1200 });
    expect(ids(window)[0]).toBe(1201);
  });

  test('earlier rows come by position from the start, and the start moves back', () => {
    let window = fromAround(body);
    expect(olderUrl('abc', 'work', window)).toBe(`/api/sessions/abc/messages?profile=work&include_compacted=true&order=oldest&limit=${PAGE_SIZE}&offset=1100`);
    window = withOlder(window, { messages: rows(1101, 1200), pagination: { limit: 100, offset: 1100, order: 'oldest', returned: 100 } });
    expect(window.start).toBe(1100);
    expect(ids(window)).toHaveLength(220);
    // Near the start the request is no bigger than what is left.
    const near = { ...window, start: 30 };
    expect(olderUrl('abc', undefined, near)).toBe(`/api/sessions/abc/messages?include_compacted=true&order=oldest&limit=30&offset=0`);
  });

  test('later rows come by position after the window; a short page means the window reached the newest', () => {
    let window = fromAround(body);
    expect(newerUrl('abc', 'work', window)).toBe(`/api/sessions/abc/messages?profile=work&include_compacted=true&order=oldest&limit=${PAGE_SIZE}&offset=1320`);
    window = withNewer(window, { messages: rows(1321, 1400), pagination: { limit: 100, offset: 1320, order: 'oldest', returned: 80 } });
    expect(window.hasNewer).toBe(false);
    expect(ids(window).at(-1)).toBe(1400);
  });
});
