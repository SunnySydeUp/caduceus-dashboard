// The one thing Caduceus does to Hermes's log files itself (M5 #06; architecture §2, guarded file operations, R11): empty one. Hermes has no
// endpoint for it. It is bounded: only the files Hermes names as its logs, only inside a profile's `logs/` directory under the Hermes
// root, never through a link, and never anything the file guard protects.
import fs from 'node:fs';
import path from 'node:path';
import type { FileGuard } from './file-guard.ts';

/**
 * The log files Hermes serves and their names on disk: `LOG_FILES` in Hermes's `hermes_cli/logs.py`, which is what
 * `GET /api/logs?file=` accepts. A test asks the real Hermes about every one.
 */
export const LOG_FILES: Readonly<Record<string, string>> = {
  agent: 'agent.log',
  errors: 'errors.log',
  gateway: 'gateway.log',
  gui: 'gui.log',
  desktop: 'desktop.log',
  mcp: 'mcp-stderr.log',
};

/** A profile id as Hermes names profile directories (`hermes_constants.PROFILE_ID_RE`). */
const PROFILE_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type LogFile = { ok: true; /** The file on disk, with no link in its path. */ path: string; /** Its name on disk: `agent.log`. */ name: string } | { ok: false; reason: 'unknown-file' | 'unknown-profile' | 'no-such-log' | 'not-a-log-file' };

/**
 * Finds the log file a request means. `file` is a name Hermes knows (`agent`); `profile` is a profile id, or the default one when it is
 * left out. A file that is not there, a link, or anything else than a plain file in `<profile home>/logs/` is not found.
 */
export function findLogFile(hermesRoot: string, files: FileGuard, file: string, profile: string | undefined): LogFile {
  const name = Object.hasOwn(LOG_FILES, file) ? LOG_FILES[file] : undefined;
  if (name === undefined) return { ok: false, reason: 'unknown-file' };
  const id = profile?.toLowerCase();
  if (id !== undefined && id !== 'default' && !PROFILE_ID.test(id)) return { ok: false, reason: 'unknown-profile' };
  const home = id === undefined || id === 'default' ? hermesRoot : path.join(hermesRoot, 'profiles', id);
  try {
    if (!fs.statSync(home).isDirectory()) return { ok: false, reason: 'unknown-profile' };
  } catch {
    return { ok: false, reason: 'unknown-profile' };
  }
  const lexical = path.join(home, 'logs', name);
  let real: string;
  try {
    real = fs.realpathSync(lexical);
  } catch {
    return { ok: false, reason: 'no-such-log' };
  }
  // The same file at the same place, so no link was followed: not the log directory, not the file.
  const expected = path.join(fs.realpathSync(home), 'logs', name);
  if (real !== expected || !fs.lstatSync(real).isFile() || !files.check(real, 'write').ok) return { ok: false, reason: 'not-a-log-file' };
  return { ok: true, path: real, name };
}

/** Empties the file and says how many bytes it held. Hermes's handlers append, so what is written next starts at the top. */
export function truncateLogFile(found: Extract<LogFile, { ok: true }>): number {
  const bytes = fs.statSync(found.path).size;
  fs.truncateSync(found.path, 0);
  return bytes;
}
