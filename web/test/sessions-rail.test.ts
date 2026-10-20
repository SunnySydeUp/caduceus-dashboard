import { describe, expect, test } from 'vitest';
import { filterCount, filterItems, footerLine, MORE_ITEMS, setFilter, stateWord, type FilterId } from '../src/modules/chat/sessions-rail.ts';
import { readSessionsView, sessionsSearch, type SessionItem, type SessionsView } from '../src/modules/chat/sessions-model.ts';
import { TALK_SCOPE } from '../src/modules/chat/talk-sessions.ts';

// The session rail (M8 #09 step B): what its two menus hold and when a row says a word. Pure: the menus are drawn from these tables.
const talkView = (search: Record<string, unknown> = {}) => readSessionsView(search, TALK_SCOPE);

function item(over: Partial<SessionItem> = {}): SessionItem {
  return { id: 's1', title: 'A chat', preview: '', source: 'tui', startedAt: 1_000, lastActive: 2_000, messageCount: 4, pinned: false, unread: false, failed: false, profile: undefined, archived: false, cwd: '', tokens: 0, ...over };
}

describe('the filter count', () => {
  test('is nothing in the view the rail opens on', () => {
    expect(filterCount(talkView(), TALK_SCOPE)).toBe(0);
  });

  test('counts each filter that is on, Automation and a source included', () => {
    expect(filterCount(talkView({ failed: '1' }), TALK_SCOPE)).toBe(1);
    expect(filterCount(talkView({ failed: '1', quiet: '1', archived: '1' }), TALK_SCOPE)).toBe(3);
    expect(filterCount(talkView({ tab: 'automation', source: 'cron' }), TALK_SCOPE)).toBe(2);
    expect(filterCount(talkView({ all: '1', group: 'project' }), TALK_SCOPE)).toBe(1);
  });

  test('counts a widening to all profiles in Talk, where the default is the agent’s own, and a narrowing where the default is every profile', () => {
    expect(filterCount(talkView({ all: '1' }), TALK_SCOPE)).toBe(1);
    expect(filterCount(readSessionsView({ all: '0' }), 'everyone')).toBe(1);
    expect(filterCount(readSessionsView({}), 'everyone')).toBe(0);
  });

  test('does not count grouping by project while All profiles makes it impossible', () => {
    expect(filterCount(talkView({ all: '1', group: 'project' }), TALK_SCOPE)).toBe(1);
  });
});

describe('what each filter asks of the list', () => {
  const asked = (id: Exclude<FilterId, 'tab' | 'source' | 'new-project'>, from: Record<string, unknown> = {}) => sessionsSearch(setFilter(talkView(from), id), TALK_SCOPE);

  test('a switch puts its own key in the address and nothing else', () => {
    expect(asked('failed')).toEqual({ failed: '1' });
    expect(asked('quiet')).toEqual({ quiet: '1' });
    expect(asked('all')).toEqual({ all: '1' });
    expect(asked('archived')).toEqual({ archived: '1' });
    expect(asked('project')).toEqual({ group: 'project' });
  });

  test('turning a switch off again takes its key out', () => {
    for (const [id, from] of [['failed', { failed: '1' }], ['quiet', { quiet: '1' }], ['all', { all: '1' }], ['archived', { archived: '1' }], ['project', { group: 'project' }]] as const) {
      expect(asked(id, from)).toEqual({});
    }
  });

  test('a switch leaves the other filters as they were', () => {
    expect(asked('failed', { quiet: '1', source: 'cron', tab: 'automation' })).toEqual({ tab: 'automation', source: 'cron', failed: '1', quiet: '1' });
  });

  test('which of them are on follows the view', () => {
    const on = (view: SessionsView) => filterItems(view, TALK_SCOPE).filter((entry) => entry.on).map((entry) => entry.id);
    expect(on(talkView())).toEqual([]);
    expect(on(talkView({ failed: '1', archived: '1', source: 'cron' }))).toEqual(['failed', 'archived', 'source']);
  });

  test('the source entry says which source, and Any when there is none', () => {
    expect(filterItems(talkView(), TALK_SCOPE).find((entry) => entry.id === 'source')?.value).toBe('Any');
    expect(filterItems(talkView({ source: 'telegram' }), TALK_SCOPE).find((entry) => entry.id === 'source')?.value).toBe('Telegram');
  });

  test('grouping by project cannot be chosen while All profiles is on, and says why', () => {
    const project = (view: SessionsView) => filterItems(view, TALK_SCOPE).find((entry) => entry.id === 'project');
    expect(project(talkView())?.disabled).toBeUndefined();
    expect(project(talkView({ all: '1' }))?.disabled).toMatch(/profile/i);
  });
});

describe('every control the toolbars had before is still in a menu', () => {
  // The words of the buttons the pane had before the two menus (an independent list, written out from the old toolbar and filter rows).
  const BEFORE_FILTERS = ['Chats', 'Automation', 'Failed only', 'Hide API noise', 'All profiles', 'Archived', 'Source', 'By project'];
  const BEFORE_ACTIONS = ['Refresh', 'Compact', 'Select', 'Import', 'Claude Code & Codex', 'Clean up'];

  test('the Filters menu holds the tabs and every filter, and New project while the list is grouped by project', () => {
    const labels = (view: SessionsView) => filterItems(view, TALK_SCOPE).map((entry) => entry.label);
    const kinds = ['Chats', 'Automation'];
    for (const label of BEFORE_FILTERS) expect(kinds.includes(label) || labels(talkView()).includes(label), label).toBe(true);
    expect(labels(talkView())).not.toContain('New project');
    expect(labels(talkView({ group: 'project' }))).toContain('New project');
    expect(labels(talkView({ group: 'project', all: '1' }))).not.toContain('New project');
  });

  test('the More menu holds every maintenance action', () => {
    const labels = MORE_ITEMS.map((entry) => entry.label);
    for (const before of BEFORE_ACTIONS) expect(labels.some((label) => label.startsWith(before)), before).toBe(true);
  });

  test('the actions that change Hermes keep their tier mark, and the ones that only change the view do not', () => {
    const changes = Object.fromEntries(MORE_ITEMS.map((entry) => [entry.id, entry.changesHermes]));
    expect(changes).toEqual({ refresh: false, compact: false, select: false, import: true, foreign: false, cleanup: true });
  });
});

describe('the word a row says', () => {
  test('is none for an ordinary session, a running one and an unread one', () => {
    expect(stateWord({ item: item(), live: undefined, drafted: false })).toBeUndefined();
    expect(stateWord({ item: item(), live: 'running', drafted: false })).toBeUndefined();
    expect(stateWord({ item: item({ unread: true }), live: undefined, drafted: false })).toBeUndefined();
  });

  test('is said when the session needs the owner: it asks something, it failed, or an unsent draft waits', () => {
    expect(stateWord({ item: item(), live: 'waiting', drafted: false })).toBe('Needs you');
    expect(stateWord({ item: item({ failed: true }), live: undefined, drafted: false })).toBe('Failed');
    expect(stateWord({ item: item(), live: undefined, drafted: true })).toBe('Draft');
  });

  test('the most urgent one is the word when several apply', () => {
    expect(stateWord({ item: item({ failed: true }), live: 'waiting', drafted: true })).toBe('Needs you');
    expect(stateWord({ item: item({ failed: true }), live: undefined, drafted: true })).toBe('Failed');
  });
});

describe('the footer', () => {
  const stats = { sessions: 88, archived: 3, messages: 900, bySource: {}, tokens: 5_000 };

  test('is the number of sessions, quietly: no messages and no tokens', () => {
    expect(footerLine({ view: talkView(), stats, total: 88, loaded: true, profiles: 0 })).toBe('88 sessions');
    expect(footerLine({ view: talkView(), stats: { ...stats, sessions: 1 }, total: 1, loaded: true, profiles: 0 })).toBe('1 session');
  });

  test('says how many profiles it spans when All profiles is on', () => {
    expect(footerLine({ view: talkView({ all: '1' }), stats, total: 120, loaded: true, profiles: 3 })).toBe('120 sessions across 3 profiles');
    expect(footerLine({ view: talkView({ all: '1' }), stats, total: 12, loaded: true, profiles: 1 })).toBe('12 sessions across 1 profile');
  });

  test('is empty until the list has loaded', () => {
    expect(footerLine({ view: talkView({ all: '1' }), stats: undefined, total: 0, loaded: false, profiles: 0 })).toBe('');
    expect(footerLine({ view: talkView(), stats: undefined, total: 0, loaded: true, profiles: 0 })).toBe('');
  });
});
