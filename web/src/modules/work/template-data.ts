// The playbook library and categories as Caduceus's server keeps them (`/_caduceus/api/work/playbooks`, `…/template-categories`): playbook
// definitions (one-stage templates and multi-stage playbooks, the owner's files, and the seeds that ship with Caduceus) and the owner's
// categories, never Hermes data. Every change goes to the server first and the page asks again, so what shows is what the server holds.
// Making a copy and putting a deleted definition back are plain requests (a new file); saving a new version and deleting are Tier 1, so they
// go through `fetchTiered` and the owner confirms first.
import { useCallback, useEffect, useState } from 'react';
import { readPlaybook, type Playbook, type TemplateCategory, type TemplateLibrary } from '@caduceus/contracts/playbooks';
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { PaletteHit } from '../../module-registry.ts';
import { fetchTiered } from '../../tiered.ts';
import type { TieredRequest } from '../../tiered-fetch.ts';
import { playbookHits, readCheck, readDetail, type PlaybookDetailData, type YamlCheck } from './playbook-model.ts';
import { duplicateOf, type TemplateDraft } from './template-model.ts';

const PLAYBOOKS = '/_caduceus/api/work/playbooks';
const CATEGORIES = '/_caduceus/api/work/template-categories';

const REFUSALS: Record<string, string> = {
  'duplicate-name': 'There is already a category with that name.',
  'not-empty': 'Move or delete the templates and playbooks in this category first.',
  'too-many-templates': 'There are too many templates and playbooks. Delete some first.',
  'too-many-categories': 'There are too many categories. Delete some first.',
  exists: 'A template or playbook with that id already exists.',
  seed: 'A built-in playbook cannot be changed. Duplicate it to make one you can edit.',
  'not-found': 'It is already gone. Reload the list.',
  'bad-request': 'Caduceus did not accept that.',
};

/** A definition the server refused: the problems it found, one sentence each, and the YAML line each is on (`null` when it has none). */
export class DefinitionRefused extends Error {
  constructor(
    readonly problems: string[],
    readonly lines: (number | null)[],
  ) {
    super(problems.join(' '));
  }
}

/** What a refusal says, in words: the problems a definition has, or the reason a change was refused. */
async function refusal(response: Response): Promise<Error> {
  const body: unknown = await response.json().catch(() => undefined);
  if (isRecord(body) && Array.isArray(body.problems) && body.problems.length > 0) {
    const problems = body.problems.filter((problem): problem is string => typeof problem === 'string');
    const lines = Array.isArray(body.lines) ? body.lines.map((line): number | null => (typeof line === 'number' ? line : null)) : [];
    return new DefinitionRefused(problems, problems.map((_, index) => lines[index] ?? null));
  }
  return new Error(isRecord(body) && typeof body.error === 'string' && REFUSALS[body.error] ? REFUSALS[body.error] : `Caduceus did not save that (HTTP ${response.status}).`);
}

async function send(method: string, path: string, body?: unknown): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  } catch {
    throw new Error('Caduceus did not answer.');
  }
  if (!response.ok) throw await refusal(response);
  return response;
}

/** A Tier 1 change: the owner confirms first. `undefined` is "the owner said no"; a refusal or a failure throws, in words. */
async function sendConfirmed(request: TieredRequest): Promise<Response | undefined> {
  let result;
  try {
    result = await fetchTiered(request);
  } catch {
    throw new Error('Caduceus did not answer.');
  }
  if (result.kind === 'cancelled') return undefined;
  if (result.kind === 'refused') throw new Error(result.refusal.message);
  if (!result.response.ok) throw await refusal(result.response);
  return result.response;
}

/** The definition a server answer holds, or an error when it is not one. */
async function storedBy(response: Response): Promise<Playbook> {
  const stored = readPlaybook(await response.json().catch(() => undefined)).playbook;
  if (stored === undefined) throw new Error('Caduceus answered with something that is not a playbook.');
  return stored;
}

/**
 * What the server answered as a library: a definition that is not valid is left out, so the page never trusts a shape it was not given.
 * Both lists are read the same way, so a seed and the owner's own are shaped alike.
 */
export function readLibrary(body: unknown): TemplateLibrary {
  const root = isRecord(body) ? body : {};
  const categories = (Array.isArray(root.categories) ? root.categories : []).flatMap((item): TemplateCategory[] => (isRecord(item) && typeof item.id === 'string' && typeof item.name === 'string' ? [{ id: item.id, name: item.name }] : []));
  const playbooks = (value: unknown) => (Array.isArray(value) ? value : []).flatMap((item) => readPlaybook(item).playbook ?? []);
  const problems = (Array.isArray(root.problems) ? root.problems : []).filter((problem): problem is string => typeof problem === 'string');
  return { categories, templates: playbooks(root.templates), seeds: playbooks(root.seeds), problems };
}

export interface LibraryState {
  /** What the server last said; undefined until it has answered. */
  library?: TemplateLibrary;
  /** Why the library could not be read. */
  error?: string;
  reload(): void;
}

export function usePlaybookLibrary(): LibraryState {
  const [library, setLibrary] = useState<TemplateLibrary>();
  const [error, setError] = useState<string>();
  const [round, setRound] = useState(0);
  useEffect(() => {
    let current = true;
    fetch(PLAYBOOKS).then(
      async (response) => {
        if (!current) return;
        if (!response.ok) return setError(`Caduceus answered HTTP ${response.status}.`);
        setLibrary(readLibrary(await response.json().catch(() => undefined)));
        setError(undefined);
      },
      () => current && setError('Caduceus did not answer.'),
    );
    return () => {
      current = false;
    };
  }, [round]);
  return { library, error, reload: useCallback(() => setRound((previous) => previous + 1), []) };
}

type Resolved = { status: 'loading' } | { status: 'missing' } | { status: 'failed'; error: string } | { status: 'ready'; detail: PlaybookDetailData };
export type PlaybookState = Resolved & { reload(): void };

/** One definition with its YAML, its versions and what Hermes does not have of what it names; `version` reads an older one. */
export function usePlaybook(id: string, version?: number): PlaybookState {
  const key = `${id}@${version ?? 'latest'}`;
  const [loaded, setLoaded] = useState<{ key: string; result: Resolved }>();
  const [round, setRound] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const done = (result: Resolved) => !controller.signal.aborted && setLoaded({ key, result });
    fetch(version === undefined ? `${PLAYBOOKS}/${encodeURIComponent(id)}` : `${PLAYBOOKS}/${encodeURIComponent(id)}/versions/${version}`, { signal: controller.signal }).then(
      async (response) => {
        if (response.status === 404) return done({ status: 'missing' });
        if (!response.ok) return done({ status: 'failed', error: `Caduceus answered HTTP ${response.status}.` });
        const detail = readDetail(await response.json().catch(() => undefined));
        done(detail ? { status: 'ready', detail } : { status: 'failed', error: 'Caduceus answered with something that is not a playbook.' });
      },
      () => done({ status: 'failed', error: 'Caduceus did not answer.' }),
    );
    return () => controller.abort();
  }, [id, version, key, round]);
  const result: Resolved = loaded?.key === key ? loaded.result : { status: 'loading' };
  return { ...result, reload: useCallback(() => setRound((previous) => previous + 1), []) };
}

/** What the server says of a YAML text: its problems by line, and what Hermes does not have of what it names. */
export async function checkYaml(yaml: string, signal?: AbortSignal): Promise<YamlCheck> {
  let response: Response;
  try {
    response = await fetch(`${PLAYBOOKS}/check`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ yaml }), signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('Caduceus did not answer.');
  }
  const check = response.ok ? readCheck(await response.json().catch(() => undefined)) : undefined;
  if (check === undefined) throw new Error(`Caduceus could not check the YAML (HTTP ${response.status}).`);
  return check;
}

/**
 * Saves a definition: a new template (an id is made from its name), or, with `editing`, the next version of one that exists (Tier 1: the owner
 * confirms, and the version it replaces stays readable). Answers what was stored; `undefined` when the owner declined.
 */
export async function saveTemplate(draft: TemplateDraft, editing?: Playbook): Promise<Playbook | undefined> {
  if (editing === undefined) return storedBy(await send('POST', PLAYBOOKS, draft));
  const response = await sendConfirmed({
    method: 'PUT',
    path: `${PLAYBOOKS}/${encodeURIComponent(editing.id)}`,
    body: draft,
    confirm: replaceConfirmation(editing, draft.name),
  });
  return response && storedBy(response);
}

/** Saves the YAML text as the next version of `editing` (Tier 1). A text the server refuses throws `DefinitionRefused`; `undefined` when the owner declined. */
export async function savePlaybookYaml(editing: Playbook, yaml: string): Promise<Playbook | undefined> {
  const response = await sendConfirmed({
    method: 'PUT',
    path: `${PLAYBOOKS}/${encodeURIComponent(editing.id)}`,
    body: { yaml },
    confirm: replaceConfirmation(editing, editing.name),
  });
  return response && storedBy(response);
}

const replaceConfirmation = (editing: Playbook, name: string) => ({
  title: `Save “${name}” as version ${editing.version + 1}?`,
  text: `This writes version ${editing.version + 1} of the definition. Version ${editing.version} stays readable, so runs started from it keep working.`,
  object: name,
  confirmLabel: `Save version ${editing.version + 1}`,
});

/** Makes a copy under a new name (a plain request: it is a new file). Seeds are only ever changed this way. */
export async function duplicatePlaybook(playbook: Playbook, categories: readonly TemplateCategory[]): Promise<Playbook> {
  return storedBy(await send('POST', PLAYBOOKS, duplicateOf(playbook, categories)));
}

/** Deletes a definition (Tier 1). `false` when the owner declined. */
export async function deletePlaybook(playbook: Playbook): Promise<boolean> {
  const response = await sendConfirmed({
    method: 'DELETE',
    path: `${PLAYBOOKS}/${encodeURIComponent(playbook.id)}`,
    confirm: { title: `Delete “${playbook.name}”?`, text: 'It leaves the library. A toast offers Undo for a few seconds, and its earlier versions stay readable.', object: playbook.name, confirmLabel: 'Delete' },
  });
  return response !== undefined;
}

/** Puts a deleted definition back exactly as it was (its id and version come with it): the undo of a delete. */
export async function restorePlaybook(playbook: Playbook): Promise<void> {
  await send('POST', PLAYBOOKS, playbook);
}

export async function addCategory(name: string): Promise<void> {
  await send('POST', CATEGORIES, { name });
}

export async function renameCategory(id: string, name: string): Promise<void> {
  await send('PUT', `${CATEGORIES}/${encodeURIComponent(id)}`, { name });
}

export async function deleteCategory(id: string): Promise<void> {
  await send('DELETE', `${CATEGORIES}/${encodeURIComponent(id)}`);
}

/** The ids of every category, in the order the owner wants them. */
export async function reorderCategories(ids: readonly string[]): Promise<void> {
  await send('PUT', `${CATEGORIES}/order`, { ids });
}

/** What the palette lists for a query: the library asked again each time, so a definition made a moment ago is found. An answer that fails finds nothing. */
export async function searchLibrary(query: string, signal: AbortSignal): Promise<PaletteHit[]> {
  const response = await fetch(PLAYBOOKS, { signal });
  return response.ok ? playbookHits(readLibrary(await response.json().catch(() => undefined)), query) : [];
}
