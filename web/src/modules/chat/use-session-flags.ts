// Whether the open chat's session is pinned or archived (M8 #09), for the More menu's Pin and Archive lines. The chat engine does not carry them: Hermes's own
// answer for the session does, read when the menu opens and again after a change.
import { useCallback, useEffect, useState } from 'react';
import { pinRefusal } from './chat-behaviour.ts';
import { readHermes } from './read-hermes.ts';
import type { Outcome, SessionActions } from './sessions-actions.ts';
import { PAGE_SIZE } from './sessions-list.ts';
import { listPath, parseSessions, readSessionsView, type SessionItem } from './sessions-model.ts';
import { flagsOf } from './talk-header.ts';

export function useSessionFlags(profile: string, storedId: string | undefined): { pinned: boolean; archived: boolean; refresh(): void } {
  const [flags, setFlags] = useState({ pinned: false, archived: false });
  const [reads, setReads] = useState(0);
  useEffect(() => {
    if (storedId === undefined || reads === 0) return;
    let current = true;
    readHermes(`/api/sessions/${encodeURIComponent(storedId)}?profile=${encodeURIComponent(profile)}`).then(
      (row) => current && setFlags(flagsOf(row)),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [profile, storedId, reads]);
  // A different session starts with no flags until the menu reads them.
  useEffect(() => setFlags({ pinned: false, archived: false }), [storedId]);
  const refresh = useCallback(() => setReads((count) => count + 1), []);
  return { ...flags, refresh };
}

/** How many of the agent's sessions are pinned, as the sessions list counts them (its newest page): the pin limit (Settings › Chat) is held against it. */
export async function pinnedCount(profile: string): Promise<number> {
  const page = parseSessions(await readHermes(listPath(readSessionsView({}, 'agent'), { profile, offset: 0, limit: PAGE_SIZE })));
  return page.items.filter((item) => item.pinned).length;
}

/** Pins or unpins, holding a pin against the owner's limit first, as the sessions list does. */
export async function setPinnedWithinLimit({ actions, item, pin, limit }: { actions: Pick<SessionActions, 'setPinned'>; item: SessionItem; pin: boolean; limit: number }): Promise<Outcome> {
  if (pin) {
    const message = pinRefusal({ pinned: await pinnedCount(item.profile ?? '').catch(() => 0), adding: 1, limit });
    if (message !== undefined) return { kind: 'failed', message };
  }
  return actions.setPinned(item, pin);
}
