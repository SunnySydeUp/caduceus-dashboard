// Observe › Logs (M5 #06): the live tail, which is the relay's view of Hermes's `GET /api/logs` pushed to the browser as server-sent
// events (architecture §4, R12). Reading the log in the first place, and every filter, stay Hermes's: the browser's query is handed to
// Hermes as it is, and Caduceus only asks again and tells what is new. The one change is Truncate file, which Hermes cannot do: a Tier 3
// operation Caduceus performs itself (`CADUCEUS_OPERATIONS`), judged by the same policy as a Hermes route and audited.
import type { Hono } from 'hono';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { AuditLog } from './audit-log.ts';
import { authClient, type AuthEnv } from './auth-routes.ts';
import type { FileGuard } from './file-guard.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { readBody } from './hermes-proxy.ts';
import { findLogFile, truncateLogFile } from './log-files.ts';
import { createLogRelay, type LogAnswer, type LogQuery } from './log-relay.ts';
import { createRelayStreams } from './relay-stream.ts';
import type { RestPolicy } from './policy.ts';

/** Hermes answers 500 lines at most. */
const MAX_LINES = 500;
const DEFAULT_LINES = 200;
/** A value of a filter is a word or a search phrase, never a paragraph. */
const MAX_VALUE = 200;
/** The body of a truncate request names a file and a profile. */
const MAX_TRUNCATE_BODY = 1024;

export interface LogRoutesDeps {
  backend: HermesBackend;
  /** How long after an answer the live tail asks Hermes again. */
  pollMs: number;
  policy: RestPolicy;
  audit: AuditLog;
  files: FileGuard;
  /** The Hermes root home, whose profiles' `logs/` directories hold the files. */
  hermesRoot: string;
}

export interface LogRoutes {
  /** Ends the streams of a session that ended. */
  closeSession(sessionId: string): void;
  /** Ends every stream: the server is stopping. */
  closeAll(): void;
}

/** The view a stream request names, or `undefined` when it is not a view. Hermes judges the filters themselves (an unknown component is its 400). */
function queryOf(params: URLSearchParams): LogQuery | undefined {
  const text = (name: string): string | undefined => {
    const value = params.get(name)?.trim();
    return value ? value : undefined;
  };
  const lines = params.has('lines') ? Number(params.get('lines')) : DEFAULT_LINES;
  const values = [text('file'), text('level'), text('component'), text('search'), text('profile')];
  if (!Number.isInteger(lines) || lines < 1 || lines > MAX_LINES || values.some((value) => value !== undefined && value.length > MAX_VALUE)) return undefined;
  const [file, level, component, search, profile] = values;
  return { file: file ?? 'agent', lines, ...(level ? { level } : {}), ...(component ? { component } : {}), ...(search ? { search } : {}), ...(profile ? { profile } : {}) };
}

/** Asks Hermes for the last lines of a view, the way the log page of Hermes does. */
function hermesRead(backend: HermesBackend) {
  return async (query: LogQuery, signal: AbortSignal): Promise<LogAnswer> => {
    if (backend.status.state !== 'ready') return { ok: false, rejected: false, message: 'Hermes is not running.' };
    const params = new URLSearchParams({ file: query.file, lines: String(query.lines) });
    for (const name of ['level', 'component', 'search', 'profile'] as const) if (query[name]) params.set(name, query[name]);
    const res = await backend.fetch(`/api/logs?${params}`, { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) });
    const body: unknown = await res.json().catch(() => undefined);
    if (res.ok && isRecord(body) && Array.isArray(body.lines)) return { ok: true, lines: body.lines.map((line) => String(line).replace(/\r?\n$/, '')) };
    const detail = isRecord(body) && typeof body.detail === 'string' ? body.detail : `Hermes answered HTTP ${res.status}.`;
    // A 4xx is Hermes saying the view itself is wrong (an unknown file or component); asking again would only hear it again.
    return { ok: false, rejected: res.status >= 400 && res.status < 500, message: detail };
  };
}

export function mountLogRoutes(app: Hono<AuthEnv>, { backend, pollMs, policy, audit, files, hermesRoot }: LogRoutesDeps): LogRoutes {
  const relay = createLogRelay({ read: hermesRead(backend), intervalMs: pollMs });
  const streams = createRelayStreams();

  app.get('/_caduceus/api/logs/stream', (c) => {
    const query = queryOf(new URL(c.req.url).searchParams);
    if (!query) return c.json({ error: 'bad-request' }, 400);
    return streams.respond(c.get('session')!.id, (listener) => relay.subscribe(query, listener));
  });

  app.post('/_caduceus/api/logs/truncate', async (c) => {
    const url = new URL(c.req.url);
    const requester = { sessionId: c.get('session')?.id, source: authClient(c).source };
    const prepared = policy.prepare('POST', url.pathname, requester);
    if (!prepared.allow) return c.json(prepared.body, prepared.status);
    const raw = await readBody(c.req.raw, MAX_TRUNCATE_BODY);
    if (raw === 'too-large') return c.json({ error: 'bad-request' }, 400);
    let request: unknown;
    try {
      request = raw.length === 0 ? undefined : JSON.parse(Buffer.from(raw).toString('utf8'));
    } catch {
      request = undefined;
    }
    if (!isRecord(request) || typeof request.file !== 'string' || (request.profile !== undefined && typeof request.profile !== 'string')) return c.json({ error: 'bad-request' }, 400);
    // Which file is named is settled before the owner's confirmation is spent: a request for a file that is not there costs nothing.
    const found = findLogFile(hermesRoot, files, request.file, request.profile);
    if (!found.ok) return c.json({ error: found.reason }, found.reason === 'no-such-log' ? 404 : 400);
    const decision = await policy.decide(prepared, { method: 'POST', search: url.search, contentType: c.req.header('content-type'), confirmation: c.req.header('x-caduceus-confirmation'), body: raw }, requester);
    if (!decision.allow) return c.json(decision.body, decision.status);
    let bytes: number;
    try {
      bytes = truncateLogFile(found);
    } catch {
      return c.json({ error: 'no-such-log' }, 404);
    }
    audit.record({ actor: 'owner', action: 'logs.truncate', target: found.name, source: requester.source, tier: 'T3', profile: request.profile?.toLowerCase() ?? 'default' });
    return c.json({ truncated: true, file: request.file, bytes });
  });

  return streams;
}
