// Reading Hermes's git routes for Workspace › Git. Only GETs live here; every change goes through `git-actions.ts`. Nothing is kept: the repository is asked again
// after every operation and when the window gets the focus back.
import { useCallback, useEffect, useRef, useState } from 'react';
import { parseBranches, parseStatus, parseWorktrees, type Branch, type RepoStatus, type Worktree } from './git-model.ts';

const route = (name: string, folder: string, extra = '') => `/api/git/${name}?path=${encodeURIComponent(folder)}${extra}`;

export type Repo =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'failed'; message: string }
  /** The folder is in no repository. */
  | { state: 'none' }
  | { state: 'ready'; status: RepoStatus; branches: Branch[]; worktrees: Worktree[] };

async function readRepo(folder: string): Promise<Repo> {
  const res = await fetch(route('status', folder)).catch(() => undefined);
  if (!res) return { state: 'failed', message: 'Caduceus did not answer, so the repository could not be read.' };
  const body: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const reason = typeof body === 'object' && body !== null ? ((body as { message?: unknown; detail?: unknown }).message ?? (body as { detail?: unknown }).detail) : undefined;
    return { state: 'failed', message: typeof reason === 'string' ? reason : `Hermes answered HTTP ${res.status}.` };
  }
  const status = parseStatus(body);
  if (status === null) return { state: 'none' };
  if (status === undefined) return { state: 'failed', message: 'Hermes did not answer with a repository status.' };
  const [branches, worktrees] = await Promise.all([
    fetch(route('branches', folder)).then((r) => (r.ok ? r.json() : undefined), () => undefined),
    fetch(route('worktrees', folder)).then((r) => (r.ok ? r.json() : undefined), () => undefined),
  ]);
  return { state: 'ready', status, branches: parseBranches(branches), worktrees: parseWorktrees(worktrees) };
}

/** The repository behind a folder; `reload` asks again, and the window getting the focus back does too. The last answer stays while the next is awaited. */
export function useRepo(folder: string | undefined): { repo: Repo; reload(): Promise<void> } {
  const [repo, setRepo] = useState<Repo>({ state: 'idle' });
  const latest = useRef(0);
  const folderRef = useRef(folder);
  folderRef.current = folder;
  const reload = useCallback(async () => {
    const now = folderRef.current;
    if (now === undefined) return;
    const request = ++latest.current;
    const read = await readRepo(now);
    if (request === latest.current) setRepo(read);
  }, []);
  useEffect(() => {
    if (folder === undefined) {
      setRepo({ state: 'idle' });
      return;
    }
    setRepo({ state: 'loading' });
    void reload();
  }, [folder, reload]);
  useEffect(() => {
    const onFocus = () => void reload();
    const onVisible = () => document.visibilityState === 'visible' && void reload();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);
  return { repo, reload };
}

/** One file's diff: unstaged or staged. `undefined` while it is read, and an empty string for no changes. */
export function useDiff(folder: string | undefined, file: string | undefined, staged: boolean, version: unknown): string | undefined {
  const [diff, setDiff] = useState<string>();
  useEffect(() => {
    if (folder === undefined || file === undefined) {
      setDiff(undefined);
      return;
    }
    let current = true;
    fetch(route('review/diff', folder, `&file=${encodeURIComponent(file)}&staged=${staged}`))
      .then((res) => (res.ok ? res.json() : undefined), () => undefined)
      .then((body: unknown) => current && setDiff(typeof body === 'object' && body !== null && 'diff' in body && typeof body.diff === 'string' ? body.diff : ''));
    return () => {
      current = false;
    };
  }, [folder, file, staged, version]);
  return diff;
}
