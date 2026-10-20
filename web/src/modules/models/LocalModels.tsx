import { useEffect, useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import type { ActionOutcome } from '../profiles/profile-actions.ts';
import { activateModel, deleteModel, downloadFromRepo, downloadModel, ejectModel, installRuntime, pauseDownload, quickStart, resumeDownload, setServer, sideloadModel } from './local-actions.ts';
import { repoFiles, searchRepos, useLocalCatalog, useLocalModels } from './local-data.ts';
import { explainRuntime, jobLine, type CatalogRow, type FileFit, type LocalJob, type RepoFile, type SearchHit, type StagedModel } from './local-models.ts';
import './models.css';

const FIT_WORDS: Record<FileFit, string> = { 'fits-gpu': 'Fits in memory', 'needs-ram': 'Fits, but slower', 'too-big': 'Too big for this Mac', unknown: 'Fit unknown' };

function Job({ job, onChange }: { job: LocalJob; onChange(): Promise<void> }) {
  const known = job.status === 'running' && job.totalBytes > 0 && job.percent !== undefined;
  const act = async (run: () => Promise<ActionOutcome>, done: string) => {
    if (Outcome(await run(), done)) await onChange();
  };
  return (
    <li className="list-row md-job">
      <span className="list-row__main">
        <span className="list-row__title">
          {job.target}
          <span className="tag" data-tone={job.status === 'error' ? 'danger' : job.status === 'done' ? 'success' : job.status === 'paused' ? 'warning' : 'accent'}>
            {job.status === 'paused' ? 'Paused' : job.status === 'running' ? (job.pausing ? 'Pausing' : 'Running') : job.status === 'done' ? 'Done' : 'Failed'}
          </span>
        </span>
        <span className="subtle md-note">{jobLine(job)}</span>
        {job.status === 'running' && <progress className="md-progress" max={known ? 100 : undefined} value={known ? job.percent : undefined} aria-label={`Progress of ${job.target}`} />}
        {(job.canPause || job.canResume) && (
          <span className="md-actions">
            {job.canPause && (
              <WriteButton type="button" className="btn btn--secondary btn--sm" onClick={() => void act(() => pauseDownload(job), 'Download paused')}>
                Pause
              </WriteButton>
            )}
            {job.canResume && (
              <WriteButton type="button" className="btn btn--secondary btn--sm" onClick={() => void act(() => resumeDownload(job), 'Download carries on')}>
                <Icon name="play" small />
                Carry on
              </WriteButton>
            )}
          </span>
        )}
      </span>
    </li>
  );
}

function Outcome(outcome: ActionOutcome, done: string): boolean {
  if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
  if (outcome.kind !== 'done') return false;
  toast(done, { tone: 'info' });
  return true;
}

function Catalog({ profile, version, runtimeInstalled, onChange }: { profile: string; version: string; runtimeInstalled: boolean; onChange(): Promise<void> }) {
  const { rows, failed } = useLocalCatalog(version);
  if (failed && !rows) return <p role="alert">Hermes did not answer, so its catalogue could not be loaded.</p>;
  if (!rows) return <p role="status">Loading the catalogue…</p>;
  const recommended = rows.find((row) => row.recommended);
  const start = async (row: CatalogRow | undefined) => {
    if (Outcome(await quickStart(profile, row, !runtimeInstalled), 'Setup started')) await onChange();
  };
  const download = async (row: CatalogRow) => {
    if (Outcome(await downloadModel(row), `Downloading ${row.name}`)) await onChange();
  };
  return (
    <>
      {recommended && (
        <div className="md-recommend">
          <p>
            <span className="tag" data-tone="accent">Recommended</span>
            <span>
              <strong>{recommended.name}</strong>: {recommended.recommendedReason ?? recommended.fitSummary}
            </span>
          </p>
          <WriteButton type="button" className="btn btn--primary" onClick={() => void start(recommended)}>
            <Icon name="bolt" />
            Quick start
          </WriteButton>
        </div>
      )}
      <ul className="list panel md-entries" aria-label="Catalogue">
        {rows.map((row) => (
          <li key={row.id}>
            <div className="list-row md-entry">
              <span className="list-row__main">
                <span className="list-row__title">{row.name}</span>
                <span className="subtle md-note">{row.description}</span>
                <span className="md-entry__meta">
                  <span className="tag">{row.sizeLabel}</span>
                  <span className="tag" data-tone={row.fits ? 'neutral' : 'warning'}>{row.fits ? 'Fits this Mac' : 'Too big'}</span>
                  {row.vision && <span className="tag">Vision</span>}
                  {row.nativeContext && <span className="tag">{row.nativeContext} context</span>}
                  {row.downloaded && <span className="tag" data-tone="success">On disk</span>}
                </span>
                <span className="subtle md-note">{row.fitSummary}{row.fitDetail ? `: ${row.fitDetail}` : ''}</span>
                {row.needsEngine && <span className="subtle md-note">Needs llama.cpp {row.minEngine} or newer: update the runtime first.</span>}
              </span>
              <span className="md-entry__actions">
                <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={row.downloaded || !row.fits || row.needsEngine} aria-label={`Download ${row.name}, ${row.sizeLabel}`} onClick={() => void download(row)}>
                  <Icon name="download" small />
                  Download
                </WriteButton>
              </span>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

function Search({ onChange }: { onChange(): Promise<void> }) {
  const id = useId();
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>();
  const [repo, setRepo] = useState<{ name: string; files: RepoFile[] | undefined; error: boolean }>();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);

  const search = async () => {
    setBusy(true);
    setRepo(undefined);
    try {
      setHits(await searchRepos(query));
      setError(false);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  const open = async (name: string) => {
    setRepo({ name, files: undefined, error: false });
    try {
      setRepo({ name, files: await repoFiles(name), error: false });
    } catch {
      setRepo({ name, files: undefined, error: true });
    }
  };
  const get = async (file: RepoFile) => {
    if (repo && Outcome(await downloadFromRepo(repo.name, file), `Downloading ${file.label}`)) await onChange();
  };

  return (
    <div className="md-box">
      <form
        className="md-actions"
        onSubmit={(event) => {
          event.preventDefault();
          if (query.trim()) void search();
        }}
      >
        <div className="input-wrap mp-search">
          <Icon name="search" />
          <input id={id} className="input" type="search" aria-label="Search Hugging Face for GGUF models" placeholder="Search Hugging Face for GGUF models" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        <button type="submit" className="btn btn--secondary" disabled={busy || !query.trim()} aria-busy={busy}>
          Search
        </button>
      </form>
      {error && <p role="alert">Hermes could not reach Hugging Face. Try again in a moment.</p>}
      {hits && hits.length === 0 && <p role="status">No GGUF repos match “{query}”.</p>}
      {hits && hits.length > 0 && !repo && (
        <ul className="list panel md-entries" aria-label="Hugging Face results">
          {hits.map((hit) => (
            <li key={hit.repo}>
              <div className="list-row md-entry">
                <span className="list-row__main">
                  <span className="list-row__title mono">{hit.repo}</span>
                  <span className="subtle md-note">
                    {hit.downloads.toLocaleString('en')} downloads · {hit.likes.toLocaleString('en')} likes · updated {hit.updated}
                    {hit.gated ? ' · needs a login on Hugging Face, so Hermes cannot download it' : ''}
                  </span>
                </span>
                <span className="md-entry__actions">
                  <button type="button" className="btn btn--secondary btn--sm" disabled={hit.gated} aria-label={`Show the files of ${hit.repo}`} onClick={() => void open(hit.repo)}>
                    Files
                  </button>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {repo && (
        <div className="md-box">
          <div className="md-box__head">
            <h3 className="mono">{repo.name}</h3>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setRepo(undefined)}>
              Back to results
            </button>
          </div>
          {repo.error && <p role="alert">Hermes could not list the files of this repo.</p>}
          {!repo.files && !repo.error && <p role="status">Asking Hermes for the files…</p>}
          {repo.files?.length === 0 && <p role="status">This repo has no GGUF model Hermes can serve.</p>}
          {repo.files && repo.files.length > 0 && (
            <ul className="list panel md-entries" aria-label={`Files of ${repo.name}`}>
              {repo.files.map((file) => (
                <li key={file.paths[0]}>
                  <div className="list-row md-entry">
                    <span className="list-row__main">
                      <span className="list-row__title mono">{file.label}</span>
                      <span className="md-entry__meta">
                        <span className="tag">{file.sizeLabel}</span>
                        <span className="tag" data-tone={file.fit === 'too-big' ? 'warning' : 'neutral'}>{FIT_WORDS[file.fit]}</span>
                      </span>
                    </span>
                    <span className="md-entry__actions">
                      <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={file.fit === 'too-big'} aria-label={`Download ${file.label}, ${file.sizeLabel}`} onClick={() => void get(file)}>
                        <Icon name="download" small />
                        Download
                      </WriteButton>
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Sideload({ onChange }: { onChange(): Promise<void> }) {
  const id = useId();
  const [path, setPath] = useState('');
  const add = async () => {
    if (Outcome(await sideloadModel(path.trim()), 'Model added')) {
      setPath('');
      await onChange();
    }
  };
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        Add a model file already on this Mac
      </label>
      <div className="md-actions">
        <input id={id} className="input input--mono mp-search" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="/Users/you/models/model-Q4_K_M.gguf" value={path} onChange={(event) => setPath(event.target.value)} />
        <WriteButton type="button" className="btn btn--secondary" disabled={!path.trim().startsWith('/')} onClick={() => void add()}>
          Add model
        </WriteButton>
      </div>
      <p className="field__help">The absolute path of a .gguf file. Hermes links it into its models folder without copying it.</p>
    </div>
  );
}

function Installed({ models, profile, serverRunning, onChange }: { models: StagedModel[]; profile: string; serverRunning: boolean; onChange(): Promise<void> }) {
  const run = async (outcome: Promise<ActionOutcome>, done: string) => {
    if (Outcome(await outcome, done)) await onChange();
  };
  const remove = async (model: StagedModel) => {
    const result = await deleteModel(model);
    if (Outcome(result, result.kind === 'done' ? result.body.message : '')) await onChange();
  };
  if (models.length === 0) {
    return (
      <div className="empty">
        <span className="empty__icon">
          <Icon name="database" />
        </span>
        <p>No local model is on disk. Download one from the catalogue or add a file.</p>
      </div>
    );
  }
  return (
    <ul className="list panel md-entries" aria-label="Local models on disk">
      {models.map((model) => (
        <li key={model.id}>
          <div className="list-row md-entry">
            <span className="list-row__main">
              <span className="list-row__title mono">{model.id}</span>
              <span className="md-entry__meta">
                <span className="tag">{model.sizeLabel}</span>
                {model.active && <span className="tag" data-tone="accent">Main model</span>}
                {model.residency === 'loaded' && <span className="tag" data-tone="success">In memory</span>}
                {model.residency === 'loading' && <span className="tag" data-tone="warning">Loading</span>}
              </span>
            </span>
            <span className="md-entry__actions">
              <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={model.active} aria-label={`Activate ${model.id} for ${profile}`} onClick={() => void run(activateModel(model, profile), `Setting up ${model.id}`)}>
                Activate
              </WriteButton>
              <WriteButton type="button" className="btn btn--ghost btn--sm" disabled={model.residency !== 'loaded' || !serverRunning} aria-label={`Eject ${model.id}`} onClick={() => void run(ejectModel(model), `${model.id} ejected`)}>
                Eject
              </WriteButton>
              <WriteButton type="button" className="btn btn--ghost btn--sm" aria-label={`Delete ${model.id}`} onClick={() => void remove(model)}>
                <Icon name="trash" small />
              </WriteButton>
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

/**
 * Agents › Models › Local models: the models Hermes can run on this Mac, with its own llama.cpp runtime. A phone shows the status, the active model
 * and the progress of jobs (and the actions that are small); downloads, searching, adding a file and installing the runtime are for a tablet or a desktop.
 */
export function LocalModels({ profile }: { profile: string }) {
  const compact = useSizeClass() === 'compact';
  const { status, hardware, jobs, failed, reload } = useLocalModels();
  const [version, setVersion] = useState('');
  useEffect(() => {
    setVersion(`${status?.models.map((model) => model.id).join(',') ?? ''}|${status?.runtime.installed}|${jobs.filter((job) => job.status === 'done').length}`);
  }, [status, jobs]);

  if (!status) {
    return failed ? (
      <div className="banner md-error" data-tone="danger" role="alert">
        <Icon name="alert" />
        <span className="banner__content">Hermes did not answer, so the local models could not be loaded.</span>
        <button type="button" className="btn btn--secondary btn--sm" onClick={() => void reload()}>
          <Icon name="refresh" />
          Retry
        </button>
      </div>
    ) : (
      <p role="status">Loading…</p>
    );
  }

  const running = jobs.filter((job) => job.status === 'running' || job.status === 'paused');
  const recent = jobs.filter((job) => job.status !== 'running' && job.status !== 'paused').slice(0, 3);
  const active = status.models.find((model) => model.active);
  const server = async (action: 'start' | 'stop') => {
    if (Outcome(await setServer(action), action === 'start' ? 'Local server started' : 'Local server stopped')) await reload();
  };
  const install = async () => {
    if (Outcome(await installRuntime(profile), 'Installing the runtime')) await reload();
  };

  return (
    <div className="md-local">
      <p className="muted md-lead">
        A <Term id="local-model">local model</Term> runs on this Mac instead of at a provider. Hermes runs it with a managed <Term id="local-runtime">runtime</Term> (llama.cpp) and keeps the files in its own models folder (<span className="mono">{status.modelsDir}</span>). Models are <Term id="gguf">GGUF</Term> files.
      </p>

      <section className="panel panel--pad md-box" aria-labelledby="md-local-status">
        <h3 id="md-local-status">Status</h3>
        <p className="md-lead" role="status">{explainRuntime(status)}</p>
        {status.runtime.updateAvailable && <p className="subtle md-note">A newer runtime build than the one in use is configured. Install the runtime to update it.</p>}
        <dl className="md-card__facts">
          <dt>Memory models can use</dt>
          <dd>{hardware ? `${hardware.totalMemoryLabel}${hardware.unified ? ' (shared with the GPU)' : ''}` : '…'}</dd>
          <dt>Main model of {profile}</dt>
          <dd>{active ? <span className="mono">{active.id}</span> : 'Not a local model'}</dd>
          <dt>Local server</dt>
          <dd>{status.runtime.serverRunning ? 'Running' : 'Off'}</dd>
        </dl>
        <div className="md-actions">
          {status.runtime.installed &&
            (status.runtime.serverRunning ? (
              <WriteButton type="button" className="btn btn--secondary btn--sm" onClick={() => void server('stop')}>
                Stop server
              </WriteButton>
            ) : (
              <WriteButton type="button" className="btn btn--secondary btn--sm" onClick={() => void server('start')}>
                Start server
              </WriteButton>
            ))}
          {!compact && (!status.runtime.installed || status.runtime.updateAvailable) && (
            <WriteButton type="button" className="btn btn--primary btn--sm" onClick={() => void install()}>
              <Icon name="download" small />
              {status.runtime.installed ? 'Update runtime' : 'Install runtime'}
            </WriteButton>
          )}
        </div>
        {compact && !status.runtime.installed && <p className="subtle md-note">Installing the runtime is offered on a tablet or a desktop.</p>}
      </section>

      {(running.length > 0 || recent.length > 0) && (
        <section className="md-box" aria-labelledby="md-local-jobs">
          <h3 id="md-local-jobs">Jobs</h3>
          <ul className="list panel md-entries" aria-label="Jobs">
            {[...running, ...recent].map((job) => (
              <Job key={job.id} job={job} onChange={reload} />
            ))}
          </ul>
        </section>
      )}

      <section className="md-box" aria-labelledby="md-local-installed">
        <h3 id="md-local-installed">On this Mac</h3>
        <Installed models={status.models} profile={profile} serverRunning={status.runtime.serverRunning} onChange={reload} />
      </section>

      {compact ? (
        <p className="subtle md-note">Downloading, searching Hugging Face and adding a file are offered on a tablet or a desktop.</p>
      ) : (
        <>
          <section className="md-box" aria-labelledby="md-local-catalog">
            <h3 id="md-local-catalog">Catalogue</h3>
            <p className="subtle md-note">Each model is priced for this Mac before you download it. A download needs the disk space shown on each model and can take a long time.</p>
            <Catalog profile={profile} version={version} runtimeInstalled={status.runtime.installed} onChange={reload} />
          </section>
          <section className="md-box" aria-labelledby="md-local-search">
            <h3 id="md-local-search">Search Hugging Face</h3>
            <Search onChange={reload} />
          </section>
          <section className="md-box" aria-labelledby="md-local-sideload">
            <h3 id="md-local-sideload">Add a file</h3>
            <Sideload onChange={reload} />
          </section>
        </>
      )}
    </div>
  );
}
