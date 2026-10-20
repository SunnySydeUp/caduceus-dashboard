// Looking for repositories in a folder, for Discover repos: Hermes only scans the folders its `desktop.repo_scan_roots` setting names (none by
// default), so the page can also ask Hermes about the folders inside one the owner picks. One level deep and bounded: a folder is a repository
// when Hermes says its git root is that folder. Nothing is kept; free of the DOM and of React.
import { parseGitRoot, parseListing } from './workspace-model.ts';
import type { RepoCandidate } from './projects-model.ts';

/** How many folders inside the picked one are asked about, and how many are asked at once. */
export const SCAN_LIMIT = 200;
const SCAN_CONCURRENCY = 8;

export interface ScanResult {
  repos: RepoCandidate[];
  /** The folder has more folders than the page asked about. */
  truncated: boolean;
  /** Why nothing could be scanned (a missing or unreadable folder), in words. */
  problem?: string;
}

/**
 * The repositories directly inside `folder`, by name. `read` answers a Hermes GET as parsed JSON (the page's `fetch`); the folder's own entries
 * come from `GET /api/fs/list` and each is asked about with `GET /api/fs/git-root`. Hidden folders are skipped.
 */
export async function scanFolder(folder: string, read: (route: string) => Promise<unknown>): Promise<ScanResult> {
  const listing = parseListing(await read(`/api/fs/list?path=${encodeURIComponent(folder)}`));
  if (listing.kind === 'missing') return { repos: [], truncated: false, problem: 'Hermes does not find this folder on the Mac that runs it.' };
  if (listing.kind === 'not-a-folder') return { repos: [], truncated: false, problem: 'This path is a file, not a folder.' };
  if (listing.kind === 'unreadable') return { repos: [], truncated: false, problem: `Hermes cannot read this folder (${listing.error}).` };
  const inside = listing.folders.filter((entry) => !entry.name.startsWith('.'));
  const asked = inside.slice(0, SCAN_LIMIT);
  const repos: RepoCandidate[] = [];
  let next = 0;
  const worker = async () => {
    for (let entry = asked[next++]; entry !== undefined; entry = asked[next++]) {
      const root = parseGitRoot(await read(`/api/fs/git-root?path=${encodeURIComponent(entry.path)}`).catch(() => undefined));
      if (root === entry.path) repos.push({ path: entry.path, label: entry.name, sessions: 0, lastActive: 0 });
    }
  };
  await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, asked.length) }, worker));
  return { repos: repos.sort((a, b) => a.label.localeCompare(b.label)), truncated: inside.length > asked.length };
}
