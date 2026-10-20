import { describe, expect, test } from 'vitest';
import { groupSessions, listPath, parseSessions, readSessionsView, sessionsSearch, type SessionItem } from '../src/modules/chat/sessions-model.ts';
import { latestSession, TALK_SCOPE } from '../src/modules/chat/talk-sessions.ts';

// Talk opens an agent's newest conversation, and lists that agent's sessions under its name. Pure: what is listed and opened is Hermes's.
type HermesRow = Record<string, unknown>;

function hermesRow(id: string, over: HermesRow = {}): HermesRow {
  return { id, title: id, preview: 'Hello', source: 'caduceus', started_at: 1_000, last_active: 1_000, message_count: 2, ended_at: null, end_reason: null, pinned: false, unread: false, archived: false, input_tokens: 0, output_tokens: 0, ...over };
}
const items = (...rows: HermesRow[]): SessionItem[] => parseSessions({ sessions: rows, total: rows.length }).items;

describe('the session Talk opens', () => {
  test('is the one with the newest activity, whatever order Hermes listed them in and whether it is pinned or not', () => {
    const list = items(hermesRow('old', { last_active: 1_000 }), hermesRow('newest', { last_active: 9_000 }), hermesRow('pinned-old', { last_active: 500, pinned: true }), hermesRow('middle', { last_active: 5_000 }));
    expect(latestSession(list)?.id).toBe('newest');
  });

  test('is never an archived session, an automation session or the API server’s throwaway one', () => {
    const list = items(
      hermesRow('archived', { last_active: 9_000, archived: true }),
      hermesRow('cron', { last_active: 8_000, source: 'cron' }),
      hermesRow('kanban', { last_active: 8_000, source: 'kanban' }),
      hermesRow('noise', { last_active: 7_000, source: 'api_server', message_count: 2, started_at: 6_990 }),
      hermesRow('chat', { last_active: 100 }),
    );
    expect(latestSession(list)?.id).toBe('chat');
  });

  test('is never a background run the agent was delegated, which is its own session and not the conversation the owner is in', () => {
    const list = items(hermesRow('bg_a1b2c3', { last_active: 9_000, source: 'tui' }), hermesRow('chat', { last_active: 100, source: 'tui' }));
    expect(latestSession(list)?.id).toBe('chat');
    expect(latestSession(items(hermesRow('bg_a1b2c3', { last_active: 9_000, source: 'tui' })))).toBeUndefined();
  });

  test('keeps Hermes’s own order between sessions that were last active at the same second', () => {
    const list = items(hermesRow('first', { last_active: 4_000 }), hermesRow('second', { last_active: 4_000 }));
    expect(latestSession(list)?.id).toBe('first');
  });

  test('is nothing when the agent has no conversation yet, so the screen starts a new chat', () => {
    expect(latestSession([])).toBeUndefined();
    expect(latestSession(items(hermesRow('cron', { source: 'cron' })))).toBeUndefined();
  });
});

describe('the sessions listed under the agent’s name', () => {
  test('are the agent’s own unless the address says all profiles, where the chat list elsewhere shows every profile unless it says otherwise', () => {
    expect(readSessionsView({}).all).toBe(true);
    expect(readSessionsView({}, TALK_SCOPE).all).toBe(false);
    expect(readSessionsView({ all: '1' }, TALK_SCOPE).all).toBe(true);
    expect(readSessionsView({ all: '0' }, TALK_SCOPE).all).toBe(false);
  });

  test('ask Hermes for that profile only, and widening to every profile asks for all of them', () => {
    const page = { profile: 'coder', offset: 0, limit: 50 };
    expect(listPath(readSessionsView({}, TALK_SCOPE), page)).toContain('/api/sessions?');
    expect(listPath(readSessionsView({}, TALK_SCOPE), page)).toContain('profile=coder');
    expect(listPath(readSessionsView({ all: '1' }, TALK_SCOPE), page)).toContain('profile=all');
  });

  test('put nothing in the address for the agent’s own list, and all=1 for the wider one, so that every row link stays short', () => {
    expect(sessionsSearch(readSessionsView({}, TALK_SCOPE), TALK_SCOPE)).toEqual({});
    expect(sessionsSearch(readSessionsView({ all: '1' }, TALK_SCOPE), TALK_SCOPE)).toEqual({ all: '1' });
    // The chat list's own default is unchanged.
    expect(sessionsSearch(readSessionsView({ all: '0' }))).toEqual({ all: '0' });
  });

  test('are grouped as the sessions list groups them: pinned first, then by the calendar day of the last activity', () => {
    const now = Date.UTC(2026, 9, 17, 22, 30) / 1000;
    const list = items(hermesRow('today', { last_active: now - 3_600 }), hermesRow('pinned', { last_active: now - 40 * 86_400, pinned: true }), hermesRow('older', { last_active: now - 20 * 86_400 }));
    expect(groupSessions(list, { now, timeZone: 'UTC' }).map((group) => [group.id, group.items.map((item) => item.id)])).toEqual([
      ['pinned', ['pinned']],
      ['today', ['today']],
      ['older', ['older']],
    ]);
  });
});
