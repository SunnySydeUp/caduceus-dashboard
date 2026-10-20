// Share links (R4, M7 #06; architecture §2): a read-only link to a frozen copy of a session's transcript. Making one reads the session's rows from Hermes's
// messages endpoint, keeps what the page needs of them (secret tool arguments hidden, `sharedRow`) as a derived artifact (`shares/<id>.json` beside the
// database) and hands the owner a random token once; only its SHA-256 is stored. `/share/<token>` and its data (`/_caduceus/share/<token>`) are the one thing
// in Caduceus a visitor with no session can load, and they serve the snapshot and nothing else. Links are as reachable as Caduceus is: only on the tailnet
// (D9), because nothing here adds a listener or a Funnel route. A snapshot is deleted when its link expires, and a little after it is revoked (Undo until then).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Context, Hono } from 'hono';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { SHARE_EXPIRIES, SHARE_EXPIRY_MS, SHARE_MAX_BYTES, SHARE_MAX_ROWS, SHARE_TOKEN, SHARE_UNDO_MS, sharedRow, sharePath, type ShareCreated, type ShareExpiry, type ShareSummary, type SharedRow, type SharedTranscript } from '@caduceus/contracts/share-links';
import type { AuditLog } from './audit-log.ts';
import { authClient, type AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { readBody } from './hermes-proxy.ts';
import type { RestPolicy } from './policy.ts';

export interface SharesDeps {
  backend: HermesBackend;
  policy: RestPolicy;
  audit: AuditLog;
  store: CaduceusStore;
  now: () => number;
  /** The address the owner's devices reach Caduceus at (the Tailscale Serve URL); a share's link is made from it. */
  publicOrigin: string | undefined;
}

export interface Shares {
  mount(app: Hono<AuthEnv>): void;
  /** Deletes the snapshots of shares that have expired or whose undo window is over. Also run before every read of the list or of a share. */
  sweep(): void;
  /** Whether `/share/<token>` names a share that can be opened now. */
  isOpen(token: string): boolean;
}

interface ShareRow {
  id: string;
  session_id: string;
  profile: string;
  title: string;
  created_at: number;
  expires_at: number | null;
  revoked_at: number | null;
}

/** Hermes's messages come in pages of at most 500. */
const PAGE = 500;
const SMALL_BODY_BYTES = 8 * 1024;

const hashOf = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

export function createShares({ backend, policy, audit, store, now, publicOrigin }: SharesDeps): Shares {
  const { db } = store;
  const folder = path.join(store.dir, 'shares');
  const fileOf = (id: string) => path.join(folder, `${id}.json`);

  const summaryOf = (row: ShareRow): ShareSummary => ({
    id: row.id,
    sessionId: row.session_id,
    profile: row.profile,
    title: row.title,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: row.expires_at === null ? null : new Date(row.expires_at).toISOString(),
    ...(row.revoked_at === null ? {} : { revokedAt: new Date(row.revoked_at).toISOString() }),
  });

  const forget = (id: string) => {
    fs.rmSync(fileOf(id), { force: true });
    db.prepare('DELETE FROM shares WHERE id = ?').run(id);
  };

  const sweep = () => {
    const at = now();
    const gone = db.prepare('SELECT id FROM shares WHERE (expires_at IS NOT NULL AND expires_at <= ?) OR (revoked_at IS NOT NULL AND revoked_at + ? <= ?)').all(at, SHARE_UNDO_MS, at) as { id: string }[];
    for (const { id } of gone) forget(id);
    // A snapshot with no row (a crash between the two) is no one's.
    if (fs.existsSync(folder)) {
      const known = new Set((db.prepare('SELECT id FROM shares').all() as { id: string }[]).map((row) => `${row.id}.json`));
      for (const name of fs.readdirSync(folder)) if (name.endsWith('.json') && !known.has(name)) fs.rmSync(path.join(folder, name), { force: true });
    }
  };

  const open = (token: string): ShareRow | undefined => {
    if (!SHARE_TOKEN.test(token)) return undefined;
    sweep();
    const row = db.prepare('SELECT id, session_id, profile, title, created_at, expires_at, revoked_at FROM shares WHERE token_hash = ?').get(hashOf(token)) as ShareRow | undefined;
    return row && row.revoked_at === null ? row : undefined;
  };

  const requesterOf = (c: Context<AuthEnv>) => ({ sessionId: c.get('session')?.id, source: authClient(c).source });

  /** Every row of a session, oldest first, as Hermes pages them out. */
  const readRows = async (sessionId: string, profile: string): Promise<{ rows: SharedRow[] } | { problem: 'no-such-session' | 'too-long' | 'hermes' }> => {
    const rows: SharedRow[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const res = await backend.fetch(`/api/sessions/${encodeURIComponent(sessionId)}/messages?${new URLSearchParams({ profile, order: 'oldest', limit: String(PAGE), offset: String(offset) })}`).catch(() => undefined);
      if (res === undefined) return { problem: 'hermes' };
      if (res.status === 404) return { problem: 'no-such-session' };
      const body: unknown = await res.json().catch(() => undefined);
      if (!res.ok || !isRecord(body) || !Array.isArray(body.messages)) return { problem: 'hermes' };
      for (const message of body.messages) if (isRecord(message) && message.display_kind !== 'hidden') rows.push(sharedRow(message));
      if (rows.length > SHARE_MAX_ROWS) return { problem: 'too-long' };
      if (body.messages.length < PAGE) return { rows };
    }
  };

  const titleOf = async (sessionId: string, profile: string, rows: readonly SharedRow[]): Promise<string> => {
    const res = await backend.fetch(`/api/sessions/${encodeURIComponent(sessionId)}?${new URLSearchParams({ profile })}`).catch(() => undefined);
    const body: unknown = await res?.json().catch(() => undefined);
    const named = isRecord(body) && typeof body.title === 'string' ? body.title.trim() : '';
    if (named !== '') return named.slice(0, 200);
    const first = rows.find((row) => row.role === 'user' && typeof row.content === 'string');
    return typeof first?.content === 'string' && first.content.trim() !== '' ? first.content.trim().slice(0, 80) : 'Shared session';
  };

  return {
    sweep,
    isOpen: (token) => open(token) !== undefined,

    mount(app) {
      app.post('/_caduceus/api/shares', async (c) => {
        const url = new URL(c.req.url);
        const requester = requesterOf(c);
        const prepared = policy.prepare('POST', url.pathname, requester);
        if (!prepared.allow) return c.json(prepared.body, prepared.status);
        const raw = await readBody(c.req.raw, SMALL_BODY_BYTES);
        if (raw === 'too-large') return c.json({ error: 'payload-too-large' }, 413);
        let request: unknown;
        try {
          request = JSON.parse(Buffer.from(raw).toString('utf8'));
        } catch {
          request = undefined;
        }
        if (!isRecord(request) || typeof request.sessionId !== 'string' || request.sessionId === '' || typeof request.profile !== 'string' || request.profile === '') {
          return c.json({ error: 'bad-request', message: 'A share names the session and the profile it belongs to.' }, 400);
        }
        const expiry = request.expiry;
        if (typeof expiry !== 'string' || !(SHARE_EXPIRIES as readonly string[]).includes(expiry)) return c.json({ error: 'bad-request', message: `Choose how long the link lasts: ${SHARE_EXPIRIES.join(', ')}.` }, 400);
        const { sessionId, profile } = request;
        // Nothing is asked of the owner for a session that cannot be shared.
        const read = await readRows(sessionId, profile);
        if ('problem' in read) {
          if (read.problem === 'no-such-session') return c.json({ error: 'no-such-session', message: 'Hermes has no such session.' }, 404);
          if (read.problem === 'too-long') return c.json({ error: 'too-long', message: `That session is longer than ${SHARE_MAX_ROWS} messages, which is more than a share holds. Export it instead.` }, 413);
          return c.json({ error: 'hermes-unavailable', message: 'Hermes did not give the session, so nothing was shared.' }, 502);
        }
        if (read.rows.length === 0) return c.json({ error: 'empty', message: 'That session has nothing in it to share yet.' }, 400);
        const decision = await policy.decide(prepared, { method: 'POST', search: url.search, contentType: c.req.header('content-type'), confirmation: c.req.header('x-caduceus-confirmation'), body: raw }, requester);
        if (!decision.allow) return c.json(decision.body, decision.status);

        const title = await titleOf(sessionId, profile, read.rows);
        const at = now();
        const lasts = SHARE_EXPIRY_MS[expiry as ShareExpiry];
        const id = crypto.randomBytes(8).toString('hex');
        const token = crypto.randomBytes(32).toString('base64url');
        const snapshot: SharedTranscript = { title, createdAt: new Date(at).toISOString(), expiresAt: lasts === null ? null : new Date(at + lasts).toISOString(), rows: read.rows };
        const text = JSON.stringify(snapshot);
        if (Buffer.byteLength(text) > SHARE_MAX_BYTES) return c.json({ error: 'too-long', message: 'That session is larger than a share holds. Export it instead.' }, 413);
        fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
        fs.writeFileSync(fileOf(id), text, { mode: 0o600 });
        db.prepare('INSERT INTO shares (id, token_hash, session_id, profile, title, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(id, hashOf(token), sessionId, profile, title, at, lasts === null ? null : at + lasts);
        audit.record({ actor: 'owner', action: 'share.create', target: `${sessionId} (${title})`, source: requester.source, tier: 'T1', profile });
        const created: ShareCreated = { ...summaryOf({ id, session_id: sessionId, profile, title, created_at: at, expires_at: lasts === null ? null : at + lasts, revoked_at: null }), token, path: sharePath(token), ...(publicOrigin ? { origin: publicOrigin } : {}) };
        return c.json(created, 201);
      });

      app.get('/_caduceus/api/shares', (c) => {
        sweep();
        const rows = db.prepare('SELECT id, session_id, profile, title, created_at, expires_at, revoked_at FROM shares WHERE revoked_at IS NULL ORDER BY created_at DESC, id').all() as unknown as ShareRow[];
        return c.json({ shares: rows.map(summaryOf) });
      });

      /** Revoking is a T0 with an undo window: the link stops working at once, and the snapshot goes when the window is over. */
      app.delete('/_caduceus/api/shares/:id', async (c) => {
        const url = new URL(c.req.url);
        const requester = requesterOf(c);
        const prepared = policy.prepare('DELETE', url.pathname, requester);
        if (!prepared.allow) return c.json(prepared.body, prepared.status);
        const decision = await policy.decide(prepared, { method: 'DELETE', search: url.search, contentType: undefined, confirmation: undefined, body: undefined }, requester);
        if (!decision.allow) return c.json(decision.body, decision.status);
        sweep();
        const row = db.prepare('SELECT id, session_id, profile, title, created_at, expires_at, revoked_at FROM shares WHERE id = ? AND revoked_at IS NULL').get(c.req.param('id')) as ShareRow | undefined;
        if (!row) return c.json({ error: 'not-found', message: 'There is no such share.' }, 404);
        const at = now();
        db.prepare('UPDATE shares SET revoked_at = ? WHERE id = ?').run(at, row.id);
        audit.record({ actor: 'owner', action: 'share.revoke', target: `${row.session_id} (${row.title})`, source: requester.source, tier: 'T0', profile: row.profile });
        return c.json({ ...summaryOf({ ...row, revoked_at: at }), undoMs: SHARE_UNDO_MS });
      });

      app.post('/_caduceus/api/shares/:id/restore', async (c) => {
        const url = new URL(c.req.url);
        const requester = requesterOf(c);
        const prepared = policy.prepare('POST', url.pathname, requester);
        if (!prepared.allow) return c.json(prepared.body, prepared.status);
        const decision = await policy.decide(prepared, { method: 'POST', search: url.search, contentType: undefined, confirmation: undefined, body: undefined }, requester);
        if (!decision.allow) return c.json(decision.body, decision.status);
        sweep();
        const row = db.prepare('SELECT id, session_id, profile, title, created_at, expires_at, revoked_at FROM shares WHERE id = ? AND revoked_at IS NOT NULL').get(c.req.param('id')) as ShareRow | undefined;
        if (!row) return c.json({ error: 'not-found', message: 'The undo window is over, so that link cannot be brought back. Make a new one.' }, 404);
        db.prepare('UPDATE shares SET revoked_at = NULL WHERE id = ?').run(row.id);
        audit.record({ actor: 'owner', action: 'share.restore', target: `${row.session_id} (${row.title})`, source: requester.source, tier: 'T0', profile: row.profile });
        return c.json(summaryOf({ ...row, revoked_at: null }));
      });

      /** The one route a visitor with no session may call (`isPublicSharePath`): the snapshot, and nothing of the owner's. */
      app.get('/_caduceus/share/:token', (c) => {
        const row = open(c.req.param('token'));
        c.header('Cache-Control', 'no-store');
        c.header('Referrer-Policy', 'no-referrer');
        c.header('X-Robots-Tag', 'noindex, nofollow');
        if (!row) return c.json({ error: 'not-found' }, 404);
        return c.body(fs.readFileSync(fileOf(row.id), 'utf8'), 200, { 'Content-Type': 'application/json; charset=utf-8' });
      });
    },
  };
}
