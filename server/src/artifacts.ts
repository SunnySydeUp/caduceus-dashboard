// The Artifacts store (M6 #05; work model §2.3, architecture §2): derived outputs kept in `<Caduceus folder>/artifacts/`, one file each, with a row in the store
// saying what it is and which session, task or playbook run it came from. Nothing here copies a task or a session: an artifact is the file a worker handed in
// and the name of where it came from. The files are kept under a size cap: when it is passed the oldest artifacts that are not pinned are removed first.
//
// A deleted artifact (a T1 with an undo) or one the cap removed keeps its row as a tombstone, so the capture that made it does not make it again.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ARTIFACT_KINDS, ARTIFACT_SOURCE_TYPES, ARTIFACT_UNDO_MS, DEFAULT_ARTIFACT_CAP_BYTES, MAX_ARTIFACT_BYTES, MIN_ARTIFACT_CAP_BYTES, artifactKind, artifactMime, markdownTitle, type Artifact, type ArtifactKind, type ArtifactList, type ArtifactSource, type ArtifactSourceType } from '@caduceus/contracts/artifacts';
import type { Hono } from 'hono';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import { gateRequest } from './policy-gate.ts';
import type { RestPolicy } from './policy.ts';
import type { KanbanPort } from './playbook-kanban.ts';
import type { FileGuard } from './file-guard.ts';
import type { HermesBackend } from './hermes-backend.ts';

export interface NewArtifact {
  name: string;
  bytes: Uint8Array;
  /** The type the file was attached with; the kind comes from the name first. */
  mime?: string | null;
  source: ArtifactSource;
  /** What this was taken from, so taking it again keeps nothing new. */
  origin?: string;
}

export interface ArtifactFilter {
  source?: ArtifactSourceType;
  /** The id of the source: one session, task or run. */
  sourceId?: string;
  kind?: ArtifactKind;
}

export interface ArtifactStore {
  /** Keeps a file. `undefined` when its `origin` is known already (kept before, or deleted by the owner) or the file is too large. */
  add(input: NewArtifact): Artifact | undefined;
  /** What became of what was taken from `origin`: still `kept`, or `removed` (deleted by the owner, or by the cap); `undefined` when nothing was taken. */
  knows(origin: string): 'kept' | 'removed' | undefined;
  /** Forgets a removed artifact's tombstone, so the owner can keep the same file again. */
  forget(origin: string): void;
  list(filter?: ArtifactFilter): ArtifactList;
  get(id: string): Artifact | undefined;
  /** The file's bytes and the name and type it is served with. */
  open(id: string): { artifact: Artifact; file: string } | undefined;
  /** Deletes an artifact: it leaves the list at once and its file stays for the undo window. */
  remove(id: string): Artifact | undefined;
  /** Brings back one deleted within the undo window. */
  restore(id: string): Artifact | undefined;
  pin(id: string, pinned: boolean): Artifact | undefined;
  usage(): ArtifactList['usage'];
  setCapBytes(bytes: number): void;
  /** Removes the files of artifacts whose undo window is over, orphan files, and whatever the cap says. */
  sweep(): void;
}

interface Row {
  id: string;
  name: string;
  title: string;
  kind: string;
  mime: string;
  size: number;
  source_type: string;
  source_id: string;
  source_board: string | null;
  source_profile: string | null;
  source_playbook: string | null;
  source_task: string | null;
  source_label: string;
  pinned: number;
  created_at: number;
  deleted_at: number | null;
}

const COLUMNS = 'id, name, title, kind, mime, size, source_type, source_id, source_board, source_profile, source_playbook, source_task, source_label, pinned, created_at, deleted_at';
const CAP_KEY = 'artifacts.cap-bytes';

const asKind = (value: string): ArtifactKind => (value === 'markdown' || value === 'html' || value === 'image' || value === 'pdf' || value === 'text' ? value : 'file');
const asSourceType = (value: string): ArtifactSourceType => ARTIFACT_SOURCE_TYPES.find((type) => type === value) ?? 'task';

const artifactOf = (row: Row): Artifact => ({
  id: row.id,
  name: row.name,
  title: row.title,
  kind: asKind(row.kind),
  mime: row.mime,
  size: row.size,
  source: { type: asSourceType(row.source_type), id: row.source_id, ...(row.source_board === null ? {} : { board: row.source_board }), ...(row.source_profile === null ? {} : { profile: row.source_profile }), ...(row.source_playbook === null ? {} : { playbook: row.source_playbook }), ...(row.source_task === null ? {} : { taskId: row.source_task }), label: row.source_label },
  pinned: row.pinned === 1,
  createdAt: row.created_at,
});

export function createArtifactStore({ store, now }: { store: CaduceusStore; now(): number }): ArtifactStore {
  const { db } = store;
  const folder = path.join(store.dir, 'artifacts');
  const fileOf = (id: string) => path.join(folder, id);

  const capBytes = (): number => {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(CAP_KEY) as { value: string } | undefined;
    const value = row === undefined ? Number.NaN : Number(row.value);
    return Number.isFinite(value) && value >= MIN_ARTIFACT_CAP_BYTES ? value : DEFAULT_ARTIFACT_CAP_BYTES;
  };

  /** Bytes whose files are on disk: what the owner keeps and what is waiting out its undo window. */
  const usedBytes = (): number => (db.prepare('SELECT COALESCE(SUM(size), 0) AS bytes FROM artifacts WHERE purged = 0').get() as { bytes: number }).bytes;

  /** Drops the file of an artifact and keeps its row, so a capture does not make it again. */
  const purge = (id: string, at: number) => {
    fs.rmSync(fileOf(id), { force: true });
    db.prepare('UPDATE artifacts SET purged = 1, deleted_at = COALESCE(deleted_at, ?) WHERE id = ?').run(at, id);
  };

  /** Removes the oldest artifacts that are not pinned until the files fit under the cap. `keep` (the one just added) is never the one that goes. */
  const enforceCap = (keep?: string) => {
    const cap = capBytes();
    let used = usedBytes();
    if (used <= cap) return;
    // What is already deleted goes before anything the owner still has.
    const candidates = db.prepare('SELECT id, size, deleted_at FROM artifacts WHERE purged = 0 AND pinned = 0 AND id IS NOT ? ORDER BY deleted_at IS NULL, created_at, id').all(keep ?? null) as { id: string; size: number }[];
    for (const candidate of candidates) {
      if (used <= cap) return;
      purge(candidate.id, now());
      used -= candidate.size;
    }
  };

  const sweep = () => {
    const at = now();
    const expired = db.prepare('SELECT id FROM artifacts WHERE purged = 0 AND deleted_at IS NOT NULL AND deleted_at + ? <= ?').all(ARTIFACT_UNDO_MS, at) as { id: string }[];
    for (const { id } of expired) purge(id, at);
    enforceCap();
    // A file with no row (a crash between the two) is no one's.
    if (fs.existsSync(folder)) {
      const kept = new Set((db.prepare('SELECT id FROM artifacts WHERE purged = 0').all() as { id: string }[]).map((row) => row.id));
      for (const name of fs.readdirSync(folder)) if (!kept.has(name)) fs.rmSync(path.join(folder, name), { recursive: true, force: true });
    }
  };

  const usage = () => ({ bytes: usedBytes(), capBytes: capBytes() });

  const read = (id: string): Row | undefined => db.prepare(`SELECT ${COLUMNS} FROM artifacts WHERE id = ? AND purged = 0`).get(id) as Row | undefined;

  return {
    add({ name, bytes, mime, source, origin }) {
      if (bytes.byteLength > MAX_ARTIFACT_BYTES) return undefined;
      if (origin !== undefined && db.prepare('SELECT 1 FROM artifacts WHERE origin = ?').get(origin) !== undefined) return undefined;
      const kind = artifactKind(name, mime);
      const title = kind === 'markdown' ? (markdownTitle(Buffer.from(bytes).toString('utf8')) ?? name) : name;
      const id = crypto.randomBytes(8).toString('hex');
      fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
      fs.writeFileSync(fileOf(id), bytes, { mode: 0o600 });
      const at = now();
      db.prepare(`INSERT INTO artifacts (id, name, title, kind, mime, size, source_type, source_id, source_board, source_profile, source_playbook, source_task, source_label, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id, name, title, kind, artifactMime(kind, name), bytes.byteLength, source.type, source.id, source.board ?? null, source.profile ?? null, source.playbook ?? null, source.taskId ?? null, source.label, origin ?? null, at,
      );
      enforceCap(id);
      const kept = read(id);
      return kept === undefined ? undefined : artifactOf(kept);
    },
    knows(origin) {
      const row = db.prepare('SELECT purged, deleted_at FROM artifacts WHERE origin = ?').get(origin) as { purged: number; deleted_at: number | null } | undefined;
      return row === undefined ? undefined : row.purged === 1 || row.deleted_at !== null ? 'removed' : 'kept';
    },
    forget(origin) {
      const gone = db.prepare('SELECT id FROM artifacts WHERE origin = ? AND (purged = 1 OR deleted_at IS NOT NULL)').get(origin) as { id: string } | undefined;
      if (gone === undefined) return;
      fs.rmSync(fileOf(gone.id), { force: true });
      db.prepare('DELETE FROM artifacts WHERE id = ?').run(gone.id);
    },
    list({ source, sourceId, kind } = {}) {
      sweep();
      const rows = db.prepare(`SELECT ${COLUMNS} FROM artifacts WHERE purged = 0 AND deleted_at IS NULL AND (? IS NULL OR source_type = ?) AND (? IS NULL OR source_id = ?) AND (? IS NULL OR kind = ?) ORDER BY created_at DESC, id`).all(source ?? null, source ?? null, sourceId ?? null, sourceId ?? null, kind ?? null, kind ?? null) as unknown as Row[];
      return { artifacts: rows.map(artifactOf), usage: usage() };
    },
    get(id) {
      const row = db.prepare(`SELECT ${COLUMNS} FROM artifacts WHERE id = ? AND purged = 0 AND deleted_at IS NULL`).get(id) as Row | undefined;
      return row === undefined ? undefined : artifactOf(row);
    },
    open(id) {
      const row = db.prepare(`SELECT ${COLUMNS} FROM artifacts WHERE id = ? AND purged = 0 AND deleted_at IS NULL`).get(id) as Row | undefined;
      return row === undefined || !fs.existsSync(fileOf(id)) ? undefined : { artifact: artifactOf(row), file: fileOf(id) };
    },
    remove(id) {
      sweep();
      const row = db.prepare(`SELECT ${COLUMNS} FROM artifacts WHERE id = ? AND purged = 0 AND deleted_at IS NULL`).get(id) as Row | undefined;
      if (row === undefined) return undefined;
      db.prepare('UPDATE artifacts SET deleted_at = ? WHERE id = ?').run(now(), id);
      return artifactOf(row);
    },
    restore(id) {
      sweep();
      const row = db.prepare(`SELECT ${COLUMNS} FROM artifacts WHERE id = ? AND purged = 0 AND deleted_at IS NOT NULL`).get(id) as Row | undefined;
      if (row === undefined) return undefined;
      db.prepare('UPDATE artifacts SET deleted_at = NULL WHERE id = ?').run(id);
      return artifactOf({ ...row, deleted_at: null });
    },
    pin(id, pinned) {
      const row = db.prepare(`SELECT ${COLUMNS} FROM artifacts WHERE id = ? AND purged = 0 AND deleted_at IS NULL`).get(id) as Row | undefined;
      if (row === undefined) return undefined;
      db.prepare('UPDATE artifacts SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id);
      return artifactOf({ ...row, pinned: pinned ? 1 : 0 });
    },
    usage,
    setCapBytes(bytes) {
      db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').run(CAP_KEY, String(bytes));
      enforceCap();
    },
    sweep,
  };
}

const BODY = 10_000;
const ID = /^[0-9a-f]{16}$/;
const BOARD = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TASK = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

/** What stops a file the owner opens from being a page of Caduceus: the page is its own opaque origin that can run nothing, and no kind but the ones the viewer shows opens inline. */
function contentHeaders(artifact: Artifact, download: boolean): Record<string, string> {
  // A PDF is drawn by the browser's own viewer, which a sandboxed response breaks; a raster image has nothing to run.
  const inert = artifact.kind === 'pdf' || (artifact.kind === 'image' && artifact.mime !== 'image/svg+xml');
  const attachment = download || artifact.kind === 'file';
  return {
    'Content-Type': artifact.mime,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    ...(inert ? {} : { 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:" }),
    'Content-Disposition': `${attachment ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(artifact.name).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`,
  };
}

export interface ArtifactRoutesDeps {
  artifacts: ArtifactStore;
  policy: RestPolicy;
  kanban: KanbanPort;
  backend: HermesBackend;
  files: FileGuard;
}

/** A folder and each folder above it, nearest first, up to eight. */
function* parentsOf(folder: string): Generator<string> {
  let current = folder;
  for (let level = 0; level < 8; level += 1) {
    yield current;
    const above = path.dirname(current);
    if (above === current) return;
    current = above;
  }
}

const SESSION = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const PROFILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

export function mountArtifacts(app: Hono<AuthEnv>, { artifacts, policy, kanban, backend, files }: ArtifactRoutesDeps): void {
  app.get('/_caduceus/api/artifacts', (c) => {
    const source = ARTIFACT_SOURCE_TYPES.find((type) => type === c.req.query('source'));
    const kind = ARTIFACT_KINDS.find((candidate) => candidate === c.req.query('kind'));
    if ((c.req.query('source') !== undefined && source === undefined) || (c.req.query('kind') !== undefined && kind === undefined)) return c.json({ error: 'bad-request' }, 400);
    return c.json(artifacts.list({ source, kind, sourceId: c.req.query('sourceId') }));
  });

  app.get('/_caduceus/api/artifacts/:id/content', (c) => {
    const opened = ID.test(c.req.param('id')) ? artifacts.open(c.req.param('id')) : undefined;
    if (opened === undefined) return c.json({ error: 'not-found' }, 404);
    return c.body(fs.readFileSync(opened.file), 200, contentHeaders(opened.artifact, c.req.query('download') === '1'));
  });

  /** Deleting is a T1 with an undo: the artifact leaves the list at once and its file goes when the window is over. */
  app.delete('/_caduceus/api/artifacts/:id', async (c) => {
    const gated = await gateRequest(policy, c, 'DELETE', BODY);
    if ('refusal' in gated) return gated.refusal;
    const removed = ID.test(c.req.param('id')) ? artifacts.remove(c.req.param('id')) : undefined;
    return removed === undefined ? c.json({ error: 'not-found', message: 'There is no such artifact.' }, 404) : c.json({ artifact: removed, undoMs: ARTIFACT_UNDO_MS });
  });

  app.post('/_caduceus/api/artifacts/:id/restore', async (c) => {
    const gated = await gateRequest(policy, c, 'POST', BODY);
    if ('refusal' in gated) return gated.refusal;
    const restored = ID.test(c.req.param('id')) ? artifacts.restore(c.req.param('id')) : undefined;
    return restored === undefined ? c.json({ error: 'not-found', message: 'The undo window is over, so that artifact cannot be brought back.' }, 404) : c.json({ artifact: restored });
  });

  app.put('/_caduceus/api/artifacts/:id/pin', async (c) => {
    const gated = await gateRequest(policy, c, 'PUT', BODY);
    if ('refusal' in gated) return gated.refusal;
    if (!isRecord(gated.body) || typeof gated.body.pinned !== 'boolean' || !ID.test(c.req.param('id'))) return c.json({ error: 'bad-request' }, 400);
    const pinned = artifacts.pin(c.req.param('id'), gated.body.pinned);
    return pinned === undefined ? c.json({ error: 'not-found' }, 404) : c.json({ artifact: pinned });
  });

  app.put('/_caduceus/api/artifacts-settings', async (c) => {
    const gated = await gateRequest(policy, c, 'PUT', BODY);
    if ('refusal' in gated) return gated.refusal;
    const bytes = isRecord(gated.body) ? gated.body.capBytes : undefined;
    if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < MIN_ARTIFACT_CAP_BYTES) return c.json({ error: 'bad-request', message: `The size cap must be a whole number of bytes, at least ${MIN_ARTIFACT_CAP_BYTES}.` }, 400);
    artifacts.setCapBytes(bytes);
    return c.json(artifacts.usage());
  });

  /** Keeps a file attached to a Kanban task as an artifact (the owner's choice, from the task's Attachments tab). */
  app.post('/_caduceus/api/artifacts/from-task', async (c) => {
    const gated = await gateRequest(policy, c, 'POST', BODY);
    if ('refusal' in gated) return gated.refusal;
    const body = gated.body;
    if (!isRecord(body) || typeof body.board !== 'string' || !BOARD.test(body.board) || typeof body.taskId !== 'string' || !TASK.test(body.taskId) || typeof body.attachmentId !== 'number' || !Number.isInteger(body.attachmentId)) return c.json({ error: 'bad-request' }, 400);
    const { board, taskId, attachmentId } = body;
    let task: Awaited<ReturnType<KanbanPort['task']>>;
    let attachment: Awaited<ReturnType<KanbanPort['attachments']>>[number] | undefined;
    let bytes: Uint8Array | undefined;
    try {
      task = await kanban.task(board, taskId);
      attachment = (await kanban.attachments(board, taskId)).find((candidate) => candidate.id === attachmentId);
      bytes = attachment === undefined ? undefined : await kanban.download(board, attachmentId);
    } catch {
      return c.json({ error: 'hermes-unavailable', message: 'Caduceus could not read the task from Hermes.' }, 502);
    }
    if (task === undefined || attachment === undefined || bytes === undefined) return c.json({ error: 'not-found', message: 'Hermes has no such attachment on that task.' }, 404);
    const origin = `kanban:${board}:${attachmentId}`;
    if (artifacts.knows(origin) === 'kept') return c.json({ error: 'already-kept', message: 'That file is already in Artifacts.' }, 409);
    artifacts.forget(origin);
    const kept = artifacts.add({ name: attachment.filename, bytes, mime: attachment.contentType, origin, source: { type: 'task', id: taskId, board, taskId, label: task.title } });
    return kept === undefined ? c.json({ error: 'too-large', message: 'That file is larger than Artifacts keeps.' }, 413) : c.json({ artifact: kept }, 201);
  });

  /**
   * Keeps a file a chat session worked on as an artifact (the owner's choice, from the chat's Artifacts tab). Hermes reads the file, and only where the file
   * guard lets the owner browse: never Hermes's keys or Caduceus's own folder, nor anything outside the folders Hermes is meant to use.
   */
  app.post('/_caduceus/api/artifacts/from-session', async (c) => {
    const gated = await gateRequest(policy, c, 'POST', BODY);
    if ('refusal' in gated) return gated.refusal;
    const body = gated.body;
    if (!isRecord(body) || typeof body.sessionId !== 'string' || !SESSION.test(body.sessionId) || typeof body.path !== 'string' || body.path === '' || (body.cwd !== undefined && (typeof body.cwd !== 'string' || !body.cwd.startsWith('/'))) || (body.profile !== undefined && (typeof body.profile !== 'string' || !PROFILE.test(body.profile))) || (body.title !== undefined && typeof body.title !== 'string')) return c.json({ error: 'bad-request' }, 400);
    if (!body.path.startsWith('/') && body.cwd === undefined) return c.json({ error: 'bad-request', message: 'A relative path needs the folder it is relative to.' }, 400);
    // Hermes lists a changed file by its path from the root of the repository, which is the chat's folder or one above it.
    const named = body.path.startsWith('/') ? body.path : [...parentsOf(body.cwd as string)].map((folder) => path.join(folder, body.path as string)).find((candidate) => fs.existsSync(candidate)) ?? path.join(body.cwd as string, body.path);
    const checked = files.check(named, 'browse');
    if (!checked.ok) return c.json({ error: 'refused', message: checked.reason === 'protected-path' ? 'That file is protected, so it cannot be kept.' : 'That file is outside the folders Hermes is meant to use.' }, 403);
    let response: Response;
    try {
      response = await backend.fetch(`/api/files/download?path=${encodeURIComponent(checked.path)}`);
    } catch {
      return c.json({ error: 'hermes-unavailable', message: 'Caduceus could not read the file from Hermes.' }, 502);
    }
    if (response.status === 404) return c.json({ error: 'not-found', message: 'Hermes has no such file.' }, 404);
    if (!response.ok) return c.json({ error: 'hermes-refused', message: `Hermes did not give the file (HTTP ${response.status}).` }, 502);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const title = body.title?.trim() ?? '';
    const kept = artifacts.add({ name: path.basename(checked.path), bytes, mime: response.headers.get('content-type'), source: { type: 'session', id: body.sessionId, ...(body.profile === undefined ? {} : { profile: body.profile }), label: title === '' ? 'Chat session' : title.slice(0, 200) } });
    return kept === undefined ? c.json({ error: 'too-large', message: 'That file is larger than Artifacts keeps.' }, 413) : c.json({ artifact: kept }, 201);
  });
}
