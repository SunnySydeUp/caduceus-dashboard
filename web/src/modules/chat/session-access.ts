// Whether Caduceus may continue a session it opens (M1 #16): no DOM and no React. Hermes has no lock to ask. A session that another process is
// writing to (the terminal, the messaging gateway) or that a Kanban worker owns is read, and never resumed: a second writer would interleave
// with the first. The facts are Hermes's own; the rule is Caduceus's, and it keeps nothing.

/** Hermes calls a session active when it has not ended and spoke in the last five minutes (`hermes_cli/web_routers/sessions.py`); the same window here. */
export const ACTIVE_WINDOW_S = 300;

export interface SessionFacts {
  /** Where it came from (`cli`, `telegram`, `kanban`, `caduceus`…). */
  source: string;
  /** Seconds since the epoch the session ended; null while it is open. */
  endedAt: number | null;
  /** Seconds since the epoch of its last message or activity. */
  lastActive: number;
}

export type ReadOnlyReason = 'kanban' | 'other-process';
export type Access = { mode: 'continue' } | { mode: 'read-only'; reason: ReadOnlyReason };

/** The sessions Caduceus itself makes: it is their only writer. */
const OWN_SOURCE = 'caduceus';

/** `live` says this Hermes runs the session now (the gateway's `session.active_list`): then it is Caduceus's to continue, whoever made it. */
export function accessOf({ source, endedAt, lastActive }: SessionFacts, { now, live }: { now: number; live: boolean }): Access {
  if (source === OWN_SOURCE || live) return { mode: 'continue' };
  if (source === 'kanban') return { mode: 'read-only', reason: 'kanban' };
  if (endedAt === null && now - lastActive < ACTIVE_WINDOW_S) return { mode: 'read-only', reason: 'other-process' };
  return { mode: 'continue' };
}

/** What the banner above a read-only session says. */
export function readOnlyNote(access: Extract<Access, { mode: 'read-only' }>): string {
  return access.reason === 'kanban'
    ? 'This is a Kanban worker’s session. It is read-only here so that nothing interrupts the worker.'
    : 'Another program (the terminal or a messaging gateway) is working in this session, so it is read-only here. It refreshes as that program writes.';
}

const seconds = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? value : undefined);

/** What `readAccess` reads Hermes through: its REST API, and the page's gateway client for the sessions this Hermes hosts. */
export interface AccessSources {
  rest(path: string): Promise<unknown>;
  client: { request<Result>(method: string, params: Record<string, unknown>): Promise<Result> };
}

/**
 * Asks Hermes the facts `accessOf` needs and applies the rule: the session's row (source, end, last activity), its newest message, and
 * whether this Hermes hosts it. Sessions Caduceus made are answered without asking for more than the row. The session's source comes with the answer.
 */
export async function readAccess({ rest, client }: AccessSources, { storedId, profile, now }: { storedId: string; profile: string; now: number }): Promise<{ access: Access; source: string }> {
  const id = encodeURIComponent(storedId);
  const scope = `profile=${encodeURIComponent(profile)}`;
  const row = (await rest(`/api/sessions/${id}?${scope}`)) as { source?: unknown; started_at?: unknown; ended_at?: unknown; last_activity_at?: unknown };
  const source = typeof row.source === 'string' ? row.source : '';
  if (source === OWN_SOURCE) return { access: { mode: 'continue' }, source };
  const newest = (await rest(`/api/sessions/${id}/messages?${scope}&order=latest&limit=1`).catch(() => undefined)) as { messages?: { timestamp?: unknown }[] } | undefined;
  const lastActive = Math.max(seconds(row.started_at) ?? 0, seconds(row.last_activity_at) ?? 0, seconds(newest?.messages?.at(-1)?.timestamp) ?? 0);
  const hosted = (await client.request<{ sessions?: { id?: unknown; session_key?: unknown }[] }>('session.active_list', { profile }).catch(() => undefined))?.sessions ?? [];
  const live = hosted.some((entry) => entry.session_key === storedId || entry.id === storedId);
  return { access: accessOf({ source, endedAt: seconds(row.ended_at) ?? null, lastActive }, { now, live }), source };
}
