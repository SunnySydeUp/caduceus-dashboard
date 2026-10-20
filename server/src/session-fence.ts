// The identity Hermes 0.22 wants on a session write.
//
// A rename, an archive, a pin, a read mark, a delete and an import are committed against the identity of the write (`request_id`, so that a retry is
// the same write) and the revision the session had when the caller looked (`expected_revision`, and `expected_generation` when it has one). A write that
// names none is refused with 409 `client_upgrade_required`, as one from an app that predates the fence. The page holds no revisions (it asks for a
// session's rows, not its counters), so Caduceus reads the counters from Hermes (`GET /api/sessions/{id}/mutation-snapshot`) as the write passes through
// and adds them: the owner's one-click change keeps working, and the revision is the one the session has at that moment.
import { randomUUID } from 'node:crypto';
import type { HermesBackend } from './hermes-backend.ts';

/** What Hermes says of a session's counters. An id it has no row for is revision 0 (the revision an import is written against). */
export interface Snapshot {
  exists: boolean;
  runtime_revision: number;
  runtime_generation: number | null;
}

/** The session a write is fenced against, and the profile whose store holds it (`undefined`: the one Hermes has current). */
export interface FencePlan {
  anchor: string;
  profile: string | undefined;
}

const SESSION_PATH = /^\/api\/sessions\/([^/]+)$/;
/** Routes that sit where a session id would, and are not one. */
const NOT_AN_ID: Record<string, true> = { import: true, 'bulk-delete': true, 'owner-backfill': true, empty: true, search: true };

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function parseBody(body: Uint8Array<ArrayBuffer> | undefined): Record<string, unknown> | undefined {
  if (body === undefined) return undefined;
  try {
    return record(JSON.parse(new TextDecoder().decode(body)));
  } catch {
    return undefined;
  }
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

/** Whether this write needs a fence and has none, and if so which session's counters it is fenced against. */
export function planFence(method: string, target: string, body: Uint8Array<ArrayBuffer> | undefined): FencePlan | undefined {
  const url = new URL(target, 'http://hermes');
  if (method === 'POST' && url.pathname === '/api/sessions/import') {
    const sent = parseBody(body);
    if (sent === undefined || (sent.request_id !== undefined && sent.expected_revision !== undefined)) return undefined;
    const first = Array.isArray(sent.sessions) ? record(sent.sessions[0]) : undefined;
    const anchor = text(first?.id);
    return anchor === undefined ? undefined : { anchor, profile: text(sent.profile) ?? text(url.searchParams.get('profile')) };
  }
  const matched = method === 'PATCH' || method === 'DELETE' ? SESSION_PATH.exec(url.pathname) : null;
  if (!matched) return undefined;
  const anchor = decodeURIComponent(matched[1]!);
  if (Object.hasOwn(NOT_AN_ID, anchor)) return undefined;
  if (method === 'DELETE') {
    if (url.searchParams.has('request_id') && url.searchParams.has('expected_revision')) return undefined;
    return { anchor, profile: text(url.searchParams.get('profile')) };
  }
  const sent = parseBody(body);
  if (sent === undefined || (sent.request_id !== undefined && sent.expected_revision !== undefined)) return undefined;
  return { anchor, profile: text(sent.profile) ?? text(url.searchParams.get('profile')) };
}

/** The write with the identity added: in the query for a delete, in the JSON body for the others. */
export function applyFence(method: string, target: string, body: Uint8Array<ArrayBuffer> | undefined, snapshot: Snapshot, requestId: string): { target: string; body: Uint8Array<ArrayBuffer> | undefined } {
  const identity: Record<string, string | number> = { request_id: requestId, expected_revision: snapshot.runtime_revision };
  if (snapshot.runtime_generation !== null) identity.expected_generation = snapshot.runtime_generation;
  if (method === 'DELETE') {
    const url = new URL(target, 'http://hermes');
    for (const [key, value] of Object.entries(identity)) url.searchParams.set(key, String(value));
    return { target: `${url.pathname}${url.search}`, body };
  }
  return { target, body: new TextEncoder().encode(JSON.stringify({ ...parseBody(body), ...identity })) };
}

/** What Hermes answers for the counters of a session in a store it has not created yet (browsing never creates one; the first write does). */
const STORE_NOT_CREATED = /^Session store is not initialized/;

/** The counters Hermes gives for the session a write is fenced against, or `undefined` when it gives none. */
async function readSnapshot(backend: HermesBackend, plan: FencePlan): Promise<Snapshot | undefined> {
  const query = plan.profile === undefined ? '' : `?${new URLSearchParams({ profile: plan.profile })}`;
  const answer = await backend.fetch(`/api/sessions/${encodeURIComponent(plan.anchor)}/mutation-snapshot${query}`).catch(() => undefined);
  if (answer === undefined) return undefined;
  const counters = record(await answer.json().catch(() => undefined));
  if (!answer.ok) {
    // A profile that has never held a session has no store yet: the session is not there, which is revision 0, the revision an import is written against.
    return answer.status === 503 && typeof counters?.detail === 'string' && STORE_NOT_CREATED.test(counters.detail) ? { exists: false, runtime_revision: 0, runtime_generation: null } : undefined;
  }
  if (typeof counters?.runtime_revision !== 'number') return undefined;
  return {
    exists: counters.exists === true,
    runtime_revision: counters.runtime_revision,
    runtime_generation: typeof counters.runtime_generation === 'number' ? counters.runtime_generation : null,
  };
}

/**
 * Hermes takes a store's session writes one at a time: while one is being committed to a store no gateway owns, a second is refused ("Exclusive
 * maintenance refused"). The page changes many sessions at once (pin ten chats), so the writes to one profile's store go through one at a time here.
 */
const queues = new WeakMap<HermesBackend, Map<string, Promise<unknown>>>();

function inTurn<T>(backend: HermesBackend, profile: string, run: () => Promise<T>): Promise<T> {
  let byProfile = queues.get(backend);
  if (byProfile === undefined) queues.set(backend, (byProfile = new Map()));
  const turn = (byProfile.get(profile) ?? Promise.resolve()).then(run);
  const tail = turn.catch(() => undefined);
  byProfile.set(profile, tail);
  void tail.then(() => {
    if (byProfile.get(profile) === tail) byProfile.delete(profile);
  });
  return turn;
}

/** Why Hermes refused a write with 409 when the counters it was made against had moved on (a turn ran, or another write landed, since they were read). */
async function movedOn(answer: Response): Promise<boolean> {
  const detail = record(await answer.clone().json().catch(() => undefined))?.detail;
  return detail === 'revision_conflict' || detail === 'stale_generation';
}

export interface SessionWriteInit {
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * Sends a write to Hermes, with the identity Hermes 0.22 wants added to a session write that has none: the counters are read from Hermes first, the
 * write goes in its profile's turn, and a write refused because the counters moved on is sent once more against fresh ones (the owner's change does
 * not depend on the revision; it was only a guard). Every other refusal is Hermes's to word: a session busy with a turn stays refused. Anything that
 * is not a session write passes as it is, and so does one whose counters Hermes will not give.
 */
export async function sendSessionWrite(backend: HermesBackend, method: string, target: string, body: Uint8Array<ArrayBuffer> | undefined, init: SessionWriteInit = {}): Promise<Response> {
  const send = (to: string, content: Uint8Array<ArrayBuffer> | undefined) => backend.fetch(to, { method, headers: init.headers, body: content, signal: init.signal });
  const plan = planFence(method, target, body);
  if (plan === undefined) return send(target, body);
  const attempt = async (): Promise<Response> => {
    const snapshot = await readSnapshot(backend, plan);
    if (snapshot === undefined) return send(target, body);
    const fenced = applyFence(method, target, body, snapshot, randomUUID());
    return send(fenced.target, fenced.body);
  };
  return inTurn(backend, plan.profile ?? '', async () => {
    const first = await attempt();
    if (first.status !== 409 || !(await movedOn(first))) return first;
    await first.body?.cancel();
    return attempt();
  });
}
