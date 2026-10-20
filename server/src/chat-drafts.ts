// Chat drafts (M1 #11): the owner's unsent composer text and attachments, kept in the Caduceus store per (profile, session id or `new`) so that they
// survive a reload and follow the owner to another device. Caduceus's own (R5); Hermes knows nothing of them and nothing here reaches Hermes.
//
// What a draft may hold is capped (`contracts/chat-drafts.ts`) and never includes a secret: text, or an attachment that looks like credentials, is refused
// with the reason and stays in the page that has it. Caduceus's store is in every `hermes backup` and on every device, so nothing of that kind is written to it.
import { randomUUID } from 'node:crypto';
import type { Context, Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { isRecord } from '@caduceus/contracts/policy/guards';
import {
  MAX_DRAFT_ATTACHMENT_BYTES,
  MAX_DRAFT_ATTACHMENTS,
  MAX_DRAFT_ATTACHMENTS_BYTES,
  MAX_DRAFT_TEXT_BYTES,
  MAX_DRAFTS,
  MAX_DRAFTS_BYTES,
  SECRET_SCAN_BYTES,
  secretIn,
  secretInAttachment,
  type Draft,
  type DraftAttachment,
  type DraftAttachmentKind,
  type DraftList,
  type DraftReply,
} from '@caduceus/contracts/chat-drafts';
import type { AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { READ_ONLY_MESSAGE } from './policy.ts';
import type { ReadOnlyMode } from './read-only.ts';

/** The route a draft's attachment is uploaded to: the one request of the Caduceus API whose body may be large. */
const UPLOAD_ROUTE = '/_caduceus/api/chat/draft/attachments';
export const isDraftUpload = (method: string, path: string) => method === 'POST' && path === UPLOAD_ROUTE;

const MB = 1024 * 1024;

interface DraftRow {
  profile: string;
  session: string;
  text: string;
  revision: number;
  updated_at: number;
}

interface AttachmentRow {
  id: string;
  name: string;
  kind: DraftAttachmentKind;
  mime: string;
  size: number;
  pasted: number;
  origin: string | null;
}

const ATTACHMENT_COLUMNS = 'id, name, kind, mime, size, pasted, origin';

export function mountChatDrafts(app: Hono<AuthEnv>, store: CaduceusStore, now: () => number, { readOnly, backend }: { readOnly: ReadOnlyMode; backend: HermesBackend }): void {
  const { db } = store;
  // Nothing is in flight at start, so an uploaded attachment no draft names (the page went away between the upload and the save) is safe to drop.
  db.prepare('DELETE FROM chat_draft_attachments WHERE NOT EXISTS (SELECT 1 FROM chat_drafts d WHERE d.profile = chat_draft_attachments.profile AND d.session = chat_draft_attachments.session)').run();

  const draftRow = (profile: string, session: string) =>
    db.prepare('SELECT profile, session, text, revision, updated_at FROM chat_drafts WHERE profile = ? AND session = ?').get(profile, session) as DraftRow | undefined;
  const attachmentsOf = (profile: string, session: string): DraftAttachment[] =>
    (db.prepare(`SELECT ${ATTACHMENT_COLUMNS} FROM chat_draft_attachments WHERE profile = ? AND session = ? ORDER BY position`).all(profile, session) as unknown as AttachmentRow[]).map(
      (stored) => ({ id: stored.id, name: stored.name, kind: stored.kind, mime: stored.mime, size: stored.size, ...(stored.pasted ? { pasted: true as const } : {}), ...(stored.origin === null ? {} : { origin: stored.origin }) }),
    );
  const toDraft = (stored: DraftRow): Draft => ({
    profile: stored.profile,
    session: stored.session,
    text: stored.text,
    attachments: attachmentsOf(stored.profile, stored.session),
    revision: stored.revision,
    updatedAt: stored.updated_at,
  });
  const dropDraft = (profile: string, session: string) => {
    db.prepare('DELETE FROM chat_drafts WHERE profile = ? AND session = ?').run(profile, session);
    db.prepare('DELETE FROM chat_draft_attachments WHERE profile = ? AND session = ?').run(profile, session);
  };
  /** Counts every write of any draft; a revision is never given twice, even for a draft that was deleted and made again. */
  const nextRevision = () => {
    const { next } = db.prepare("SELECT COALESCE(MAX(CAST(value AS INTEGER)), 0) + 1 AS next FROM settings WHERE key = 'chat.draft-revision'").get() as { next: number };
    db.prepare("INSERT INTO settings (key, value) VALUES ('chat.draft-revision', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value").run(String(next));
    return next;
  };
  const keyOf = (c: Context<AuthEnv, string>) => {
    const profile = c.req.query('profile');
    const session = c.req.query('session');
    return profile && session ? { profile, session } : undefined;
  };
  const refuseWhileReadOnly = (c: Context<AuthEnv, string>) =>
    readOnly.enabled() ? c.json({ error: 'read-only', message: `${READ_ONLY_MESSAGE} Your draft is not saved; it stays in this tab.` }, 403) : undefined;

  /** Whether Hermes still has the session; a session Hermes cannot be asked about counts as present, so that a Hermes restart never costs a draft. */
  const sessionExists = async (profile: string, session: string): Promise<boolean> => {
    if (session === 'new') return true;
    try {
      const res = await backend.fetch(`/api/sessions/${encodeURIComponent(session)}?profile=${encodeURIComponent(profile)}`);
      return res.status !== 404;
    } catch {
      return true;
    }
  };

  app.get('/_caduceus/api/chat/draft', async (c) => {
    const key = keyOf(c);
    if (!key) return c.json({ error: 'bad-request' }, 400);
    const stored = draftRow(key.profile, key.session);
    if (stored && !(await sessionExists(key.profile, key.session))) {
      dropDraft(key.profile, key.session);
      return c.json({ draft: null } satisfies DraftReply);
    }
    return c.json({ draft: stored ? toDraft(stored) : null } satisfies DraftReply);
  });

  app.put('/_caduceus/api/chat/draft', async (c) => {
    const key = keyOf(c);
    const body: unknown = await c.req.json().catch(() => undefined);
    const named = isRecord(body) && Array.isArray(body.attachments) && body.attachments.every((id) => typeof id === 'string') ? (body.attachments as string[]) : undefined;
    if (!key || !isRecord(body) || typeof body.text !== 'string' || (body.attachments !== undefined && named === undefined)) return c.json({ error: 'bad-request' }, 400);
    const refused = refuseWhileReadOnly(c);
    if (refused) return refused;
    const current = draftRow(key.profile, key.session);
    const kept = named ?? attachmentsOf(key.profile, key.session).map((attachment) => attachment.id);
    if (body.text.trim() === '' && kept.length === 0) {
      dropDraft(key.profile, key.session);
      return c.json({ draft: null } satisfies DraftReply);
    }
    if (Buffer.byteLength(body.text) > MAX_DRAFT_TEXT_BYTES) return c.json({ error: 'too-large', message: `This draft is not saved: its text is longer than ${MAX_DRAFT_TEXT_BYTES / 1000} KB. Attach a long text as a file instead.` }, 413);
    const secret = secretIn(body.text);
    if (secret) return c.json({ error: 'secret', what: secret, message: `This draft is not saved: it looks like it holds ${secret}. Caduceus never keeps those. What you typed stays here until you send or clear it.` }, 422);
    const here = attachmentsOf(key.profile, key.session);
    if (kept.some((id) => !here.some((attachment) => attachment.id === id))) return c.json({ error: 'unknown-attachment', message: 'One of the attachments is not stored with this draft.' }, 409);
    if (!current && (db.prepare('SELECT COUNT(*) AS n FROM chat_drafts').get() as { n: number }).n >= MAX_DRAFTS) return c.json({ error: 'too-many', message: `Caduceus keeps up to ${MAX_DRAFTS} drafts. Send or clear some first.` }, 409);

    // The caller says which revision it last saw. A draft that moved on since, to other words than the caller is saving, is what its save replaces:
    // the latest write wins, and the caller hears what it replaced so that it can offer it back.
    const base = typeof body.base === 'number' ? body.base : undefined;
    const replaced = current && base !== undefined && current.revision > base && current.text !== body.text ? toDraft(current) : undefined;
    const revision = nextRevision();
    // Attachments the save leaves out go with their bytes (and those uploaded and never named, which are not in `here` once the page's save has run).
    db.prepare('INSERT INTO chat_drafts (profile, session, text, revision, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (profile, session) DO UPDATE SET text = excluded.text, revision = excluded.revision, updated_at = excluded.updated_at').run(
      key.profile,
      key.session,
      body.text,
      revision,
      now(),
    );
    for (const attachment of here) if (!kept.includes(attachment.id)) db.prepare('DELETE FROM chat_draft_attachments WHERE id = ?').run(attachment.id);
    if (named) {
      // The order the save names is the order the draft keeps.
      const move = db.prepare('UPDATE chat_draft_attachments SET position = ? WHERE id = ?');
      const { top } = db.prepare('SELECT COALESCE(MAX(position), 0) AS top FROM chat_draft_attachments').get() as { top: number };
      named.forEach((id, index) => move.run(top + 1 + index, id));
    }
    return c.json({ draft: toDraft(draftRow(key.profile, key.session)!), ...(replaced ? { replaced } : {}) } satisfies DraftReply);
  });

  app.delete('/_caduceus/api/chat/draft', (c) => {
    const key = keyOf(c);
    if (!key) return c.json({ error: 'bad-request' }, 400);
    const refused = refuseWhileReadOnly(c);
    if (refused) return refused;
    dropDraft(key.profile, key.session);
    return c.body(null, 204);
  });

  app.post(
    UPLOAD_ROUTE,
    bodyLimit({ maxSize: MAX_DRAFT_ATTACHMENT_BYTES, onError: (c) => c.json(tooLarge(`${c.req.query('name') ?? 'This attachment'} is not kept with the draft: it is over ${MAX_DRAFT_ATTACHMENT_BYTES / MB} MB.`), 413) }),
    async (c) => {
      const key = keyOf(c);
      const name = c.req.query('name');
      const kind = c.req.query('kind');
      if (!key || !name || (kind !== 'image' && kind !== 'pdf' && kind !== 'file')) return c.json({ error: 'bad-request' }, 400);
      const refused = refuseWhileReadOnly(c);
      if (refused) return refused;
      const bytes = new Uint8Array(await c.req.arrayBuffer());
      const mime = c.req.header('content-type')?.split(';')[0].trim() || 'application/octet-stream';
      const secret = secretInAttachment(name, kind === 'file' ? bytes.subarray(0, SECRET_SCAN_BYTES) : undefined);
      if (secret) return c.json({ error: 'secret', what: secret, message: `${name} is not kept with the draft: it looks like ${secret}. Caduceus never keeps those. It stays attached until you send or remove it.` }, 422);
      const held = db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS bytes FROM chat_draft_attachments WHERE profile = ? AND session = ?').get(key.profile, key.session) as { n: number; bytes: number };
      if (held.n >= MAX_DRAFT_ATTACHMENTS) return c.json({ error: 'too-many', message: `${name} is not kept with the draft: a draft keeps at most ${MAX_DRAFT_ATTACHMENTS} attachments.` }, 409);
      if (held.bytes + bytes.length > MAX_DRAFT_ATTACHMENTS_BYTES) return c.json(tooLarge(`${name} is not kept with the draft: a draft keeps ${MAX_DRAFT_ATTACHMENTS_BYTES / MB} MB of attachments at most.`), 413);
      const { total } = db.prepare('SELECT COALESCE(SUM(size), 0) AS total FROM chat_draft_attachments').get() as { total: number };
      if (total + bytes.length > MAX_DRAFTS_BYTES) return c.json(tooLarge(`${name} is not kept with the draft: Caduceus keeps ${MAX_DRAFTS_BYTES / MB} MB of draft attachments in all. Send or clear some drafts first.`), 413);
      const id = randomUUID();
      const pasted = c.req.query('pasted') === '1' ? 1 : 0;
      const origin = c.req.query('origin') || null;
      db.prepare('INSERT INTO chat_draft_attachments (id, profile, session, name, kind, mime, size, pasted, origin, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(id, key.profile, key.session, name, kind, mime, bytes.length, pasted, origin, bytes);
      return c.json({ attachment: { id, name, kind, mime, size: bytes.length, ...(pasted ? { pasted: true } : {}), ...(origin === null ? {} : { origin }) } }, 201);
    },
  );

  app.get(`${UPLOAD_ROUTE}/:id`, (c) => {
    const stored = db.prepare('SELECT body FROM chat_draft_attachments WHERE id = ?').get(c.req.param('id')) as { body: Uint8Array } | undefined;
    if (!stored) return c.json({ error: 'not-found' }, 404);
    // Whatever the owner attached, it is only ever bytes for the composer to read back, never a page.
    return c.body(stored.body as Uint8Array<ArrayBuffer>, 200, { 'content-type': 'application/octet-stream', 'x-content-type-options': 'nosniff', 'content-disposition': 'attachment' });
  });

  app.get('/_caduceus/api/chat/drafts', async (c) => {
    const profile = c.req.query('profile');
    const rows = (profile
      ? db.prepare('SELECT profile, session, text, revision, updated_at FROM chat_drafts WHERE profile = ?').all(profile)
      : db.prepare('SELECT profile, session, text, revision, updated_at FROM chat_drafts').all()) as unknown as DraftRow[];
    // A draft of a session Hermes no longer has is dropped here, where the owner looks for drafts, and it is not listed.
    const present = await Promise.all(rows.map((stored) => sessionExists(stored.profile, stored.session)));
    const list: DraftList = { drafts: [] };
    rows.forEach((stored, index) => {
      if (!present[index]) dropDraft(stored.profile, stored.session);
      else list.drafts.push({ profile: stored.profile, session: stored.session, chars: stored.text.length, attachments: attachmentsOf(stored.profile, stored.session).length, updatedAt: stored.updated_at });
    });
    return c.json(list);
  });
}

function tooLarge(message: string) {
  return { error: 'too-large', message, maxBytes: MAX_DRAFT_ATTACHMENT_BYTES };
}
