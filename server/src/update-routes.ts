// Updating Hermes and Caduceus (M5 #12; architecture §8). One operation at a time, and always in the same order:
//   draining   Caduceus takes no new turns (the page is told) and waits for the turns Hermes is working on to end, for a while.
//   updating   Hermes: its own `POST /api/hermes/update`, whose log is read back as it grows. Caduceus: a fast-forward pull, an install if the lockfile moved, a build.
//   restarting Hermes: the private backend starts afresh, so the new code runs (and the contract check runs again, and may turn read-only mode on). Caduceus:
//              clients are told it is stopping, and the process is asked to restart: the launchd service starts it again and the page's connection resumes.
//   verifying  Hermes: the update receipt (`GET /api/hermes/update/receipt`) is what says whether it worked, not the backend being up.
//   resuming   New turns are allowed again.
// The log of an operation is relayed to whoever watches, event by event (server-sent events, as the plugin installs do). What is kept is the What's New record
// of each update (Hermes's own receipt only holds the latest); the rest is in memory.
import type { Hono } from 'hono';
import { setTimeout as delay } from 'node:timers/promises';
import type { CompatibilityReport, UpdateCheck, UpdateCommit, UpdateEnd, UpdatePhase, UpdatesState, UpdateTarget, WhatsNewEntry } from '@caduceus/contracts/caduceus-api';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { AuditLog } from './audit-log.ts';
import { authClient, type AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import { contractDrift } from './contract-diff.ts';
import { waitForTurns, type Drain } from './drain.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { readBody } from './hermes-proxy.ts';
import type { RestPolicy } from './policy.ts';
import type { SelfUpdate } from './self-update.ts';
import { linesAfter } from './update-log.ts';

const MAX_BODY = 1024;
/** How often a quiet log says it is alive: a proxy between Caduceus and the browser drops a connection that is silent for long. */
const HEARTBEAT_MS = 20_000;
/** The lines of one log that are kept, and the longest one. */
const MAX_LINES = 5000;
const MAX_LINE = 2000;
/** How many lines of Hermes's update log one read asks for (the most Hermes gives). */
const LOG_WINDOW = 2000;
/** How long Caduceus waits for Hermes's update to end before it stops waiting. */
const UPDATE_TIMEOUT_MS = 30 * 60_000;
/** How many failed reads of Hermes's log in a row (Hermes is restarting itself) before Caduceus goes on to check the receipt. */
const LOST_READS = 120;
/** The updates that are remembered for What's New. */
const KEEP_HISTORY = 20;
const HISTORY_KEY = 'update-history';

/** Credentials in an address are never kept or shown. */
const withoutCredentials = (text: string): string => text.replace(/([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^\s/@]+@/g, '$1');

type Event = { kind: 'line'; text: string } | { kind: 'phase'; phase: UpdatePhase } | { kind: 'end'; end: UpdateEnd };

interface Operation {
  id: string;
  target: UpdateTarget;
  phase: UpdatePhase;
  startedAt: number;
  lines: string[];
  partial: string;
  end?: UpdateEnd;
  listeners: Set<(event: Event) => void>;
}

export interface UpdateRoutesDeps {
  backend: HermesBackend;
  policy: RestPolicy;
  audit: AuditLog;
  store: CaduceusStore;
  now: () => number;
  drain: Drain;
  /** The compatibility of the running Hermes with the pinned contracts, once its check is done: asked after an update, since every launch is checked anew. */
  compatibility(): Promise<CompatibilityReport>;
  /** Caduceus's own deployment; without it Caduceus cannot update itself. */
  selfUpdate?: SelfUpdate;
  /** Ends every connection of the page and asks the process to restart; without it Caduceus cannot restart itself, so it cannot update itself either. */
  restart?: () => Promise<void> | void;
  /** How often Hermes's log, and the turns still working, are asked about. */
  pollMs: number;
  /** How long a drain waits for working turns before it goes on (they are interrupted when Hermes restarts). */
  drainTimeoutMs: number;
}

export interface UpdateRoutes {
  closeSession(sessionId: string): void;
  closeAll(): void;
}

/** What the changes Hermes lists for an update look like: a commit with its summary. */
function commitsIn(value: unknown): UpdateCommit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => (isRecord(row) && typeof row.summary === 'string' ? [{ sha: typeof row.sha === 'string' ? row.sha.slice(0, 12) : '', summary: row.summary, ...(typeof row.author === 'string' ? { author: row.author } : {}), ...(typeof row.at === 'string' ? { at: row.at } : {}) }] : []));
}

export function mountUpdateRoutes(app: Hono<AuthEnv>, deps: UpdateRoutesDeps): UpdateRoutes {
  const { backend, policy, audit, store, now, drain, selfUpdate } = deps;
  const operations: Operation[] = [];
  const open = new Set<{ sessionId: string; close(): void }>();

  const readHistory = (): WhatsNewEntry[] => {
    const row = store.db.prepare('SELECT value FROM settings WHERE key = ?').get(HISTORY_KEY) as { value: string } | undefined;
    try {
      const parsed: unknown = row ? JSON.parse(row.value) : [];
      return Array.isArray(parsed) ? (parsed as WhatsNewEntry[]) : [];
    } catch {
      return [];
    }
  };
  const remember = (entry: WhatsNewEntry) => {
    const value = JSON.stringify([entry, ...readHistory()].slice(0, KEEP_HISTORY));
    store.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(HISTORY_KEY, value);
  };

  const emit = (operation: Operation, event: Event) => {
    for (const listener of operation.listeners) listener(event);
  };
  const addLine = (operation: Operation, text: string) => {
    const line = withoutCredentials(backend.redact(text)).slice(0, MAX_LINE);
    if (operation.lines.length >= MAX_LINES) return;
    operation.lines.push(line);
    emit(operation, { kind: 'line', text: line });
  };
  /** Output that arrives in pieces, as a command prints it: lines are told when they end. */
  const heard = (operation: Operation, text: string) => {
    const pieces = (operation.partial + text).split(/\r\n|\n|\r/);
    operation.partial = pieces.pop() ?? '';
    for (const piece of pieces) addLine(operation, piece);
  };
  const setPhase = (operation: Operation, phase: UpdatePhase) => {
    operation.phase = phase;
    emit(operation, { kind: 'phase', phase });
  };

  const hermesJson = async (route: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> } | undefined> => {
    try {
      const res = await backend.fetch(route, init);
      const body: unknown = await res.json().catch(() => ({}));
      return { status: res.status, body: isRecord(body) ? body : {} };
    } catch {
      return undefined;
    }
  };

  const hermesUpdate = async (operation: Operation): Promise<WhatsNewEntry> => {
    const entry = (ok: boolean, message: string, extra: Partial<WhatsNewEntry> = {}): WhatsNewEntry => ({ id: operation.id, target: 'hermes', at: now(), ok, message, fromVersion: null, toVersion: null, changes: [], ...extra });
    // What the update will bring, as Hermes lists it now: once it has run, only its receipt remains, and that does not list the commits.
    const before = (await hermesJson('/api/hermes/update/check'))?.body;
    const fromVersion = typeof before?.current_version === 'string' ? before.current_version : null;
    const changes = commitsIn(before?.commits);
    const logWindow = async () => {
      const answer = await hermesJson(`/api/actions/hermes-update/status?lines=${LOG_WINDOW}`);
      return answer?.status === 200 ? answer.body : undefined;
    };
    // What the log said before this update began is not this update's.
    const window = (status: Record<string, unknown> | undefined): string[] => (Array.isArray(status?.lines) ? status.lines.map(String) : []);
    let shown = window(await logWindow());

    setPhase(operation, 'updating');
    const started = await hermesJson('/api/hermes/update', { method: 'POST' });
    if (!started || started.status !== 200) return entry(false, 'Hermes did not start the update.', { fromVersion });
    if (started.body.ok === false) {
      const why = typeof started.body.message === 'string' ? started.body.message : 'Hermes refused to update itself.';
      addLine(operation, why);
      return entry(false, why, { fromVersion });
    }

    const began = performance.now();
    let exitCode: number | null = null;
    let lost = 0;
    for (;;) {
      const status = await logWindow();
      if (status) {
        lost = 0;
        const lines = window(status);
        for (const line of linesAfter(shown, lines)) addLine(operation, line);
        shown = lines;
        if (status.running === false) {
          exitCode = typeof status.exit_code === 'number' ? status.exit_code : null;
          break;
        }
      } else if (++lost >= LOST_READS) break;
      if (performance.now() - began >= UPDATE_TIMEOUT_MS) return entry(false, 'Hermes was still updating after 30 minutes, so Caduceus stopped waiting. Check the Hermes log.', { fromVersion, changes });
      await delay(deps.pollMs);
    }
    if (exitCode !== null && exitCode !== 0) return entry(false, `Hermes's update failed (exit code ${exitCode}). Hermes was not restarted.`, { fromVersion, changes });

    setPhase(operation, 'restarting');
    addLine(operation, 'Restarting the Hermes backend so the new code runs.');
    try {
      await backend.restart();
    } catch {
      return entry(false, 'The update ran, but the Hermes backend could not be restarted.', { fromVersion, changes });
    }

    setPhase(operation, 'verifying');
    const receipt = await hermesJson('/api/hermes/update/receipt');
    const record = receipt?.status === 200 && isRecord(receipt.body.receipt) ? receipt.body.receipt : undefined;
    const outcome = record && typeof record.outcome === 'string' ? record.outcome : undefined;
    const post = record && isRecord(record.post_update) ? record.post_update : undefined;
    const toVersion = post && typeof post.version === 'string' ? post.version : null;
    // Every launch is checked against the pinned contracts: after an update, a Hermes that no longer matches has turned read-only mode on by now.
    const compatibility = await deps.compatibility();
    const drifted = compatibility.state === 'incompatible' && contractDrift(compatibility).length > 0;
    const drift = drifted ? ' Hermes no longer matches what Caduceus was built for, so Caduceus is in read-only mode until that is dealt with.' : '';
    if (!record) return entry(false, `Hermes did not record a receipt for the update, so Caduceus cannot tell whether it worked.${drift}`, { fromVersion, changes });
    if (outcome !== 'success') return entry(false, `Hermes's receipt says the update ${outcome === 'partial' ? 'only partly finished' : 'did not succeed'} (${outcome ?? 'no outcome'}).${drift}`, { fromVersion, toVersion, changes });
    addLine(operation, `Hermes's receipt says the update succeeded${toVersion ? ` (now ${toVersion})` : ''}.`);
    return entry(true, `Hermes is updated${toVersion ? ` to ${toVersion}` : ''}.${drift}`, { fromVersion, toVersion, changes });
  };

  const caduceusUpdate = async (operation: Operation): Promise<WhatsNewEntry> => {
    setPhase(operation, 'updating');
    const result = await selfUpdate!.update((text) => heard(operation, text));
    return { id: operation.id, target: 'caduceus', at: now(), ok: result.ok, message: result.message, fromVersion: result.fromVersion, toVersion: result.toVersion, changes: result.changes };
  };

  const run = async (operation: Operation) => {
    let restarting = false;
    let result: WhatsNewEntry;
    try {
      setPhase(operation, 'draining');
      drain.begin(operation.target === 'hermes' ? 'Hermes is being updated.' : 'Caduceus is being updated.');
      await waitForTurns(backend, { pollMs: deps.pollMs, timeoutMs: deps.drainTimeoutMs, say: (line) => addLine(operation, line) });
      result = operation.target === 'hermes' ? await hermesUpdate(operation) : await caduceusUpdate(operation);
      restarting = operation.target === 'caduceus' && result.ok;
    } catch {
      result = { id: operation.id, target: operation.target, at: now(), ok: false, message: 'The update stopped because Caduceus hit an error it did not expect.', fromVersion: null, toVersion: null, changes: [] };
    }
    if (operation.partial !== '') addLine(operation, operation.partial);
    operation.partial = '';
    if (!restarting) {
      // The step the owner sees under way when it failed stays the one that failed: a failed update still lets turns start again, quietly.
      if (result.ok) setPhase(operation, 'resuming');
      drain.end();
    }
    remember(result);
    operation.end = { ok: result.ok, message: result.message };
    emit(operation, { kind: 'end', end: operation.end });
    // Caduceus's own update replaces the code that is running: the page's connections are ended and the process restarts, still draining, so no turn starts in between.
    if (restarting) await Promise.resolve(deps.restart?.()).catch(() => undefined);
  };

  app.get('/_caduceus/api/updates', (c) => {
    const last = operations.at(-1);
    const state: UpdatesState = {
      drain: drain.state,
      operation: last ? { id: last.id, target: last.target, phase: last.phase, startedAt: last.startedAt, ...(last.end ? { end: last.end } : {}) } : null,
      history: readHistory(),
      restartable: deps.restart !== undefined && selfUpdate !== undefined,
    };
    return c.json(state);
  });

  app.get('/_caduceus/api/updates/caduceus', async (c) => {
    if (!selfUpdate) {
      const none: UpdateCheck = { current_version: 'unknown', behind: null, update_available: false, can_apply: false, message: 'This Caduceus is not set up to update itself.' };
      return c.json(none);
    }
    const check = await selfUpdate.check(c.req.query('force') === '1');
    return c.json(deps.restart ? check : { ...check, can_apply: false, message: check.message ?? 'Caduceus is not running as a background service here, so it cannot restart itself after an update.' });
  });

  app.post('/_caduceus/api/updates/operations', async (c) => {
    const url = new URL(c.req.url);
    const requester = { sessionId: c.get('session')?.id, source: authClient(c).source };
    const prepared = policy.prepare('POST', url.pathname, requester);
    if (!prepared.allow) return c.json(prepared.body, prepared.status);
    const raw = await readBody(c.req.raw, MAX_BODY);
    if (raw === 'too-large') return c.json({ error: 'bad-request' }, 400);
    let request: unknown;
    try {
      request = raw.length === 0 ? undefined : JSON.parse(Buffer.from(raw).toString('utf8'));
    } catch {
      request = undefined;
    }
    if (!isRecord(request) || Object.keys(request).some((key) => key !== 'target') || (request.target !== 'hermes' && request.target !== 'caduceus')) return c.json({ error: 'bad-request', field: 'target' }, 400);
    const decision = await policy.decide(prepared, { method: 'POST', search: url.search, contentType: c.req.header('content-type'), confirmation: c.req.header('x-caduceus-confirmation'), body: raw }, requester);
    if (!decision.allow) return c.json(decision.body, decision.status);
    const target: UpdateTarget = request.target;
    if (operations.some((other) => !other.end)) return c.json({ error: 'busy', message: 'An update is already running. Wait for it to finish.' }, 409);
    if (target === 'hermes' && backend.status.state !== 'ready') return c.json(backend.status, 503);
    if (target === 'caduceus' && (!selfUpdate || !deps.restart)) return c.json({ error: 'unavailable', message: 'Caduceus cannot restart itself here (it is not running as the background service), so it cannot update itself.' }, 409);
    if (drain.active()) return c.json({ error: 'busy', message: 'Caduceus is already draining for another change. Wait for it to finish.' }, 409);

    const operation: Operation = { id: crypto.randomUUID(), target, phase: 'draining', startedAt: now(), lines: [], partial: '', listeners: new Set() };
    operations.push(operation);
    operations.splice(0, Math.max(0, operations.length - 10));
    audit.record({ actor: 'owner', action: `update.${target}`, target, source: requester.source, tier: 'T2' });
    void run(operation);
    return c.json({ id: operation.id }, 202);
  });

  app.get('/_caduceus/api/updates/operations/:id/stream', (c) => {
    const operation = operations.find((other) => other.id === c.req.param('id'));
    if (!operation) return c.json({ error: 'not-found' }, 404);
    const encoder = new TextEncoder();
    let live = true;
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(started) {
        controller = started;
      },
      cancel: () => void leave(),
    });
    const send = (event: string, data: unknown) => {
      if (live) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
    };
    const listener = (event: Event) => {
      if (event.kind === 'line') send('line', { text: event.text });
      else if (event.kind === 'phase') send('phase', { phase: event.phase });
      else {
        send('end', event.end);
        connection.close();
      }
    };
    const heartbeat = setInterval(() => send('ping', {}), HEARTBEAT_MS);
    const leave = () => {
      if (!live) return false;
      live = false;
      clearInterval(heartbeat);
      operation.listeners.delete(listener);
      open.delete(connection);
      return true;
    };
    const connection = {
      sessionId: c.get('session')!.id,
      close() {
        if (leave()) controller.close();
      },
    };
    open.add(connection);
    // What happened before this tab came is replayed first, then the listener hears the rest: no await in between, so no event is missed or heard twice.
    send('phase', { phase: operation.phase });
    for (const text of operation.lines) send('line', { text });
    if (operation.end) {
      send('end', operation.end);
      connection.close();
    } else operation.listeners.add(listener);
    return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no', connection: 'close' } });
  });

  return {
    closeSession(sessionId) {
      for (const connection of open) if (connection.sessionId === sessionId) connection.close();
    },
    closeAll() {
      for (const connection of open) connection.close();
    },
  };
}
