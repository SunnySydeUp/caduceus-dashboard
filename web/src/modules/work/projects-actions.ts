// What the owner can do to Hermes's projects from Work › Projects: make one of a folder, rename it, make it the active one, and turn the
// repositories Hermes found into projects. Each is a Tier 1 gateway call (`projects.create`, `projects.update`, `projects.set_active`) that the
// owner confirms first, with an explicit profile. No DOM and no React, so it runs under test. Caduceus keeps nothing of a project (D1): the answer is
// what Hermes says now, and the page reads the tree again.
import type { ConfirmRequest } from '../../palette.ts';
import { READ_ONLY_MESSAGE } from '../../tiered-fetch.ts';
import type { ChatConnection } from '../chat/chat-session.ts';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { parseCandidates, projectFolders, type RepoCandidate } from './projects-model.ts';

export interface ProjectActionsDeps {
  connection: Pick<ChatConnection, 'client'>;
  /** Asks the owner to confirm a Tier 1 action that goes over the gateway; `false` when they decline. */
  confirm(request: ConfirmRequest): Promise<boolean>;
  /** Read-only mode is on: nothing is asked and nothing is sent. */
  readOnly(): boolean;
}

export type ActionResult<T = undefined> = ({ kind: 'done' } & (T extends undefined ? unknown : T)) | { kind: 'cancelled' } | { kind: 'failed'; message: string };

/** A project of the profile, as `projects.list` has it: the owner's own, with what the page needs to offer a change. */
export interface ProfileProject {
  id: string;
  name: string;
  folders: string[];
}

export interface ProfileProjects {
  projects: ProfileProject[];
  /** The project Hermes has as active in the profile. */
  activeId: string | undefined;
  /** Folder → project name, for a candidate that is already a project. */
  folders: Map<string, string>;
}

export interface ProjectActions {
  /** The profile's own (not archived) projects and its active one. Throws when Hermes does not answer. */
  list(profile: string): Promise<ProfileProjects>;
  create(profile: string, project: { name: string; folder: string }): Promise<{ kind: 'created'; id: string } | Extract<ActionResult, { kind: 'cancelled' | 'failed' }>>;
  rename(profile: string, project: { id: string; name: string }, name: string): Promise<ActionResult>;
  /** Makes the project the profile's active one, or (with `undefined`) none. */
  activate(profile: string, project: { id: string; name: string } | undefined): Promise<ActionResult>;
  /** The repositories Hermes found for the profile: those its sessions worked in and those in the folders it scans. Throws when Hermes does not answer. */
  discover(profile: string): Promise<RepoCandidate[]>;
  /** Makes a project of each repository, after one confirmation. A repository that Hermes refuses is named in `failed`; the others are still made. */
  addRepos(profile: string, repos: readonly RepoCandidate[]): Promise<{ kind: 'added'; made: number; failed: string[] } | Extract<ActionResult, { kind: 'cancelled' | 'failed' }>>;
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function createProjectActions({ connection, confirm, readOnly }: ProjectActionsDeps): ProjectActions {
  const { client } = connection;

  const asks = (action: string, profile: string, ask: Pick<ConfirmRequest, 'label' | 'text' | 'object' | 'confirmLabel'>): ConfirmRequest => ({ tier: 'T1', moduleId: 'projects', action, profile, ...ask });

  /** One gateway call after the owner has confirmed it. Hermes's error is its message. */
  async function gateway<T>(method: string, params: Record<string, unknown>, ask: ConfirmRequest): Promise<{ kind: 'ok'; result: T } | { kind: 'cancelled' } | { kind: 'failed'; message: string }> {
    if (readOnly()) return { kind: 'failed', message: READ_ONLY_MESSAGE };
    if (!(await confirm(ask))) return { kind: 'cancelled' };
    try {
      return { kind: 'ok', result: await client.request<T>(method, params) };
    } catch (error) {
      return { kind: 'failed', message: messageOf(error) };
    }
  }

  const folderOf = (folder: string) => folder.trim();

  async function list(profile: string): Promise<ProfileProjects> {
    const answer = await client.request<unknown>('projects.list', { profile });
    const rows = isRecord(answer) && Array.isArray(answer.projects) ? answer.projects : [];
    const projects = rows.flatMap((row): ProfileProject[] => {
      if (!isRecord(row) || typeof row.id !== 'string' || row.archived === true) return [];
      const folders = (Array.isArray(row.folders) ? row.folders : []).flatMap((folder) => (isRecord(folder) && typeof folder.path === 'string' ? [folder.path] : []));
      return [{ id: row.id, name: typeof row.name === 'string' && row.name !== '' ? row.name : row.id, folders }];
    });
    return { projects, activeId: isRecord(answer) && typeof answer.active_id === 'string' ? answer.active_id : undefined, folders: projectFolders(answer) };
  }

  async function create(profile: string, { name, folder }: { name: string; folder: string }) {
    const title = name.trim();
    if (title === '') return { kind: 'failed' as const, message: 'A project needs a name.' };
    if (folderOf(folder) === '') return { kind: 'failed' as const, message: 'A project needs a folder: it is the folder its sessions work in.' };
    const answer = await gateway<{ project?: { id?: unknown } | null }>(
      'projects.create',
      { profile, name: title, folders: [folderOf(folder)], primary_path: folderOf(folder) },
      asks('projects.create', profile, { label: `Create the project “${title}”?`, text: `Hermes keeps the project, with the folder ${folderOf(folder)}, in the profile ${profile}.`, object: title, confirmLabel: 'Create project' }),
    );
    if (answer.kind !== 'ok') return answer;
    const id = answer.result.project?.id;
    return typeof id === 'string' ? { kind: 'created' as const, id } : { kind: 'failed' as const, message: 'Hermes did not say which project it made.' };
  }

  async function rename(profile: string, project: { id: string; name: string }, name: string): Promise<ActionResult> {
    const title = name.trim();
    if (title === '') return { kind: 'failed', message: 'A project needs a name.' };
    const answer = await gateway('projects.update', { profile, id: project.id, name: title }, asks('projects.update', profile, { label: `Rename “${project.name}”?`, text: `The project becomes “${title}” in Hermes.`, object: project.name, confirmLabel: 'Rename' }));
    return answer.kind === 'ok' ? { kind: 'done' } : answer;
  }

  async function activate(profile: string, project: { id: string; name: string } | undefined): Promise<ActionResult> {
    const ask = project
      ? asks('projects.set_active', profile, { label: `Make “${project.name}” the active project?`, text: `Hermes uses it as the profile ${profile}’s active project: new sessions there start in its folder.`, object: project.name, confirmLabel: 'Make active' })
      : asks('projects.set_active', profile, { label: 'Stop using an active project?', text: `The profile ${profile} goes back to having no active project.`, object: profile, confirmLabel: 'Clear active project' });
    const answer = await gateway('projects.set_active', { profile, ...(project ? { id: project.id } : {}) }, ask);
    return answer.kind === 'ok' ? { kind: 'done' } : answer;
  }

  async function discover(profile: string): Promise<RepoCandidate[]> {
    // `scan` has the Mac that runs Hermes look in the folders its `desktop.repo_scan_roots` setting names, as well as in the folders sessions worked in.
    return parseCandidates(await client.request('projects.discover_repos', { profile, scan: true }));
  }

  async function addRepos(profile: string, repos: readonly RepoCandidate[]) {
    if (repos.length === 0) return { kind: 'failed' as const, message: 'Choose at least one repository.' };
    if (readOnly()) return { kind: 'failed' as const, message: READ_ONLY_MESSAGE };
    const named = repos.length === 1 ? `“${repos[0]!.label}”` : `${repos.length} repositories`;
    const ask = asks('projects.create', profile, { label: `Add ${named} as ${repos.length === 1 ? 'a project' : 'projects'}?`, text: `Hermes keeps a project for each, named after its folder, in the profile ${profile}. The folders are not changed.`, object: repos.length === 1 ? repos[0]!.label : `${repos.length} repositories`, confirmLabel: repos.length === 1 ? 'Add project' : 'Add projects' });
    if (!(await confirm(ask))) return { kind: 'cancelled' as const };
    let made = 0;
    const failed: string[] = [];
    for (const repo of repos) {
      try {
        await client.request('projects.create', { profile, name: repo.label, folders: [repo.path], primary_path: repo.path });
        made += 1;
      } catch (error) {
        failed.push(`${repo.label}: ${messageOf(error)}`);
      }
    }
    return { kind: 'added' as const, made, failed };
  }

  return { list, create, rename, activate, discover, addRepos };
}
