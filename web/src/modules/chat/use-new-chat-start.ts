// How a new chat starts when something sent it here (M1 #17): the workspace of a worktree session that was just made, and a link `/chat/new?prompt=&profile=`.
// The words of a link only ever reach the message box, for the owner to read and send; nothing here sends. The parsing is `deep-link.ts`.
import { useEffect, useRef } from 'react';
import { useLocation, useRouter } from '@tanstack/react-router';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { toast } from '../../shell/toasts.ts';
import type { Chat as ChatEngine } from './chat-session.ts';
import { resolveNewChatLink, UNKNOWN_PROFILE_NOTICE } from './deep-link.ts';
import { onWorkspaceOffered, takeWorkspace } from './workspace-handoff.ts';

/**
 * For a chat that has no session yet (`storedId` is `undefined`): starts it in the workspace a worktree session left for this profile, and puts the prompt of the
 * address in the message box (`onPrompt`) once Hermes has said which profiles exist. The prompt (and a profile Hermes does not have, which the tab then does not use
 * and the owner is told about) is taken out of the address afterwards, so that a reload or a bookmark of the tab does not bring it back.
 */
export function useNewChatStart({ chat, profile, storedId, onPrompt }: { chat: ChatEngine | undefined; profile: string; storedId: string | undefined; onPrompt(text: string): void }): void {
  const router = useRouter();
  const search = useLocation({ select: (location) => location.searchStr });
  const { hermes } = useProfileScope();

  // The workspace goes to the chat once: when it opens, or when an offer arrives while it is open.
  useEffect(() => {
    if (!chat || storedId !== undefined) return;
    const take = () => {
      const cwd = takeWorkspace(profile);
      if (cwd !== undefined) chat.setWorkspace(cwd).catch((error: unknown) => toast('Hermes did not start the chat in the worktree', { tone: 'danger', detail: error instanceof Error ? error.message : String(error) }));
    };
    take();
    return onWorkspaceOffered(take);
  }, [chat, storedId, profile]);

  // Each address is read once (strict mode runs an effect twice).
  const read = useRef<string>(undefined);
  useEffect(() => {
    if (storedId !== undefined || hermes === undefined || read.current === search) return;
    read.current = search;
    const link = resolveNewChatLink(search, hermes.profiles.map((candidate) => candidate.name));
    if (link.unknownProfile !== undefined) toast(UNKNOWN_PROFILE_NOTICE(link.unknownProfile), { tone: 'info' });
    if (link.prompt !== undefined) onPrompt(link.prompt);
    if (link.remaining !== search) router.history.replace(`${location.pathname}${link.remaining}`);
  }, [storedId, hermes, search, router, onPrompt]);
}
