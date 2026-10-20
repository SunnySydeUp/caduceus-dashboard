// Reading Hermes for the workspace field: the folders under a path, a repository's branches, the projects and the default folder. Only GETs live here.
// Nothing is kept: Hermes is asked again whenever the path changes, and an answer for an earlier path is ignored.
import { isRecord } from '@caduceus/contracts/policy/guards';
import { useEffect, useState } from 'react';
import { parseBranches, parseListing, type Branch, type Listing } from './workspace-model.ts';

/** How long a typed path rests before Hermes is asked about it. */
const TYPING_PAUSE_MS = 250;

/** A path Hermes can be asked about: absolute, or under the home folder's `~`. */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('~');
}

/**
 * Asks Hermes for `url` (nothing when `undefined`) after `pause` ms and parses the body. The value belongs to the url it was read for:
 * while a new url is waiting, `value` is `undefined` and `loading` is true. `failed` turns a network or HTTP failure into a value; without it a failure leaves `value` undefined.
 */
function useRead<T>(url: string | undefined, parse: (body: unknown) => T, pause: number, failed?: (message: string) => T): { value: T | undefined; loading: boolean } {
  const [answer, setAnswer] = useState<{ url: string; value: T | undefined }>();
  useEffect(() => {
    if (url === undefined) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void fetch(url, { signal: controller.signal })
        .then((response) => {
          if (!response.ok) throw new Error(`Hermes answered HTTP ${response.status}.`);
          return response.json() as Promise<unknown>;
        })
        .then(
          (body) => setAnswer({ url, value: parse(body) }),
          (error: unknown) => {
            if (controller.signal.aborted) return;
            setAnswer({ url, value: failed?.(error instanceof Error ? error.message : 'Hermes did not answer.') });
          },
        );
    }, pause);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // `parse` and `failed` are fixed at every call site; only the url and the pause change what is asked.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, pause]);
  const value = url !== undefined && answer?.url === url ? answer.value : undefined;
  return { value, loading: url !== undefined && answer?.url !== url };
}

function pathUrl(endpoint: string, path: string): string | undefined {
  const trimmed = path.trim();
  return isAbsolutePath(trimmed) ? `${endpoint}?path=${encodeURIComponent(trimmed)}` : undefined;
}

/** What Hermes says is at `path`; nothing is asked for a path that is empty or relative. Pass `pause` 0 for a path chosen by a tap rather than typed. */
export function useListing(path: string, pause = TYPING_PAUSE_MS): { listing: Listing | undefined; loading: boolean } {
  const { value, loading } = useRead<Listing>(pathUrl('/api/fs/list', path), parseListing, pause, (error) => ({ kind: 'unreadable', error }));
  return { listing: value, loading };
}

/** The branches of the repository at `path`: `[]` when the folder is in none, `undefined` until Hermes has answered or when it cannot. */
export function useBranches(path: string): Branch[] | undefined {
  return useRead(pathUrl('/api/git/branches', path), parseBranches, TYPING_PAUSE_MS).value;
}

export interface WorkProject {
  id: string;
  slug: string;
  name: string;
  /** The repository folder the project anchors worktrees in; empty when it has none. */
  primaryPath: string;
}

function parseProjects(body: unknown): WorkProject[] {
  const listed = isRecord(body) && Array.isArray(body.projects) ? body.projects : [];
  const projects = listed.flatMap((entry): WorkProject[] => {
    if (!isRecord(entry) || typeof entry.id !== 'string') return [];
    const slug = typeof entry.slug === 'string' ? entry.slug : entry.id;
    return [{ id: entry.id, slug, name: typeof entry.name === 'string' && entry.name !== '' ? entry.name : slug, primaryPath: typeof entry.primary_path === 'string' ? entry.primary_path : '' }];
  });
  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

/** Hermes's kanban projects, by name; `undefined` until Hermes has answered or when it cannot. */
export function useProjects(): WorkProject[] | undefined {
  return useRead('/api/plugins/kanban/projects', parseProjects, 0).value;
}

function parseDefaultFolder(body: unknown): string {
  return isRecord(body) && typeof body.cwd === 'string' && body.cwd !== '' ? body.cwd : '/';
}

/** The folder Hermes starts in on the Mac that runs it, or the top folder `/` when Hermes does not say. `undefined` only until it has answered. */
export function useDefaultFolder(): string | undefined {
  return useRead('/api/fs/default-cwd', parseDefaultFolder, 0, () => '/').value;
}
