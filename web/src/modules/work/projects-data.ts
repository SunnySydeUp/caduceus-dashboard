// Reading Hermes for Work › Projects, and the workspace registry from Caduceus. Only GETs live here (and the actions are built from the page's own
// `fetchTiered` and gateway); nothing is kept beyond what a page shows (D1): Hermes is asked again each time a page opens, and when the owner changes something.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Workspace } from '@caduceus/contracts/caduceus-api';
import { gatewayConnection } from '../../gateway.ts';
import { isReadOnly } from '../../policy-state.ts';
import { confirmTier } from '../../shell/tier-confirmation.ts';
import { fetchTiered } from '../../tiered.ts';
import { createProjectActions, type ProfileProjects, type ProjectActions } from './projects-actions.ts';
import { boardSlugs, linkedBoards, parseDocText, parseGitSummary, parseProjectTree, parseRecentCommits, projectTasks, repoDocs, type DocText, type GitSummary, type LinkedBoard, type LinkedTask, type ProjectTree, type RepoDoc } from './projects-model.ts';
import { createWorkspaceRegistryClient, type WorkspaceRegistryClient } from './workspace-registry.ts';
import { isUninitialisedStore } from '../../uninitialised-store.ts';

const KANBAN = '/api/plugins/kanban';

/**
 * Reads a route as JSON (Hermes's or Caduceus's); throws with the HTTP status when it does not answer well. A profile that has never held a chat has no session
 * store, and Hermes 0.22 refuses every read of it; that profile has nothing in it, so it reads as an empty answer (`uninitialised-store.ts`).
 */
export async function readJson(route: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(route, { signal });
  if (await isUninitialisedStore(response)) return {};
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

/** What a read of Hermes is now. `reload` asks again; the value stays until the new answer is in, so a page never blinks empty. */
export interface Reading<T> {
  value: T | undefined;
  error: string | undefined;
  reload(): void;
}

/** Runs `load` when the page opens, when `key` changes and when `reload` is called; an answer for an earlier key is ignored. */
function useReading<T>(load: (signal: AbortSignal) => Promise<T>, key: string): Reading<T> {
  const [state, setState] = useState<{ key: string; value?: T; error?: string }>({ key });
  const [round, setRound] = useState(0);
  const latest = useRef(load);
  latest.current = load;
  useEffect(() => {
    const controller = new AbortController();
    latest.current(controller.signal).then(
      (value) => !controller.signal.aborted && setState({ key, value }),
      (error: unknown) => !controller.signal.aborted && setState((previous) => ({ key, value: previous.key === key ? previous.value : undefined, error: error instanceof Error ? error.message : 'Hermes did not answer.' })),
    );
    return () => controller.abort();
  }, [key, round]);
  const reload = useCallback(() => setRound((previous) => previous + 1), []);
  return { value: state.key === key ? state.value : undefined, error: state.key === key ? state.error : undefined, reload };
}

/** Hermes's projects tree across profiles (`GET /api/profiles/projects/tree`). */
export function useProjectTree(): Reading<ProjectTree> {
  return useReading(async (signal) => parseProjectTree(await readJson('/api/profiles/projects/tree', signal)), 'tree');
}

/** The actions of Work › Projects, with the page's own dialog, gateway and read-only state. */
export function useProjectActions(): ProjectActions {
  return useMemo(() => createProjectActions({ connection: gatewayConnection(), confirm: confirmTier, readOnly: isReadOnly }), []);
}

/** The projects the profile itself owns and its active one (`projects.list`): what a rename or Make active may be offered for. */
export function useProfileProjects(profile: string | undefined): Reading<ProfileProjects> {
  const actions = useProjectActions();
  return useReading(async () => (profile === undefined ? { projects: [], activeId: undefined, folders: new Map() } : actions.list(profile)), `owned:${profile ?? ''}`);
}

/** A repository's overview: each part is read on its own, so one that fails does not hide the others. */
export interface Overview {
  /** `null` once Hermes has said the folder is in no repository. */
  git: Reading<GitSummary | null>;
  commits: Reading<string[]>;
  docs: Reading<RepoDoc[]>;
}

const folderRoute = (route: string, folder: string) => `${route}?path=${encodeURIComponent(folder)}`;

export function useOverview(folder: string | undefined): Overview {
  const key = folder ?? '';
  const git = useReading(async (signal) => (folder === undefined ? null : (parseGitSummary(await readJson(folderRoute('/api/git/status', folder), signal)) ?? null)), `git:${key}`);
  const commits = useReading(async (signal) => (folder === undefined ? [] : parseRecentCommits(await readJson(folderRoute('/api/git/review/commit-context', folder), signal))), `commits:${key}`);
  const docs = useReading(async (signal) => {
    if (folder === undefined) return [];
    const [root, inDocs] = await Promise.all([readJson(folderRoute('/api/fs/list', folder), signal), readJson(folderRoute('/api/fs/list', `${folder.replace(/\/+$/, '')}/docs`), signal).catch(() => undefined)]);
    return repoDocs(root, inDocs);
  }, `docs:${key}`);
  return { git, commits, docs };
}

/** One document's text for the preview, read when a document is chosen. */
export function useDocText(path: string | undefined): Reading<DocText> {
  return useReading(async (signal) => (path === undefined ? ({ kind: 'unreadable' } as DocText) : parseDocText(await readJson(folderRoute('/api/fs/read-text', path), signal))), `doc:${path ?? ''}`);
}

export interface Linked {
  boards: LinkedBoard[];
  tasks: LinkedTask[];
}

/**
 * The boards Hermes links to a declared project and the tasks that name it. Every board is read (a task can name a project on a board the project is
 * not linked to); a board that cannot be read is left out rather than failing the page.
 */
export function useLinked(projectId: string | undefined): Reading<Linked> {
  return useReading(async (signal) => {
    if (projectId === undefined) return { boards: [], tasks: [] };
    const boardList = await readJson(`${KANBAN}/boards`, signal);
    const slugs = boardSlugs(boardList);
    const answers = await Promise.all(slugs.map((slug) => readJson(`${KANBAN}/board?board=${encodeURIComponent(slug)}`, signal).then((body) => projectTasks(body, projectId, slug), () => [])));
    return { boards: linkedBoards(boardList, projectId), tasks: answers.flat() };
  }, `linked:${projectId ?? ''}`);
}

/** The workspace registry as Caduceus keeps it, and the client that changes it. */
export function useWorkspaceRegistry(): Reading<Workspace[]> & { client: WorkspaceRegistryClient } {
  const client = useMemo(() => createWorkspaceRegistryClient({ send: fetchTiered, read: (route) => readJson(route) }), []);
  const reading = useReading(() => client.list(), 'workspaces');
  return { ...reading, client };
}
