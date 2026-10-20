// Talk's sessions (M8 #04): which conversation an agent opens on, and whose sessions its list shows. Pure: the list is Hermes's, read on this load.
import { isApiNoise, isInTab, type ListScope, type SessionItem } from './sessions-model.ts';

/** Talk's list is the agent's own sessions unless the address widens it to all profiles (the Chat list that came before showed every profile). */
export const TALK_SCOPE: ListScope = 'agent';

/** The id Hermes gives a background run's session (`bg_<id>`); the server reads the same name to list the runs that are going. */
const BACKGROUND_RUN = /^bg_/;

/**
 * The conversation Talk opens an agent on: its newest chat, by the last activity. An archived session is out of the way on purpose, an automation session
 * (cron, Kanban, webhook) is not a conversation with the agent, a background run the agent was delegated (Hermes's `bg_` sessions, M8 #06) is its own work
 * and not the conversation the owner is in, and the API server's throwaway sessions are noise. Between two that were last active in the
 * same second the list's own order stands. `undefined` when there is none: the screen then starts a new chat.
 */
export function latestSession(items: readonly SessionItem[]): SessionItem | undefined {
  let newest: SessionItem | undefined;
  for (const item of items) {
    if (item.archived || !isInTab(item.source, 'chats') || isApiNoise(item) || BACKGROUND_RUN.test(item.id)) continue;
    if (newest === undefined || item.lastActive > newest.lastActive) newest = item;
  }
  return newest;
}
