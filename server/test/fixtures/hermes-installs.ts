// The dependency environment a throwaway HERMES_HOME runs on.
//
// Since 0.22 Hermes keeps its Python dependencies per data root (`<HERMES_HOME>/installs/<key>`), and a root that has none refuses to start
// (`no dependency environment is committed for this install`) until `hermes pm repair` has built one: about ten seconds and a virtual
// environment each. A test's temp home therefore links its `installs` to one shared, already repaired root that lives under `node_modules/.cache`
// (never the owner's own `~/.hermes`, which a test must not write to), and `hermes pm repair` runs once per test run, in the vitest global
// setup, or once per process for a script that launches a test Hermes outside vitest.
//
// Several test runs may start at once (the machine is shared), and two `hermes pm repair` on one root fight over its files, so the repair is done
// under a lock, and skipped when the root was already repaired for the Hermes that is installed now (its `--version` banner is the stamp).
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/** Set by the vitest global setup once the shared root is repaired; the workers inherit it. */
const SHARED_ENV = 'CADUCEUS_TEST_HERMES_INSTALLS';

export const SHARED_ROOT = fileURLToPath(new URL('../../../node_modules/.cache/caduceus-test-hermes-root', import.meta.url));
const STAMP = path.join(SHARED_ROOT, 'repaired-for');
const LOCK = path.join(SHARED_ROOT, 'repair.lock');
/** A repair takes seconds; a lock older than this belongs to a process that died. */
const STALE_LOCK_MS = 5 * 60_000;
/** How long another process's repair is waited for before giving up. */
const WAIT_LIMIT_MS = 4 * 60_000;

let repaired: Promise<string> | undefined;

/** Gives a throwaway HERMES_HOME the shared, repaired dependency environment (see the top of this file): Hermes refuses a root with none. */
export async function linkSharedInstalls(home: string): Promise<void> {
  fs.symlinkSync(await sharedInstalls(), path.join(home, 'installs'));
}

/** The installed Hermes as it describes itself under the owner's own root, which this only reads. */
async function installedBanner(): Promise<string> {
  const { HERMES_HOME: _own, ...env } = process.env;
  return (await execFileAsync('hermes', ['--version'], { env })).stdout.trim();
}

const isCurrent = (banner: string): boolean => fs.existsSync(STAMP) && fs.readFileSync(STAMP, 'utf8') === banner && fs.existsSync(path.join(SHARED_ROOT, 'installs'));

async function repairOnce(): Promise<string> {
  const installs = path.join(SHARED_ROOT, 'installs');
  fs.mkdirSync(SHARED_ROOT, { recursive: true });
  const banner = await installedBanner();
  const started = Date.now();
  while (!isCurrent(banner)) {
    try {
      fs.mkdirSync(LOCK);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Another process holds the lock. Whether it finishes is a fact of the operating system, so this polls (bounded), and takes over a lock its holder left behind.
      if (Date.now() - fs.statSync(LOCK).mtimeMs > STALE_LOCK_MS) fs.rmSync(LOCK, { recursive: true, force: true });
      else if (Date.now() - started > WAIT_LIMIT_MS) throw new Error(`Another test run held ${LOCK} for over ${WAIT_LIMIT_MS / 1000} s`);
      else await delay(500);
      continue;
    }
    try {
      if (!isCurrent(banner)) {
        await execFileAsync('hermes', ['pm', 'repair'], { env: { ...process.env, HERMES_HOME: SHARED_ROOT }, maxBuffer: 1 << 26 });
        fs.writeFileSync(STAMP, banner);
      }
    } finally {
      fs.rmSync(LOCK, { recursive: true, force: true });
    }
  }
  process.env[SHARED_ENV] = installs;
  return installs;
}

/** The `installs` directory of the shared test root, repaired for the installed Hermes (idempotent: a root that is current changes nothing). */
export function sharedInstalls(): Promise<string> {
  const inherited = process.env[SHARED_ENV];
  if (inherited) return Promise.resolve(inherited);
  repaired ??= repairOnce();
  return repaired;
}
