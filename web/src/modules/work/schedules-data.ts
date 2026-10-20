// Reading Hermes's cron for Work › Schedules. Only GETs live here; every change goes through `schedules-actions.ts`. Nothing is kept
// beyond what the page shows (D1): the jobs and their runs come from Hermes on every load, and again whenever Hermes says its jobs
// moved (`cron.changed`), after a reconnect, and when the tab comes back to the foreground.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useGatewayEvent, useLiveLoad } from '../../gateway.ts';
import { outputDirectory, parseFileOutput, parseOutputFiles, parseRuns, parseSessionOutput, runOfFile, type Run } from './job-runs.ts';
import { parseBlueprintTitles, parseJobs, type Job } from './schedules-model.ts';

async function read(path: string): Promise<unknown> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`Hermes answered HTTP ${response.status}`);
  return response.json();
}

export interface JobsState {
  /** The jobs of every profile; undefined until Hermes has answered once. */
  jobs: Job[] | undefined;
  /** Hermes did not answer the last ask: `jobs`, if any, are from before. */
  failed: boolean;
  /** Asks again now; resolves once Hermes has answered (or not). */
  reload(): Promise<void>;
}

/**
 * Every job of every profile (`GET /api/cron/jobs?profile=all`), with the blueprints' titles that tell a blueprint's job from a prompt's. Nothing is read before
 * `enabled` is true (it is by default): Today holds its schedule back until what it opens on has been answered, because Hermes answers one thing at a time and the
 * blueprints alone keep it busy for most of a second on a first load, in front of the answer the first screen is waiting for (`npm run perf`, LCP).
 */
export function useJobs(enabled = true): JobsState {
  const [jobs, setJobs] = useState<Job[]>();
  const [failed, setFailed] = useState(false);
  /** Which load is the latest: an answer that arrives late must not replace a newer one. */
  const latest = useRef(0);
  const titles = useRef<string[]>(undefined);
  const [open] = useState(() => Promise.withResolvers<void>());
  useEffect(() => {
    if (enabled) open.resolve();
  }, [enabled, open]);

  const load = useCallback(async () => {
    const request = ++latest.current;
    await open.promise;
    try {
      // The titles do not change while Hermes runs, so they are asked for once; a Hermes that does not answer gives none, and its blueprints' jobs read as prompts until it does.
      titles.current ??= await read('/api/cron/blueprints').then(parseBlueprintTitles, () => undefined);
      const next = parseJobs(await read('/api/cron/jobs?profile=all'), titles.current ?? []);
      if (request !== latest.current) return;
      setJobs(next);
      setFailed(false);
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, [open]);

  useLiveLoad(() => void load());
  useGatewayEvent('cron.changed', () => void load());
  useEffect(() => {
    const seen = () => document.visibilityState === 'visible' && void load();
    const back = () => void load();
    document.addEventListener('visibilitychange', seen);
    window.addEventListener('online', back);
    return () => {
      document.removeEventListener('visibilitychange', seen);
      window.removeEventListener('online', back);
    };
  }, [load]);

  return { jobs, failed, reload: load };
}

/** A run of the job, and what it produced when that is already known (a script's runs are read whole, an agent's output when it is opened). */
export interface RunEntry {
  run: Run;
  output?: string;
  truncated?: boolean;
}

export interface RunsState {
  /** Newest first; undefined until Hermes has answered. */
  runs: RunEntry[] | undefined;
  failed: boolean;
}

/** How many runs the history shows. Hermes's own limit is 100. */
const RUNS_SHOWN = 30;

const query = (profile: string) => `profile=${encodeURIComponent(profile)}`;

/**
 * The newest runs of a job. `version` is whatever says a run may have been added (the job's last run time): when it changes the history
 * is read again, which is how a finished run joins the list of an open job page without a reload.
 */
export function useJobRuns(job: Job | undefined, version: unknown): RunsState {
  const [state, setState] = useState<RunsState>({ runs: undefined, failed: false });
  const id = job?.id;
  const profile = job?.profile;
  const noAgent = job?.config.no_agent === true;
  const directory = job ? outputDirectory(job) : undefined;
  useEffect(() => {
    if (id === undefined || profile === undefined) return;
    let current = true;
    void (async () => {
      try {
        const runs = noAgent ? await readFileRuns(directory) : parseRuns(await read(`/api/cron/jobs/${encodeURIComponent(id)}/runs?${query(profile)}&limit=${RUNS_SHOWN}`)).map((run): RunEntry => ({ run }));
        if (current) setState({ runs, failed: false });
      } catch {
        if (current) setState((previous) => ({ runs: previous.runs, failed: true }));
      }
    })();
    return () => {
      current = false;
    };
  }, [id, profile, noAgent, directory, version]);
  // A job that is not this one's has no history here.
  return id === undefined ? { runs: undefined, failed: false } : state;
}

/** A script's runs: the output files in its profile's folder, newest first, each read whole because the file is the only place its status is. */
async function readFileRuns(directory: string | undefined): Promise<RunEntry[]> {
  if (directory === undefined) return [];
  const files = parseOutputFiles(await read(`/api/fs/list?path=${encodeURIComponent(directory)}`)).slice(0, RUNS_SHOWN);
  return Promise.all(
    files.map(async (file): Promise<RunEntry> => {
      const output = parseFileOutput(await read(`/api/fs/read-text?path=${encodeURIComponent(file.path)}`));
      return { run: runOfFile(file, output), output: output.text, truncated: output.truncated };
    }),
  );
}

/** What an agent run produced, read from its session when the run is opened. */
export async function loadRunOutput(job: Job, run: Run): Promise<string | undefined> {
  return parseSessionOutput(await read(`/api/sessions/${encodeURIComponent(run.id)}/messages?${query(job.profile)}`));
}
