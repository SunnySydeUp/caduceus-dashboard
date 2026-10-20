// Vitest's global setup: gives each `vitest run` a temp directory of its own, and fails the run when a test leaves one of its own behind.
//
// Every test file puts its throwaway directories (a HERMES_HOME, a workspace, a fixture) under `os.tmpdir()`, which reads `TMPDIR`. Here
// `TMPDIR` is pointed at a directory made for this run, which the workers inherit: so what a run leaves is one directory, nothing else
// can be mistaken for it (other runs on this machine have their own), and the programs the tests start (Hermes writes its shell snapshots
// to the temp directory) leave nothing in the owner's.
//   - A test that leaves a `caduceus-*` or `fake-hermes-*` directory fails the run, by name, so the test that does not clean up after itself
//     is found by the run, not by listing the temp directory by hand.
//   - A run that is killed (the machine is shared; a lane's agent stops a run that is too slow) has no teardown: its directory is removed by
//     the next run, once the process named in it is gone.
import fs from 'node:fs';
import os from 'node:os';
import { sharedInstalls } from './hermes-installs.ts';
import path from 'node:path';

const RUN_DIR = 'vitest-run-';
/** What a test must remove: the temp directories its own code and fixtures make (`fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-…'))`). */
const OWN = /^(caduceus|fake-hermes)-/;

/** Removes the directories of runs whose process is gone: nothing can have run their teardown. */
function sweepKilledRuns(parent: string): void {
  for (const name of fs.readdirSync(parent)) {
    const pid = Number(new RegExp(`^${RUN_DIR}(\\d+)-`).exec(name)?.[1]);
    if (!Number.isInteger(pid)) continue;
    try {
      process.kill(pid, 0);
    } catch (error) {
      // ESRCH: no such process. Anything else (EPERM) is a process that is there.
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') fs.rmSync(path.join(parent, name), { recursive: true, force: true, maxRetries: 3 });
    }
  }
}

export default async function setup(): Promise<() => void> {
  const parent = os.tmpdir();
  sweepKilledRuns(parent);
  const root = fs.mkdtempSync(path.join(parent, `${RUN_DIR}${process.pid}-`));
  process.env.TMPDIR = root;
  // Every test Hermes links its `installs` to this repaired root (see the file); once here, the workers inherit it.
  await sharedInstalls();
  return () => {
    process.env.TMPDIR = parent;
    // What a leaked directory holds says who left it (a `.local` alone is a wrapper that a program wrote after the test's HOME was removed).
    const left = fs
      .readdirSync(root)
      .filter((name) => OWN.test(name))
      .map((name) => `${name} [${fs.readdirSync(path.join(root, name)).slice(0, 8).join(' ')}]`);
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
    if (left.length > 0) throw new Error(`Tests left temp directories behind (the test that makes each one must remove it): ${left.join(', ')}`);
  };
}
