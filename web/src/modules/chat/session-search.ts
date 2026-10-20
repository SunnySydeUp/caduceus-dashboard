// Session search (M1 #15): no DOM and no React. The search is Hermes's own (`GET /api/sessions/search`, its FTS5 index over message bodies and
// session ids); Caduceus keeps no index and no copy of any text. A hit says which session matched and a snippet Hermes cut around the words;
// `locateHit` finds the first message of that session that holds them, so the chat opens there.
import { activityLabel, sourceLabel } from './sessions-model.ts';

/** A run of a snippet: the words the query matched are marked. */
export interface SnippetPart {
  text: string;
  match: boolean;
}

export interface SearchHit {
  /** The session to open (the newest of a compressed lineage: Hermes answers with the one that carries on). */
  sessionId: string;
  title: string;
  profile: string;
  source: string | undefined;
  /** Whose words matched: absent for a hit on the session's id. */
  role: string | undefined;
  /** When the session last spoke, or started, in seconds since the epoch. */
  at: number | undefined;
  snippet: SnippetPart[];
}

/** How many hits one search asks for (Hermes allows 100). */
export const SEARCH_LIMIT = 30;

/** Hermes's FTS snippet marks the matched words `>>>word<<<`. */
export function snippetParts(snippet: string): SnippetPart[] {
  const parts: SnippetPart[] = [];
  let rest = snippet;
  while (rest !== '') {
    const open = rest.indexOf('>>>');
    const close = open < 0 ? -1 : rest.indexOf('<<<', open + 3);
    if (open < 0 || close < 0) {
      parts.push({ text: rest, match: false });
      break;
    }
    if (open > 0) parts.push({ text: rest.slice(0, open), match: false });
    parts.push({ text: rest.slice(open + 3, close), match: true });
    rest = rest.slice(close + 3);
  }
  return parts;
}

/** The address that opens a hit: the session, with the query it was found by (the chat jumps to the first message that matches, and the sessions list keeps the search). */
export const hitPath = (hit: SearchHit, query: string) => `/chat/${encodeURIComponent(hit.sessionId)}?${new URLSearchParams({ q: query.trim(), find: query.trim() })}`;

/** What a hit says about where it is from and when, apart from its profile: `Telegram · Yesterday`. */
export const hitDetail = (hit: SearchHit, now: number) => [hit.source === undefined ? undefined : sourceLabel(hit.source), hit.at === undefined ? undefined : activityLabel(hit.at, { now })].filter((part) => part !== undefined).join(' · ');

/** The path of a search in `profile`'s sessions. */
export const searchPath = (query: string, profile: string, limit = SEARCH_LIMIT) => `/api/sessions/search?${new URLSearchParams({ q: query, limit: String(limit), profile })}`;

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);
const seconds = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** Hermes's answer as hits, the ones it could not describe left out. */
export function parseHits(body: unknown): SearchHit[] {
  const results = (body as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((raw: Record<string, unknown>): SearchHit[] => {
    const sessionId = text(raw.session_id) ?? text(raw.id);
    if (sessionId === undefined) return [];
    const preview = text(raw.preview);
    return [
      {
        sessionId,
        title: text(raw.title) ?? preview?.replace(/\s+/g, ' ').slice(0, 80) ?? 'Untitled chat',
        profile: text(raw.profile) ?? 'default',
        source: text(raw.source),
        role: text(raw.role),
        at: seconds(raw.last_active) ?? seconds(raw.started_at) ?? seconds(raw.session_started),
        snippet: snippetParts(text(raw.snippet) ?? preview ?? ''),
      },
    ];
  });
}

/** Searches the message bodies and ids of `profile`'s sessions. A blank query finds nothing and asks Hermes nothing. */
export async function searchSessions(rest: (path: string) => Promise<unknown>, query: string, options: { profile: string; limit?: number }): Promise<SearchHit[]> {
  if (query.trim() === '') return [];
  return parseHits(await rest(searchPath(query.trim(), options.profile, options.limit)));
}

// ── From a hit to the message ───────────────────────────────────────────────────────────────

/** The words a query asks for: quotes, `*` and the FTS operators are not words. */
export function queryTerms(query: string): string[] {
  return [...query.matchAll(/"([^"]*)"|(\S+)/g)]
    .flatMap((match) => (match[1] !== undefined ? [match[1]] : [match[2]!.replace(/\*+$/, '')]))
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term !== '' && !['and', 'or', 'not'].includes(term));
}

/** What a stored row says, as text (Hermes stores a message as text or as parts). */
function rowText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.map((part: unknown) => (typeof part === 'string' ? part : typeof (part as { text?: unknown } | null)?.text === 'string' ? (part as { text: string }).text : '')).join('\n');
}

/** Where a hit is in its session: the first message that holds the query, and the prompt whose page (messages-around) has it. */
export interface HitSpot {
  /** Hermes's row id of the first message that matches. */
  message: number;
  /** The row id of the owner's prompt that the matching message answers, or is: the page opens at it. */
  prompt: number;
}

/** Rows read at once while looking for the first match (Hermes allows 500), and how many reads are made before the search for it is given up (20,000 rows). */
const SCAN_PAGE = 500;
const SCAN_PAGES = 40;

interface Row {
  id: number;
  role: string;
  content?: unknown;
}

/**
 * Finds the first message of `sessionId` that holds the query's words, reading Hermes's history oldest first a page at a time (never the
 * whole of it: the scan stops at the first match), then the timeline of prompts to find the one the message belongs to. Undefined when
 * the transcript has no such message (the hit was on the session's id, or on words Hermes keeps beside the message).
 */
export async function locateHit(rest: (path: string) => Promise<unknown>, options: { sessionId: string; profile: string; query: string }): Promise<HitSpot | undefined> {
  const terms = queryTerms(options.query);
  if (terms.length === 0) return undefined;
  const id = encodeURIComponent(options.sessionId);
  const holds = (row: Row, need: (term: string, text: string) => boolean) => {
    const text = rowText(row.content).toLowerCase();
    return text !== '' && terms.every((term) => need(term, text));
  };
  let message: number | undefined;
  for (let page = 0; page < SCAN_PAGES && message === undefined; page++) {
    const query = new URLSearchParams({ profile: options.profile, include_compacted: 'true', order: 'oldest', limit: String(SCAN_PAGE), offset: String(page * SCAN_PAGE) });
    const { messages = [] } = (await rest(`/api/sessions/${id}/messages?${query}`)) as { messages?: Row[] };
    message = messages.find((row) => holds(row, (term, text) => text.includes(term)))?.id;
    if (messages.length < SCAN_PAGE) break;
  }
  if (message === undefined) return undefined;
  // The last prompt at or before the message (row ids grow with the transcript).
  let prompt: number | undefined;
  for (let after = 0; ; ) {
    const query = new URLSearchParams({ profile: options.profile, limit: '500', after_row_id: String(after) });
    const body = (await rest(`/api/sessions/${id}/timeline?${query}`)) as { entries?: { row_id: number }[]; pagination?: { next_cursor?: number | null } };
    const entries = body.entries ?? [];
    const before = entries.filter((entry) => entry.row_id <= message!);
    prompt = before.at(-1)?.row_id ?? prompt ?? (after === 0 ? entries[0]?.row_id : undefined);
    const next = body.pagination?.next_cursor;
    if (before.length < entries.length || next === null || next === undefined) break;
    after = next;
  }
  return prompt === undefined ? undefined : { message, prompt };
}
