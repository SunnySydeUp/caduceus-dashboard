import { useEffect, useId, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { Icon } from '../../icons.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { filesUrl } from '../files/files-model.ts';
import { DiffView, useSplitDiff } from '../git/DiffView.tsx';
import { useFolderChoices } from '../git/folder-choices.ts';
import { restoreCheckpoint } from './checkpoints-actions.ts';
import { readDiff, useCheckpoints, useStorage } from './checkpoints-data.ts';
import { diffCut, plainDiff, sizeWords, type CheckpointItem } from './checkpoints-model.ts';
import './checkpoints.css';

const when = (at: number | undefined) => (at === undefined ? 'Unknown time' : new Date(at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' }));
const url = (folder: string) => `/workspace/checkpoints?folder=${encodeURIComponent(folder)}`;

/** Workspace › Checkpoints: the snapshots Hermes's agent took of a workspace, each compared with the files now and restorable. */
export function Checkpoints() {
  const search = useSearch({ strict: false }) as { folder?: unknown };
  const navigate = useAppNavigate();
  const { effective } = useProfileScope();
  const profile = effective?.name;
  const choices = useFolderChoices();
  const picked = typeof search.folder === 'string' && search.folder !== '' ? search.folder : undefined;
  const folder = picked ?? choices?.[0]?.path;
  const { checkpoints, reload } = useCheckpoints(folder, profile);
  const [version, setVersion] = useState(0);
  const storage = useStorage(profile, version);
  const split = useSplitDiff();
  const [selected, setSelected] = useState<CheckpointItem>();
  const [diff, setDiff] = useState<{ diff: string; stat: string } | { error: string }>();
  const [busy, setBusy] = useState(false);
  const pickerId = useId();
  const ready = checkpoints.state === 'ready' ? checkpoints : undefined;

  useEffect(() => setSelected(undefined), [folder]);
  useEffect(() => {
    if (!ready || !selected) {
      setDiff(undefined);
      return;
    }
    let current = true;
    setDiff(undefined);
    readDiff(ready.sessionId, selected.hash).then(
      (read) => current && setDiff(read),
      (error: unknown) => current && setDiff({ error: error instanceof Error ? error.message : String(error) }),
    );
    return () => {
      current = false;
    };
  }, [ready?.sessionId, selected?.hash]);

  const restore = async () => {
    if (!ready || !selected || !folder) return;
    setBusy(true);
    try {
      const outcome = await restoreCheckpoint(ready.sessionId, folder, selected, profile);
      if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
      if (outcome.kind === 'done') {
        toast(`Restored ${folder} to checkpoint ${selected.short}`, { tone: 'success', detail: 'Hermes put the files back.' });
        setVersion((now) => now + 1);
        await reload();
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cp">
      <PageHeader overline="Workspace" title="Checkpoints" subtitle={<>The <Term id="checkpoint">checkpoints</Term> Hermes’s agent took of a workspace, before it changed files.</>} />
      {choices !== undefined && choices.length === 0 && picked === undefined && (
        <div className="empty">
          <span className="empty__icon"><Icon name="history" /></span>
          <p>There is no workspace to show yet. Add one on Work › Projects, or look at a folder in Files.</p>
          <AppLink className="btn btn--primary" to="/work/projects">Open Projects</AppLink>
        </div>
      )}
      {folder !== undefined && (
        <div className="field">
          <label className="field__label" htmlFor={pickerId}>Workspace</label>
          <select id={pickerId} className="input" value={folder} onChange={(event) => void navigate(url(event.target.value), { replace: true })}>
            {!choices?.some((choice) => choice.path === folder) && <option value={folder}>{folder}</option>}
            {choices?.map((choice) => <option key={choice.path} value={choice.path}>{choice.label}</option>)}
          </select>
        </div>
      )}
      {checkpoints.state === 'attaching' && <p role="status">Opening a session on this folder through Hermes so its checkpoints can be read… Caduceus attaches one for you (no message is sent and nothing in the folder is touched).</p>}
      {checkpoints.state === 'failed' && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">{checkpoints.message}</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void reload()}><Icon name="refresh" />Retry</button>
        </div>
      )}
      {ready && !ready.list.enabled && (
        <div className="empty">
          <span className="empty__icon"><Icon name="history" /></span>
          <p>Checkpoints are off for this Hermes. A <Term id="checkpoint">checkpoint</Term> is a snapshot the agent takes of a workspace before it changes files in a turn. Caduceus turns them on for the Hermes it runs; if you started Hermes yourself, set HERMES_TUI_CHECKPOINTS=1 in its environment, and see the checkpoint settings in Config.</p>
          <AppLink className="btn btn--secondary" to="/system/config">Open Config</AppLink>
        </div>
      )}
      {ready && ready.list.enabled && (
        <>
          <p className="subtle">
            {ready.list.items.length} {ready.list.items.length === 1 ? 'checkpoint' : 'checkpoints'} for this workspace. {storage ? `All checkpoints use ${sizeWords(storage.totalBytes)}; ` : ''}old ones are pruned in System › Maintenance, not here.
          </p>
          {ready.list.items.length === 0 ? (
            <div className="empty">
              <span className="empty__icon"><Icon name="history" /></span>
              <p>No checkpoint yet. The agent takes one the first time it changes a file in this workspace during a turn.</p>
              <AppLink className="btn btn--secondary" to={filesUrl(folder)}>Look at the folder in Files</AppLink>
            </div>
          ) : (
            <div className="cp-split">
              <ul className="cp-list" aria-label="Checkpoints">
                {ready.list.items.map((item) => (
                  <li key={item.hash}>
                    <button type="button" className="cp-item" aria-pressed={selected?.hash === item.hash} onClick={() => setSelected(item)}>
                      <Icon name="history" />
                      <span className="cp-item__text">
                        <span>{when(item.at)}</span>
                        <small className="mono">{item.short}{item.message ? ` · ${item.message}` : ''}</small>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {selected && (
                <section className="cp-diff" aria-label={`Changes since checkpoint ${selected.short}`}>
                  <div className="cp-bar">
                    <h3 className="cp-h">Checkpoint {selected.short}</h3>
                    <WriteButton type="button" className="btn btn--danger btn--sm" disabled={busy} onClick={() => void restore()}>
                      <Icon name="history" />
                      Restore…
                    </WriteButton>
                  </div>
                  <p className="subtle">Restoring overwrites the files now in the folder with this checkpoint’s. It needs your passkey and the folder’s name typed, and only another checkpoint can reverse it. <Term id="checkpoint-restore">Restore</Term> also takes a live session’s history back one turn.</p>
                  {diff === undefined ? <p role="status">Loading…</p> : 'error' in diff ? (
                    <p className="banner" data-tone="danger" role="alert"><Icon name="alert" /><span className="banner__content">{diff.error}</span></p>
                  ) : (
                    <>
                      {diff.stat && <p className="mono cp-stat">{plainDiff(diff.stat)}</p>}
                      <DiffView diff={plainDiff(diff.diff)} split={split} />
                      {diffCut(diff.diff) && <p className="subtle">Hermes shows only the first 4000 characters of this diff.</p>}
                    </>
                  )}
                </section>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
