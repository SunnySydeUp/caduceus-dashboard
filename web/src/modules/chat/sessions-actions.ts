// What the owner can do to Hermes's sessions from the list (M1 #14): pin, archive, mark unread and rename (Tier 0, each with an undo that puts
// Hermes back as it was), move to a project, delete one, many or the empty ones, and prune old ones. No DOM and no React, so it runs under
// test. Everything it changes is Hermes's, through Hermes's own session update and delete endpoints with an explicit profile; Caduceus
// keeps no copy of any of it (D1), and an undo is made of what the row said when the owner acted, not of anything stored here.
import type { LlmOneshotResult } from '@caduceus/contracts/hermes/gateway';
import type { ConfirmRequest } from '../../palette.ts';
import { READ_ONLY_MESSAGE, type TieredRequest, type TieredResult } from '../../tiered-fetch.ts';
import type { ChatConnection } from './chat-session.ts';
import { entriesOf } from './activity.ts';
import type { HistoryBody } from './history-window.ts';
import { cleanTitle, MAX_TITLE_ATTEMPTS, TITLE_INSTRUCTIONS, titleInput } from './session-title.ts';
import type { SessionItem } from './sessions-model.ts';
import { parseProjects, type Project, type ProjectTone } from './sessions-projects.ts';

/** How one action ended. `done` says what happened, for a toast, and a Tier 0 change carries the way back. */
export type Outcome =
  | { kind: 'done'; message: string; undo?: () => Promise<Outcome> }
  /** The owner declined the confirmation: nothing was sent, and nothing needs saying. */
  | { kind: 'cancelled' }
  | { kind: 'failed'; message: string };

export interface SessionActionsDeps {
  /** Calls a Hermes REST route through the policy (`fetchTiered`). */
  send(request: TieredRequest): Promise<TieredResult>;
  connection: ChatConnection;
  /** Asks the owner to confirm a Tier 1 action that goes over the gateway rather than REST. */
  confirm(request: ConfirmRequest): Promise<boolean>;
  /** Read-only mode is on: nothing is asked and nothing is sent over the gateway (the REST calls check it themselves). */
  readOnly(): boolean;
  /** The tab's profile: the owner of every session that does not say otherwise. */
  profile: string;
}

/** A project that was just made, or why it was not. */
export type CreateOutcome = { kind: 'created'; project: Project } | Extract<Outcome, { kind: 'cancelled' | 'failed' }>;

export interface SessionActions {
  setPinned(item: SessionItem, pinned: boolean): Promise<Outcome>;
  setArchived(item: SessionItem, archived: boolean): Promise<Outcome>;
  setUnread(item: SessionItem, unread: boolean): Promise<Outcome>;
  rename(item: SessionItem, title: string): Promise<Outcome>;
  /**
   * Asks Hermes's title model (`llm.oneshot`, the `title_generation` slot; Tier 1, so the owner confirms) for a new name from the session's first message and has Hermes keep it, with a number added when another
   * session already has that title. What the outcome says is read back from Hermes, and its undo puts the old title back.
   */
  regenerateTitle(item: SessionItem): Promise<Outcome>;
  pinMany(items: readonly SessionItem[], pinned: boolean): Promise<Outcome>;
  archiveMany(items: readonly SessionItem[], archived: boolean): Promise<Outcome>;
  /** Deletes one session (Tier 1: the dialog names it and its profile). Hermes cannot bring it back. */
  remove(item: SessionItem): Promise<Outcome>;
  /** Deletes the sessions in one call (Tier 3: step-up and a typed confirmation). They must be one profile's, and no more than Hermes takes at once. */
  removeMany(items: readonly SessionItem[]): Promise<Outcome>;
  /** How many empty sessions (ended, no messages, not archived) the profile has, by Hermes's count. Throws when Hermes does not answer. */
  countEmpty(profile: string): Promise<number>;
  /** Deletes the profile's empty sessions (Tier 1: the dialog lists how many). */
  removeEmpty(profile: string): Promise<Outcome>;
  /** Asks Hermes how many sessions a prune would delete, without deleting any. */
  previewPrune(profile: string, filter: PruneFilter): Promise<PrunePreview>;
  /** Prunes (Tier 3): the count is read first, and nothing is asked when nothing matches. */
  prune(profile: string, filter: PruneFilter): Promise<Outcome>;
  /** The profile's projects, archived ones included. Throws when Hermes does not answer. */
  listProjects(profile: string): Promise<Project[]>;
  /** Makes a project of a name and a folder (Tier 1). */
  createProject(profile: string, project: { name: string; folder: string; tone: ProjectTone | undefined }): Promise<CreateOutcome>;
  renameProject(profile: string, project: Project, name: string): Promise<Outcome>;
  /** Gives the project a colour, or none (Tier 1). */
  recolourProject(profile: string, project: Project, tone: ProjectTone | undefined): Promise<Outcome>;
  /** Moves the sessions into the project: Hermes re-homes each one's workspace to the project's folder (Tier 1, asked once). */
  moveToProject(items: readonly SessionItem[], project: Project): Promise<Outcome>;
  /** Takes the sessions out of their project, to Hermes's default folder (Tier 1, asked once). */
  moveOut(items: readonly SessionItem[]): Promise<Outcome>;
}

/** Which sessions a prune matches: ended ones that were last active this long ago (Hermes needs at least a day), from one source or any. */
export interface PruneFilter {
  olderThanDays: number;
  source?: string;
}

/** How many sessions a prune would delete, from Hermes's dry run. */
export type PrunePreview = { kind: 'previewed'; matched: number } | Extract<Outcome, { kind: 'failed' }>;

/** The most sessions Hermes's bulk delete takes in one call. */
export const BULK_DELETE_MAX = 500;

/** How many updates are in flight at once when the owner changes many sessions. */
const CONCURRENCY = 6;

/** The name a session goes by in a sentence. */
export const nameOf = (item: SessionItem): string => item.title || item.preview || 'Untitled chat';

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

const describe = (items: readonly SessionItem[]): string => (items.length === 1 ? `“${nameOf(items[0]!)}”` : `${items.length} sessions`);

/** Hermes refuses a session write with a short reason (`web_server_sessions.py`); this is what each says to the owner. */
const WRITE_REFUSALS: Readonly<Record<string, string>> = {
  session_busy: 'Hermes is working on this chat right now. Try again when it has finished.',
  runtime_draining: 'Hermes is shutting down this chat’s runtime. Try again in a moment.',
  owner_unreachable: 'Hermes could not reach the process that runs your chats. Try again in a moment.',
  storage_unavailable: 'Hermes could not reach its session store. Try again in a moment.',
  revision_conflict: 'The chat changed while this was being sent. Try again.',
  stale_generation: 'The chat changed while this was being sent. Try again.',
  not_found: 'Hermes no longer has this chat.',
  permission_denied: 'Hermes did not allow this change.',
  profile_mismatch: 'Hermes does not serve this chat’s profile.',
};

/** What was wrong, in the words of whoever refused: the policy's `message` (read-only mode, a missing profile), Hermes's string `detail`, or the first message of a validation error. */
export async function failureOf(response: Response): Promise<string> {
  const body: unknown = await response.json().catch(() => undefined);
  if (typeof body === 'object' && body !== null && 'error' in body && 'message' in body && typeof body.message === 'string') return body.message;
  const detail = typeof body === 'object' && body !== null && 'detail' in body ? body.detail : undefined;
  if (typeof detail === 'string' && detail !== '') return WRITE_REFUSALS[detail] ?? detail;
  if (Array.isArray(detail) && typeof detail[0]?.msg === 'string') return detail[0].msg;
  return `Hermes answered ${response.status}.`;
}

/** Runs `run` over `items`, a few at a time, and stops starting new ones after the first that throws. */
async function eachLimited<T>(items: readonly T[], run: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) await run(next);
    }),
  );
}

export function createSessionActions({ send, connection, confirm, readOnly, profile }: SessionActionsDeps): SessionActions {
  /** One REST call. `undefined` is the answer for a call that was sent and worked; a string is why it did not. */
  async function call(request: TieredRequest): Promise<{ kind: 'sent'; response: Response } | Extract<Outcome, { kind: 'cancelled' | 'failed' }>> {
    const result = await send(request);
    if (result.kind === 'cancelled') return result;
    if (result.kind === 'refused') return { kind: 'failed', message: result.refusal.message };
    if (!result.response.ok) return { kind: 'failed', message: await failureOf(result.response) };
    return result;
  }

  /** A change to the sessions' own fields, each session's previous value kept for the way back. */
  async function update(items: readonly SessionItem[], change: (item: SessionItem) => Record<string, unknown>, restore: (item: SessionItem) => Record<string, unknown>, said: string): Promise<Outcome> {
    let failure: Extract<Outcome, { kind: 'failed' }> | undefined;
    const changed: SessionItem[] = [];
    const patch = async (item: SessionItem, body: Record<string, unknown>) => {
      const answer = await call({ method: 'PATCH', path: `/api/sessions/${encodeURIComponent(item.id)}`, body: { ...body, profile: item.profile ?? profile } });
      if (answer.kind === 'sent') return true;
      failure ??= answer.kind === 'failed' ? answer : undefined;
      return false;
    };
    await eachLimited(items, async (item) => {
      if (failure) return;
      if (await patch(item, change(item))) changed.push(item);
    });
    if (failure) return changed.length === 0 ? failure : { kind: 'failed', message: `Hermes changed ${changed.length} of ${items.length} sessions, then stopped: ${failure.message}` };
    return {
      kind: 'done',
      message: said,
      undo: async () => {
        let failed: string | undefined;
        await eachLimited(changed, async (item) => {
          if (failed === undefined && !(await patch(item, restore(item)))) failed = 'Hermes did not take the change back.';
        });
        return failed === undefined ? { kind: 'done', message: `Put ${describe(changed)} back` } : { kind: 'failed', message: failed };
      },
    };
  }

  const flag = (field: 'pinned' | 'archived' | 'unread', value: boolean, words: { on: string; off: string }) => (items: readonly SessionItem[]) =>
    update(items, () => ({ [field]: value }), (item) => ({ [field]: item[field] }), `${value ? words.on : words.off} ${describe(items)}`);

  async function remove(item: SessionItem): Promise<Outcome> {
    const owner = item.profile ?? profile;
    const answer = await call({
      method: 'DELETE',
      path: `/api/sessions/${encodeURIComponent(item.id)}?profile=${encodeURIComponent(owner)}`,
      confirm: { title: `Delete “${nameOf(item)}”?`, text: `Hermes deletes this session and its messages from the profile ${owner}. This cannot be undone.`, object: nameOf(item), profile: owner, confirmLabel: 'Delete' },
    });
    return answer.kind === 'sent' ? { kind: 'done', message: `Deleted “${nameOf(item)}”` } : answer;
  }

  async function removeMany(items: readonly SessionItem[]): Promise<Outcome> {
    if (items.length > BULK_DELETE_MAX) return { kind: 'failed', message: `Hermes deletes at most ${BULK_DELETE_MAX} sessions at once: select fewer.` };
    const owners = [...new Set(items.map((item) => item.profile ?? profile))];
    if (owners.length > 1) return { kind: 'failed', message: `Delete sessions of one profile at a time: this selection has sessions of ${owners.slice(0, -1).join(', ')} and ${owners.at(-1)}.` };
    const owner = owners[0] ?? profile;
    const count = `${items.length} session${items.length === 1 ? '' : 's'}`;
    const answer = await call({
      method: 'POST',
      path: '/api/sessions/bulk-delete',
      body: { ids: items.map((item) => item.id), profile: owner },
      confirm: {
        title: `Delete ${count}?`,
        text: `Hermes deletes these sessions and their messages from the profile ${owner}.`,
        object: count,
        profile: owner,
        confirmLabel: `Delete ${count}`,
        recoverability: { undoable: false, note: 'Hermes does not keep a copy.' },
      },
    });
    return answer.kind === 'sent' ? { kind: 'done', message: `Deleted ${count}` } : answer;
  }

  async function countEmpty(owner: string): Promise<number> {
    const answer = await call({ method: 'GET', path: `/api/sessions/empty/count?profile=${encodeURIComponent(owner)}` });
    if (answer.kind !== 'sent') throw new Error(answer.kind === 'failed' ? answer.message : 'The count was not asked for.');
    const { count } = (await answer.response.json()) as { count?: unknown };
    return typeof count === 'number' ? count : 0;
  }

  async function removeEmpty(owner: string): Promise<Outcome> {
    const count = await countEmpty(owner).catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
    if (count instanceof Error) return { kind: 'failed', message: count.message };
    if (count === 0) return { kind: 'done', message: 'There are no empty sessions to delete.' };
    const named = plural(count, 'empty session');
    const answer = await call({
      method: 'DELETE',
      path: `/api/sessions/empty?profile=${encodeURIComponent(owner)}`,
      confirm: { title: `Delete ${named}?`, text: `Hermes deletes the ${named} of the profile ${owner}: ended chats with no messages. This cannot be undone.`, object: named, profile: owner, confirmLabel: 'Delete' },
    });
    if (answer.kind !== 'sent') return answer;
    const { deleted } = (await answer.response.json().catch(() => ({}))) as { deleted?: unknown };
    return { kind: 'done', message: `Deleted ${plural(typeof deleted === 'number' ? deleted : count, 'empty session')}` };
  }

  const pruneBody = (owner: string, { olderThanDays, source }: PruneFilter) => ({ older_than_days: olderThanDays, ...(source === undefined ? {} : { source }), profile: owner });

  async function previewPrune(owner: string, filter: PruneFilter): Promise<PrunePreview> {
    const answer = await call({ method: 'POST', path: '/api/sessions/prune', body: { ...pruneBody(owner, filter), dry_run: true } });
    if (answer.kind === 'failed') return answer;
    if (answer.kind === 'cancelled') return { kind: 'failed', message: 'The count was not asked for.' };
    const { matched } = (await answer.response.json()) as { matched?: unknown };
    return { kind: 'previewed', matched: typeof matched === 'number' ? matched : 0 };
  }

  async function prune(owner: string, filter: PruneFilter): Promise<Outcome> {
    const preview = await previewPrune(owner, filter);
    if (preview.kind === 'failed') return preview;
    const age = `older than ${plural(filter.olderThanDays, 'day')}`;
    if (preview.matched === 0) return { kind: 'done', message: `No sessions are ${age}.` };
    const named = plural(preview.matched, 'session');
    const answer = await call({
      method: 'POST',
      path: '/api/sessions/prune',
      body: pruneBody(owner, filter),
      confirm: {
        title: `Prune ${named} ${age}?`,
        text: `Hermes deletes the ended sessions of the profile ${owner} that were last active more than ${plural(filter.olderThanDays, 'day')} ago${filter.source === undefined ? '' : `, from ${filter.source}`}.`,
        object: named,
        profile: owner,
        confirmLabel: `Prune ${named}`,
        recoverability: { undoable: false, note: 'Hermes does not keep a copy.' },
      },
    });
    if (answer.kind !== 'sent') return answer;
    const { removed } = (await answer.response.json().catch(() => ({}))) as { removed?: unknown };
    return { kind: 'done', message: `Pruned ${plural(typeof removed === 'number' ? removed : preview.matched, 'session')} ${age}` };
  }

  /** One gateway call, after the owner has confirmed it when it needs that. Hermes's error is its message. */
  async function gateway<T>(method: string, params: Record<string, unknown>, ask?: ConfirmRequest): Promise<{ kind: 'ok'; result: T } | Extract<Outcome, { kind: 'cancelled' | 'failed' }>> {
    if (readOnly()) return { kind: 'failed', message: READ_ONLY_MESSAGE };
    if (ask && !(await confirm(ask))) return { kind: 'cancelled' };
    try {
      return { kind: 'ok', result: await connection.client.request<T>(method, params) };
    } catch (error) {
      return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
    }
  }

  const asks = (action: string, ask: Pick<ConfirmRequest, 'label' | 'text' | 'object' | 'confirmLabel'>, owner: string): ConfirmRequest => ({ tier: 'T1', moduleId: 'chat', action, profile: owner, ...ask });

  async function listProjects(owner: string): Promise<Project[]> {
    return parseProjects(await connection.client.request('projects.list', { profile: owner }));
  }

  async function createProject(owner: string, { name, folder, tone }: { name: string; folder: string; tone: ProjectTone | undefined }): Promise<CreateOutcome> {
    const title = name.trim();
    if (title === '') return { kind: 'failed', message: 'A project needs a name.' };
    if (folder.trim() === '') return { kind: 'failed', message: 'A project needs a folder: it is the folder its sessions work in.' };
    const answer = await gateway<{ project?: unknown }>(
      'projects.create',
      { profile: owner, name: title, folders: [folder.trim()], primary_path: folder.trim(), ...(tone === undefined ? {} : { color: tone }) },
      asks('projects.create', { label: `Create the project “${title}”?`, text: `Hermes keeps the project, with the folder ${folder.trim()}, in the profile ${owner}.`, object: title, confirmLabel: 'Create project' }, owner),
    );
    if (answer.kind !== 'ok') return answer;
    const [project] = parseProjects({ projects: [answer.result.project] });
    return project === undefined ? { kind: 'failed', message: 'Hermes did not say which project it made.' } : { kind: 'created', project };
  }

  async function updateProject(owner: string, project: Project, change: Record<string, unknown>, ask: Pick<ConfirmRequest, 'label' | 'text' | 'object' | 'confirmLabel'>, said: string): Promise<Outcome> {
    const answer = await gateway('projects.update', { profile: owner, id: project.id, ...change }, asks('projects.update', ask, owner));
    return answer.kind === 'ok' ? { kind: 'done', message: said } : answer;
  }

  async function moveToFolder(items: readonly SessionItem[], cwd: string, ask: ConfirmRequest, said: string): Promise<Outcome> {
    if (readOnly()) return { kind: 'failed', message: READ_ONLY_MESSAGE };
    if (!(await confirm(ask))) return { kind: 'cancelled' };
    let failure: string | undefined;
    await eachLimited(items, async (item) => {
      if (failure !== undefined) return;
      const answer = await gateway('session.workspace.move', { profile: item.profile ?? profile, session_key: item.id, cwd });
      if (answer.kind === 'failed') failure = answer.message;
    });
    return failure === undefined ? { kind: 'done', message: said } : { kind: 'failed', message: failure };
  }

  async function moveToProject(items: readonly SessionItem[], project: Project): Promise<Outcome> {
    if (project.folder === undefined) return { kind: 'failed', message: `“${project.name}” has no folder yet, so there is nowhere to move a session to. Give it a folder in Hermes first.` };
    const owner = items[0]?.profile ?? profile;
    const ask = asks('session.workspace.move', { label: `Move ${describe(items)} to “${project.name}”?`, text: `Hermes works in ${project.folder} from the next message on.`, object: project.name, confirmLabel: 'Move' }, owner);
    return moveToFolder(items, project.folder, ask, `Moved ${describe(items)} to ${project.name}`);
  }

  async function moveOut(items: readonly SessionItem[]): Promise<Outcome> {
    const owner = items[0]?.profile ?? profile;
    let cwd: string | undefined;
    try {
      cwd = (await connection.client.request<{ cwd?: string | null }>('config.get', { key: 'project', profile: owner })).cwd ?? undefined;
      const owned = cwd === undefined ? undefined : (await connection.client.request<{ project?: { name?: string } | null }>('projects.for_cwd', { profile: owner, cwd })).project;
      if (cwd === undefined) return { kind: 'failed', message: 'Hermes has no default folder to move the session to.' };
      if (owned) return { kind: 'failed', message: `Hermes’s default folder ${cwd} belongs to the project “${owned.name ?? 'unnamed'}”, so moving there would not take the session out of a project.` };
    } catch (error) {
      return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
    }
    const ask = asks('session.workspace.move', { label: `Take ${describe(items)} out of its project?`, text: `Hermes works in its default folder, ${cwd}, from the next message on.`, object: cwd, confirmLabel: 'Take out' }, owner);
    return moveToFolder(items, cwd, ask, `Took ${describe(items)} out of its project`);
  }

  const rename = (item: SessionItem, title: string) => update([item], () => ({ title }), (previous) => ({ title: previous.title }), `Renamed to “${title.trim() || 'Untitled chat'}”`);

  async function regenerateTitle(item: SessionItem): Promise<Outcome> {
    const owner = item.profile ?? profile;
    const opening = await call({ method: 'GET', path: `/api/sessions/${encodeURIComponent(item.id)}/messages?${new URLSearchParams({ profile: owner, order: 'oldest', limit: '20' })}` });
    if (opening.kind !== 'sent') return opening;
    const first = entriesOf(((await opening.response.json()) as HistoryBody).messages).find((entry) => entry.kind === 'bubble' && entry.role === 'user' && !entry.continued);
    if (first?.kind !== 'bubble') return { kind: 'failed', message: 'This chat has no message of yours yet, so there is nothing to name it from.' };
    const asked = await gateway<LlmOneshotResult>(
      'llm.oneshot',
      { profile: owner, task: 'title_generation', instructions: TITLE_INSTRUCTIONS, input: titleInput(first.text), max_tokens: 64 },
      asks('chat.regenerate-title', { label: `Regenerate the title of “${nameOf(item)}”?`, text: 'Hermes asks its title model (the Title generation model) for a new name, from the first message of the chat, and replaces the title.', object: nameOf(item), confirmLabel: 'Regenerate title' }, owner),
    );
    if (asked.kind !== 'ok') return asked;
    const title = cleanTitle(asked.result.text);
    if (title === undefined) return { kind: 'failed', message: 'Hermes’s title model did not answer with a title. Try again, or rename the chat yourself.' };
    // Hermes keeps one title per session: one that another session has is refused, and the next number is tried, as Hermes does for the titles it makes.
    let renamed: Outcome = { kind: 'failed', message: 'Hermes did not take the title.' };
    for (let attempt = 1; attempt <= MAX_TITLE_ATTEMPTS; attempt++) {
      renamed = await rename(item, attempt === 1 ? title : `${title} #${attempt}`);
      if (renamed.kind !== 'failed' || !/already|in use|taken|unique|exists/i.test(renamed.message)) break;
    }
    if (renamed.kind !== 'done') return renamed;
    const stored = await call({ method: 'GET', path: `/api/sessions/${encodeURIComponent(item.id)}?profile=${encodeURIComponent(owner)}` });
    const said = stored.kind === 'sent' ? ((await stored.response.json().catch(() => ({}))) as { title?: unknown }).title : undefined;
    return { ...renamed, message: `Title is now “${typeof said === 'string' && said !== '' ? said : title}”` };
  }

  return {
    listProjects,
    createProject,
    renameProject: (owner, project, name) =>
      updateProject(owner, project, { name: name.trim() }, { label: `Rename “${project.name}”?`, text: `The project becomes “${name.trim()}” in Hermes.`, object: project.name, confirmLabel: 'Rename' }, `Renamed the project to “${name.trim()}”`),
    recolourProject: (owner, project, tone) =>
      updateProject(owner, project, { color: tone ?? '' }, { label: `Change the colour of “${project.name}”?`, text: tone === undefined ? 'The project goes back to no colour in Hermes.' : `The project becomes ${tone} in Hermes.`, object: project.name, confirmLabel: 'Change colour' }, `Recoloured “${project.name}”`),
    moveToProject,
    moveOut,
    remove,
    removeMany,
    countEmpty,
    removeEmpty,
    previewPrune,
    prune,
    pinMany: (items, pinned) => flag('pinned', pinned, { on: 'Pinned', off: 'Unpinned' })(items),
    archiveMany: (items, archived) => flag('archived', archived, { on: 'Archived', off: 'Restored' })(items),
    setPinned: (item, pinned) => flag('pinned', pinned, { on: 'Pinned', off: 'Unpinned' })([item]),
    setArchived: (item, archived) => flag('archived', archived, { on: 'Archived', off: 'Restored' })([item]),
    setUnread: (item, unread) => flag('unread', unread, { on: 'Marked unread:', off: 'Marked read:' })([item]),
    rename,
    regenerateTitle,
  };
}
