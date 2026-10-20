// The Inbox (M2; work-model §2.5): everything that waits on the owner or concerns them, as one list that is derived from Hermes's state and never
// stored. The sources (`inbox-requests.ts`, `inbox-cron.ts`, `inbox-pairing.ts`, `inbox-system.ts`, and the later ones that add to it) each know
// their own items; this joins them, keeps the order, applies what the asking device has put aside, and serves the result for that device:
// `GET /_caduceus/api/inbox`, its server-sent stream, the owner's decision on an item, and the device's snoozes, dismissals and activity cursor.
import type { Hono } from 'hono';
import type { LiveRun, InboxDecision, InboxHide, InboxState } from '@caduceus/contracts/inbox';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { authClient, type AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import { deviceOf } from './device-preferences.ts';
import { readBody } from './hermes-proxy.ts';
import type { ActivityFeed } from './inbox-activity.ts';
import { applyHidden, type HiddenRow } from './inbox-hidden.ts';
import type { LiveRequests } from './inbox-requests.ts';
import type { InboxSource } from './inbox-source.ts';
import type { RestPolicy } from './policy.ts';

const HEARTBEAT_MS = 25_000;
const MAX_BODY = 16 * 1024;
/** How long what a device put aside is kept after it was put aside: a dismissal of a state that has not come back for a month is a dismissal nobody needs. */
const KEEP_HIDDEN_MS = 30 * 24 * 3600_000;

export interface Inbox {
  /** What `device`'s Inbox is now. */
  state(device: string): InboxState;
  /** Puts an item aside on a device: a snooze (`until`) or a dismissal. */
  hide(device: string, hide: InboxHide): void;
  /** Brings an item back on a device. */
  unhide(device: string, ref: string): void;
  /** Says a device has seen the activity feed up to `seq`. */
  seen(device: string, seq: number): void;
  subscribe(listener: () => void): () => void;
  close(): void;
}

export interface InboxDeps {
  sources: readonly InboxSource[];
  activity: ActivityFeed;
  /** The chat runs Hermes is working on (Work's running rows and the crew's states), which are part of what every device is told. */
  runs(): LiveRun[];
  store: CaduceusStore;
  now: () => number;
  /** Whether Caduceus can reach Hermes. */
  live(): boolean;
}

/** Joins the sources into one list, newest first, for each device. */
export function createInbox({ sources, activity, runs, store, now, live }: InboxDeps): Inbox {
  const { db } = store;
  const listeners = new Set<() => void>();
  const changed = () => {
    for (const listener of [...listeners]) listener();
  };
  const stops = [...sources.map((source) => source.subscribe(changed)), activity.subscribe(changed)];
  // A snooze ends by itself, with no change in Hermes to say so: the devices are told when it does.
  let wake: NodeJS.Timeout | undefined;
  const planWake = () => {
    clearTimeout(wake);
    const next = db.prepare('SELECT MIN(until) AS until FROM inbox_hidden WHERE until IS NOT NULL AND until > ?').get(now()) as { until: number | null };
    if (next.until === null) return;
    wake = setTimeout(() => {
      changed();
      planWake();
    }, Math.min(next.until - now() + 50, 2 ** 31 - 1));
    wake.unref();
  };
  planWake();

  return {
    state(device) {
      const all = sources.flatMap((source) => source.items()).toSorted((a, b) => b.at - a.at);
      const rows = db.prepare('SELECT ref, stamp, until FROM inbox_hidden WHERE device_id = ?').all(device) as unknown as HiddenRow[];
      const { shown, snoozed } = applyHidden(all, rows, now());
      const seen = (db.prepare('SELECT seen FROM activity_cursors WHERE device_id = ?').get(device) as { seen: number } | undefined)?.seen ?? 0;
      const events = activity.events();
      return {
        items: shown,
        needsDecision: shown.filter((item) => item.group === 'decision').length,
        snoozed: snoozed.toSorted((a, b) => a.until - b.until),
        activity: events,
        unseen: events.filter((event) => event.seq > seen).length,
        running: runs(),
        live: live(),
      };
    },
    hide(device, { ref, stamp, until }) {
      db.prepare('INSERT INTO inbox_hidden (device_id, ref, stamp, until, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (device_id, ref) DO UPDATE SET stamp = excluded.stamp, until = excluded.until, at = excluded.at').run(device, ref, stamp, until ?? null, now());
      db.prepare('DELETE FROM inbox_hidden WHERE at < ?').run(now() - KEEP_HIDDEN_MS);
      planWake();
      changed();
    },
    unhide(device, ref) {
      db.prepare('DELETE FROM inbox_hidden WHERE device_id = ? AND ref = ?').run(device, ref);
      changed();
    },
    seen(device, seq) {
      db.prepare('INSERT INTO activity_cursors (device_id, seen) VALUES (?, ?) ON CONFLICT (device_id) DO UPDATE SET seen = MAX(seen, excluded.seen)').run(device, seq);
      changed();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close() {
      clearTimeout(wake);
      for (const stop of stops) stop();
      listeners.clear();
    },
  };
}

export interface InboxRoutesDeps {
  inbox: Inbox;
  requests: LiveRequests;
  policy: RestPolicy;
}

export interface InboxRoutes {
  closeSession(sessionId: string): void;
  closeAll(): void;
  /** Tells every open stream to say the list again (the connection to Hermes went up or down). */
  announce(): void;
}

export function mountInbox(app: Hono<AuthEnv>, { inbox, requests, policy }: InboxRoutesDeps): InboxRoutes {
  const open = new Set<{ sessionId: string; close(): void; send(): void }>();

  app.get('/_caduceus/api/inbox', (c) => c.json(inbox.state(deviceOf(c))));

  app.get('/_caduceus/api/inbox/stream', (c) => {
    const device = deviceOf(c);
    const encoder = new TextEncoder();
    let live = true;
    let leave = () => {};
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const finish = () => {
      if (!live) return false;
      live = false;
      clearInterval(heartbeat);
      leave();
      open.delete(connection);
      return true;
    };
    // A plain stream, not Hono's `streamSSE`: a write to a client that has just gone away must not hold the response open.
    const body = new ReadableStream<Uint8Array>({
      start(started) {
        controller = started;
      },
      cancel: () => void finish(),
    });
    const write = (text: string) => {
      if (live) controller.enqueue(encoder.encode(text));
    };
    const heartbeat = setInterval(() => write('event: ping\ndata: {}\n\n'), HEARTBEAT_MS);
    // The whole state is said on every change: it is small, and a page that reconnects is then right without having to know what it missed.
    const connection = {
      sessionId: c.get('session')!.id,
      send: () => write(`event: inbox\ndata: ${JSON.stringify(inbox.state(device))}\n\n`),
      close() {
        if (finish()) controller.close();
      },
    };
    open.add(connection);
    leave = inbox.subscribe(connection.send);
    connection.send();
    return new Response(body, { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'x-accel-buffering': 'no', connection: 'close' } });
  });

  app.post('/_caduceus/api/inbox/hide', async (c) => {
    const body = await jsonBody(c.req.raw);
    if (!isRecord(body) || typeof body.ref !== 'string' || body.ref === '' || typeof body.stamp !== 'string' || (body.until !== undefined && (typeof body.until !== 'number' || !Number.isFinite(body.until)))) return c.json({ error: 'bad-request' }, 400);
    inbox.hide(deviceOf(c), { ref: body.ref, stamp: body.stamp, ...(typeof body.until === 'number' ? { until: body.until } : {}) });
    return c.json({ ok: true });
  });

  app.delete('/_caduceus/api/inbox/hide', (c) => {
    const ref = c.req.query('ref');
    if (!ref) return c.json({ error: 'bad-request' }, 400);
    inbox.unhide(deviceOf(c), ref);
    return c.json({ ok: true });
  });

  app.post('/_caduceus/api/inbox/activity/seen', async (c) => {
    const body = await jsonBody(c.req.raw);
    if (!isRecord(body) || typeof body.seq !== 'number' || !Number.isFinite(body.seq)) return c.json({ error: 'bad-request' }, 400);
    inbox.seen(deviceOf(c), body.seq);
    return c.json({ ok: true });
  });

  app.post('/_caduceus/api/inbox/:id/decision', async (c) => {
    const url = new URL(c.req.url);
    const requester = { sessionId: c.get('session')?.id, source: authClient(c).source };
    const prepared = policy.prepare('POST', url.pathname, requester);
    if (!prepared.allow) return c.json(prepared.body, prepared.status);
    const raw = await readBody(c.req.raw, MAX_BODY);
    if (raw === 'too-large') return c.json({ error: 'bad-request' }, 400);
    const decision = await policy.decide(prepared, { method: 'POST', search: url.search, contentType: c.req.header('content-type'), confirmation: c.req.header('x-caduceus-confirmation'), body: raw }, requester);
    if (!decision.allow) return c.json(decision.body, decision.status);
    const answer = decisionOf(raw);
    if (!answer) return c.json({ error: 'bad-request' }, 400);
    try {
      return c.json(await requests.decide(c.req.param('id'), answer));
    } catch (error) {
      return c.json({ error: 'hermes-refused', message: error instanceof Error ? error.message : 'Hermes did not take the answer.' }, 502);
    }
  });

  return {
    closeSession(sessionId) {
      for (const connection of open) if (connection.sessionId === sessionId) connection.close();
    },
    closeAll() {
      for (const connection of open) connection.close();
    },
    announce() {
      for (const connection of open) connection.send();
    },
  };
}

async function jsonBody(request: Request): Promise<unknown> {
  const raw = await readBody(request, MAX_BODY);
  if (raw === 'too-large') return undefined;
  try {
    return JSON.parse(Buffer.from(raw).toString('utf8'));
  } catch {
    return undefined;
  }
}

/** The decision a request body holds, or `undefined` when it is not one. */
function decisionOf(raw: Uint8Array): InboxDecision | undefined {
  let body: unknown;
  try {
    body = JSON.parse(Buffer.from(raw).toString('utf8'));
  } catch {
    return undefined;
  }
  if (!isRecord(body)) return undefined;
  if (typeof body.choice === 'string' && ['once', 'session', 'always', 'deny'].includes(body.choice)) {
    return { choice: body.choice as 'once' | 'session' | 'always' | 'deny', ...(typeof body.reason === 'string' ? { reason: body.reason } : {}) };
  }
  const { result } = body;
  if (!isRecord(result)) return undefined;
  if (isRecord(result.answers) && Object.values(result.answers).every((answer) => typeof answer === 'string')) return { result: { answers: result.answers as Record<string, string> } };
  return undefined;
}
