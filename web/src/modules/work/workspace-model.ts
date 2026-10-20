// What the Brief editor reads from Hermes's file and git endpoints to choose a task's workspace: the folders under a path (`GET /api/fs/list`),
// whether a folder is there, and a repository's branches (`GET /api/git/branches`). Free of the DOM and of React; nothing is kept, Hermes is asked
// again whenever the owner opens a folder or a picker (D1).
import { isRecord } from '@caduceus/contracts/policy/guards';

export interface FolderEntry {
  name: string;
  /** The folder's absolute path as Hermes resolves it. */
  path: string;
}

/** What Hermes says a path is. A path that is not there is `{ entries: [], error: 'ENOENT' }`, not an HTTP error. */
export type Listing = { kind: 'folder'; folders: FolderEntry[]; files: number } | { kind: 'missing' } | { kind: 'not-a-folder' } | { kind: 'unreadable'; error: string };

export function parseListing(body: unknown): Listing {
  if (!isRecord(body)) return { kind: 'unreadable', error: 'Hermes did not answer with a listing.' };
  if (body.error === 'ENOENT') return { kind: 'missing' };
  if (body.error === 'ENOTDIR') return { kind: 'not-a-folder' };
  if (typeof body.error === 'string') return { kind: 'unreadable', error: body.error };
  const entries = Array.isArray(body.entries) ? body.entries : [];
  const folders = entries.flatMap((entry): FolderEntry[] => (isRecord(entry) && entry.isDirectory === true && typeof entry.name === 'string' && typeof entry.path === 'string' ? [{ name: entry.name, path: entry.path }] : []));
  return { kind: 'folder', folders: folders.sort((a, b) => a.name.localeCompare(b.name)), files: entries.filter((entry) => isRecord(entry) && entry.isDirectory !== true).length };
}

/**
 * Why a folder cannot be the task's workspace, in words; `undefined` when it can. Under a remote terminal backend (`remote`: its name and label) the
 * agent works on another machine, but Hermes still checks a workspace on its own Mac, so a folder it does not find may exist there: Hermes's refusal
 * is shown with that said.
 */
export function folderProblem(listing: Listing, remote?: { label: string }): string | undefined {
  switch (listing.kind) {
    case 'folder':
      return undefined;
    case 'missing':
      return remote
        ? `Hermes does not find this folder on the Mac that runs it. The terminal backend of this profile is ${remote.label}, so the agent works on another machine, but Hermes can only check folders on its own Mac: a folder that exists only there is refused here.`
        : 'Hermes does not find this folder on the Mac that runs it.';
    case 'not-a-folder':
      return 'This path is a file, not a folder.';
    case 'unreadable':
      return `Hermes cannot read this folder (${listing.error}).`;
  }
}

/** The folder above `path`, or `undefined` at the top. */
export function parentFolder(path: string): string | undefined {
  const trimmed = path.replace(/\/+$/, '');
  const cut = trimmed.lastIndexOf('/');
  if (cut < 0) return undefined;
  return cut === 0 ? (trimmed === '' ? undefined : '/') : trimmed.slice(0, cut);
}

export interface Branch {
  name: string;
  isDefault: boolean;
  isRemote: boolean;
  /** Checked out in a worktree now: a second worktree cannot use it. */
  checkedOut: boolean;
}

/** A repository's branches from `GET /api/git/branches`, the default branch first and local ones before remote ones; a folder that is no repository has none. */
export function parseBranches(body: unknown): Branch[] {
  const listed = isRecord(body) && Array.isArray(body.branches) ? body.branches : [];
  const branches = listed.flatMap((entry): Branch[] => (isRecord(entry) && typeof entry.name === 'string' ? [{ name: entry.name, isDefault: entry.isDefault === true, isRemote: entry.isRemote === true, checkedOut: entry.checkedOut === true }] : []));
  return branches.sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || Number(a.isRemote) - Number(b.isRemote) || a.name.localeCompare(b.name));
}

/** The repository's root from `GET /api/fs/git-root`, or `undefined` when the folder is in no repository. */
export function parseGitRoot(body: unknown): string | undefined {
  return isRecord(body) && typeof body.root === 'string' && body.root !== '' ? body.root : undefined;
}
