// When processes started, as the operating system says. Hermes does not report a gateway's start time over REST (its
// `gateway_state.json` has one, which `/api/status` leaves out), so the restart-to-apply banner reads it from the process itself.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** `ps -o lstart=` prints local time as `Sat Oct 17 19:03:12 2026`, in the C locale, whatever the user's. */
const LSTART = /^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +\d{1,2} \d{2}:\d{2}:\d{2} \d{4}$/;

/**
 * The start time (milliseconds since the epoch, to the second) of each of `pids` that is running. A pid that is not running, or
 * that `ps` cannot read, is left out; so is everything when `ps` itself cannot be run.
 */
export async function processStartTimes(pids: readonly number[]): Promise<Map<number, number>> {
  const started = new Map<number, number>();
  const wanted = [...new Set(pids)].filter((pid) => Number.isInteger(pid) && pid > 0);
  if (wanted.length === 0) return started;
  try {
    // `ps -p` exits 1 when none of the pids exist, and prints nothing for the ones that do not: ask for them all at once.
    const { stdout } = await run('ps', ['-o', 'pid=,lstart=', '-p', wanted.join(',')], { env: { ...process.env, LC_ALL: 'C' } }).catch((error: { stdout?: string }) => ({ stdout: error.stdout ?? '' }));
    for (const line of stdout.split('\n')) {
      const [, pid, lstart] = /^\s*(\d+)\s+(.+?)\s*$/.exec(line) ?? [];
      if (!pid || !LSTART.test(lstart)) continue;
      const at = Date.parse(lstart);
      if (!Number.isNaN(at)) started.set(Number(pid), at);
    }
  } catch {
    // No `ps`: there are no start times, and the banner falls back to waiting for the owner.
  }
  return started;
}
