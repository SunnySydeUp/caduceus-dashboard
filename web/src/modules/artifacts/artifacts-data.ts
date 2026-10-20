// Reading and changing the Artifacts store through Caduceus (`/_caduceus/api/artifacts`). The list is asked again after every change; nothing is kept here.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Artifact, ArtifactList } from '@caduceus/contracts/artifacts';
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import { contentUrl, filterQuery, parseList, TEXT_VIEW_LIMIT, type ArtifactFilters } from './artifacts-model.ts';

const API = '/_caduceus/api/artifacts';

export type Artifacts = { state: 'loading' } | { state: 'failed'; message: string } | ({ state: 'ready' } & ArtifactList);

/** The artifacts that match `filters` (and, for a chat, one session's); `reload` asks again after a change. */
export function useArtifacts(filters: ArtifactFilters, sourceId?: string): { artifacts: Artifacts; reload(): Promise<void> } {
  const [artifacts, setArtifacts] = useState<Artifacts>({ state: 'loading' });
  const latest = useRef(0);
  const query = filterQuery(filters, sourceId === undefined ? {} : { sourceId });
  const reload = useCallback(async () => {
    const request = ++latest.current;
    const res = await fetch(`${API}${query}`).catch(() => undefined);
    const list = res?.ok ? parseList(await res.json().catch(() => undefined)) : undefined;
    if (request !== latest.current) return;
    setArtifacts(list === undefined ? { state: 'failed', message: 'Caduceus could not list the artifacts.' } : { state: 'ready', ...list });
  }, [query]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { artifacts, reload };
}

/** What a viewer needs of a file: text, or an object address for an image or a PDF (revoked by the caller), or why it cannot be shown. */
export type Content = { state: 'loading' } | { state: 'failed'; message: string } | { state: 'text'; text: string; cut: boolean } | { state: 'object'; src: string };

export function useContent(artifact: Artifact): Content {
  const [content, setContent] = useState<Content>({ state: 'loading' });
  useEffect(() => {
    if (artifact.kind === 'file') return;
    let current = true;
    let objectUrl: string | undefined;
    setContent({ state: 'loading' });
    fetch(contentUrl(artifact.id)).then(
      async (res) => {
        if (!current) return;
        if (!res.ok) return setContent({ state: 'failed', message: res.status === 404 ? 'The file is gone from Caduceus’s folder.' : `Caduceus answered HTTP ${res.status}.` });
        if (artifact.kind === 'image' || artifact.kind === 'pdf') {
          objectUrl = URL.createObjectURL(await res.blob());
          if (current) setContent({ state: 'object', src: objectUrl });
          else URL.revokeObjectURL(objectUrl);
          return;
        }
        const text = await res.text();
        if (current) setContent({ state: 'text', text: text.slice(0, TEXT_VIEW_LIMIT), cut: text.length > TEXT_VIEW_LIMIT });
      },
      () => current && setContent({ state: 'failed', message: 'Caduceus did not answer, so the file could not be opened.' }),
    );
    return () => {
      current = false;
      if (objectUrl !== undefined) URL.revokeObjectURL(objectUrl);
    };
  }, [artifact.id, artifact.kind]);
  return content;
}

/** Deletes (T1, the dialog names the artifact); the answer carries how long Undo works. */
export function deleteArtifact(artifact: Artifact): Promise<ActionOutcome<{ undoMs: number }>> {
  return runTiered(
    fetchTiered({
      method: 'DELETE',
      path: `${API}/${encodeURIComponent(artifact.id)}`,
      confirm: { title: `Delete “${artifact.title}”?`, text: 'It leaves Artifacts. The task, run or chat it came from is not changed. A toast offers Undo for a minute, and after that the file is gone.', object: artifact.title, confirmLabel: 'Delete', recoverability: { undoable: true, note: 'Undo brings it back for a minute.' } },
    }),
  );
}

export const restoreArtifact = (artifact: Artifact): Promise<ActionOutcome> => runTiered(fetchTiered({ method: 'POST', path: `${API}/${encodeURIComponent(artifact.id)}/restore` }));

export const pinArtifact = (artifact: Artifact, pinned: boolean): Promise<ActionOutcome> => runTiered(fetchTiered({ method: 'PUT', path: `${API}/${encodeURIComponent(artifact.id)}/pin`, body: { pinned } }));

export const setCap = (capBytes: number): Promise<ActionOutcome> => runTiered(fetchTiered({ method: 'PUT', path: '/_caduceus/api/artifacts-settings', body: { capBytes } }));

/** Keeps a file of a task (Attachments tab) or of a chat's workspace (chat's Artifacts tab) as an artifact. */
export const keepTaskFile = (board: string, taskId: string, attachmentId: number): Promise<ActionOutcome<{ artifact: Artifact }>> => runTiered(fetchTiered({ method: 'POST', path: `${API}/from-task`, body: { board, taskId, attachmentId } }));

export const keepSessionFile = (sessionId: string, profile: string | undefined, title: string, cwd: string, path: string): Promise<ActionOutcome<{ artifact: Artifact }>> =>
  runTiered(fetchTiered({ method: 'POST', path: `${API}/from-session`, body: { sessionId, ...(profile ? { profile } : {}), title, cwd, path } }));
