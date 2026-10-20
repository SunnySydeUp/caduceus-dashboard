// The owner's saved prompts as the page holds them (M1 #11). The server keeps them (`/_caduceus/api/chat/prompts`, the owner's, so every device shows
// the same); this is the page's copy of what it last heard, so the composer's chip, its sheet and the palette command agree without asking again.
// Nothing here talks to Hermes: a prompt goes to Hermes only when it has been put in the message box and the owner presses Send.
import { useEffect, useSyncExternalStore } from 'react';
import type { SavedPrompt, SavedPromptInput, SavedPromptList } from '@caduceus/contracts/chat-drafts';

/** The page's way to call the server; `fetch` in the browser, the test server's in a test. */
export type Request = (method: string, path: string, body?: unknown) => Promise<Response>;

const ROUTE = '/_caduceus/api/chat/prompts';
const browserRequest: Request = (method, path, body) =>
  fetch(path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });

let current: readonly SavedPrompt[] | undefined;
const listeners = new Set<() => void>();
const publish = (next: readonly SavedPrompt[]) => {
  current = next;
  listeners.forEach((notify) => notify());
};

/** Why a call did not work, in the server's words when it gave some. */
async function failure(res: Response, what: string): Promise<Error> {
  const body = (await res.json().catch(() => undefined)) as { message?: unknown } | undefined;
  return new Error(typeof body?.message === 'string' ? body.message : `${what} (HTTP ${res.status}).`);
}

/** Reads every saved prompt from the server (once per page unless `again`). Throws when the server does not answer. */
export async function loadPrompts(request: Request = browserRequest, again = false): Promise<readonly SavedPrompt[]> {
  if (current && !again) return current;
  const res = await request('GET', ROUTE);
  if (!res.ok) throw await failure(res, 'Caduceus did not list the saved prompts');
  publish(((await res.json()) as SavedPromptList).prompts);
  return current ?? [];
}

/** Saves a new prompt (`id` undefined) or an edit of one, and says what the server stored. Throws with the server's reason when it was not saved. */
export async function savePrompt(input: SavedPromptInput, id?: string, request: Request = browserRequest): Promise<SavedPrompt> {
  const res = await (id === undefined ? request('POST', ROUTE, input) : request('PUT', `${ROUTE}/${encodeURIComponent(id)}`, input));
  if (!res.ok) throw await failure(res, 'Caduceus did not save the prompt');
  await loadPrompts(request, true);
  return (await res.json()) as SavedPrompt;
}

/** Deletes a prompt. Throws with the server's reason when it was not deleted. */
export async function deletePrompt(id: string, request: Request = browserRequest): Promise<void> {
  const res = await request('DELETE', `${ROUTE}/${encodeURIComponent(id)}`);
  if (!res.ok && res.status !== 404) throw await failure(res, 'Caduceus did not delete the prompt');
  await loadPrompts(request, true);
}

/** The saved prompts, `undefined` until the server has answered. */
export function usePrompts(): readonly SavedPrompt[] | undefined {
  useEffect(() => {
    void loadPrompts().catch(() => undefined);
  }, []);
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => void listeners.delete(notify);
    },
    () => current,
  );
}
