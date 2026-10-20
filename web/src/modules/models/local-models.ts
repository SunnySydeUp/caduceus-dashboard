// Agents › Models › Local models: what Hermes's local-models endpoints say, and what the screen asks of them, free of the DOM and of React.
// Hermes runs models on this Mac with a managed llama.cpp runtime; it words most of its answers for people already ("4.4 GB", "starts at 64K
// and grows toward 262K") and the screen shows those words. Caduceus keeps nothing of it (D1): a reload asks Hermes again, and a download that
// is running is found again in Hermes's list of jobs.
import { isRecord } from '@caduceus/contracts/policy/guards';

const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0);

/** The two reads the status panel opens with. */
export const statusPaths = ['/api/local-models/status', '/api/local-models/hardware'] as const;

export interface StagedModel {
  /** The id Hermes serves it under: the file's name without `.gguf`. */
  id: string;
  sizeBytes: number;
  sizeLabel: string;
  /** `loaded`: in memory now; `loading`: being loaded. Nothing: on disk only. */
  residency: 'loaded' | 'loading' | undefined;
  /** The main model of the profile Hermes is asked about. */
  active: boolean;
}

export interface LocalStatus {
  runtime: {
    installed: boolean;
    /** The llama.cpp build in use, e.g. `b10964`. */
    tag: string;
    /** The kind of GPU build installed (`metal`); undefined when none is. */
    backend: string | undefined;
    updateAvailable: boolean;
    serverRunning: boolean;
    serverUrl: string | undefined;
    /** The owner has the local engine switched on (Hermes starts it with itself). */
    enabled: boolean;
  };
  models: StagedModel[];
  active: string | undefined;
  modelsDir: string;
}

/** Reads `GET /api/local-models/status`. */
export function parseStatus(payload: unknown): LocalStatus {
  const body = isRecord(payload) ? payload : {};
  const loaded = isRecord(body.loaded_models) ? body.loaded_models : {};
  const loading = isRecord(body.loading) ? body.loading : {};
  const active = text(body.active_model_id) || undefined;
  const models = (Array.isArray(body.models) ? body.models : []).flatMap((item): StagedModel[] => {
    const row = isRecord(item) ? item : {};
    const id = text(row.id);
    if (id === '') return [];
    const state = text(loaded[id]);
    const residency = state === 'loaded' || state === 'ready' ? 'loaded' : state === 'loading' || id in loading ? 'loading' : undefined;
    const sizeBytes = count(row.size_bytes);
    return [{ id, sizeBytes, sizeLabel: bytesLabel(sizeBytes), residency, active: id === active }];
  });
  return {
    runtime: {
      installed: body.runtime_installed === true,
      tag: text(body.tag),
      backend: text(body.runtime_backend) || undefined,
      updateAvailable: body.update_available === true,
      serverRunning: body.server_running === true,
      serverUrl: text(body.server_base_url) || undefined,
      enabled: body.enabled === true,
    },
    models,
    active,
    modelsDir: text(body.models_dir),
  };
}

export interface Hardware {
  /** True where the GPU shares the Mac's memory (Apple silicon). */
  unified: boolean;
  /** The memory models can use, as Hermes words it ("64.0 GB"). */
  totalMemoryLabel: string;
  usableBytes: number;
  ramTotalBytes: number;
  ramAvailableBytes: number;
  gpuName: string | undefined;
}

/** Reads `GET /api/local-models/hardware`. */
export function parseHardware(payload: unknown): Hardware {
  const body = isRecord(payload) ? payload : {};
  return {
    unified: body.uma === true,
    totalMemoryLabel: text(body.vram_label),
    usableBytes: count(body.vram_usable_bytes),
    ramTotalBytes: count(body.ram_total_bytes),
    ramAvailableBytes: count(body.ram_available_bytes),
    gpuName: text(body.gpu_name) || undefined,
  };
}

/** What the status means in plain words: why a model cannot be started yet, or what is running. */
export function explainRuntime(status: LocalStatus): string {
  if (!status.runtime.installed) {
    return 'The local runtime is not installed on this Mac. Hermes runs local models with llama.cpp, which it downloads once (a few hundred megabytes) and keeps up to date. Until it is installed, a downloaded model cannot be started.';
  }
  const build = `llama.cpp ${status.runtime.tag}${status.runtime.backend ? ` (${status.runtime.backend})` : ''}`;
  if (!status.runtime.serverRunning) return `The local runtime (${build}) is installed, and the local server is off. Start it to use a downloaded model.`;
  return `The local server is running on ${build}. A model is loaded into memory the first time something asks it a question, and Eject frees that memory.`;
}

export interface CatalogRow {
  /** The family id (`qwen3.8-27b`), which a download and a quick start take. */
  id: string;
  name: string;
  description: string;
  sizeBytes: number;
  sizeLabel: string;
  /** Whether this Mac can run it at all. */
  fits: boolean;
  /** How it would run here, in Hermes's words ("runs at its full 256K context", "Needs more memory than this machine has"). */
  fitSummary: string;
  fitDetail: string | undefined;
  /** The quantisation of the build Hermes picked for this Mac, e.g. `UD-Q4_K_M`. */
  quant: string | undefined;
  nativeContext: string;
  recommended: boolean;
  recommendedReason: string | undefined;
  downloaded: boolean;
  /** The id the downloaded file is served under, when it is on disk. */
  downloadedId: string | undefined;
  vision: boolean;
  /** The model needs a newer llama.cpp than is installed: downloading it waits for an engine update. */
  needsEngine: boolean;
  minEngine: string | undefined;
}

/** Reads `GET /api/local-models/catalog`. */
export function parseCatalog(payload: unknown): CatalogRow[] {
  const body = isRecord(payload) ? payload : {};
  return (Array.isArray(body.models) ? body.models : []).flatMap((item): CatalogRow[] => {
    const row = isRecord(item) ? item : {};
    const id = text(row.id);
    if (id === '') return [];
    return [
      {
        id,
        name: text(row.display_name) || id,
        description: text(row.description),
        sizeBytes: count(row.size_bytes),
        sizeLabel: bytesLabel(count(row.size_bytes)),
        fits: row.fits === true,
        fitSummary: text(row.fit_summary),
        fitDetail: text(row.fit_detail) || undefined,
        quant: text(row.quant) || undefined,
        nativeContext: text(row.native_context_label),
        recommended: row.recommended === true,
        recommendedReason: text(row.recommended_reason) || undefined,
        downloaded: row.downloaded === true,
        downloadedId: text(row.downloaded_model_id) || undefined,
        vision: row.vision === true,
        needsEngine: row.needs_engine === true,
        minEngine: text(row.min_engine) || undefined,
      },
    ];
  });
}

/** A size as the screen words it: whole kilobytes, then megabytes and gigabytes to one decimal ("128 KB", "4.4 GB"). */
export function bytesLabel(bytes: number): string {
  if (bytes >= 1 << 30) return `${(bytes / (1 << 30)).toFixed(1)} GB`;
  if (bytes >= 1 << 20) return `${(bytes / (1 << 20)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export const searchPath = (query: string) => `/api/local-models/search?q=${encodeURIComponent(query)}&limit=20`;
export const filesPath = (repo: string) => `/api/local-models/search/files?repo=${encodeURIComponent(repo)}`;

export interface SearchHit {
  repo: string;
  downloads: number;
  likes: number;
  /** The day the repo last changed. */
  updated: string;
  /** The repo asks for a login or licence to download from: Hermes cannot fetch it. */
  gated: boolean;
}

/** Reads `GET /api/local-models/search`: Hugging Face's GGUF repos, most downloaded first. */
export function parseSearch(payload: unknown): SearchHit[] {
  const body = isRecord(payload) ? payload : {};
  return (Array.isArray(body.hits) ? body.hits : []).flatMap((item): SearchHit[] => {
    const hit = isRecord(item) ? item : {};
    const repo = text(hit.repo);
    return repo === '' ? [] : [{ repo, downloads: count(hit.downloads), likes: count(hit.likes), updated: text(hit.updated).slice(0, 10), gated: hit.gated === true }];
  });
}

/** How a build is judged for this Mac from its size alone, before it is downloaded. */
export type FileFit = 'fits-gpu' | 'needs-ram' | 'too-big' | 'unknown';

export interface RepoFile {
  /** The quantisation (`Q4_K_M`) or the file's name. */
  label: string;
  /** One file, or every part of a split model in order. */
  paths: string[];
  sizeBytes: number;
  sizeLabel: string;
  fit: FileFit;
}

/** Reads `GET /api/local-models/search/files`: the models in one repo, largest first. */
export function parseRepoFiles(payload: unknown): RepoFile[] {
  const body = isRecord(payload) ? payload : {};
  return (Array.isArray(body.files) ? body.files : []).flatMap((item): RepoFile[] => {
    const file = isRecord(item) ? item : {};
    const paths = (Array.isArray(file.paths) ? file.paths : []).filter((path): path is string => typeof path === 'string');
    if (paths.length === 0) return [];
    const fit = text(file.fit);
    const sizeBytes = count(file.total_bytes);
    return [{ label: text(file.label) || paths[0], paths, sizeBytes, sizeLabel: bytesLabel(sizeBytes), fit: fit === 'fits-gpu' || fit === 'needs-ram' || fit === 'too-big' ? fit : 'unknown' }];
  });
}

export const jobsPath = '/api/local-models/jobs';

export interface LocalJob {
  id: string;
  /** `model-download`, `runtime-install`, `quickstart` or `model-activate`. */
  kind: string;
  /** What it works on, in Hermes's words ("Qwen3.8 27B (UD-Q4_K_M)"). */
  target: string;
  /** `paused` is a download the owner stopped (Hermes 0.22): its files stay and it carries on from where it was. */
  status: 'running' | 'paused' | 'done' | 'error';
  /** The step, as Hermes names it (`downloading`, `starting-server`). */
  phase: string;
  /** What Hermes says it is doing now ("Qwen3.8 27B — 17.9 GB"). */
  detail: string;
  doneBytes: number;
  /** 0 until Hermes knows the size. */
  totalBytes: number;
  /** 0 to 100 when the size is known. */
  percent: number | undefined;
  error: string | undefined;
  startedAt: number;
  /** Hermes lets the owner pause it now (a download in a download phase that is not already stopping). */
  canPause: boolean;
  /** Hermes lets the owner carry it on (a paused one). */
  canResume: boolean;
  /** The owner has asked it to pause and Hermes has not stopped it yet. */
  pausing: boolean;
}

/** Reads `GET /api/local-models/jobs`: Hermes's recent jobs, running ones first. A page opened later finds a job that is still running here. */
export function parseJobs(payload: unknown): LocalJob[] {
  const body = isRecord(payload) ? payload : {};
  return (Array.isArray(body.jobs) ? body.jobs : []).flatMap((item): LocalJob[] => {
    const job = isRecord(item) ? item : {};
    const id = text(job.job_id);
    if (id === '') return [];
    const status = text(job.status);
    const percent = typeof job.percent === 'number' ? job.percent : undefined;
    return [
      {
        id,
        kind: text(job.kind),
        target: text(job.target),
        status: status === 'done' || status === 'error' || status === 'paused' ? status : 'running',
        phase: text(job.phase),
        detail: text(job.detail),
        doneBytes: count(job.done_bytes),
        totalBytes: count(job.total_bytes),
        percent,
        error: text(job.error) || undefined,
        startedAt: count(job.started_at),
        canPause: job.can_pause === true,
        canResume: job.can_resume === true,
        pausing: job.pause_requested === true,
      },
    ];
  });
}

/** A Hermes request as `fetchTiered` takes it, before its confirmation text is added. */
export interface LocalRequest {
  method: 'POST' | 'DELETE';
  path: string;
  body?: Record<string, unknown>;
}

/** Downloads GGUF files of one Hugging Face repo into Hermes's models folder (Tier 1): one file, or every part of a split model in order. */
export const downloadBrowsedRequest = (repo: string, paths: readonly string[]): LocalRequest => ({ method: 'POST', path: '/api/local-models/download-browsed', body: { repo, paths } });

/** One line for a job's progress: the bytes and percent when Hermes knows the size, otherwise what it says it is doing; a failed job says why. */
export function jobLine(job: LocalJob): string {
  if (job.status === 'error') return job.error ?? 'It failed.';
  if (job.status === 'done') return job.detail || 'Done';
  const progress = job.totalBytes > 0 && job.percent !== undefined ? `${bytesLabel(job.doneBytes)} of ${bytesLabel(job.totalBytes)} · ${job.percent}%` : job.detail || job.phase || 'Working';
  // A stopped or stopping download says so before how far it got.
  return job.status === 'paused' ? `Paused · ${progress}` : job.pausing ? `Pausing · ${progress}` : progress;
}

/** Registers a GGUF file already on this Mac (Tier 1): Hermes links it into its models folder (a copy only when it cannot link) and leaves the original alone. */
export const sideloadRequest = (path: string): LocalRequest => ({ method: 'POST', path: '/api/local-models/sideload', body: { path } });

const scoped = (route: string, profile: string) => `${route}?profile=${encodeURIComponent(profile)}`;

/** Makes a downloaded model the profile's main model and makes sure the local server is up (Tier 1). It is a job: Hermes does not load the model until something asks it. */
export const activateRequest = (modelId: string, profile: string): LocalRequest => ({ method: 'POST', path: scoped('/api/local-models/activate', profile), body: { model_id: modelId } });

/** Frees a loaded model's memory now (Tier 1); the next question loads it again. */
export const ejectRequest = (modelId: string): LocalRequest => ({ method: 'POST', path: '/api/local-models/eject', body: { model_id: modelId } });

/** Starts or stops the local server (Tier 1). Stopping also frees all of its memory and keeps it off until it is started. */
export const serverRequest = (action: 'start' | 'stop'): LocalRequest => ({ method: 'POST', path: '/api/local-models/server', body: { action } });

/** Removes a model's files from Hermes's models folder (Tier 1). */
export const deleteRequest = (modelId: string): LocalRequest => ({ method: 'DELETE', path: `/api/local-models/models/${encodeURIComponent(modelId)}` });

/** Stops a download where it is (Tier 1); its files stay, and it can be carried on. */
export const pauseRequest = (jobId: string): LocalRequest => ({ method: 'POST', path: '/api/local-models/download/pause', body: { job_id: jobId } });

/** Carries on a paused download from where it stopped (Tier 1): Hermes reuses the files it already verified. */
export const resumeRequest = (jobId: string): LocalRequest => ({ method: 'POST', path: '/api/local-models/download/resume', body: { job_id: jobId } });

/** The line that reports a delete: Hermes does not say what it freed, so the screen reports the size the model had on disk. */
export const freedMessage = (model: Pick<StagedModel, 'id' | 'sizeLabel'>): string => `Deleted ${model.id}: ${model.sizeLabel} of disk space freed.`;

/** Downloads the catalogue's build of a model for this Mac (Tier 1). `modelId` is the family id from the catalogue. */
export const downloadRequest = (modelId: string): LocalRequest => ({ method: 'POST', path: '/api/local-models/download', body: { model_id: modelId } });

/** Installs the runtime if it is missing, downloads the recommended (or chosen) model and makes it the profile's main model, as one job (Tier 1). */
export const quickstartRequest = (profile: string, modelId?: string): LocalRequest => ({ method: 'POST', path: scoped('/api/local-models/quickstart', profile), body: modelId ? { model_id: modelId } : {} });

/** Downloads and unpacks the llama.cpp runtime for this Mac (Tier 1). */
export const installRuntimeRequest = (profile: string): LocalRequest => ({ method: 'POST', path: scoped('/api/local-models/runtime/install', profile), body: {} });

/** The provider Hermes lists the models on disk under in its model options, so the shared picker offers them with no help from here. */
export const LOCAL_PROVIDER = 'llamacpp';
