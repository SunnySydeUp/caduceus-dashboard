// A cron job's run history, as Hermes keeps it, free of the DOM and of React. An agent run is an ordinary session named
// `cron_<job>_<time>` (`GET /api/cron/jobs/{id}/runs`, its output the session's last reply). A script run starts no agent, so it leaves no
// session: its record is the output file Hermes saves for every run (`<profile home>/cron/output/<job>/<time>.md`).
import { isRecord } from '@caduceus/contracts/policy/guards';

export type RunStatus = 'ok' | 'running' | 'failed' | 'incomplete';

export interface Run {
  /** The session's id, or the output file's name. */
  id: string;
  source: 'session' | 'file';
  /** Milliseconds since the epoch. */
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  status: RunStatus;
  statusLabel: string;
  /** An output file's absolute path, as Hermes listed it. */
  path?: string;
}

const STATUS_LABEL: Record<RunStatus, string> = { ok: 'Finished', running: 'Running', failed: 'Failed', incomplete: 'Did not finish' };

const seconds = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) ? Math.round(value * 1000) : undefined);

function runOf(id: string, source: Run['source'], startedAt: number, endedAt: number | undefined, status: RunStatus, path?: string): Run {
  return { id, source, startedAt, endedAt, durationMs: endedAt === undefined ? undefined : Math.max(0, endedAt - startedAt), status, statusLabel: STATUS_LABEL[status], path };
}

/** The runs in Hermes's answer (`{ runs: [session rows] }`), newest first. A session Hermes closed with `cron_complete` finished; any other ending, or none, did not. */
export function parseRuns(body: unknown): Run[] {
  const rows = isRecord(body) && Array.isArray(body.runs) ? body.runs : [];
  return rows
    .flatMap((row): Run[] => {
      if (!isRecord(row) || typeof row.id !== 'string') return [];
      const startedAt = seconds(row.started_at);
      if (startedAt === undefined) return [];
      const endedAt = seconds(row.ended_at);
      const status: RunStatus = endedAt === undefined ? (row.is_active === true ? 'running' : 'incomplete') : row.end_reason === 'cron_complete' ? 'ok' : 'incomplete';
      return [runOf(row.id, 'session', startedAt, endedAt, status)];
    })
    .sort((a, b) => b.startedAt - a.startedAt);
}

/** What an agent run produced: the last thing the agent said, from the session's messages (`GET /api/sessions/{id}/messages`). */
export function parseSessionOutput(body: unknown): string | undefined {
  const messages = isRecord(body) && Array.isArray(body.messages) ? body.messages : [];
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (isRecord(message) && message.role === 'assistant' && typeof message.content === 'string' && message.content.trim() !== '') return message.content;
  }
  return undefined;
}

/** Where Hermes saves the output of a job's runs, in the profile the job belongs to: `<profile home>/cron/output/<job id>`. */
export function outputDirectory(job: { id: string; config: Record<string, unknown> }): string | undefined {
  const home = job.config.hermes_home;
  return typeof home === 'string' && home !== '' ? `${home.replace(/\/$/, '')}/cron/output/${job.id}` : undefined;
}

/** One output file Hermes saved: `<year>-<month>-<day>_<hour>-<minute>-<second>.md`, named in Hermes's own clock. */
export interface OutputFile {
  name: string;
  path: string;
  startedAt: number;
}

const FILE_NAME = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})\.md$/;

/** The output files in Hermes's listing of the folder (`GET /api/fs/list`), newest first. Anything else in the folder is not a run. */
export function parseOutputFiles(body: unknown): OutputFile[] {
  const entries = isRecord(body) && Array.isArray(body.entries) ? body.entries : [];
  return entries
    .flatMap((entry): OutputFile[] => {
      if (!isRecord(entry) || typeof entry.name !== 'string' || typeof entry.path !== 'string' || entry.isDirectory === true) return [];
      const stamp = FILE_NAME.exec(entry.name);
      if (!stamp) return [];
      const [year, month, day, hour, minute, second] = stamp.slice(1).map(Number);
      return [{ name: entry.name, path: entry.path, startedAt: new Date(year, month - 1, day, hour, minute, second).getTime() }];
    })
    .sort((a, b) => b.startedAt - a.startedAt);
}

export interface FileOutput {
  /** Whether Hermes noted a failure in the file's header. */
  failed: boolean;
  /** What the run produced, without the header Hermes writes above it. */
  text: string;
  /** Hermes read only the start of a very long file. */
  truncated: boolean;
}

/** A saved output file (`GET /api/fs/read-text`): a header of `# Cron Job: …` and `**Key:** value` lines, then what the run produced. A failed run has `**Status:** …` in the header. */
export function parseFileOutput(body: unknown): FileOutput {
  const file = isRecord(body) ? body : {};
  const lines = (typeof file.text === 'string' ? file.text : '').split('\n');
  let first = 0;
  let failed = false;
  while (first < lines.length && (/^# Cron Job:/.test(lines[first]) || /^\*\*[^*]+:\*\*/.test(lines[first]) || lines[first].trim() === '' || lines[first].trim() === '---')) {
    if (/^\*\*Status:\*\*/.test(lines[first])) failed = true;
    first++;
  }
  return { failed, text: lines.slice(first).join('\n').trimEnd(), truncated: file.truncated === true };
}

/** A script run, from the file Hermes saved for it. Its length is not recorded: only an agent's session has a start and an end. */
export function runOfFile(file: OutputFile, output: FileOutput): Run {
  const status: RunStatus = output.failed ? 'failed' : 'ok';
  return { id: file.name, source: 'file', startedAt: file.startedAt, status, statusLabel: STATUS_LABEL[status], path: file.path };
}
