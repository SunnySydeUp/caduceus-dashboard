// The single-writer lease of the playbook engine (M6 #02; architecture §1): a small file in the Caduceus folder that names who may advance runs and
// until when. Two Caduceus processes on one folder (a restart that overlaps its predecessor, a second install) must never both advance a run, so the
// engine asks for the lease before every pass and renews it by asking again; one that is not renewed for `ttlMs` is free for anyone. The file holds
// no run state, only the holder and the time.
import fs from 'node:fs';
import path from 'node:path';

export interface Lease {
  /** Takes the lease, or renews it when this owner holds it. Answers whether it is held now. */
  acquire(): boolean;
  /** Whether this owner holds an unexpired lease. */
  held(): boolean;
  /** Gives it up, if this owner holds it. */
  release(): void;
}

export interface LeaseOptions {
  file: string;
  /** Who is asking: one name per engine instance. */
  owner: string;
  ttlMs: number;
  now(): number;
}

interface Held {
  owner: string;
  expiresAt: number;
}

/** A guard folder that older than this is the leftover of a crash, not of a process in the middle of taking the lease. */
const STALE_GUARD_MS = 10_000;

export function createLease({ file, owner, ttlMs, now }: LeaseOptions): Lease {
  const guard = `${file}.guard`;

  function read(): Held | undefined {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (typeof parsed === 'object' && parsed !== null && 'owner' in parsed && 'expiresAt' in parsed && typeof parsed.owner === 'string' && typeof parsed.expiresAt === 'number') return { owner: parsed.owner, expiresAt: parsed.expiresAt };
    } catch {
      // Missing or damaged: nobody holds it.
    }
    return undefined;
  }

  function write(): void {
    const partial = `${file}.${process.pid}.${owner}.tmp`;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(partial, JSON.stringify({ owner, expiresAt: now() + ttlMs } satisfies Held), { mode: 0o600 });
    fs.renameSync(partial, file);
  }

  /** Runs `body` while holding the guard (a folder, which only one process can make), so that two engines deciding on an expired lease cannot both take it. */
  function guarded<T>(body: () => T, fallback: T): T {
    try {
      fs.mkdirSync(guard);
    } catch {
      try {
        if (Date.now() - fs.statSync(guard).mtimeMs > STALE_GUARD_MS) fs.rmSync(guard, { recursive: true, force: true });
      } catch {
        // It went away between the two calls: the next ask will find it free.
      }
      return fallback;
    }
    try {
      return body();
    } finally {
      fs.rmSync(guard, { recursive: true, force: true });
    }
  }

  const held = (): boolean => {
    const current = read();
    return current?.owner === owner && current.expiresAt > now();
  };

  return {
    acquire: () =>
      guarded(() => {
        const current = read();
        if (current !== undefined && current.owner !== owner && current.expiresAt > now()) return false;
        write();
        return true;
      }, held()),
    held,
    release() {
      guarded(() => {
        if (read()?.owner === owner) fs.rmSync(file, { force: true });
      }, undefined);
    },
  };
}
