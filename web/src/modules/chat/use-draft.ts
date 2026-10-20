// The composer's draft as React state (M1 #11): the sync of `draft-sync.ts` bound to the composer of one (profile, session). It reads the saved draft when the
// composer opens, gives the composer what another device saved, saves after a pause and when the page is hidden, and looks again when the page is looked at.
// What it keeps, and why a draft is sometimes refused, is the server's (`contracts/chat-drafts.ts`).
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { Attachment } from './attachments.ts';
import { markDraft } from './draft-index.ts';
import { createDraftSync, type DraftContent, type DraftSync, type DraftView } from './draft-sync.ts';

export interface ComposerDraft {
  sync: DraftSync;
  view: DraftView;
}

/**
 * `text` and `attachments` are the composer's; `adopt` puts a draft another device saved into it. The draft of `session` (`new` for a chat with no session)
 * is the composer's for as long as the composer lives, which is as long as the conversation it is in.
 */
export function useDraft({ profile, session, text, attachments, adopt }: { profile: string; session: string; text: string; attachments: readonly Attachment[]; adopt(content: DraftContent): void }): ComposerDraft {
  const latest = useRef<DraftContent>({ text, attachments });
  latest.current = { text, attachments };
  const adopting = useRef(adopt);
  adopting.current = adopt;
  const [sync] = useState(() => createDraftSync({ profile, session, adopt: (content) => adopting.current(content), onPresence: (has) => markDraft(profile, session, has) }));
  const view = useSyncExternalStore(sync.store.subscribe, () => sync.store.state);

  useEffect(() => {
    void sync.load(latest.current);
    // What is typed after the composer closes still reaches the server: the save is already on its way.
    return () => sync.dispose();
  }, [sync]);
  useEffect(() => {
    sync.change({ text, attachments });
  }, [sync, text, attachments]);
  useEffect(() => {
    const hide = () => sync.flush(true);
    const look = () => void sync.refresh(latest.current);
    const onVisibility = () => (document.visibilityState === 'hidden' ? hide() : look());
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', hide);
    window.addEventListener('focus', look);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('focus', look);
    };
  }, [sync]);
  return { sync, view };
}
