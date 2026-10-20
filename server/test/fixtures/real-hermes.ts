// Shared helper for tests that run Caduceus against the real installed `hermes`, isolated in a throwaway HERMES_HOME.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, expect } from 'vitest';
import { launchHermesBackend, type HermesBackend, type LaunchOptions } from '../../src/hermes-backend.ts';
import { findHermesInstall, type HermesInstall } from '../../src/hermes-contract.ts';
import { linkSharedInstalls } from './hermes-installs.ts';
import { runProgram } from './run-program.ts';

/**
 * The time a test gets when the whole of what it waits for is a real Hermes doing work in its own Python process: starting again after a
 * restart or a crash, or taking in a long stream. Its waits are on events, so this is only the limit that tells a hang from a slow machine; how
 * long the work takes is a fact of the operating system, seconds on a quiet machine and over half a minute on a busy one, and it is not what a
 * test's 15 s (`testTimeout`) is for. Launching Hermes belongs in a hook, whose own timeout (`hookTimeout`) says the same.
 */
export const HERMES_WORK_TIMEOUT_MS = 60_000;

export interface TestHermes {
  backend: HermesBackend;
  /** The installed Hermes this backend runs (its version and install directory). */
  install: HermesInstall;
  /** The temp HERMES_HOME; Hermes writes only here. */
  home: string;
  /** The temp HOME of Hermes and every CLI the test runs (see `isolatedHome`): its `.local/bin` is empty and its own. */
  fakeHome: string;
  /** Stops Hermes and deletes its temp home. */
  stop(): Promise<void>;
  /**
   * Runs Hermes's own CLI against this home (`hermes <args>` with HERMES_HOME set), the way an operator or a worker would, and resolves with
   * what it printed. Never block the event loop on a CLI: see `run-program.ts`. Rejects when it exits non-zero.
   */
  cli(...args: string[]): Promise<string>;
}

/**
 * A temp HOME that reads like the owner's (credentials, caches and the state Hermes looks for under `~` are the owner's,
 * through symlinks) except `~/.local/bin`, which is an empty directory of its own: Hermes writes a wrapper script there for
 * every `hermes profile create`, and a test must never rewrite the owner's real ones.
 */
function isolatedHome(owner: string): string {
  const real = os.userInfo().homedir;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `caduceus-home-${owner}`));
  const link = (from: string, to: string, skip: string) => {
    for (const name of fs.readdirSync(from)) if (name !== skip) fs.symlinkSync(path.join(from, name), path.join(to, name));
  };
  link(real, home, '.local');
  const local = path.join(home, '.local');
  fs.mkdirSync(path.join(local, 'bin'), { recursive: true });
  const realLocal = path.join(real, '.local');
  if (fs.existsSync(realLocal)) link(realLocal, local, 'bin');
  return home;
}

/** A launch that has not returned yet: `abandoned` says the file it belongs to is over, and `settled` is when it has returned or cleaned up after itself. */
interface Launching {
  abandoned: boolean;
  settled: Promise<unknown>;
}

const launching = new Set<Launching>();
/** The Hermes homes whose caller has not stopped them. A hook that times out while `launchTestHermes` is still working never gets the handle, so nobody else would. */
const unstopped = new Set<TestHermes>();

/**
 * Ends what a file's own hooks did not: a launch still in progress cleans up after itself at its next step and fails, and a Hermes that was launched and never stopped is
 * stopped. Registered once per test file (below) to run after the file's own hooks; a test of this file calls it directly.
 */
export async function endLaunches(): Promise<void> {
  for (const launch of launching) launch.abandoned = true;
  await Promise.allSettled([...launching].map((launch) => launch.settled));
  await Promise.allSettled([...unstopped].map((hermes) => hermes.stop()));
}

try {
  afterAll(endLaunches);
} catch {
  // Outside vitest (a throwaway `tsx` smoke server) there is no file to end: the smoke server stops what it launched.
}

/**
 * Launches the real `hermes serve` through the real launcher, with HERMES_HOME set to a fresh temp dir,
 * so it never reads or writes the owner's `~/.hermes`. Seed the home through Hermes's own APIs or CLI.
 * Whoever holds the handle stops it; if nobody does (the hook that asked for it timed out), the end of the file does (`endLaunches`).
 */
export function launchTestHermes(options: Omit<LaunchOptions, 'command' | 'args'> = {}): Promise<TestHermes> {
  const launch: Launching = { abandoned: false, settled: Promise.resolve() };
  const started = startTestHermes(options, launch).then((hermes) => {
    unstopped.add(hermes);
    return hermes;
  });
  launch.settled = started.then(
    () => undefined,
    () => undefined,
  );
  launching.add(launch);
  return started.finally(() => launching.delete(launch));
}

async function startTestHermes(options: Omit<LaunchOptions, 'command' | 'args'>, launch: Launching): Promise<TestHermes> {
  // A temp directory named after the test file that made it says whose it is, if the file does not remove it (see `run-temp-root.ts`).
  // Outside vitest (a throwaway `tsx` smoke server) `expect.getState()` throws; the name is then a generic one.
  let testPath: string | undefined;
  try {
    testPath = expect.getState().testPath;
  } catch {
    testPath = undefined;
  }
  const owner = testPath ? `${path.basename(testPath).replace(/\.test\.ts$/, '')}-` : 'smoke-';
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `caduceus-hermes-home-${owner}`));
  // Hermes starts the programs that outlive it with HERMES_HOME as `Path.resolve()` spells it. Where the temp directory is behind a link (macOS: `/var` is
  // `/private/var`) that is a second name for `home`, and the only one the environment of those programs carries (see `programsOf`).
  const homeNames = [...new Set([home, fs.realpathSync(home)])];
  // Hermes writes a wrapper script for each created profile to `Path.home()/.local/bin/<name>`, which is the owner's real
  // `~/.local/bin`. HOME is set here and in this process's own environment (tests spawn the CLI with `...process.env`).
  const fakeHome = isolatedHome(owner);
  const previousHome = process.env.HOME;
  process.env.HOME = fakeHome;
  const env = { ...options.env, HERMES_HOME: home, HOME: fakeHome };
  const restoreHome = () => {
    if (process.env.HOME !== fakeHome) return;
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
  };
  const removeHomes = () => {
    try {
      fs.rmSync(fakeHome, { recursive: true, force: true, maxRetries: 3 });
    } finally {
      fs.rmSync(home, { recursive: true, force: true, maxRetries: 3 });
    }
  };
  let install: HermesInstall;
  let backend: HermesBackend;
  try {
    // Hermes 0.22 refuses a home with no dependency environment; every test home shares one repaired root (see `hermes-installs.ts`).
    await linkSharedInstalls(home);
    wanted(launch);
    install = await findHermesInstall('hermes', env);
    wanted(launch);
    backend = launchHermesBackend({ ...options, command: 'hermes', env });
  } catch (error) {
    // Nobody holds a TestHermes that was never made, so nobody else would delete these.
    restoreHome();
    removeHomes();
    throw error;
  }
  const hermes: TestHermes = {
    backend,
    install,
    home,
    fakeHome,
    cli: (...args) => runProgram('hermes', args, { env: { ...process.env, HERMES_HOME: home } }),
    async stop() {
      unstopped.delete(hermes);
      try {
        await backend.stop();
        await programsExit(homeNames);
      } finally {
        restoreHome();
        removeHomes();
      }
    },
  };
  return hermes;
}

/** Throws when nobody is waiting for this launch any more, so that it removes what it made instead of finishing it. */
function wanted(launch: Launching): void {
  if (launch.abandoned) throw new Error('Hermes was no longer wanted when it was launched: the file that asked for it had ended.');
}

/** How long a program Hermes left behind has to stop by itself before it is killed. */
const LEFTOVER_GRACE_MS = 10_000;

/**
 * The pids of the programs that carry one of `homes` as their HERMES_HOME (or a profile's, under it), which is every program Hermes started. A fact only the
 * operating system has: a program that outlives its parent is adopted by launchd, so the process tree no longer leads to it and the environment is what finds it.
 */
async function programsOf(homes: readonly string[]): Promise<number[]> {
  const listing = await runProgram('ps', ['eww', '-ax'], { env: { PATH: process.env.PATH } });
  const markers = homes.map((home) => `HERMES_HOME=${home}`);
  return listing
    .split('\n')
    .filter((line) => markers.some((marker) => line.endsWith(marker) || line.includes(`${marker} `) || line.includes(`${marker}/`)))
    .map((line) => Number(/^\s*(\d+)/.exec(line)?.[1]))
    .filter((pid) => Number.isInteger(pid) && pid !== process.pid);
}

/**
 * Waits until no program of the home (`homes` are its names, see `programsOf`) is left. `backend.stop()` resolves when `hermes serve` has exited, not the programs it
 * started, and a program that is still running writes into the home while the test removes it, so the removal fails with ENOTEMPTY or the program makes the
 * directory again, and the run reports a leaked `caduceus-hermes-home-*`. Two kinds are left:
 *   - the `python3 -m pip --version` Hermes runs while it builds an agent, which writes its bytecode caches under the HOME of the test;
 *   - the gateway (`hermes gateway run --idle-exit`): `hermes serve` starts it, detached, when a client first needs it, and it is meant to outlive that client and to
 *     end itself after ten idle minutes. Stopping it writes its state (`gateway_state.json`, the state database's WAL, `.clean_shutdown`) until it exits.
 * Each is asked to stop (SIGTERM) as soon as it is seen, and one that has not exited within the grace is killed. A bounded poll: such a program is not a child of
 * ours, so there is no exit event for it and the process table is the only record.
 */
async function programsExit(homes: readonly string[]): Promise<void> {
  const killAt = Date.now() + LEFTOVER_GRACE_MS;
  const asked = new Set<number>();
  let killed = false;
  for (let left = await programsOf(homes); left.length > 0; left = await programsOf(homes)) {
    if (killed) return;
    const kill = Date.now() >= killAt;
    killed = kill;
    for (const pid of left) {
      if (!kill && asked.has(pid)) continue;
      asked.add(pid);
      try {
        process.kill(pid, kill ? 'SIGKILL' : 'SIGTERM');
      } catch {
        // Gone already.
      }
    }
    await delay(50);
  }
}

/** The pids of the child processes of `pid`; `pgrep` exits 1 when there are none. */
function childrenOf(pid: number): number[] {
  try {
    return execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

/**
 * Kills the real `hermes serve` of `hermes` outright (SIGKILL), as a crash would, and throws if it cannot find it. The
 * launcher runs Hermes under a watchdog that is a child of this process (`hermes-watchdog.mjs`), so Hermes is that
 * watchdog's child, and the one of this home is told apart by the HERMES_HOME in its environment. Both are facts only the
 * operating system has, and the launcher keeps the child to itself.
 */
export function killHermes({ home }: TestHermes): void {
  const victims = childrenOf(process.pid)
    .flatMap(childrenOf)
    .filter((pid) => execFileSync('ps', ['eww', '-p', String(pid)], { encoding: 'utf8' }).includes(`HERMES_HOME=${home}`));
  if (victims.length !== 1) throw new Error(`Expected one Hermes process for ${home}, found ${victims.length}`);
  process.kill(victims[0], 'SIGKILL');
}
