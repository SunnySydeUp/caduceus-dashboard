// Which sessions have an unsent draft (M1 #11), for the session list's indicator. The server keeps the drafts (`/_caduceus/api/chat/drafts`, the owner's, so
// every device shows the same); this is the page's copy of what it last heard, kept up to date by the composer as it saves and clears, and read again when
// the page is looked at. Nothing here talks to Hermes.
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { DraftList } from '@caduceus/contracts/chat-drafts';

const ROUTE = '/_caduceus/api/chat/drafts';

/** `profile/session` of every draft the server holds. */
let keys: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();
const publish = (next: ReadonlySet<string>) => {
  keys = next;
  listeners.forEach((notify) => notify());
};

const keyOf = (profile: string, session: string) => `${profile}/${session}`;

/** Asks the server which drafts there are (every profile's), and replaces what the page knew. Does nothing when the server does not answer. */
export async function loadDraftIndex(fetcher: (route: string) => Promise<Response> = (route) => fetch(route)): Promise<void> {
  const res = await fetcher(ROUTE).catch(() => undefined);
  if (!res?.ok) return;
  const list = (await res.json()) as DraftList;
  publish(new Set(list.drafts.map((draft) => keyOf(draft.profile, draft.session))));
}

/** The composer saved or deleted a draft: the list shows it at once. */
export function markDraft(profile: string, session: string, has: boolean): void {
  if (keys.has(keyOf(profile, session)) === has) return;
  const next = new Set(keys);
  if (has) next.add(keyOf(profile, session));
  else next.delete(keyOf(profile, session));
  publish(next);
}

/** Whether a session has an unsent draft; the page reads the server again when it mounts and whenever it is looked at again. */
export function useHasDraft(profile: string, session: string): boolean {
  return useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => void listeners.delete(notify);
    },
    () => keys.has(keyOf(profile, session)),
  );
}

/** A draft that waits in a chat other than the one on screen. */
export interface WaitingDraft {
  profile: string;
  session: string;
}

/** The drafts of `keys` that are not the one of `here`: the agent's other chats first (the owner is likeliest to mean those), then the other agents'. */
export function otherDrafts(keys: Iterable<string>, here: WaitingDraft): WaitingDraft[] {
  const own = keyOf(here.profile, here.session);
  const others = [...keys].filter((key) => key !== own).map((key) => ({ profile: key.slice(0, key.indexOf('/')), session: key.slice(key.indexOf('/') + 1) }));
  return [...others.filter((draft) => draft.profile === here.profile), ...others.filter((draft) => draft.profile !== here.profile)];
}

/** The drafts waiting in other chats; the index is kept fresh by the sessions list and by the composer's own saves. */
export function useOtherDrafts(here: WaitingDraft): WaitingDraft[] {
  const known = useSyncExternalStore(
    (notify) => {
      listeners.add(notify);
      return () => void listeners.delete(notify);
    },
    () => keys,
  );
  return useMemo(() => otherDrafts(known, here), [known, here.profile, here.session]);
}

/** Keeps the index fresh while a screen that shows it is open. */
export function useDraftIndexLoaded(): void {
  useEffect(() => {
    void loadDraftIndex();
    const again = () => document.visibilityState === 'visible' && void loadDraftIndex();
    document.addEventListener('visibilitychange', again);
    window.addEventListener('focus', again);
    return () => {
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('focus', again);
    };
  }, []);
}
