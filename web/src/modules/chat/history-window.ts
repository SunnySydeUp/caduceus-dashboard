// The part of a transcript the page has loaded (M1 #04): pure. Hermes's REST history is paged (`/messages`, newest page first;
// `/messages/around`, a page that starts at a prompt), the page keeps a window of it and loads earlier or later rows on demand.
// Nothing here is kept beyond what the page is showing; Hermes is the source of truth.

/** How many rows one request asks for (Hermes allows 500; `/messages/around` 120). */
export const PAGE_SIZE = 100;
const AROUND_SIZE = 120;

/** A row of Hermes's `/messages` pages, as far as the transcript reads it. */
export interface HistoryRow {
  id: number;
  role: string;
  content?: unknown;
  display_kind?: unknown;
  [field: string]: unknown;
}

/** The body of `/messages` and `/messages/around`. */
export interface HistoryBody {
  messages: HistoryRow[];
  pagination: { limit?: number; offset?: number; order?: string; returned?: number; total?: number; has_older?: boolean; has_newer?: boolean; row_id?: number };
}

/** The loaded rows, oldest first, and what lies beyond them. Every row Hermes sent is kept (tool rows too): their count is the position for the next request. */
export interface HistoryWindow {
  rows: HistoryRow[];
  hasOlder: boolean;
  hasNewer: boolean;
  /** Position of `rows[0]` among Hermes's display rows, when the window came from `/messages/around`; undefined for a window that ends at the newest row. */
  start: number | undefined;
}

const query = (profile: string | undefined, parts: Record<string, string | number>) =>
  new URLSearchParams({ ...(profile === undefined ? {} : { profile }), ...Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, String(value)])) }).toString();

/** The newest page. */
export const latestUrl = (storedId: string, profile: string | undefined) => `/api/sessions/${encodeURIComponent(storedId)}/messages?${query(profile, { order: 'latest', limit: PAGE_SIZE })}`;

/** The page that starts at prompt `rowId`. */
export const aroundUrl = (storedId: string, profile: string | undefined, rowId: number) => `/api/sessions/${encodeURIComponent(storedId)}/messages/around?${query(profile, { row_id: rowId, limit: AROUND_SIZE })}`;

/** The rows before the window: counted from the newest row for a window that ends there, from the start for one that came from an `around`. */
export function olderUrl(storedId: string, profile: string | undefined, window: HistoryWindow): string {
  const base = `/api/sessions/${encodeURIComponent(storedId)}/messages?`;
  if (window.start === undefined) return base + query(profile, { order: 'latest', limit: PAGE_SIZE, offset: window.rows.length });
  const limit = Math.min(PAGE_SIZE, window.start);
  return base + query(profile, { include_compacted: 'true', order: 'oldest', limit, offset: window.start - limit });
}

/** The rows after a window that came from an `around`. */
export const newerUrl = (storedId: string, profile: string | undefined, window: HistoryWindow) =>
  `/api/sessions/${encodeURIComponent(storedId)}/messages?${query(profile, { include_compacted: 'true', order: 'oldest', limit: PAGE_SIZE, offset: (window.start ?? 0) + window.rows.length })}`;

/** The window a newest page makes. A page that is not full is the whole transcript. */
export function fromLatest(body: HistoryBody): HistoryWindow {
  return { rows: body.messages, hasOlder: body.messages.length >= PAGE_SIZE, hasNewer: false, start: undefined };
}

/** The window an `around` page makes. */
export function fromAround(body: HistoryBody): HistoryWindow {
  const { offset = 0, has_older: hasOlder = offset > 0, has_newer: hasNewer = false } = body.pagination;
  return { rows: body.messages, hasOlder, hasNewer, start: offset };
}

/** The window with the page before it added. Rows it already holds are not added twice. */
export function withOlder(window: HistoryWindow, body: HistoryBody): HistoryWindow {
  const first = window.rows[0]?.id ?? Infinity;
  const added = body.messages.filter((row) => row.id < first);
  const start = window.start === undefined ? undefined : Math.max(0, window.start - added.length);
  return { ...window, rows: [...added, ...window.rows], start, hasOlder: start === undefined ? body.messages.length >= PAGE_SIZE : start > 0 };
}

/** The window with the page after it added; a page that is not full means the window now ends at the newest row. */
export function withNewer(window: HistoryWindow, body: HistoryBody): HistoryWindow {
  const last = window.rows.at(-1)?.id ?? -Infinity;
  return { ...window, rows: [...window.rows, ...body.messages.filter((row) => row.id > last)], hasNewer: body.messages.length >= PAGE_SIZE };
}

/** The newest page read again (a turn finished): it replaces the window's newest rows and leaves the older ones it already loaded. */
export function mergeLatest(window: HistoryWindow, body: HistoryBody): HistoryWindow {
  const first = body.messages[0]?.id;
  if (first === undefined) return window;
  return { ...window, rows: [...window.rows.filter((row) => row.id < first), ...body.messages], hasNewer: false };
}
