// Reading Hermes for Agents › Models › Local models. Only GETs live here; every change goes through `local-actions.ts`. Nothing is kept
// beyond what the screen shows: a reload asks Hermes again, and a job that is still running is found again in Hermes's list of jobs (D1).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useLiveLoad } from '../../gateway.ts';
import { toast } from '../../shell/toasts.ts';
import { filesPath, jobsPath, parseCatalog, parseHardware, parseJobs, parseRepoFiles, parseSearch, parseStatus, searchPath, statusPaths, type CatalogRow, type Hardware, type LocalJob, type LocalStatus, type RepoFile, type SearchHit } from './local-models.ts';

async function read(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`GET ${path}: HTTP ${res.status}`);
  return res.json();
}

/** How often Hermes is asked about a job that is running. Hermes has no event for a job's progress, so this is the one poll, and it stops when no job is running. */
const JOB_POLL_MS = 1500;

export interface LocalView {
  status: LocalStatus | undefined;
  hardware: Hardware | undefined;
  jobs: LocalJob[];
  failed: boolean;
  /** Asks Hermes again for the status and the jobs. */
  reload(): Promise<void>;
}

/**
 * The runtime status, the hardware and the jobs. While a job is running they are asked again every moment; when a job ends the owner is told
 * (a toast) and the status is read once more, because a finished download is a new model on disk.
 */
export function useLocalModels(): LocalView {
  const [status, setStatus] = useState<LocalStatus>();
  const [hardware, setHardware] = useState<Hardware>();
  const [jobs, setJobs] = useState<LocalJob[]>([]);
  const [failed, setFailed] = useState(false);
  const running = useRef<Map<string, LocalJob>>(new Map());
  const latest = useRef(0);

  const reload = useCallback(async () => {
    const request = ++latest.current;
    try {
      const [statusBody, hardwareBody, jobsBody] = await Promise.all([...statusPaths.map(read), read(jobsPath)]);
      if (request !== latest.current) return;
      const next = parseJobs(jobsBody);
      // A job that was running a moment ago and is not any more: say how it ended.
      for (const job of next) {
        const before = running.current.get(job.id);
        if (before && job.status === 'done') toast(`${job.target}: done`, { tone: 'info', detail: job.detail || undefined });
        if (before && job.status === 'error') toast(`${job.target} failed`, { tone: 'danger', detail: job.error });
      }
      running.current = new Map(next.filter((job) => job.status === 'running').map((job) => [job.id, job]));
      setStatus(parseStatus(statusBody));
      setHardware(parseHardware(hardwareBody));
      setJobs(next);
      setFailed(false);
    } catch {
      if (request === latest.current) setFailed(true);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);
  useLiveLoad(() => void reload());

  const anyRunning = jobs.some((job) => job.status === 'running');
  useEffect(() => {
    if (!anyRunning) return;
    const timer = setInterval(() => void reload(), JOB_POLL_MS);
    return () => clearInterval(timer);
  }, [anyRunning, reload]);

  return { status, hardware, jobs, failed, reload };
}

/** Hermes's catalogue, priced for this Mac. It asks again when `version` changes (a download finished, a model was deleted). */
export function useLocalCatalog(version: string): { rows: CatalogRow[] | undefined; failed: boolean } {
  const [rows, setRows] = useState<CatalogRow[]>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let current = true;
    read('/api/local-models/catalog').then(
      (body) => {
        if (!current) return;
        setRows(parseCatalog(body));
        setFailed(false);
      },
      () => current && setFailed(true),
    );
    return () => {
      current = false;
    };
  }, [version]);
  return { rows, failed };
}

/** Searches Hugging Face through Hermes for GGUF repos. */
export async function searchRepos(query: string): Promise<SearchHit[]> {
  return parseSearch(await read(searchPath(query)));
}

/** The models in one repo, with a verdict for this Mac. */
export async function repoFiles(repo: string): Promise<RepoFile[]> {
  return parseRepoFiles(await read(filesPath(repo)));
}
