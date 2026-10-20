// Runs a program for a test without blocking the event loop.
//
// A test never calls `execFileSync` (or `spawnSync`) on a program that can take seconds, such as `hermes` (a Python start), because the
// test process also holds the Caduceus server, the stub LLM and the keep-alive connections of `fetch`: while the loop is blocked their
// idle-connection timers (Node closes an idle connection after 5 s) cannot run, and when the loop wakes the next `fetch` is written to a
// socket that is already closed and fails with ECONNRESET (`read ECONNRESET`, "fetch failed"). A synchronous call also holds a test past
// its timeout, because vitest's timer cannot fire until the call returns.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RunOptions {
  /** Written to the program's standard input, which is then closed (a program that reads it, such as `python -c`, needs it). */
  input?: string;
  /** The environment of the program; this process's own when left out. */
  env?: NodeJS.ProcessEnv;
  cwd?: string;
}

/**
 * Runs `command` with `args` and resolves with its standard output as text. Rejects when it cannot be started or exits non-zero; the
 * error carries its standard error in `stderr` and its message, as `execFileSync`'s does.
 */
export async function runProgram(command: string, args: readonly string[], { input, env, cwd }: RunOptions = {}): Promise<string> {
  const running = execFileAsync(command, args, { env, cwd, encoding: 'utf8', maxBuffer: 1 << 26 });
  // The standard input is always closed: a program waiting for it to end would otherwise wait for ever. A program that exits without
  // reading it makes the write fail (EPIPE); how it exited is the failure to report.
  running.child.stdin!.on('error', () => undefined);
  running.child.stdin!.end(input);
  return (await running).stdout;
}
