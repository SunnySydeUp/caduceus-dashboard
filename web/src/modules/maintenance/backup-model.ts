// What System › Maintenance › Backup shows, as pure functions (M5 #14): sizes, the checkpoint count from Hermes's own listing, the words for a prune that Hermes
// aborted, the steps of a restore and what the contract check after it says. Hermes holds the backups and the checkpoints; nothing here is kept.
import { isRecord } from '@caduceus/contracts/policy/guards';

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** A size in the largest unit that keeps it at one or more, with one decimal below ten (`1.5 KB`, `10 MB`). */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit++;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${UNITS[unit]}`;
}

export interface CheckpointSummary {
  /** The sessions Hermes keeps a checkpoint store for. */
  sessions: number;
  files: number;
  bytes: number;
  text: string;
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** Hermes's listing of its checkpoint stores (`GET /api/ops/checkpoints`: a count and size per session) as the page says it; `undefined` for an answer that is not that listing. */
export function checkpointSummary(answer: unknown): CheckpointSummary | undefined {
  if (!isRecord(answer) || !Array.isArray(answer.sessions)) return undefined;
  let files = 0;
  let bytes = 0;
  for (const entry of answer.sessions) {
    if (!isRecord(entry) || typeof entry.files !== 'number' || typeof entry.bytes !== 'number') return undefined;
    files += entry.files;
    bytes += entry.bytes;
  }
  const sessions = answer.sessions.length;
  const text = sessions === 0 ? 'No checkpoints' : `${sessions === 1 ? '1 session holds' : `${sessions} sessions hold`} checkpoints: ${plural(files, 'file', 'files')}, ${formatBytes(bytes)}`;
  return { sessions, files, bytes, text };
}

/**
 * What to tell the owner when Hermes's prune ended without doing it: Hermes asks before it deletes the checkpoints of a folder it cannot find (the folder may be on a
 * volume that is not mounted), and a prune started from here cannot be asked, so it says "Aborted." and deletes nothing. `undefined` when the log says no such thing.
 */
export function pruneAdvice(lines: readonly string[]): string | undefined {
  if (!lines.some((line) => line.trim() === 'Aborted.')) return undefined;
  return 'Hermes asks before it deletes the checkpoints of a folder it cannot find, and it cannot ask here, so it deleted nothing. To confirm those deletions yourself, run `hermes checkpoints prune` in a terminal on the Mac that runs Hermes.';
}

export type RestorePhase = 'draining' | 'importing' | 'restarting' | 'checked';
export type RestoreStepState = 'done' | 'current' | 'failed' | 'todo';

export interface RestoreStep {
  phase: RestorePhase;
  label: string;
  state: RestoreStepState;
}

const STEPS: readonly { phase: RestorePhase; label: string }[] = [
  { phase: 'draining', label: 'Pause new turns' },
  { phase: 'importing', label: 'Hermes restores the backup' },
  { phase: 'restarting', label: 'Restart Hermes and Caduceus' },
  { phase: 'checked', label: 'Check Hermes against its contracts' },
];

/** Where a restore is: what is done, what is going on (or where it stopped, when it failed) and what is still to come. */
export function restoreSteps(phase: RestorePhase, status: 'running' | 'ok' | 'failed'): RestoreStep[] {
  const at = STEPS.findIndex((step) => step.phase === phase);
  return STEPS.map((step, index) => ({
    ...step,
    state: status === 'ok' || index < at ? 'done' : index > at ? 'todo' : status === 'failed' ? 'failed' : 'current',
  }));
}

export interface Verdict {
  tone: 'success' | 'warning' | 'info';
  text: string;
}

/** What the contract check that runs after a restore says, in words; `undefined` is a check that could not be read. */
export function restoreVerdict(report: { state: 'checking' | 'compatible' | 'incompatible'; reasons?: readonly string[] } | undefined): Verdict {
  if (!report) return { tone: 'warning', text: 'Caduceus could not read the contract check. Look at Health in a moment.' };
  if (report.state === 'checking') return { tone: 'info', text: 'Caduceus is still checking Hermes against its contracts. Health shows the result.' };
  if (report.state === 'compatible') return { tone: 'success', text: 'Hermes matches the contracts Caduceus was built for.' };
  const reasons = report.reasons?.length ? ` ${report.reasons.join('; ')}` : '';
  return { tone: 'warning', text: `Hermes no longer matches the contracts Caduceus was built for. Health says whether read-only mode is on.${reasons ? ` Differences:${reasons}` : ''}` };
}
