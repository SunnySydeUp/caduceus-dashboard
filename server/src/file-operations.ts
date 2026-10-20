// The guarded file operations (R11, M7 #02; architecture §2): renaming and moving a file or a folder, and saving an Office document. Hermes has no
// API for the first two, so the Caduceus server does them on disk itself; every path is canonicalised (links resolved, `..` followed) and judged by the
// file guard, which keeps them inside the roots Hermes's file API exposes and off `.env`, `auth.json` and `caduceus/`. What is refused here is settled before
// the confirmation is asked for, so the owner is never asked about something that cannot happen. Each operation is audited with its source, its target and
// the profile. A request is judged by the policy first (`CADUCEUS_OPERATIONS`): the tiers, read-only mode and the typed confirmation are the policy's.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Context, Hono } from 'hono';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { DENIED_MESSAGES, type DeniedReason, type Tier } from '@caduceus/contracts/policy/tiers';
import type { AuditLog } from './audit-log.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { authClient, type AuthEnv } from './auth-routes.ts';
import type { FileGuard } from './file-guard.ts';
import { readBody } from './hermes-proxy.ts';
import type { Prepared, RestPolicy } from './policy.ts';

export interface FileOperationsDeps {
  policy: RestPolicy;
  files: FileGuard;
  audit: AuditLog;
  store: CaduceusStore;
  /** Hermes's file API writes the Office document (see `saveOffice`). */
  backend: HermesBackend;
  now: () => number;
}

/** The documents the Office editor opens and saves: the three Office Open XML formats. */
export const OFFICE_EXTENSIONS: readonly string[] = ['.docx', '.xlsx', '.pptx'];
/** The largest Office document the editor opens and saves. */
export const OFFICE_MAX_BYTES = 25 * 1024 * 1024;
/** How many versions an Office document keeps: the newest ones. */
export const OFFICE_SNAPSHOTS_PER_FILE = 5;
/** What every Office Open XML file starts with: it is a zip archive. */
const ZIP_MAGIC = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** A request for a rename or a move is a few names; anything longer is not one. */
const SMALL_BODY_BYTES = 16 * 1024;
/** A file name as the file system takes it. */
const MAX_NAME_BYTES = 255;

type Requester = { sessionId: string | undefined; source: string };

/** A request that passed the policy's classification: who sent it, and what it says. */
interface Started {
  prepared: Prepared;
  requester: Requester;
  body: Record<string, unknown>;
  raw: Uint8Array<ArrayBuffer>;
  search: string;
}
type Refusal = { status: 400 | 403 | 404 | 409 | 413; body: { error: string; message: string; tier?: 'denied'; reason?: DeniedReason } };

const refusal = (status: Refusal['status'], error: string, message: string): Refusal => ({ status, body: { error, message } });

/** A name that is a name and not a path: what a rename may give a file. */
function nameProblem(name: string): string | undefined {
  if (name.trim() === '' || name === '.' || name === '..') return 'Give the new name: a file name, not a path.';
  if (name.includes('/') || name.includes('\\') || name.includes('\0')) return 'A name cannot hold a slash or a backslash: it is a file name, not a path. Use Move to… to change the folder.';
  if (Buffer.byteLength(name) > MAX_NAME_BYTES) return 'That name is too long for the file system.';
  return undefined;
}

/** `lstat` that answers `undefined` for a path that is not there. */
function lstat(target: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(target);
  } catch {
    return undefined;
  }
}

/**
 * What a rename or a move works on, as the file guard sees it: the canonical path of the source, which must be there and must be itself, not a link
 * (renaming the target of a link instead of the link is not what was asked for).
 */
function sourceOf(files: FileGuard, raw: string): { ok: true; path: string; directory: boolean } | { ok: false; refusal: Refusal } {
  if (!path.isAbsolute(raw)) return { ok: false, refusal: refusal(400, 'bad-path', DENIED_MESSAGES['bad-path']) };
  const checked = files.check(raw, 'relocate');
  if (!checked.ok) return { ok: false, refusal: { status: 403, body: { error: 'denied', tier: 'denied', reason: checked.reason, message: DENIED_MESSAGES[checked.reason] } } };
  const stat = lstat(path.resolve(raw));
  if (!stat) return { ok: false, refusal: refusal(404, 'not-found', 'There is nothing at that path. It may have been moved or deleted.') };
  if (stat.isSymbolicLink()) return { ok: false, refusal: refusal(400, 'is-link', 'That is a link. Caduceus renames and moves files and folders, not links.') };
  return { ok: true, path: checked.path, directory: stat.isDirectory() };
}

/** Where the new name or place is: it must pass the guard too (a rename to `.env` is a way to a protected name). */
function placeOf(files: FileGuard, target: string): Refusal | undefined {
  const checked = files.check(target, 'write');
  return checked.ok ? undefined : { status: 403, body: { error: 'denied', tier: 'denied', reason: checked.reason, message: DENIED_MESSAGES[checked.reason] } };
}

/** Whether the two paths are one file, whatever the case they are written in (a case-insensitive file system names it both ways). */
function sameFile(a: string, b: string): boolean {
  const first = lstat(a);
  const second = lstat(b);
  return first !== undefined && second !== undefined && first.dev === second.dev && first.ino === second.ino;
}

/**
 * Puts `source` at `target` and never over something that is there: a file is linked in place first (which fails if the name is taken, and cannot
 * overwrite), then the old name is removed; a folder is renamed after a check just before. Across file systems it is copied, then the original removed.
 * Returns `false` when the name is taken.
 */
function place(source: string, target: string, directory: boolean): boolean {
  if (lstat(target) && !sameFile(source, target)) return false;
  try {
    if (directory || sameFile(source, target)) {
      fs.renameSync(source, target);
      return true;
    }
    fs.linkSync(source, target);
    fs.unlinkSync(source);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST' || code === 'ENOTEMPTY') return false;
    // A file system without hard links, or a move to another one: copy, never over a file, then remove the original.
    if (code !== 'EXDEV' && code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EMLINK') throw error;
  }
  if (directory) {
    fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    fs.rmSync(source, { recursive: true });
  } else {
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    fs.unlinkSync(source);
  }
  return true;
}

export function mountFileOperations(app: Hono<AuthEnv>, { policy, files, audit, store, backend, now }: FileOperationsDeps): void {
  const { db } = store;
  /** The request line judged, its small JSON body read; or the answer that stops it. */
  const begin = async (c: Context<AuthEnv>, method: 'POST' | 'PUT', maxBytes = SMALL_BODY_BYTES): Promise<Started | Response> => {
    const url = new URL(c.req.url);
    const requester: Requester = { sessionId: c.get('session')?.id, source: authClient(c).source };
    const prepared = policy.prepare(method, url.pathname, requester);
    if (!prepared.allow) return c.json(prepared.body, prepared.status);
    const raw = await readBody(c.req.raw, maxBytes);
    if (raw === 'too-large') return c.json({ error: 'payload-too-large', message: 'The request is too large.' }, 413);
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(raw).toString('utf8'));
    } catch {
      parsed = undefined;
    }
    if (!isRecord(parsed)) return c.json({ error: 'bad-request', message: 'The request is not a JSON object.' }, 400);
    return { prepared, requester, body: parsed, raw, search: url.search };
  };

  /** The policy's decision (tier, read-only mode, step-up and the typed confirmation), or the answer that stops the request. */
  const decide = async (c: Context<AuthEnv>, method: 'POST' | 'PUT', started: Started): Promise<Response | { tier: Tier }> => {
    const decision = await policy.decide(started.prepared, { method, search: started.search, contentType: c.req.header('content-type'), confirmation: c.req.header('x-caduceus-confirmation'), body: started.raw }, started.requester);
    return decision.allow ? { tier: decision.tier } : c.json(decision.body, decision.status);
  };

  const record = (started: Started, action: string, target: string, tier: Tier) => {
    const profile = typeof started.body.profile === 'string' && started.body.profile !== '' ? started.body.profile : undefined;
    audit.record({ actor: 'owner', action, target, source: started.requester.source, tier, profile });
  };

  const deny = (c: Context<AuthEnv>, started: Started, stopped: Refusal) => {
    if (stopped.body.error === 'denied') audit.record({ actor: 'owner', action: 'policy.denied', target: `${c.req.method} ${new URL(c.req.url).pathname}`, source: started.requester.source, tier: 'denied' });
    return c.json(stopped.body, stopped.status);
  };

  app.post('/_caduceus/api/files/rename', async (c) => {
    const started = await begin(c, 'POST');
    if (started instanceof Response) return started;
    const { path: raw, name } = started.body;
    if (typeof raw !== 'string' || typeof name !== 'string') return c.json({ error: 'bad-request', message: 'A rename names the path and the new name.' }, 400);
    const problem = nameProblem(name);
    if (problem) return c.json({ error: 'bad-name', message: problem }, 400);
    const source = sourceOf(files, raw);
    if (!source.ok) return deny(c, started, source.refusal);
    const target = path.join(path.dirname(source.path), name);
    const blocked = placeOf(files, target);
    if (blocked) return deny(c, started, blocked);
    if (target === source.path) return c.json({ error: 'same-name', message: 'That is the name it already has.' }, 400);
    const decided = await decide(c, 'POST', started);
    if (decided instanceof Response) return decided;
    if (!place(source.path, target, source.directory)) return c.json({ error: 'name-taken', message: `There is already a file or folder named ${name} here, so nothing was renamed.` }, 409);
    record(started, 'files.rename', `${source.path} → ${target}`, decided.tier);
    return c.json({ from: source.path, to: target });
  });
  app.post('/_caduceus/api/files/move', async (c) => {
    const started = await begin(c, 'POST');
    if (started instanceof Response) return started;
    const { path: raw, destination } = started.body;
    if (typeof raw !== 'string' || typeof destination !== 'string') return c.json({ error: 'bad-request', message: 'A move names the path and the folder to move it into.' }, 400);
    const source = sourceOf(files, raw);
    if (!source.ok) return deny(c, started, source.refusal);
    if (!path.isAbsolute(destination)) return c.json({ error: 'bad-path', message: DENIED_MESSAGES['bad-path'] }, 400);
    const folder = files.check(destination, 'write');
    if (!folder.ok) return deny(c, started, { status: 403, body: { error: 'denied', tier: 'denied', reason: folder.reason, message: DENIED_MESSAGES[folder.reason] } });
    const folderStat = lstat(folder.path);
    if (!folderStat?.isDirectory()) return c.json({ error: 'not-a-folder', message: 'The destination is not a folder that is there.' }, 400);
    const target = path.join(folder.path, path.basename(source.path));
    const blocked = placeOf(files, target);
    if (blocked) return deny(c, started, blocked);
    if (target === source.path) return c.json({ error: 'same-folder', message: 'It is already in that folder.' }, 400);
    if (source.directory && (folder.path === source.path || folder.path.startsWith(`${source.path}/`))) return c.json({ error: 'into-itself', message: 'A folder cannot be moved into itself.' }, 400);
    const decided = await decide(c, 'POST', started);
    if (decided instanceof Response) return decided;
    if (!place(source.path, target, source.directory)) return c.json({ error: 'name-taken', message: `There is already a file or folder named ${path.basename(target)} in that folder, so nothing was moved.` }, 409);
    record(started, 'files.move', `${source.path} → ${target}`, decided.tier);
    return c.json({ from: source.path, to: target });
  });
  /** The Office document a request names: a regular file, not a link, with an Office extension, inside the roots. */
  const officeOf = (raw: string): { ok: true; path: string; inWorkspace: boolean } | { ok: false; refusal: Refusal } => {
    if (!path.isAbsolute(raw)) return { ok: false, refusal: refusal(400, 'bad-path', DENIED_MESSAGES['bad-path']) };
    if (!OFFICE_EXTENSIONS.includes(path.extname(raw).toLowerCase())) return { ok: false, refusal: refusal(400, 'not-office', 'Only Word (.docx), Excel (.xlsx) and PowerPoint (.pptx) documents open in the Office editor.') };
    const checked = files.check(raw, 'write');
    if (!checked.ok) return { ok: false, refusal: { status: 403, body: { error: 'denied', tier: 'denied', reason: checked.reason, message: DENIED_MESSAGES[checked.reason] } } };
    const stat = lstat(path.resolve(raw));
    if (!stat?.isFile()) return { ok: false, refusal: refusal(404, 'not-found', 'There is no such document. It may have been moved or deleted.') };
    if (stat.size > OFFICE_MAX_BYTES) return { ok: false, refusal: refusal(413, 'payload-too-large', 'That document is too large for the Office editor.') };
    return { ok: true, path: checked.path, inWorkspace: checked.inWorkspace };
  };

  const sha256 = (bytes: Uint8Array) => crypto.createHash('sha256').update(bytes).digest('hex');

  app.put('/_caduceus/api/files/office', async (c) => {
    const started = await begin(c, 'PUT', Math.ceil((OFFICE_MAX_BYTES * 4) / 3) + SMALL_BODY_BYTES);
    if (started instanceof Response) return started;
    const { path: raw, content, base } = started.body;
    if (typeof raw !== 'string' || typeof content !== 'string' || typeof base !== 'string') return c.json({ error: 'bad-request', message: 'An Office save names the path, the new content and the fingerprint of the document it was opened from.' }, 400);
    const document = officeOf(raw);
    if (!document.ok) return deny(c, started, document.refusal);
    const bytes = Buffer.from(content, 'base64');
    if (bytes.length > OFFICE_MAX_BYTES) return c.json({ error: 'payload-too-large', message: 'That document is too large for the Office editor.' }, 413);
    if (!bytes.subarray(0, ZIP_MAGIC.length).equals(ZIP_MAGIC)) return c.json({ error: 'not-office', message: 'The content is not an Office document (it is not a zip archive), so nothing was saved.' }, 400);
    const current = fs.readFileSync(document.path);
    // What the editor opened is what it names: a file that changed since is never overwritten.
    if (sha256(current) !== base) return c.json({ error: 'conflict', message: 'The document changed on disk after you opened it, so it was not overwritten. Reload it to start from what is there now.' }, 409);
    const decided = await decide(c, 'PUT', started);
    if (decided instanceof Response) return decided;
    // The old bytes are kept before anything is written; if they cannot be, nothing is.
    db.prepare('INSERT INTO file_byte_snapshots (target, at, bytes) VALUES (?, ?, ?)').run(document.path, now(), current);
    db.prepare('DELETE FROM file_byte_snapshots WHERE target = ? AND id NOT IN (SELECT id FROM file_byte_snapshots WHERE target = ? ORDER BY id DESC LIMIT ?)').run(document.path, document.path, OFFICE_SNAPSHOTS_PER_FILE);
    // Hermes's streaming upload replaces a file in place (it writes beside it and renames), so the save goes through Hermes (R11 is for what Hermes cannot do).
    const form = new FormData();
    form.set('path', document.path);
    form.set('overwrite', 'true');
    form.set('file', new Blob([bytes]), path.basename(document.path));
    const upload = await backend.fetch('/api/files/upload-stream', { method: 'POST', body: form }).catch(() => undefined);
    if (upload === undefined || !upload.ok) return c.json({ error: 'hermes-refused', message: 'Hermes did not save the document. The old version is unchanged and is kept as a snapshot.' }, 502);
    // A save inside a workspace Caduceus knows is a T1, elsewhere (a protected area) a T3: the policy has judged it that way.
    record(started, 'files.office-save', document.path, document.inWorkspace ? 'T1' : 'T3');
    return c.json({ path: document.path, bytes: bytes.length, sha256: sha256(bytes) });
  });

  app.get('/_caduceus/api/files/office-snapshots', (c) => {
    const document = officeOf(c.req.query('path') ?? '');
    if (!document.ok) return c.json(document.refusal.body, document.refusal.status);
    const rows = db.prepare('SELECT id, at, length(bytes) AS bytes FROM file_byte_snapshots WHERE target = ? ORDER BY id DESC').all(document.path) as { id: number; at: number; bytes: number }[];
    return c.json({ snapshots: rows.map((row) => ({ id: row.id, at: new Date(row.at).toISOString(), bytes: row.bytes })) });
  });

  app.get('/_caduceus/api/files/office-snapshots/:id', (c) => {
    const row = db.prepare('SELECT bytes FROM file_byte_snapshots WHERE id = ?').get(Number(c.req.param('id'))) as { bytes: Uint8Array } | undefined;
    if (!row) return c.json({ error: 'not-found', message: 'There is no such version.' }, 404);
    return new Response(row.bytes as Uint8Array<ArrayBuffer>, { headers: { 'content-type': 'application/octet-stream', 'content-disposition': 'attachment' } });
  });
}
