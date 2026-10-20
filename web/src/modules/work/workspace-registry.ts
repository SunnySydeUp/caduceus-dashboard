// The workspace registry as the page uses it (M3 #10): Caduceus's own list of named directories, read and changed through the Caduceus server
// (`/_caduceus/api/work/workspaces`). Free of the DOM and of React. The list is the owner's order; the composer's workspace chip and the Brief
// editor's workspace field both offer it through `workspaceChoices`. Adding and removing an entry are Tier 1 (the dialog says what happens),
// renaming and reordering Tier 0. Removing an entry forgets its name: the folder and its files are never touched.
import type { Workspace } from '@caduceus/contracts/caduceus-api';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { TieredRequest, TieredResult } from '../../tiered-fetch.ts';

const ROUTE = '/_caduceus/api/work/workspaces';

/** What came of a change: it worked (with the server's answer), the owner declined, or it was refused (with the reason, in words). */
export type RegistryOutcome<Body = undefined> = ({ kind: 'done' } & (Body extends undefined ? unknown : { body: Body })) | { kind: 'cancelled' } | { kind: 'failed'; message: string };

export interface WorkspaceRegistryClient {
  /** The entries, in the owner's order. Throws when Caduceus does not answer. */
  list(): Promise<Workspace[]>;
  /** Adds a folder (Tier 1). The server checks it is inside the allowed roots and that Hermes finds it. */
  add(path: string, name?: string): Promise<RegistryOutcome<Workspace>>;
  rename(entry: Workspace, name: string): Promise<RegistryOutcome<Workspace>>;
  /** Puts the entries in the order of `ids`, which must name every one once. */
  reorder(ids: readonly string[]): Promise<RegistryOutcome<Workspace[]>>;
  /** Removes an entry (Tier 1). */
  remove(entry: Workspace): Promise<RegistryOutcome>;
}

/** The entries of the server's answer; a row that is not an entry is left out. */
export function parseWorkspaces(body: unknown): Workspace[] {
  const rows = isRecord(body) && Array.isArray(body.workspaces) ? body.workspaces : [];
  return rows.flatMap((row): Workspace[] => (isRecord(row) && typeof row.id === 'string' && typeof row.name === 'string' && typeof row.path === 'string' ? [{ id: row.id, name: row.name, path: row.path }] : []));
}

const GENERIC: Record<string, string> = {
  'bad-request': 'Caduceus did not accept that name or path.',
  'not-found': 'It is already gone. Reload the list.',
  'too-many-workspaces': 'There are too many workspaces. Remove some first.',
  'hermes-unavailable': 'Hermes did not answer, so the folder could not be checked.',
};

/** What a refusal says: the server's own words when it gave some, else a plain sentence for its code. */
function failure(body: unknown, status: number): string {
  if (isRecord(body)) {
    if (typeof body.message === 'string') return body.message;
    if (typeof body.error === 'string' && GENERIC[body.error]) return GENERIC[body.error]!;
  }
  return `Caduceus did not do that (HTTP ${status}).`;
}

export interface WorkspaceRegistryDeps {
  /** Sends a Caduceus request through the policy (`fetchTiered`): it asks the dialog for a Tier 1 first. */
  send(request: TieredRequest): Promise<TieredResult>;
  /** Reads a Caduceus route as parsed JSON; throws when it does not answer. */
  read(route: string): Promise<unknown>;
}

export function createWorkspaceRegistryClient({ send, read }: WorkspaceRegistryDeps): WorkspaceRegistryClient {
  async function run<Body>(sending: Promise<TieredResult>, parse: (body: unknown) => Body): Promise<RegistryOutcome<Body>> {
    const result = await sending;
    if (result.kind === 'cancelled') return { kind: 'cancelled' };
    if (result.kind === 'refused') return { kind: 'failed', message: result.refusal.message };
    const text = await result.response.text();
    let body: unknown;
    try {
      body = text === '' ? undefined : JSON.parse(text);
    } catch {
      body = undefined;
    }
    return result.response.ok ? ({ kind: 'done', body: parse(body) } as RegistryOutcome<Body>) : { kind: 'failed', message: failure(body, result.response.status) };
  }

  const entryOf = (body: unknown): Workspace => parseWorkspaces({ workspaces: [body] })[0] ?? { id: '', name: '', path: '' };

  return {
    async list() {
      return parseWorkspaces(await read(ROUTE));
    },
    add(path, name) {
      const title = name?.trim();
      return run(
        send({
          method: 'POST',
          path: ROUTE,
          body: { path: path.trim(), ...(title ? { name: title } : {}) },
          confirm: { title: 'Add this folder as a workspace?', text: `Caduceus offers ${path.trim()} in the composer and the Brief editor, and a file written inside it by Hermes’s file tools needs only a confirmation, not a passkey. Nothing in the folder changes.`, object: path.trim(), confirmLabel: 'Add workspace' },
        }),
        entryOf,
      );
    },
    rename: (entry, name) => run(send({ method: 'PUT', path: `${ROUTE}/${encodeURIComponent(entry.id)}`, body: { name: name.trim() } }), entryOf),
    reorder: (ids) => run(send({ method: 'PUT', path: `${ROUTE}/order`, body: { ids: [...ids] } }), parseWorkspaces),
    remove: (entry) =>
      run(
        send({
          method: 'DELETE',
          path: `${ROUTE}/${encodeURIComponent(entry.id)}`,
          confirm: { title: `Remove the workspace “${entry.name}”?`, text: `Caduceus stops offering ${entry.path}. The folder and its files are not touched, and you can add it again.`, object: entry.name, confirmLabel: 'Remove workspace' },
        }),
        () => undefined,
      ),
  };
}

/** One choice in the composer's workspace chip or the Brief editor's workspace field. */
export interface WorkspaceChoice {
  id: string;
  name: string;
  path: string;
  /** It is the folder in use now. */
  current: boolean;
}

/** The registry as a list of choices, in the owner's order; `current` marks the entry whose folder is in use. */
export function workspaceChoices(entries: readonly Workspace[], currentPath?: string): WorkspaceChoice[] {
  const wanted = currentPath?.trim().replace(/\/+$/, '');
  return entries.map((entry) => ({ ...entry, current: wanted !== undefined && wanted !== '' && entry.path.replace(/\/+$/, '') === wanted }));
}
