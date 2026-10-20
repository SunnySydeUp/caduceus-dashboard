import { describe, expect, test } from 'vitest';
import { layoutOf, visibleWindow } from '../src/modules/chat/virtual-list.ts';
import {
  activityLabel,
  flattenGroups,
  groupSessions,
  listPath,
  liveSessions,
  moveSelection,
  parseSessions,
  parseStats,
  pull,
  PULL_MAX,
  readSessionsView,
  selectSessions,
  sessionsSearch,
  sourceIcon,
  sourceLabel,
  statsLine,
  withTab,
  type SessionItem,
  type SessionsView,
} from '../src/modules/chat/sessions-model.ts';

/** A session as Hermes's list gives it, with only what a test cares about changed. */
type HermesRow = Record<string, unknown>;

function hermesRow(id: string, over: HermesRow = {}): HermesRow {
  return {
    id,
    title: null,
    preview: 'Hello',
    source: 'cli',
    started_at: 1_000,
    last_active: 1_000,
    message_count: 2,
    ended_at: null,
    end_reason: null,
    pinned: false,
    unread: false,
    input_tokens: 0,
    output_tokens: 0,
    ...over,
  };
}

const items = (...rows: HermesRow[]): SessionItem[] => parseSessions({ sessions: rows, total: rows.length }).items;

// 2026-10-18 09:30 in Sydney (UTC+11) is 2026-10-17 22:30 UTC.
const NOW = Date.UTC(2026, 9, 17, 22, 30) / 1000;
const HOUR = 3600;
const DAY = 24 * HOUR;

describe('date groups', () => {
  const at = (hoursAgo: number) => NOW - hoursAgo * HOUR;
  const idsByGroup = (rows: SessionItem[], timeZone: string) => Object.fromEntries(groupSessions(rows, { now: NOW, timeZone }).map((group) => [group.id, group.items.map((item) => item.id)]));

  test('a session is in Today, Yesterday, This week or Older by the calendar day of its last activity in the viewer’s time zone, and pinned ones come first whatever their age', () => {
    const rows = items(
      hermesRow('now', { last_active: at(0) }),
      hermesRow('early-today', { last_active: at(9) }),
      hermesRow('late-yesterday', { last_active: at(9.6) }),
      hermesRow('two-days', { last_active: at(2 * 24) }),
      hermesRow('six-days', { last_active: at(6 * 24) }),
      hermesRow('seven-days', { last_active: at(7 * 24) }),
      hermesRow('old-pin', { last_active: at(90 * 24), pinned: true }),
      hermesRow('new-pin', { last_active: at(1), pinned: true }),
    );
    // Sydney is UTC+11, so it is 09:30 on the 18th: 9 hours ago is 00:30 the same day, 9.6 hours ago is 23:54 on the 17th.
    expect(idsByGroup(rows, 'Australia/Sydney')).toEqual({
      pinned: ['new-pin', 'old-pin'],
      today: ['now', 'early-today'],
      yesterday: ['late-yesterday'],
      week: ['two-days', 'six-days'],
      older: ['seven-days'],
    });
  });

  test('the same instants fall in different groups in another time zone', () => {
    const rows = items(hermesRow('a', { last_active: NOW }), hermesRow('b', { last_active: NOW - 9.6 * HOUR }));
    // In Los Angeles (UTC-7) it is 15:30 on the 17th; 9.6 hours earlier is 05:54 on the 17th.
    expect(idsByGroup(rows, 'America/Los_Angeles')).toEqual({ today: ['a', 'b'] });
    // In Auckland (UTC+13) it is 11:30 on the 18th; 9.6 hours earlier is 01:54 on the 18th.
    expect(idsByGroup(rows, 'Pacific/Auckland')).toEqual({ today: ['a', 'b'] });
    // In Kiritimati (UTC+14) it is 12:30 on the 18th; 13 hours earlier is 23:30 on the 17th.
    expect(idsByGroup(items(hermesRow('c', { last_active: NOW - 13 * HOUR })), 'Pacific/Kiritimati')).toEqual({ yesterday: ['c'] });
  });

  test('a day with a daylight-saving change is still one calendar day', () => {
    // New York turned its clocks back at 02:00 on 2026-11-01, a day of 25 hours. Noon on 31 October is "yesterday" at noon on 1 November.
    const noonOn1st = Date.UTC(2026, 10, 1, 17) / 1000;
    const noonOn31st = Date.UTC(2026, 9, 31, 16) / 1000;
    const groups = groupSessions(items(hermesRow('x', { last_active: noonOn31st })), { now: noonOn1st, timeZone: 'America/New_York' });
    expect(groups.map((group) => group.id)).toEqual(['yesterday']);
  });

  test('empty groups are left out, and a session with no last activity uses its start', () => {
    const groups = groupSessions(items(hermesRow('s', { last_active: null, started_at: NOW - 2 * DAY })), { now: NOW, timeZone: 'UTC' });
    expect(groups.map((group) => [group.id, group.label])).toEqual([['week', 'This week']]);
  });
});

describe('the last-activity label of a row', () => {
  const label = (lastActive: number, locale: string, timeZone = 'Australia/Sydney') => activityLabel(lastActive, { now: NOW, timeZone, locale });

  test('today shows the time of day the way the locale writes it, yesterday and the week the weekday, older the date', () => {
    expect(label(NOW - 3 * HOUR, 'en-US')).toBe('6:30 AM');
    expect(label(NOW - 3 * HOUR, 'de-DE')).toBe('6:30');
    expect(label(NOW - 3 * HOUR, 'ar-EG')).toBe('٦:٣٠ ص');
    expect(label(NOW - 2 * DAY, 'en-US')).toBe('Fri');
    expect(label(NOW - 2 * DAY, 'de-DE')).toBe('Fr');
    expect(label(NOW - 30 * DAY, 'en-US')).toBe('Sep 18');
    expect(label(NOW - 30 * DAY, 'de-DE')).toBe('18. Sept.');
  });

  test('yesterday says so, and a date in another year carries the year', () => {
    expect(label(NOW - 12 * HOUR, 'en-US')).toBe('Yesterday');
    expect(label(NOW - 400 * DAY, 'en-US')).toBe('Sep 13, 2025');
  });

  test('the time zone moves a label across midnight', () => {
    expect(label(NOW - HOUR, 'en-US', 'UTC')).toBe('9:30 PM');
    expect(label(NOW - HOUR, 'en-US', 'Australia/Sydney')).toBe('8:30 AM');
  });
});

describe('the list’s filters in the address', () => {
  test('the default view (every profile) is no query at all, and what is in the query reads back as the same view', () => {
    expect(sessionsSearch(readSessionsView({}))).toEqual({});
    expect(readSessionsView({})).toMatchObject({ all: true });
    const views: SessionsView[] = [
      { tab: 'chats', failed: false, quiet: false, all: true },
      { tab: 'automation', failed: false, quiet: false, all: true },
      { tab: 'chats', source: 'telegram', failed: true, quiet: false, all: true },
      { tab: 'automation', source: 'cron', failed: false, quiet: true, all: false },
      { tab: 'chats', failed: true, quiet: true, all: false },
    ];
    for (const view of views) {
      expect(readSessionsView(Object.fromEntries(new URLSearchParams(new URLSearchParams(sessionsSearch(view)).toString())))).toEqual(view);
    }
    // Narrowing the list to this tab's profile is what the address says: `all=0`.
    expect(sessionsSearch(views[3]!)).toEqual({ tab: 'automation', source: 'cron', quiet: '1', all: '0' });
  });

  test('a damaged query is as if it were not there', () => {
    expect(readSessionsView({ tab: 'everything', source: '  ', failed: 'yes', quiet: '0', all: ['0', '0'] })).toEqual({ tab: 'chats', failed: false, quiet: false, all: true });
    expect(readSessionsView({ source: 3 })).toEqual({ tab: 'chats', failed: false, quiet: false, all: true });
  });

  test('changing the tab drops a source that belongs to the other one', () => {
    expect(withTab({ tab: 'chats', source: 'telegram', failed: true, quiet: false, all: true }, 'automation')).toEqual({ tab: 'automation', failed: true, quiet: false, all: true });
    expect(withTab({ tab: 'automation', source: 'cron', failed: false, quiet: false, all: true }, 'automation')).toEqual({
      tab: 'automation',
      source: 'cron',
      failed: false,
      quiet: false,
      all: true,
    });
  });
});

describe('the archive and the project grouping in the address', () => {
  test('?archived=1 and ?group=project read back as the same view, and are in no other view', () => {
    const views: SessionsView[] = [
      { tab: 'chats', failed: false, quiet: false, all: true, archived: true },
      { tab: 'chats', failed: false, quiet: false, all: true, group: 'project' },
      { tab: 'automation', source: 'cron', failed: true, quiet: false, all: false, archived: true, group: 'project' },
    ];
    for (const view of views) {
      expect(readSessionsView(Object.fromEntries(new URLSearchParams(new URLSearchParams(sessionsSearch(view)).toString())))).toEqual(view);
    }
    expect(sessionsSearch(views[2]!)).toEqual({ tab: 'automation', source: 'cron', failed: '1', all: '0', archived: '1', group: 'project' });
    expect(readSessionsView({ archived: '0', group: 'date' })).toEqual({ tab: 'chats', failed: false, quiet: false, all: true });
    expect(withTab({ tab: 'chats', failed: false, quiet: false, all: true, archived: true, group: 'project' }, 'automation')).toEqual({ tab: 'automation', failed: false, quiet: false, all: true, archived: true, group: 'project' });
  });

  test('the archive is read from Hermes as its own list: archived sessions only, in every profile or one', () => {
    const query = (view: SessionsView) => Object.fromEntries(new URLSearchParams(listPath(view, { profile: 'work', offset: 0, limit: 100 }).split('?')[1]));
    expect(query({ tab: 'chats', failed: false, quiet: false, all: true })).not.toHaveProperty('archived');
    expect(query({ tab: 'chats', failed: false, quiet: false, all: false, archived: true })).toMatchObject({ archived: 'only', profile: 'work' });
    expect(query({ tab: 'chats', failed: false, quiet: false, all: true, archived: true })).toMatchObject({ archived: 'only', profile: 'all' });
  });
});

describe('what a view asks of Hermes, and what it keeps of the answer', () => {
  const view = (over: Partial<SessionsView> = {}): SessionsView => ({ tab: 'chats', failed: false, quiet: false, all: false, ...over });
  const query = (v: SessionsView, offset = 0) => Object.fromEntries(new URLSearchParams(listPath(v, { profile: 'work', offset, limit: 100 }).split('?')[1]));

  test('the Chats tab leaves out the automation sources and the Automation tab asks for only them, in the profile of the tab, newest activity first, with no empty sessions', () => {
    expect(listPath(view(), { profile: 'work', offset: 0, limit: 100 }).startsWith('/api/sessions?')).toBe(true);
    expect(query(view())).toEqual({ order: 'recent', min_messages: '1', limit: '100', offset: '0', profile: 'work', exclude_sources: 'cron,kanban,webhook,api_server' });
    expect(query(view({ tab: 'automation' }), 200)).toEqual({ order: 'recent', min_messages: '1', limit: '100', offset: '200', profile: 'work', sources: 'cron,kanban,webhook,api_server' });
  });

  test('a source filter narrows the tab, and the cross-profile list uses the aggregate endpoint for every profile', () => {
    expect(query(view({ source: 'telegram' }))).toMatchObject({ source: 'telegram', exclude_sources: 'cron,kanban,webhook,api_server' });
    const all = listPath(view({ all: true, tab: 'automation', source: 'cron' }), { profile: 'work', offset: 0, limit: 100 });
    expect(all.startsWith('/api/profiles/sessions?')).toBe(true);
    expect(Object.fromEntries(new URLSearchParams(all.split('?')[1]))).toEqual({
      order: 'recent',
      min_messages: '1',
      limit: '100',
      offset: '0',
      profile: 'all',
      source: 'cron',
      sources: 'cron,kanban,webhook,api_server',
    });
  });

  const rows = items(
    hermesRow('chat-ok', { source: 'telegram' }),
    hermesRow('chat-failed', { source: 'telegram', end_reason: 'error' }),
    hermesRow('cron-failed', { source: 'cron', end_reason: 'agent_error' }),
    hermesRow('cron-ok', { source: 'cron' }),
    hermesRow('api-noise', { source: 'api_server', message_count: 2, started_at: 100, last_active: 130 }),
    hermesRow('api-real', { source: 'api_server', message_count: 14, started_at: 100, last_active: 5_000 }),
    hermesRow('api-slow', { source: 'api_server', message_count: 2, started_at: 100, last_active: 400 }),
    hermesRow('cli-closed', { source: 'cli', end_reason: 'idle_timeout' }),
  );
  const kept = (v: SessionsView) => selectSessions(rows, v).map((item) => item.id);

  test('the tab, the source, failed-only and hide-API-noise combine: a session must pass every one that is on', () => {
    expect(kept(view())).toEqual(['chat-ok', 'chat-failed', 'cli-closed']);
    expect(kept(view({ tab: 'automation' }))).toEqual(['cron-failed', 'cron-ok', 'api-noise', 'api-real', 'api-slow']);
    expect(kept(view({ tab: 'automation', quiet: true }))).toEqual(['cron-failed', 'cron-ok', 'api-real', 'api-slow']);
    expect(kept(view({ tab: 'automation', source: 'api_server', quiet: true }))).toEqual(['api-real', 'api-slow']);
    expect(kept(view({ failed: true }))).toEqual(['chat-failed']);
    expect(kept(view({ tab: 'automation', failed: true, quiet: true }))).toEqual(['cron-failed']);
    expect(kept(view({ source: 'cron' }))).toEqual([]);
    // Every filter off on the Chats tab with a source: only that source.
    expect(kept(view({ source: 'telegram' }))).toEqual(['chat-ok', 'chat-failed']);
  });

  test('only an error, a failure, a crash or a timeout ends a session badly: the automatic and ordinary closes do not', () => {
    const failedIds = (reasons: (string | null)[]) => items(...reasons.map((reason, index) => hermesRow(`s${index}`, { end_reason: reason }))).filter((item) => item.failed).length;
    expect(failedIds(['error', 'agent_error', 'crash', 'gateway_crashed', 'tool_failure', 'timeout'])).toBe(6);
    expect(failedIds([null, 'cli_close', 'tui_close', 'ws_orphan_reap', 'idle_timeout', 'compression', 'done', 'cron_complete', 'user_exit'])).toBe(0);
  });
});

describe('moving through the list with the keyboard', () => {
  const ids = ['a', 'b', 'c'];

  test('j and ArrowDown go to the next row, k and ArrowUp to the one before, and neither goes past an end', () => {
    expect(moveSelection(ids, 'a', 'j')).toBe('b');
    expect(moveSelection(ids, 'b', 'ArrowDown')).toBe('c');
    expect(moveSelection(ids, 'c', 'j')).toBe('c');
    expect(moveSelection(ids, 'c', 'k')).toBe('b');
    expect(moveSelection(ids, 'b', 'ArrowUp')).toBe('a');
    expect(moveSelection(ids, 'a', 'k')).toBe('a');
  });

  test('with nothing selected, or a selection that is no longer in the list, the first row is the one to go to; an empty list selects nothing; other keys do nothing', () => {
    expect(moveSelection(ids, undefined, 'j')).toBe('a');
    expect(moveSelection(ids, 'gone', 'k')).toBe('a');
    expect(moveSelection([], undefined, 'j')).toBeUndefined();
    expect(moveSelection(ids, 'b', 'x')).toBe('b');
    expect(moveSelection(ids, 'b', 'Home')).toBe('a');
    expect(moveSelection(ids, 'b', 'End')).toBe('c');
  });
});

describe('what a row says about whether the session is live', () => {
  test('a session Hermes is running or waiting on is live, and one that is only open or still starting is not; the stored id is the session key', () => {
    const live = liveSessions({
      sessions: [
        { id: 'tui-1', session_key: 'stored-1', status: 'working' },
        { id: 'tui-2', session_key: 'stored-2', status: 'idle' },
        { id: 'tui-3', session_key: 'stored-3', status: 'waiting' },
        { id: 'tui-4', session_key: '', status: 'streaming' },
        { id: 'tui-5', session_key: 'stored-5', status: 'starting' },
        { id: 'tui-6', session_key: 'stored-6', status: 'resuming' },
      ],
    });
    expect(live).toEqual({ 'stored-1': 'running', 'stored-3': 'waiting', 'tui-4': 'running' });
    expect(liveSessions(undefined)).toEqual({});
    expect(liveSessions({ sessions: 'nope' })).toEqual({});
  });
});

describe('the stats strip', () => {
  test('reads Hermes’s session stats and the week’s token use, and says them in a line', () => {
    const stats = parseStats(
      { total: 1423, active_store: 1400, archived: 23, messages: 30_512, by_source: { cli: 800, telegram: 600, cron: 23, bogus: 'x' } },
      { totals: { total_input: 1_200_000, total_output: 340_000 } },
    );
    expect(stats).toEqual({ sessions: 1400, archived: 23, messages: 30_512, bySource: { cli: 800, telegram: 600, cron: 23 }, tokens: 1_540_000 });
    expect(statsLine(stats)).toBe('1,400 sessions · 30,512 messages · 1.5M tokens this week');
    expect(statsLine({ ...stats, tokens: undefined })).toBe('1,400 sessions · 30,512 messages');
    expect(statsLine({ sessions: 1, archived: 0, messages: 1, bySource: {}, tokens: 950 })).toBe('1 session · 1 message · 950 tokens this week');
    expect(statsLine({ sessions: 2, archived: 0, messages: 4, bySource: {}, tokens: 12_300 })).toBe('2 sessions · 4 messages · 12.3k tokens this week');
  });

  test('stats Hermes did not send are as if there were none', () => {
    expect(parseStats(undefined, undefined)).toEqual({ sessions: 0, archived: 0, messages: 0, bySource: {}, tokens: undefined });
  });
});

describe('the rows the page draws', () => {
  const many = items(...Array.from({ length: 2000 }, (_, n) => hermesRow(`s${n}`, { last_active: NOW - n * 3 * HOUR, pinned: n === 1500 })));
  const groups = groupSessions(many, { now: NOW, timeZone: 'UTC' });
  const flat = flattenGroups(groups);

  test('a header stands before the rows of each group, so that a long list is one list of equal-height kinds', () => {
    expect(flat).toHaveLength(2000 + groups.length);
    expect(flat[0]).toMatchObject({ kind: 'header', id: 'pinned', key: 'header:pinned' });
    expect(flat[1]).toMatchObject({ kind: 'row', key: 's1500' });
    expect(flat.filter((entry) => entry.kind === 'header').map((entry) => entry.id)).toEqual(groups.map((group) => group.id));
  });

  test('only the entries near the screen are drawn, however long the list: headers and rows are measured apart', () => {
    const heights = flat.map((entry) => (entry.kind === 'header' ? 36 : 64));
    const layout = layoutOf(heights, 64, 0);
    const shown = visibleWindow({ layout, scrollTop: 40_000, viewport: 700, overscan: 6 });
    expect(shown.end - shown.start).toBeLessThan(30);
    expect(shown.before).toBe(layout.offsets[shown.start]);
    expect(shown.before + (layout.offsets[shown.end]! - layout.offsets[shown.start]!) + shown.after).toBe(layout.total);
  });
});

describe('pulling the list down to refresh', () => {
  test('a pull from the top is resisted and arms the refresh past the threshold; a pull that does not start at the top, or goes up, is nothing', () => {
    expect(pull({ startY: 100, y: 130, atTop: true })).toEqual({ distance: 15, armed: false });
    expect(pull({ startY: 100, y: 260, atTop: true })).toEqual({ distance: 80, armed: true });
    expect(pull({ startY: 100, y: 900, atTop: true }).distance).toBe(PULL_MAX);
    expect(pull({ startY: 100, y: 260, atTop: false })).toEqual({ distance: 0, armed: false });
    expect(pull({ startY: 100, y: 40, atTop: true })).toEqual({ distance: 0, armed: false });
  });
});

describe('where a session came from', () => {
  test('a source has a name and an icon, a source Hermes adds later is named by itself, and no source at all is just Hermes’s', () => {
    expect(sourceLabel('cli')).toBe('Terminal');
    expect(sourceLabel('api_server')).toBe('API');
    expect(sourceLabel('mattermost')).toBe('Mattermost');
    expect(sourceLabel('')).toBe('Hermes');
    expect(sourceIcon('telegram')).toBe('telegram');
    expect(sourceIcon('cron')).toBe('clock');
    expect(sourceIcon('mattermost')).toBe('chat');
  });
});
