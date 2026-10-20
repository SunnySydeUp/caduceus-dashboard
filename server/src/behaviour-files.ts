// The behaviour files of a profile (M4 #02): SOUL.md, AGENTS.md / HERMES.md, MEMORY.md / USER.md and config.yaml. Hermes holds
// them and the page writes them through the policy proxy like any other Hermes route; Caduceus adds two things (architecture §2,
// R1; §5, the file-write rule): before a write is forwarded, the text it replaces is kept as a snapshot (a ring buffer per file),
// and a write that names the text it was made from is refused when the file has changed since (`409`, with the text now there).
import crypto from 'node:crypto';
import path from 'node:path';
import type { Hono } from 'hono';
import type { FileSnapshot } from '@caduceus/contracts/caduceus-api';
import type { AuthEnv } from './auth-routes.ts';
import type { CaduceusStore } from './caduceus-store.ts';
import type { FileGuard } from './file-guard.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { maskRawConfig } from './config-raw.ts';

/** How many snapshots a file keeps: the newest ones. */
export const SNAPSHOTS_PER_FILE = 20;

/** The header a save carries: the SHA-256 (hex) of the text the editor loaded. */
export const BASE_HEADER = 'x-caduceus-base-sha256';

/** A write Caduceus refuses before it reaches Hermes. */
export interface WriteRefusal {
  status: 400 | 409 | 502;
  body: { error: string; message: string; current?: string };
}

/** The write about to be forwarded: what the policy matched, the query, the body and the base the page named. */
export interface PendingWrite {
  operation: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Uint8Array | undefined;
  baseSha256: string | undefined;
}

export interface BehaviourFiles {
  /** Checks a write that the policy has already allowed, and keeps what it replaces. A refusal is the answer; `undefined` means: forward it. */
  beforeWrite(write: PendingWrite): Promise<WriteRefusal | undefined>;
  mount(app: Hono<AuthEnv>): void;
}

export interface BehaviourFilesDeps {
  store: CaduceusStore;
  backend: HermesBackend;
  files: FileGuard;
  now: () => number;
}

const sha256 = (text: string) => crypto.createHash('sha256').update(text).digest('hex');

type Current = { ok: true; text: string } | { ok: false; reason: 'truncated' | 'unreadable' };

/** What a target is: a key for the store and the way to read the file now. */
interface Target {
  key: string;
  /** The file is a config.yaml: the page sees it with its credentials masked (`config-raw.ts`), so a snapshot and a base name that text. */
  config: boolean;
  read(): Promise<Current>;
}

export function createBehaviourFiles({ store, backend, files, now }: BehaviourFilesDeps): BehaviourFiles {
  const { db } = store;

  const getJson = async (route: string): Promise<{ status: number; body: Record<string, unknown> } | undefined> => {
    try {
      const res = await backend.fetch(route);
      const body: unknown = await res.json().catch(() => ({}));
      return { status: res.status, body: typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {} };
    } catch {
      return undefined;
    }
  };

  const soul = (profile: string): Target => ({
    key: `soul:${profile}`,
    config: false,
    async read() {
      const answer = await getJson(`/api/profiles/${encodeURIComponent(profile)}/soul`);
      if (answer?.status !== 200 || typeof answer.body.content !== 'string') return { ok: false, reason: 'unreadable' };
      return { ok: true, text: answer.body.content };
    },
  });
  const config = (profile: string): Target => ({
    key: `config:${profile}`,
    config: true,
    async read() {
      const answer = await getJson(`/api/config/raw?profile=${encodeURIComponent(profile)}`);
      if (answer?.status !== 200 || typeof answer.body.yaml !== 'string') return { ok: false, reason: 'unreadable' };
      return { ok: true, text: answer.body.yaml };
    },
  });
  const file = (resolved: string): Target => ({
    key: `file:${resolved}`,
    config: path.basename(resolved).toLowerCase() === 'config.yaml',
    async read() {
      const answer = await getJson(`/api/fs/read-text?path=${encodeURIComponent(resolved)}`);
      // A file that is not there yet has nothing to keep.
      if (answer?.status === 404) return { ok: true, text: '' };
      if (answer?.status !== 200 || typeof answer.body.text !== 'string') return { ok: false, reason: 'unreadable' };
      if (answer.body.truncated === true) return { ok: false, reason: 'truncated' };
      return { ok: true, text: answer.body.text };
    },
  });

  /** The target a write or a listing is about, from what the request says; `undefined` when it names nothing usable. */
  const targetOf = (kind: string | null | undefined, profile: string | null | undefined, rawPath: string | null | undefined): Target | undefined => {
    if ((kind === 'soul' || kind === 'config') && profile) return kind === 'soul' ? soul(profile) : config(profile);
    if (kind === 'file' && rawPath) {
      const checked = files.check(rawPath, 'read');
      return checked.ok ? file(checked.path) : undefined;
    }
    return undefined;
  };

  const keep = (target: string, text: string) => {
    const newest = db.prepare('SELECT text FROM file_snapshots WHERE target = ? ORDER BY id DESC LIMIT 1').get(target) as { text: string } | undefined;
    if (newest?.text === text) return;
    db.prepare('INSERT INTO file_snapshots (target, at, text) VALUES (?, ?, ?)').run(target, now(), text);
    db.prepare('DELETE FROM file_snapshots WHERE target = ? AND id NOT IN (SELECT id FROM file_snapshots WHERE target = ? ORDER BY id DESC LIMIT ?)').run(target, target, SNAPSHOTS_PER_FILE);
  };

  const jsonBody = (body: Uint8Array | undefined): Record<string, unknown> => {
    try {
      const parsed: unknown = JSON.parse(Buffer.from(body ?? new Uint8Array()).toString('utf8'));
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  };

  /** A reset, or an edit or delete of a learning-graph memory chunk, changes MEMORY.md and USER.md; what they hold is kept first, as the snapshot of each file. */
  const keepMemoryFiles = async (profile: string, names: readonly string[], action: string): Promise<WriteRefusal | undefined> => {
    const listed = await getJson('/api/profiles');
    const profiles = Array.isArray(listed?.body.profiles) ? (listed.body.profiles as { name?: unknown; path?: unknown }[]) : [];
    const home = profiles.find((candidate) => candidate.name === profile)?.path;
    if (typeof home !== 'string') return { status: 502, body: { error: 'snapshot-failed', message: `Caduceus could not find the profile’s folder to keep a snapshot first, so nothing was ${action}.` } };
    const targets = names.flatMap((name) => {
      const checked = files.check(path.join(home, 'memories', name), 'read');
      return checked.ok ? [file(checked.path)] : [];
    });
    const reads = await Promise.all(targets.map((target) => target.read()));
    if (reads.some((read) => !read.ok)) return { status: 502, body: { error: 'snapshot-failed', message: `Caduceus could not read the memory files to keep a snapshot of them first, so nothing was ${action}.` } };
    reads.forEach((read, index) => read.ok && read.text !== '' && keep(targets[index].key, read.text));
    return undefined;
  };

  return {
    async beforeWrite({ operation, params, query, body, baseSha256 }) {
      if (operation === 'POST /api/memory/reset') {
        const requested = jsonBody(body).target;
        return keepMemoryFiles(query.getAll('profile').at(-1) ?? 'default', requested === 'memory' ? ['MEMORY.md'] : requested === 'user' ? ['USER.md'] : ['MEMORY.md', 'USER.md'], 'reset');
      }
      if (operation === 'PUT /api/learning/node' || operation === 'DELETE /api/learning/node') {
        // A memory chunk is a piece of MEMORY.md (`memory:memory:<n>`) or USER.md (`memory:profile:<n>`); Hermes rewrites that file. A skill is not kept here.
        const { id, profile } = jsonBody(body);
        const file = typeof id === 'string' ? ({ 'memory:memory': 'MEMORY.md', 'memory:profile': 'USER.md' } as Record<string, string>)[id.split(':').slice(0, 2).join(':')] : undefined;
        return file ? keepMemoryFiles(typeof profile === 'string' && profile !== '' ? profile : 'default', [file], 'changed') : undefined;
      }
      let target: Target | undefined;
      if (operation === 'PUT /api/profiles/{name}/soul') target = soul(params.name);
      else if (operation === 'PUT /api/config/raw') {
        const bodyProfile = jsonBody(body).profile;
        const queryProfile = query.getAll('profile').at(-1);
        // Hermes takes the body's profile before the query's; a request that names two is one the page never sends.
        if (typeof bodyProfile === 'string' && bodyProfile !== '' && bodyProfile !== queryProfile) {
          return { status: 400, body: { error: 'profile-mismatch', message: 'The request names one profile in its address and another in its body, so it was not sent.' } };
        }
        if (queryProfile) target = config(queryProfile);
      } else if (operation === 'POST /api/fs/write-text') {
        const raw = jsonBody(body).path;
        const checked = typeof raw === 'string' ? files.check(raw, 'write') : undefined;
        if (checked?.ok) target = file(checked.path);
      }
      if (!target) return undefined;

      const current = await target.read();
      if (!current.ok) {
        return {
          status: 502,
          body: {
            error: current.reason === 'truncated' ? 'file-too-large' : 'snapshot-failed',
            message: current.reason === 'truncated' ? 'This file is too large to keep a snapshot of, so it was not changed.' : 'Caduceus could not read the file to keep a snapshot of it first, so it was not changed.',
          },
        };
      }
      // What the page saw, and so what it names as its base and what a snapshot keeps.
      const shown = target.config ? maskRawConfig(current.text) : current.text;
      if (baseSha256 !== undefined && baseSha256 !== sha256(shown)) {
        return { status: 409, body: { error: 'conflict', message: 'The file changed in Hermes after you opened it, so it was not overwritten.', current: shown } };
      }
      if (shown !== '') keep(target.key, shown);
      return undefined;
    },

    mount(app) {
      app.get('/_caduceus/api/file-snapshots', (c) => {
        const target = targetOf(c.req.query('kind'), c.req.query('profile'), c.req.query('path'));
        if (!target) return c.json({ error: 'bad-request', message: 'Name a file: kind=soul or config with a profile, or kind=file with a path.' }, 400);
        const rows = db.prepare('SELECT id, at, text FROM file_snapshots WHERE target = ? ORDER BY id DESC').all(target.key) as { id: number; at: number; text: string }[];
        const snapshots: FileSnapshot[] = rows.map((row) => ({ id: row.id, at: new Date(row.at).toISOString(), bytes: Buffer.byteLength(row.text) }));
        return c.json({ snapshots });
      });
      app.get('/_caduceus/api/file-snapshots/:id', (c) => {
        const row = db.prepare('SELECT id, at, text FROM file_snapshots WHERE id = ?').get(Number(c.req.param('id'))) as { id: number; at: number; text: string } | undefined;
        if (!row) return c.json({ error: 'not-found' }, 404);
        return c.json({ id: row.id, at: new Date(row.at).toISOString(), bytes: Buffer.byteLength(row.text), text: row.text });
      });
    },
  };
}
