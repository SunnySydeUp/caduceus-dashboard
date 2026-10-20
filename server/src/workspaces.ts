// The workspace registry (M3 #10; work model §4): the named directories the owner offers in the composer's workspace chip and the Brief editor.
// It is Caduceus's own list (the `workspaces` table of the store) and the only thing Caduceus keeps about projects and spaces; Hermes's projects
// are read from Hermes every time. A folder is added only when the file guard allows it (inside the folders Hermes may write to, never a
// protected one) and Hermes's own file list finds it, so what the registry names is a folder Hermes can use. Removing an entry forgets the name:
// the folder and its files are never touched. The registered paths also feed the file guard, where a raw file write inside one is a T1.
import { randomBytes } from 'node:crypto';
import type { Context, Hono } from 'hono';
import type { Workspace } from '@caduceus/contracts/caduceus-api';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { authClient, type AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import type { FileGuard } from './file-guard.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { readBody } from './hermes-proxy.ts';
import type { RestPolicy } from './policy.ts';

const MAX_NAME = 60;
const MAX_WORKSPACES = 50;
const MAX_BODY = 8_192;
const ROUTE = '/_caduceus/api/work/workspaces';

/** A name as stored: trimmed, one line, not empty, not long. */
function workspaceName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const name = value.replace(/\s+/g, ' ').trim();
  return name === '' || name.length > MAX_NAME ? undefined : name;
}

/** The last folder of a path, for an entry the owner did not name. */
function folderName(folderPath: string): string {
  const name = folderPath.replace(/\/+$/, '').split('/').pop() ?? '';
  return name === '' ? folderPath : name.slice(0, MAX_NAME);
}

export interface WorkspaceRegistry {
  /** The entries, in the owner's order. */
  list(): Workspace[];
  /** Their paths: the workspaces the file guard knows. */
  paths(): string[];
}

export function createWorkspaceRegistry(store: CaduceusStore): WorkspaceRegistry {
  const list = () => store.db.prepare('SELECT id, name, path FROM workspaces ORDER BY position').all() as unknown as Workspace[];
  return { list, paths: () => list().map((entry) => entry.path) };
}

export interface WorkspaceRoutesDeps {
  store: CaduceusStore;
  registry: WorkspaceRegistry;
  files: FileGuard;
  backend: HermesBackend;
  policy: RestPolicy;
}

export function mountWorkspaces(app: Hono<AuthEnv>, { store, registry, files, backend, policy }: WorkspaceRoutesDeps): void {
  const { db } = store;

  /**
   * Runs the request through the policy (its tier, read-only mode, the audit entry) and reads its JSON body. Returns the refusal to answer with,
   * or the body (`undefined` when the request has none or it is not JSON, which the route then refuses as a bad request).
   */
  async function gate(c: Context<AuthEnv, string>, method: string): Promise<{ refusal: Response } | { body: unknown }> {
    const url = new URL(c.req.url);
    const requester = { sessionId: c.get('session')?.id, source: authClient(c).source };
    const prepared = policy.prepare(method, url.pathname, requester);
    if (!prepared.allow) return { refusal: c.json(prepared.body, prepared.status) };
    const raw = await readBody(c.req.raw, MAX_BODY);
    if (raw === 'too-large') return { refusal: c.json({ error: 'payload-too-large' }, 413) };
    const decision = await policy.decide(prepared, { method, search: url.search, contentType: c.req.header('content-type'), confirmation: c.req.header('x-caduceus-confirmation'), body: raw }, requester);
    if (!decision.allow) return { refusal: c.json(decision.body, decision.status) };
    try {
      return { body: raw.length === 0 ? undefined : (JSON.parse(Buffer.from(raw).toString('utf8')) as unknown) };
    } catch {
      return { body: undefined };
    }
  }

  app.get(ROUTE, (c) => c.json({ workspaces: registry.list() }));

  app.post(ROUTE, async (c) => {
    const gated = await gate(c, 'POST');
    if ('refusal' in gated) return gated.refusal;
    const body = gated.body;
    const given = isRecord(body) ? body.path : undefined;
    const named = isRecord(body) && body.name !== undefined ? workspaceName(body.name) : undefined;
    if (typeof given !== 'string' || (isRecord(body) && body.name !== undefined && named === undefined)) return c.json({ error: 'bad-request' }, 400);
    const check = files.check(given, 'workspace');
    if (!check.ok) {
      const messages = {
        'bad-path': 'Give the full path of a folder on the Mac that runs Hermes, such as /Users/you/project.',
        'outside-roots': 'This folder is outside the folders Caduceus lets Hermes work in, so it cannot be a workspace.',
        'protected-path': 'This folder holds Hermes’s keys or Caduceus’s own data, so it cannot be a workspace.',
        'secret-path': 'This folder holds keys or credentials, so it cannot be a workspace.',
        'persistence-path': 'This folder is one that runs code later (a shell start-up file, SSH, launch agents or Hermes’s own scripts and skills), so it cannot be a workspace.',
      } as const;
      return c.json({ error: check.reason, message: messages[check.reason] }, check.reason === 'bad-path' ? 400 : 403);
    }
    const entries = registry.list();
    if (entries.length >= MAX_WORKSPACES) return c.json({ error: 'too-many-workspaces', message: `Caduceus keeps up to ${MAX_WORKSPACES} workspaces.` }, 409);
    // Hermes's own file list is the check that Hermes can see the folder: a path that is not there is an `ENOENT` answer, not an HTTP error.
    let listing: unknown;
    try {
      const answer = await backend.fetch(`/api/fs/list?path=${encodeURIComponent(check.path)}`);
      listing = answer.ok ? await answer.json() : undefined;
    } catch {
      listing = undefined;
    }
    if (!isRecord(listing)) return c.json({ error: 'hermes-unavailable', message: 'Hermes did not answer, so the folder could not be checked.' }, 502);
    if (listing.error === 'ENOENT') return c.json({ error: 'not-found', message: 'Hermes does not find this folder on the Mac that runs it.' }, 422);
    if (listing.error === 'ENOTDIR') return c.json({ error: 'not-a-folder', message: 'This path is a file, not a folder.' }, 422);
    if (typeof listing.error === 'string') return c.json({ error: 'unreadable', message: `Hermes cannot read this folder (${listing.error}).` }, 422);
    if (entries.some((entry) => entry.path === check.path)) return c.json({ error: 'duplicate-path', message: 'This folder is already a workspace.' }, 409);
    const entry: Workspace = { id: `w_${randomBytes(5).toString('hex')}`, name: named ?? folderName(check.path), path: check.path };
    const { next } = db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS next FROM workspaces').get() as { next: number };
    db.prepare('INSERT INTO workspaces (id, name, path, position) VALUES (?, ?, ?, ?)').run(entry.id, entry.name, entry.path, next);
    return c.json(entry, 201);
  });

  // Registered before `/:id`, which would otherwise take `order` for an id.
  app.put(`${ROUTE}/order`, async (c) => {
    const gated = await gate(c, 'PUT');
    if ('refusal' in gated) return gated.refusal;
    const ids = isRecord(gated.body) && Array.isArray(gated.body.ids) ? gated.body.ids : undefined;
    const known = registry.list().map((entry) => entry.id);
    if (ids === undefined || ids.length !== known.length || new Set(ids).size !== ids.length || !ids.every((id) => typeof id === 'string' && known.includes(id))) return c.json({ error: 'bad-request' }, 400);
    db.exec('BEGIN');
    ids.forEach((id, index) => db.prepare('UPDATE workspaces SET position = ? WHERE id = ?').run(index + 1, id as string));
    db.exec('COMMIT');
    return c.json({ workspaces: registry.list() });
  });

  app.put(`${ROUTE}/:id`, async (c) => {
    const gated = await gate(c, 'PUT');
    if ('refusal' in gated) return gated.refusal;
    const name = isRecord(gated.body) ? workspaceName(gated.body.name) : undefined;
    if (name === undefined) return c.json({ error: 'bad-request' }, 400);
    const current = registry.list().find((entry) => entry.id === c.req.param('id'));
    if (!current) return c.json({ error: 'not-found' }, 404);
    db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name, current.id);
    return c.json({ ...current, name } satisfies Workspace);
  });

  app.delete(`${ROUTE}/:id`, async (c) => {
    const gated = await gate(c, 'DELETE');
    if ('refusal' in gated) return gated.refusal;
    const current = registry.list().find((entry) => entry.id === c.req.param('id'));
    if (!current) return c.json({ error: 'not-found' }, 404);
    // The registry forgets the entry. The folder is not Caduceus's to touch.
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(current.id);
    return c.body(null, 204);
  });
}
