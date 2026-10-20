// Saving a cron script (M3 #12): `PUT /_caduceus/api/work/scripts` writes `<profile home>/scripts/<name>` through Hermes's own file endpoint.
// Hermes runs a cron job's script (and its monitor script) only from its profile's `scripts/` folder, and its file endpoint writes anywhere, so this
// is the file guard of the script editor: the name is a plain file name (never a path), the folder is the profile's own `scripts/` folder (a link out of
// the profile is refused), and the file is not a link (what a link points at is never written). It is a T3 (`CADUCEUS_OPERATIONS`): code that a
// scheduler will run. The profile's home is whatever Hermes says it is; nothing is kept.
import fs from 'node:fs';
import path from 'node:path';
import type { Hono } from 'hono';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { MAX_SCRIPT_BYTES, SCRIPT_FILE_NAME } from '@caduceus/contracts/script-files';
import { authClient, type AuthEnv } from './auth-routes.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { readBody } from './hermes-proxy.ts';
import type { RestPolicy } from './policy.ts';


export interface ScriptFilesDeps {
  backend: HermesBackend;
  policy: RestPolicy;
}

/** The home of a profile, from Hermes's list; `undefined` when Hermes has no such profile (or does not answer). */
async function homeOf(backend: HermesBackend, profile: string): Promise<string | undefined> {
  const res = await backend.fetch('/api/profiles').catch(() => undefined);
  const body: unknown = await res?.json().catch(() => undefined);
  const listed = isRecord(body) && Array.isArray(body.profiles) ? body.profiles : [];
  const found = listed.find((entry) => isRecord(entry) && entry.name === profile);
  return isRecord(found) && typeof found.path === 'string' && found.path !== '' ? found.path : undefined;
}

type Placed = { ok: true; folder: string; file: string; folderExists: boolean } | { ok: false };

/**
 * Where the script goes, or that it may not go there. The folder, when it is there, must resolve inside the profile's home (a `scripts` that is a
 * link to somewhere else is refused); the file, when it is there, must be a plain file and not a link.
 */
function placeScript(home: string, name: string): Placed {
  let root: string;
  try {
    root = fs.realpathSync.native(home);
  } catch {
    return { ok: false };
  }
  const declared = path.join(root, 'scripts');
  let folder = declared;
  let folderExists = true;
  try {
    folder = fs.realpathSync.native(declared);
  } catch {
    folderExists = false;
  }
  if (folderExists && (!folder.startsWith(`${root}/`) || !fs.statSync(folder).isDirectory())) return { ok: false };
  const file = path.join(folder, name);
  if (folderExists) {
    try {
      const existing = fs.lstatSync(file);
      if (existing.isSymbolicLink() || !existing.isFile()) return { ok: false };
    } catch {
      // Not there yet: the common case.
    }
  }
  return { ok: true, folder, file, folderExists };
}

export function mountScriptFiles(app: Hono<AuthEnv>, { backend, policy }: ScriptFilesDeps): void {
  app.put('/_caduceus/api/work/scripts', async (c) => {
    const url = new URL(c.req.url);
    const requester = { sessionId: c.get('session')?.id, source: authClient(c).source };
    const prepared = policy.prepare('PUT', url.pathname, requester);
    if (!prepared.allow) return c.json(prepared.body, prepared.status);
    const raw = await readBody(c.req.raw, MAX_SCRIPT_BYTES + 4096);
    if (raw === 'too-large') return c.json({ error: 'payload-too-large' }, 413);
    let request: unknown;
    try {
      request = JSON.parse(Buffer.from(raw).toString('utf8'));
    } catch {
      request = undefined;
    }
    if (!isRecord(request) || typeof request.profile !== 'string' || typeof request.content !== 'string' || typeof request.name !== 'string') return c.json({ error: 'bad-request' }, 400);
    const { profile, name, content } = request;
    if (!SCRIPT_FILE_NAME.test(name)) return c.json({ error: 'bad-script-name', message: 'A script’s name is a file name: letters, digits, dots, dashes and underscores, not starting with a dot.' }, 400);
    if (Buffer.byteLength(content) > MAX_SCRIPT_BYTES) return c.json({ error: 'payload-too-large' }, 413);
    const home = await homeOf(backend, profile);
    if (home === undefined) return c.json({ error: 'no-such-profile' }, 404);
    // What is refused here costs the owner no confirmation: it is settled before the step-up and the typed name are asked for.
    const placed = placeScript(home, name);
    if (!placed.ok) return c.json({ error: 'outside-scripts', message: 'That would write outside the profile’s scripts folder, so Caduceus did not.' }, 403);
    const decision = await policy.decide(prepared, { method: 'PUT', search: url.search, contentType: c.req.header('content-type'), confirmation: c.req.header('x-caduceus-confirmation'), body: raw }, requester);
    if (!decision.allow) return c.json(decision.body, decision.status);
    const ask = async (route: string, body: Record<string, unknown>) => backend.fetch(route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => undefined);
    // Hermes writes a file only into a folder that is there.
    if (!placed.folderExists) {
      const made = await ask('/api/files/mkdir', { path: placed.folder });
      if (made === undefined || !made.ok) return c.json({ error: 'hermes-refused', message: 'Hermes could not make the scripts folder.' }, 502);
      // The folder was made by Hermes just now: it is checked again, as a link planted in the meantime is no better than one that was there.
      if (!placeScript(home, name).ok) return c.json({ error: 'outside-scripts', message: 'That would write outside the profile’s scripts folder, so Caduceus did not.' }, 403);
    }
    const written = await ask('/api/fs/write-text', { path: placed.file, content });
    if (written === undefined || !written.ok) return c.json({ error: 'hermes-refused', message: 'Hermes did not save the script.' }, 502);
    return c.json({ name, path: placed.file, bytes: Buffer.byteLength(content) });
  });
}
