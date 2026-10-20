// The chat's context panel, Artifacts tab (M6 #05): what Caduceus has kept from this chat, and the files the chat changed, read live from Hermes each time the tab
// opens and when a turn ends. In a git repository the list is Hermes's review of the working tree; elsewhere it is the chat's latest checkpoint compared with the files
// now. Nothing about the files is stored: Keep in Artifacts copies one file into the store, on purpose.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { gatewayConnection } from '../../gateway.ts';
import { AppLink } from '../../shell/navigation.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { keepSessionFile, useArtifacts } from '../artifacts/artifacts-data.ts';
import { contentUrl, sizeWords } from '../artifacts/artifacts-model.ts';
import { filesFromDiff, parseReviewList, STATUS_WORDS, type ChangedFile, type DiffedFile } from '../artifacts/changed-files.ts';
import '../artifacts/artifacts.css';
import '../git/git.css';
import { DiffView } from '../git/DiffView.tsx';
import { useDiff } from '../git/git-data.ts';
import { parseCheckpoints } from '../checkpoints/checkpoints-model.ts';

export interface ArtifactsTabProps {
  /** The stored session's id, or `undefined` while the chat has none yet. */
  sessionId: string | undefined;
  profile: string | undefined;
  title: string;
  /** The folder the chat works in. */
  cwd: string | undefined;
  /** Hermes's live session for the chat, which a checkpoint is read through. */
  liveSession(): string | undefined;
  /** Changes when a turn ends, so the list is read again. */
  turn: unknown;
}

type Changed =
  | { state: 'loading' }
  | { state: 'failed'; message: string }
  | { state: 'ready'; origin: 'git' | 'checkpoint'; files: (ChangedFile | DiffedFile)[]; note?: string };

const CHECKPOINT_DIFF_LIMIT = 4000;

async function readChanged(cwd: string, live: string | undefined): Promise<Changed> {
  const status = await fetch(`/api/git/status?path=${encodeURIComponent(cwd)}`).catch(() => undefined);
  if (status === undefined || !status.ok) return { state: 'failed', message: status === undefined ? 'Caduceus did not answer, so the chat’s files could not be read.' : `Hermes answered HTTP ${status.status} for the chat’s folder.` };
  const repository: unknown = await status.json().catch(() => undefined);
  if (repository !== null) {
    const listed = await fetch(`/api/git/review/list?path=${encodeURIComponent(cwd)}`).catch(() => undefined);
    const files = listed?.ok ? parseReviewList(await listed.json().catch(() => undefined)) : undefined;
    return files === undefined ? { state: 'failed', message: 'Hermes did not list the changed files.' } : { state: 'ready', origin: 'git', files };
  }
  // No repository: the chat's latest checkpoint against the files now, when Hermes keeps checkpoints and the chat is live.
  if (live === undefined) return { state: 'ready', origin: 'checkpoint', files: [], note: 'This folder is not a git repository, and Hermes can compare checkpoints only for a chat that is open. Send a message first.' };
  try {
    const { client } = gatewayConnection();
    const list = parseCheckpoints(await client.request('rollback.list', { session_id: live }));
    if (!list.enabled) return { state: 'ready', origin: 'checkpoint', files: [], note: 'This folder is not a git repository and Hermes is not keeping checkpoints, so there is no list of changed files.' };
    const newest = list.items[0];
    if (newest === undefined) return { state: 'ready', origin: 'checkpoint', files: [], note: 'No checkpoint yet: the agent takes one the first time it changes a file.' };
    const answer = await client.request<{ diff?: unknown }>('rollback.diff', { session_id: live, hash: newest.hash });
    const diff = typeof answer.diff === 'string' ? answer.diff : '';
    return { state: 'ready', origin: 'checkpoint', files: filesFromDiff(diff), ...(diff.length >= CHECKPOINT_DIFF_LIMIT ? { note: 'Hermes cuts a checkpoint’s diff at 4000 characters, so files past that are not listed.' } : {}) };
  } catch (error) {
    return { state: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}

/** The panel is a narrow column (or a sheet), so a diff in it is always the unified one. */
function GitDiff({ cwd, file }: { cwd: string; file: string }) {
  const diff = useDiff(cwd, file, false, undefined);
  return diff === undefined ? <p role="status">Loading…</p> : <DiffView diff={diff} split={false} />;
}

function Row({ file, origin, cwd, keep, kept }: { file: ChangedFile | DiffedFile; origin: 'git' | 'checkpoint'; cwd: string; keep(path: string): void; kept: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="ctx-art__file">
      <button type="button" className="btn btn--ghost btn--sm ctx-art__name" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name={open ? 'chev-d' : 'chev-r'} small />
        <span className="mono">{file.path}</span>
      </button>
      <div className="ctx-art__meta">
        <span className="ctx-art__status">{STATUS_WORDS[file.status] ?? file.status}</span>
        <span className="subtle mono grow">
          +{file.added} −{file.removed}
        </span>
        {file.status !== 'D' && (
          <WriteButton type="button" className="btn btn--secondary btn--sm" aria-label={`${kept ? 'Kept in Artifacts' : 'Keep in Artifacts'}: ${file.path}`} disabled={kept} onClick={() => keep(file.path)}>
            {kept ? 'Kept' : 'Keep in Artifacts'}
          </WriteButton>
        )}
      </div>
      {open && (origin === 'git' ? <GitDiff cwd={cwd} file={file.path} /> : 'diff' in file ? <DiffView diff={file.diff} split={false} /> : null)}
    </li>
  );
}

export function ArtifactsTab({ sessionId, profile, title, cwd, liveSession, turn }: ArtifactsTabProps) {
  const kept = useArtifacts({ source: 'session' }, sessionId ?? '-');
  const [changed, setChanged] = useState<Changed>({ state: 'loading' });
  const reloadKept = kept.reload;
  // The parent makes a new function on every render; reading through a ref keeps the list from being asked again for it.
  const live = useRef(liveSession);
  live.current = liveSession;
  const read = useCallback(async () => {
    if (cwd === undefined) return;
    setChanged(await readChanged(cwd, live.current()));
  }, [cwd]);
  useEffect(() => {
    void read();
  }, [read, turn]);
  useEffect(() => {
    const onVisible = () => document.visibilityState === 'visible' && void read();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [read]);

  // The files kept from this panel: pressed once, a file shows as Kept and cannot be kept again (a second copy is refused, with a red error).
  const [keptPaths, setKeptPaths] = useState<ReadonlySet<string>>(new Set());
  const keep = async (relative: string) => {
    if (sessionId === undefined || cwd === undefined || keptPaths.has(relative)) return;
    const outcome = await keepSessionFile(sessionId, profile, title, cwd, relative);
    if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
    if (outcome.kind === 'done') setKeptPaths((paths) => new Set(paths).add(relative));
    if (outcome.kind === 'done') toast(`Kept ${outcome.body.artifact.name} in Artifacts`, { tone: 'success' });
    await reloadKept();
  };

  return (
    <div className="ctx-art">
      <section aria-labelledby="ctx-art-kept">
        <h3 id="ctx-art-kept" className="ctx__heading">
          Kept from this chat
        </h3>
        {sessionId === undefined ? (
          <p className="subtle">Artifacts you keep from this chat appear here once the chat has started.</p>
        ) : kept.artifacts.state !== 'ready' ? (
          <p className="subtle" role={kept.artifacts.state === 'failed' ? 'alert' : 'status'}>
            {kept.artifacts.state === 'failed' ? kept.artifacts.message : 'Loading…'}
          </p>
        ) : kept.artifacts.artifacts.length === 0 ? (
          <p className="subtle">Nothing kept yet. Use Keep in Artifacts on a file below.</p>
        ) : (
          <ul className="ctx-art__list">
            {kept.artifacts.artifacts.map((artifact) => (
              <li key={artifact.id} className="ctx-art__kept">
                <AppLink className="btn btn--ghost btn--sm ctx-art__link" to={`/workspace/artifacts?open=${encodeURIComponent(artifact.id)}`}>
                  {artifact.title}
                </AppLink>
                <span className="subtle">{sizeWords(artifact.size)}</span>
                <a className="btn btn--ghost btn--icon" href={contentUrl(artifact.id, true)} download={artifact.name} aria-label={`Download ${artifact.name}`}>
                  <Icon name="download" small />
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="ctx-art-changed">
        <h3 id="ctx-art-changed" className="ctx__heading">
          Files this chat changed
        </h3>
        {cwd === undefined ? (
          <p className="subtle">This chat has no folder yet, so there is nothing to compare.</p>
        ) : changed.state === 'loading' ? (
          <p className="subtle" role="status">
            Asking Hermes…
          </p>
        ) : changed.state === 'failed' ? (
          <p className="banner" data-tone="danger" role="alert">
            <Icon name="alert" />
            <span className="banner__content">{changed.message}</span>
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => void read()}>
              <Icon name="refresh" small />
              Retry
            </button>
          </p>
        ) : (
          <>
            <p className="subtle ctx-art__note">
              {changed.origin === 'git' ? `Hermes’s review of the working tree in ${cwd}: everything changed there, not only by this chat.` : `The chat’s latest checkpoint compared with the files now in ${cwd}.`}
            </p>
            {changed.note && <p className="subtle">{changed.note}</p>}
            {changed.files.length === 0 && !changed.note && <p className="subtle">No changed files.</p>}
            {changed.files.length > 0 && (
              <ul className="ctx-art__list">
                {changed.files.map((file) => (
                  <Row key={file.path} file={file} origin={changed.origin} cwd={cwd} keep={(path) => void keep(path)} kept={keptPaths.has(file.path)} />
                ))}
              </ul>
            )}
          </>
        )}
      </section>
    </div>
  );
}
