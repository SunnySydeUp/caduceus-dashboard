// What Talk's header holds and what its More menu offers (M8 #09). The header is the agent, the title and three or four buttons; everything the header used to
// show (Make this a task, the Chat actions, the terminal toggle) is a line of the More menu, and the transcript's tools and the activity mode are the View menu's.
// Pure: the screen gives each line its `run`.
import type { IconName } from '../../icons.tsx';

export type HeaderControl = 'new' | 'sessions' | 'details' | 'view' | 'more';

/**
 * The buttons in the header, in order: New chat once the chat has a session (before that it is a new chat already) and only above a phone's width (a phone has no
 * room for it beside the agent's name: its agent strip starts a new chat), Sessions only on a phone (where the list is a sheet), View unless the chat is a Fast one
 * (no agent activity, no transcript to work on), and More only once the chat has a session to act on.
 */
export function headerControls({ compact, titled, viewable }: { compact: boolean; titled: boolean; viewable: boolean }): HeaderControl[] {
  return [...(titled && !compact ? ['new' as const] : []), ...(compact ? ['sessions' as const] : []), 'details', ...(viewable ? ['view' as const] : []), ...(titled ? ['more' as const] : [])];
}

export type ThreadActionId = 'rename' | 'pin' | 'task' | 'archive' | 'regenerate-title' | 'fork' | 'undo' | 'handoff-summary' | 'branch' | 'export' | 'share' | 'terminal';

export interface ThreadMenuInput {
  /** A session another process owns: Caduceus reads it and never writes to it. */
  readOnlySession: boolean;
  /** The chat has a session and words to start a task from, and read-only mode is off. */
  taskOffered: boolean;
  /** A turn is running or arriving: Hermes refuses to cut or undo history then. */
  busy: boolean;
  /** The chat has no messages. */
  empty: boolean;
  /** Terminal mode is offered at this window size. */
  terminal: boolean;
  pinned: boolean;
  archived: boolean;
}

export interface ThreadMenuEntry {
  id: ThreadActionId;
  icon: IconName;
  label: string;
  sub?: string;
  /** A change to Hermes: switched off while read-only mode is on. */
  writes: boolean;
  /** Why the line cannot be used now. */
  disabled?: string;
}

const WRITING = 'Hermes is writing a reply. Stop it first, or wait for it to finish.';

/** The lines of the More menu, in order. Rename, Pin, Make this a task and Archive come first; the rest of what a chat can do follows. */
export function threadMenu({ readOnlySession, taskOffered, busy, empty, terminal, pinned, archived }: ThreadMenuInput): ThreadMenuEntry[] {
  const task: ThreadMenuEntry[] = taskOffered ? [{ id: 'task', icon: 'tasks', label: 'Make this a task', sub: 'Start a task from this chat', writes: true }] : [];
  const summary: ThreadMenuEntry = { id: 'handoff-summary', icon: 'book', label: 'Write a handoff summary…', sub: 'A short note for whoever picks it up; it costs a model call', writes: false };
  const leaving: ThreadMenuEntry[] = [
    { id: 'export', icon: 'download', label: 'Export…', sub: 'Markdown, a web page or JSON, as a file', writes: false },
    { id: 'share', icon: 'link', label: 'Share link…', sub: 'A read-only copy, for devices on your tailnet', writes: true },
    ...(terminal ? [{ id: 'terminal' as const, icon: 'terminal' as const, label: 'Open in terminal', sub: 'Hermes’s own terminal on this chat', writes: false }] : []),
  ];
  if (readOnlySession) return [{ id: 'branch', icon: 'git', label: 'Branch to continue', sub: 'A new session with every message of this one', writes: false }, summary, ...task, ...leaving];
  return [
    { id: 'rename', icon: 'draft', label: 'Rename…', sub: 'Change the title Hermes keeps', writes: true },
    { id: 'pin', icon: 'pin', label: pinned ? 'Unpin' : 'Pin', sub: pinned ? undefined : 'Keep it at the top of the list', writes: true },
    ...task,
    { id: 'archive', icon: 'archive', label: archived ? 'Restore from archive' : 'Archive', sub: archived ? undefined : 'Out of the list, still in Hermes', writes: true },
    { id: 'regenerate-title', icon: 'refresh', label: 'Regenerate title…', sub: 'Ask Hermes’s title model for a new name', writes: true },
    { id: 'fork', icon: 'git', label: 'Fork this chat', sub: 'A new chat with every message of this one', writes: true, ...(busy ? { disabled: WRITING } : {}) },
    { id: 'undo', icon: 'history', label: 'Undo last exchange', sub: 'Takes the last message and its reply out of the chat', writes: true, ...(busy ? { disabled: WRITING } : empty ? { disabled: 'There is nothing to undo yet.' } : {}) },
    summary,
    ...leaving,
  ];
}

const flag = (value: unknown): boolean => value === true || value === 1;

/** Whether a session is pinned or archived, from Hermes's answer for it (`GET /api/sessions/{id}`): the list says `true`, its own table holds 1. */
export function flagsOf(row: unknown): { pinned: boolean; archived: boolean } {
  const fields = typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {};
  return { pinned: flag(fields.pinned), archived: flag(fields.archived) };
}
