// The sessions list's engine (M1 #13): no DOM and no React, so it runs under test. It reads Hermes's list a page at a time (never the whole
// history: a profile can hold thousands of sessions), keeps what the filters leave, marks the sessions Hermes is working on, and reads
// everything again whenever Hermes says the sessions changed. It keeps nothing of its own across loads (D1).
import type { SessionActiveListResult } from '@caduceus/contracts/hermes/gateway';
import type { ChatConnection } from './chat-session.ts';
import { listPath, liveSessions, parseSessions, parseStats, selectSessions, type LiveKind, type SessionItem, type SessionPage, type SessionStats, type SessionsView } from './sessions-model.ts';
import { parseProjects, parseProjectTree, type Project } from './sessions-projects.ts';
import { createStore, type Store } from './store.ts';

/** How many sessions one read asks Hermes for (`GET /api/sessions` takes at most 100). */
export const PAGE_SIZE = 100;
/** When the filters the screen applies itself leave fewer rows than this and Hermes has more, the next page is read without being asked. */
const FILL_TO = 25;
/** The week's token use is a heavier question for Hermes than the counts: it is asked again after a change only when the last answer is this old. */
const USAGE_MAX_AGE_S = 30;

export interface SessionListState {
  /** The sessions that pass the filters, in Hermes's order (newest activity first). */
  items: SessionItem[];
  /** How many sessions Hermes has under the filters it did itself (tab, source), not only those read so far. */
  total: number;
  /** Hermes has more pages to read. */
  hasMore: boolean;
  /** The list has been read at least once under this view. */
  loaded: boolean;
  loadingMore: boolean;
  /** A read of the whole list is in progress after the first (a refresh, or a change Hermes announced). */
  refreshing: boolean;
  /** Why the last read failed, in Hermes's words; cleared by the next one that works. The rows stay: they are the last that were read. */
  error: string | undefined;
  /** Sessions Hermes is working on now, by stored id. */
  live: Record<string, LiveKind>;
  /** Hermes's session counts and the week's token use; absent until read, and for the cross-profile list. */
  stats: SessionStats | undefined;
  /** The cross-profile list: how many sessions each profile has. */
  profileTotals: Record<string, number> | undefined;
  /** The cross-profile list: profiles Hermes could not read, in its words. */
  unreadableProfiles: string[];
  /** The profile's projects (archived ones included), read only while the list is grouped by project. */
  projects: Project[];
  /** Which project each session is in, by stored id; a session in none is not here. Read with `projects`. */
  projectOf: Record<string, string>;
}

export interface SessionList extends Store<SessionListState> {
  /** Changes the filters. Tab, source and the profile scope go to Hermes (the list is read again); failed-only and API noise are only applied. */
  setView(view: SessionsView): void;
  /** Reads the next page, if there is one. */
  loadMore(): Promise<void>;
  /** Reads the list again, as far as it has been read. */
  refresh(): Promise<void>;
  /** The session was opened: its unread marker is not shown any more (Hermes is told by the caller). */
  markRead(id: string): void;
  dispose(): void;
}

export interface SessionListOptions {
  connection: ChatConnection;
  /** Reads a JSON path of Hermes's REST API (the page's `fetch`, through Caduceus). */
  rest(path: string): Promise<unknown>;
  /** The tab's profile; the cross-profile view ignores it. */
  profile: string;
  view: SessionsView;
  pageSize?: number;
  /** Seconds since the epoch. */
  now?(): number;
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createSessionList(options: SessionListOptions): SessionList {
  const { connection, rest, profile, pageSize = PAGE_SIZE, now = () => Date.now() / 1000 } = options;
  const store = createStore<SessionListState>({
    items: [],
    total: 0,
    hasMore: false,
    loaded: false,
    loadingMore: false,
    refreshing: false,
    error: undefined,
    live: {},
    stats: undefined,
    profileTotals: undefined,
    unreadableProfiles: [],
    projects: [],
    projectOf: {},
  });
  let view = options.view;
  /** Every session read so far, before the filters the screen applies. */
  let read: SessionItem[] = [];
  /** How far into Hermes's list the reads have gone: the pages are asked for by position, and a page can come back longer than asked (Hermes adds the pins it missed). */
  let position = 0;
  let total = 0;
  /** A view that Hermes is asked for differently makes the earlier answers stale: they are dropped when they arrive. */
  let generation = 0;
  let loading: Promise<void> | undefined;
  let again = false;
  let disposed = false;
  let usage: { tokens: unknown; at: number } | undefined;

  const publish = (patch: Partial<SessionListState> = {}) => {
    if (!disposed) store.set({ items: selectSessions(read, view), total, hasMore: position < total, ...patch });
  };

  async function readPage(offset: number): Promise<void> {
    const mine = generation;
    const page = parseSessions(await rest(listPath(view, { profile, offset, limit: pageSize })));
    if (mine !== generation) return;
    const seen = new Set(read.map((item) => item.id));
    read = [...read, ...page.items.filter((item) => !seen.has(item.id))];
    position = offset + pageSize;
    total = page.total;
    publish({ profileTotals: page.profileTotals, unreadableProfiles: page.errors });
  }

  /** Reads on while the filters the screen applies leave too little to show and Hermes has more. */
  async function fill(): Promise<void> {
    const mine = generation;
    while (mine === generation && !disposed && position < total && selectSessions(read, view).length < FILL_TO) await readPage(position);
  }

  /** Which sessions are live, and the stats strip. Neither is worth an error of its own: the list reads without them. */
  async function readAround(): Promise<void> {
    const mine = generation;
    const scope = view.all ? {} : { profile };
    const grouped = view.group === 'project' && !view.all && connection.status.state === 'connected';
    const [active, stats, week, projects, tree] = await Promise.all([
      connection.status.state === 'connected' ? connection.client.request<SessionActiveListResult>('session.active_list', scope).catch(() => undefined) : undefined,
      view.all ? undefined : rest(`/api/sessions/stats?profile=${encodeURIComponent(profile)}`).catch(() => undefined),
      view.all || (usage !== undefined && now() - usage.at < USAGE_MAX_AGE_S) ? undefined : rest(`/api/analytics/usage?days=7&profile=${encodeURIComponent(profile)}`).catch(() => undefined),
      grouped ? connection.client.request('projects.list', { profile }).catch(() => undefined) : undefined,
      grouped ? connection.client.request('projects.tree', { profile }).catch(() => undefined) : undefined,
    ]);
    if (mine !== generation) return;
    if (week !== undefined) usage = { tokens: week, at: now() };
    publish({
      live: liveSessions(active),
      stats: view.all ? undefined : parseStats(stats, usage?.tokens),
      // A read that failed leaves what was last read: the groups do not empty because Hermes was busy for a moment.
      ...(grouped && projects !== undefined ? { projects: parseProjects(projects) } : {}),
      ...(grouped && tree !== undefined ? { projectOf: parseProjectTree(tree) } : {}),
    });
  }

  /** Reads the list from the top, to as far as it had been read (at least one page), and then what goes with it. Reads that are asked for meanwhile become one more. */
  function reload(): Promise<void> {
    if (loading) {
      again = true;
      return loading;
    }
    loading = (async () => {
      do {
        again = false;
        const mine = generation;
        const reach = Math.max(position, pageSize);
        try {
          const fresh: SessionItem[] = [];
          let offset = 0;
          let last: SessionPage | undefined;
          do {
            last = parseSessions(await rest(listPath(view, { profile, offset, limit: pageSize })));
            if (mine !== generation) break;
            const seen = new Set(fresh.map((item) => item.id));
            fresh.push(...last.items.filter((item) => !seen.has(item.id)));
            offset += pageSize;
          } while (offset < reach && offset < last.total);
          if (mine !== generation) continue;
          read = fresh;
          position = offset;
          total = last.total;
          publish({ loaded: true, error: undefined, profileTotals: last.profileTotals, unreadableProfiles: last.errors });
          await fill();
          await readAround();
        } catch (error) {
          if (mine === generation) publish({ error: messageOf(error) });
        }
      } while (again && !disposed);
    })().finally(() => {
      loading = undefined;
      if (!disposed) store.set({ refreshing: false });
    });
    return loading;
  }

  const refresh = () => {
    if (store.state.loaded) store.set({ refreshing: true });
    return reload();
  };

  const stops = [connection.client.on('sessions.changed', () => void refresh()), connection.onReady(() => void refresh())];
  void reload();

  return {
    get state() {
      return store.state;
    },
    subscribe: store.subscribe,
    until: store.until,
    refresh,
    async loadMore() {
      // A read in progress ends first, so that its pages and this one are not read twice.
      await loading;
      if (store.state.loadingMore || position >= total) return;
      store.set({ loadingMore: true });
      try {
        await readPage(position);
        await fill();
        publish({ loadingMore: false, error: undefined });
      } catch (error) {
        publish({ loadingMore: false, error: messageOf(error) });
      }
    },
    setView(next) {
      const before = listPath(view, { profile, offset: 0, limit: pageSize });
      const grouping = view.group;
      view = next;
      if (listPath(next, { profile, offset: 0, limit: pageSize }) === before) {
        publish();
        // The projects are read with the list, and only while it is grouped by them: switching to that reads them.
        if (next.group === 'project' && grouping !== 'project') void readAround().catch(() => undefined);
        void fill().then(() => publish());
        return;
      }
      generation++;
      read = [];
      position = 0;
      total = 0;
      publish({ loaded: false, hasMore: false, error: undefined, profileTotals: undefined, unreadableProfiles: [] });
      void reload();
    },
    markRead(id) {
      read = read.map((item) => (item.id === id && item.unread ? { ...item, unread: false } : item));
      publish();
    },
    dispose() {
      disposed = true;
      stops.forEach((stop) => stop());
    },
  };
}
