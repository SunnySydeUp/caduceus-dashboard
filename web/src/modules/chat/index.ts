import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';
import { withProfile } from '../../profile-scope.ts';
import { requestPromptLibrary } from './prompts-handoff.ts';
import { readHermes } from './read-hermes.ts';
import { hitDetail, hitPath, searchSessions } from './session-search.ts';
import { sourceIcon } from './sessions-model.ts';

/** How many sessions the palette lists for a query (the sessions pane lists more). */
const PALETTE_HITS = 8;

const Chat = lazy(() => import('./Chat.tsx').then((m) => ({ default: m.Chat })));

/** Starts a new chat in this tab's profile: the address of the new-chat screen, which keeps the tab's `?profile=`. */
function openNewChat(): void {
  const profile = new URLSearchParams(location.search).get('profile') ?? undefined;
  // The palette that runs this is a layer, whose history entry is popped as it closes: a push made before that settles is popped with it.
  // TanStack Router's browser history notices `pushState` from outside, so the route changes without a page load.
  // (The layers module needs a window, so it is loaded when the command runs, not with the registry.)
  void import('../../overlays/layers.ts')
    .then(({ closeAllLayers }) => closeAllLayers())
    .then(() => history.pushState(null, '', withProfile('/chat/new', profile)));
}

export const chatModule: AppModule = {
  id: 'chat',
  title: 'Chat',
  icon: 'chat',
  desk: 'talk',
  path: '/chat',
  key: 'c',
  order: 2,
  summary: 'Talk to Hermes and pick up your sessions',
  profileScoped: true,
  routes: [
    { path: '/chat', screen: Chat },
    { path: '/chat/new', screen: Chat, title: 'New chat', parent: '/chat' },
    { path: '/chat/:id', screen: Chat, title: 'Chat', parent: '/chat' },
  ],
  // ⇧⌘O is reserved for it (shortcuts.ts); the owner can still remap it in Settings › Keyboard.
  paletteCommands: () => [
    { id: 'new-chat', label: 'New chat', icon: 'plus', sub: 'Start a conversation with Hermes', shortcut: 'mod+shift+o', run: openNewChat },
    { id: 'saved-prompts', label: 'Saved prompts', icon: 'book', sub: 'Insert, save or edit a prompt for the message box', run: () => requestPromptLibrary(openNewChat) },
  ],
  // The words inside sessions: Hermes searches them (its own index); the palette lists what it finds and opens a hit at the first message that matches.
  paletteSearch: async (query, { profile, signal }) => {
    const hits = await searchSessions((path) => readHermes(path, signal), query, { profile: profile ?? 'default', limit: PALETTE_HITS });
    const now = Date.now() / 1000;
    return hits.map((hit) => ({ id: hit.sessionId, label: hit.title, sub: `${hit.profile} · ${hitDetail(hit, now)}`, snippet: hit.snippet, icon: sourceIcon(hit.source ?? ''), path: hitPath(hit, query) }));
  },
  help: () => import('./help.ts').then((m) => m.chatHelp),
  settings: [
    {
      id: 'chat',
      title: 'Chat',
      summary: 'Send key, sound, timestamps, density, pin limit, auto-follow, finished marks and the default activity mode',
      icon: 'chat',
      screen: lazy(() => import('./ChatSettings.tsx').then((m) => ({ default: m.ChatSettings }))),
      fields: [
        { id: 'send-key', label: 'Send key', description: 'Whether Enter or ⌘/Ctrl+Enter sends a message', keywords: ['enter', 'return', 'send', 'newline', 'shortcut', 'keyboard', 'command enter'] },
        { id: 'completion-sound', label: 'Completion sound', description: 'A short sound when Hermes finishes a reply', keywords: ['sound', 'beep', 'chime', 'audio', 'notification', 'done'] },
        { id: 'timestamps', label: 'Timestamps', description: 'The time each message was written, under it', keywords: ['time', 'clock', 'date', 'when'] },
        { id: 'transcript-density', label: 'Transcript density', description: 'How much room the messages of a conversation take', keywords: ['compact', 'comfortable', 'spacing', 'gap', 'messages'] },
        { id: 'list-density', label: 'Session list density', description: 'How tightly the rows of the sessions list are packed', keywords: ['compact', 'comfortable', 'sessions', 'rows', 'list'] },
        { id: 'auto-follow', label: 'Auto-follow', description: 'Keep the conversation scrolled to the end while a reply arrives', keywords: ['scroll', 'follow', 'stick', 'bottom', 'stream'] },
        { id: 'finished-marks', label: 'Finished marks on agents', description: 'The green ring and tick on an agent with finished work you have not opened', keywords: ['ring', 'outline', 'green', 'tick', 'check', 'finished', 'done', 'sigil', 'agent', 'crew', 'hide'] },
        { id: 'pin-limit', label: 'Pin limit', description: 'How many sessions can be pinned at once', keywords: ['pin', 'pinned', 'sessions', 'limit', 'maximum'] },
        { id: 'activity-mode', label: 'Default activity mode', description: 'How agent activity shows on a device that has not chosen a mode', keywords: ['worklog', 'stream', 'final', 'tools', 'activity', 'reasoning'] },
        { id: 'chip-order', label: 'Composer chips', description: 'Which chips sit under the message box and in what order', keywords: ['chips', 'composer', 'model', 'reasoning', 'workspace', 'toolsets', 'reorder', 'hide'] },
      ],
    },
  ],
};
