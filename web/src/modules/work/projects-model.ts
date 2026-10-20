// What Work › Projects knows about Hermes's projects, free of the DOM and of React: the tree Hermes builds across profiles, the repositories it finds,
// a repository's git summary, its recent commits and documents, and the boards and tasks linked to a project. Everything comes from Hermes's answers
// (D1); nothing here is stored. A Hermes project is a named set of folders that sessions and Kanban boards are grouped by; Hermes calls the folders'
// repositories "repos".
import { isRecord } from '@caduceus/contracts/policy/guards';
import { projectTone, type ProjectTone } from '../chat/sessions-projects.ts';
import { parseBoard, type BoardTask } from './board-model.ts';

/** A repository of a project: a folder Hermes resolved to a git root (or the folder itself when it is in none). */
export interface ProjectRepo {
  path: string;
  /** What Hermes calls it: the folder's name, made unique within the project. */
  label: string;
  sessionCount: number;
}

/** One row of the tree. */
export interface ProjectNode {
  /** `p_…` for a project the owner made; a folder's path for one Hermes derived from its sessions (`isAuto`). */
  id: string;
  name: string;
  /** The project's main folder; `undefined` for the Home bucket. */
  path: string | undefined;
  tone: ProjectTone | undefined;
  /** Hermes derived it from the folders its sessions work in: nobody made it, and it cannot be renamed or activated. */
  isAuto: boolean;
  /** The bucket for sessions that belong to no project. */
  isHome: boolean;
  sessionCount: number;
  /** Seconds since the epoch of the latest session; 0 for none. */
  lastActive: number;
  repos: ProjectRepo[];
}

export interface ProjectTree {
  projects: ProjectNode[];
  /** Profiles whose sessions Hermes could not read, with its words. A tree built without them is still shown. */
  errors: string[];
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);
const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : 0);

/** Reads `GET /api/profiles/projects/tree`. A row with no id is left out. Hermes orders the rows by latest activity; so does the page. */
export function parseProjectTree(body: unknown): ProjectTree {
  const root = isRecord(body) ? body : {};
  const projects = (Array.isArray(root.projects) ? root.projects : []).flatMap((raw): ProjectNode[] => {
    if (!isRecord(raw)) return [];
    const id = text(raw.id);
    if (id === undefined) return [];
    // The Home bucket (sessions that belong to no project) has one "repo" with no folder: its id is not a path anyone can open.
    const repos = raw.isNoProject === true ? [] : (Array.isArray(raw.repos) ? raw.repos : []).flatMap((entry): ProjectRepo[] => {
      if (!isRecord(entry)) return [];
      const path = text(entry.path) ?? text(entry.id);
      return path === undefined ? [] : [{ path, label: text(entry.label) ?? path, sessionCount: count(entry.sessionCount) }];
    });
    return [{ id, name: text(raw.label) ?? id, path: text(raw.path), tone: projectTone(raw.color), isAuto: raw.isAuto === true, isHome: raw.isNoProject === true, sessionCount: count(raw.sessionCount), lastActive: count(raw.lastActive), repos }];
  });
  const errors = (Array.isArray(root.errors) ? root.errors : []).flatMap((entry) => (isRecord(entry) && typeof entry.profile === 'string' ? [`${entry.profile}: ${text(entry.error) ?? 'could not be read'}`] : []));
  return { projects, errors };
}

/**
 * The tree with the projects a profile owns that Hermes's tree left out. Hermes builds the tree from each profile's sessions, so a project of a
 * profile that has no session yet is missing from it; it is shown with no sessions, so a project the owner just made is never absent.
 */
export function withOwnedProjects(projects: readonly ProjectNode[], owned: readonly { id: string; name: string; folders: readonly string[] }[]): ProjectNode[] {
  const known = new Set(projects.map((project) => project.id));
  const missing = owned.filter((project) => !known.has(project.id)).map((project): ProjectNode => ({
    id: project.id,
    name: project.name,
    path: project.folders[0],
    tone: undefined,
    isAuto: false,
    isHome: false,
    sessionCount: 0,
    lastActive: 0,
    repos: project.folders.map((path) => ({ path, label: path.split('/').filter(Boolean).pop() ?? path, sessionCount: 0 })),
  }));
  return [...projects, ...missing];
}

/** The tree in the order the page shows it: the owner's own projects, then the repositories Hermes found, then the Home bucket. */
export function groupTree(projects: readonly ProjectNode[]): { owned: ProjectNode[]; found: ProjectNode[]; home: ProjectNode | undefined } {
  return { owned: projects.filter((project) => !project.isAuto && !project.isHome), found: projects.filter((project) => project.isAuto && !project.isHome), home: projects.find((project) => project.isHome) };
}

/** A repository Hermes can turn into a project (`projects.discover_repos`). */
export interface RepoCandidate {
  path: string;
  label: string;
  sessions: number;
  /** Seconds since the epoch; 0 for none. */
  lastActive: number;
}

/** Reads `projects.discover_repos`: the repositories sessions worked in and those found in the folders Hermes scans, by latest activity. */
export function parseCandidates(result: unknown): RepoCandidate[] {
  const repos = isRecord(result) && Array.isArray(result.repos) ? result.repos : [];
  return repos.flatMap((entry): RepoCandidate[] => {
    if (!isRecord(entry)) return [];
    const path = text(entry.root);
    return path === undefined ? [] : [{ path, label: text(entry.label) ?? path, sessions: count(entry.sessions), lastActive: count(entry.last_active) }];
  });
}

/** The folders of `projects.list` by path, so a candidate that is already a project (in this profile) can say so and not be added twice. */
export function projectFolders(result: unknown): Map<string, string> {
  const owned = new Map<string, string>();
  for (const project of isRecord(result) && Array.isArray(result.projects) ? result.projects : []) {
    if (!isRecord(project) || project.archived === true) continue;
    const name = text(project.name) ?? 'a project';
    for (const folder of Array.isArray(project.folders) ? project.folders : []) if (isRecord(folder) && typeof folder.path === 'string') owned.set(folder.path, name);
  }
  return owned;
}

/** A repository's working tree as `GET /api/git/status` says it. */
export interface GitSummary {
  /** `undefined` when the head is detached. */
  branch: string | undefined;
  defaultBranch: string | undefined;
  detached: boolean;
  ahead: number;
  behind: number;
  /** Files with a change of any kind. */
  dirty: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
}

/** Reads `GET /api/git/status`; a folder in no repository answers `null`. */
export function parseGitSummary(body: unknown): GitSummary | undefined {
  if (!isRecord(body)) return undefined;
  return {
    branch: text(body.branch),
    defaultBranch: text(body.defaultBranch),
    detached: body.detached === true,
    ahead: count(body.ahead),
    behind: count(body.behind),
    dirty: count(body.changed),
    staged: count(body.staged),
    unstaged: count(body.unstaged),
    untracked: count(body.untracked),
    conflicted: count(body.conflicted),
  };
}

/** The sentence under the branch: how far it is from its upstream and how many files are changed. */
export function gitSentence(git: GitSummary): string {
  const parts: string[] = [];
  if (git.ahead === 0 && git.behind === 0) parts.push('nothing ahead or behind');
  else parts.push([git.ahead > 0 ? `${git.ahead} ahead` : '', git.behind > 0 ? `${git.behind} behind` : ''].filter(Boolean).join(', '));
  parts.push(git.dirty === 0 ? 'no changed files' : `${git.dirty} changed ${git.dirty === 1 ? 'file' : 'files'}`);
  return parts.join(' · ');
}

/** The subjects of the latest commits, newest first, from `GET /api/git/review/commit-context` (Hermes gives the ten latest subjects, no more). */
export function parseRecentCommits(body: unknown): string[] {
  const recent = isRecord(body) && typeof body.recent === 'string' ? body.recent : '';
  return recent.split('\n').map((line) => line.trim()).filter((line) => line !== '');
}

/** A document of the repository that the page can preview. */
export interface RepoDoc {
  name: string;
  path: string;
  /** `README.md`, or `docs/guide.md`: where it is, for the list. */
  where: string;
}

const DOC_PATTERN = /\.(md|markdown|mdx)$/i;
const MAX_DOCS = 30;

/** The README and the Markdown files of the `docs` folder, from two `GET /api/fs/list` answers, README first; the rest by name. */
export function repoDocs(rootListing: unknown, docsListing: unknown): RepoDoc[] {
  const files = (body: unknown) => (isRecord(body) && Array.isArray(body.entries) ? body.entries : []).flatMap((entry) => (isRecord(entry) && entry.isDirectory !== true && typeof entry.name === 'string' && typeof entry.path === 'string' ? [{ name: entry.name, path: entry.path }] : []));
  const readmes = files(rootListing).filter((file) => /^readme(\..+)?$/i.test(file.name) && DOC_PATTERN.test(file.name)).sort((a, b) => a.name.localeCompare(b.name));
  const guides = files(docsListing).filter((file) => DOC_PATTERN.test(file.name)).sort((a, b) => a.name.localeCompare(b.name));
  return [...readmes.map((file) => ({ ...file, where: file.name })), ...guides.map((file) => ({ ...file, where: `docs/${file.name}` }))].slice(0, MAX_DOCS);
}

/** What `GET /api/fs/read-text` gives for the preview. */
export type DocText = { kind: 'text'; text: string; truncated: boolean } | { kind: 'binary' } | { kind: 'unreadable' };

export function parseDocText(body: unknown): DocText {
  if (!isRecord(body) || typeof body.text !== 'string') return { kind: 'unreadable' };
  if (body.binary === true) return { kind: 'binary' };
  return { kind: 'text', text: body.text, truncated: body.truncated === true };
}

/** The slug of every board in `GET /api/plugins/kanban/boards`. */
export function boardSlugs(body: unknown): string[] {
  return (isRecord(body) && Array.isArray(body.boards) ? body.boards : []).flatMap((board) => (isRecord(board) && typeof board.slug === 'string' ? [board.slug] : []));
}

/** A board linked to a project: its slug and name. */
export interface LinkedBoard {
  slug: string;
  name: string;
}

/** The boards of `GET /api/plugins/kanban/boards` that Hermes links to the project (`project_id`). */
export function linkedBoards(body: unknown, projectId: string): LinkedBoard[] {
  const boards = isRecord(body) && Array.isArray(body.boards) ? body.boards : [];
  return boards.flatMap((board): LinkedBoard[] => {
    if (!isRecord(board) || typeof board.slug !== 'string' || board.project_id !== projectId) return [];
    return [{ slug: board.slug, name: text(board.name) ?? board.slug }];
  });
}

/** A task of the project and the board it is on. */
export interface LinkedTask extends BoardTask {
  board: string;
}

/** The tasks of one board's answer that name the project (`project_id`), as the board's cards. A body that is not a board has none. */
export function projectTasks(boardBody: unknown, projectId: string, board: string): LinkedTask[] {
  try {
    return parseBoard(boardBody).tasks.filter((task) => task.projectId === projectId).map((task) => ({ ...task, board }));
  } catch {
    return [];
  }
}
