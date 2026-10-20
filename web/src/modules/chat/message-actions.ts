// What the owner can do to a message of the transcript (M1 #12), as questions the screen and the engine both ask: pure, so that it runs under test.
// Everything done to Hermes's history is Hermes's (`prompt.submit` with a message to cut before, `session.undo`, `session.branch`); this only decides what
// is offered and what is sent.
import type { ChatMessage } from './chat-session.ts';
import { inlineText, parseMarkdown, type Block, type Inline } from './markdown.ts';
import { splitAttachments } from './message-attachments.ts';

/** The prompt an edit sends: the owner's new words, then the attachment lines the original message ended with (an image or file stays with the message). */
export function editedText(original: string, edited: string): string {
  const { body } = splitAttachments(original);
  return `${edited.trim()}${original.slice(body.length)}`;
}

/** What the owner edits: the words of a user message, without the attachment lines (they are put back by `editedText`). */
export const editableText = (original: string): string => splitAttachments(original).body;

/** How many of Hermes's messages an edit of message `id` removes: that message and every message after it (their words, not the activity cards between). */
export function removedByEdit(messages: readonly ChatMessage[], id: number): { messages: number; replies: number } {
  const at = messages.findIndex((message) => message.id === id);
  if (at < 0) return { messages: 0, replies: 0 };
  const removed = messages.slice(at).filter((message) => message.id !== undefined);
  return { messages: removed.length, replies: removed.filter((message) => message.role === 'assistant').length };
}

/** The gateway's copy of a message, as far as a branch's plan reads it. */
export interface BranchedMessage {
  role: string;
  text?: string | null;
  /** When Hermes wrote it (seconds since the epoch): a branch keeps its parent's, and its row ids are its own (new rows of the branch). */
  timestamp?: number | null;
  display_kind?: string | null;
}

/** The message of the chat a fork is made from, as the page holds it: what finds the same message in the branch. */
export interface ForkSource {
  role: string;
  /** When Hermes wrote it, in seconds. */
  at?: number | undefined;
}

/** A user message of the owner's, not a note Hermes wrote into the history (a model switch, a crash recovery): what `session.undo` counts as a turn. */
const isOwnTurn = (message: BranchedMessage) => message.role === 'user' && (message.display_kind == null || message.display_kind === 'skill_invocation');

/**
 * How a branch of the whole chat is cut back to message `from` (a message of the chat the branch was made from). The branch's messages are new rows with
 * ids of their own, and keep their parent's timestamps, so `from` is found by its role and its time:
 * `undo` turns come off the end (each `session.undo` takes the last user message and what followed), `users` of the owner's messages remain, and `last` is
 * the words the branch must end with. A message of the owner's is cut too, and its words go back to the composer (`prefill`): the fork then starts at that
 * message, the way an edit does. Undefined when the message is not in the branch.
 */
export function forkPlan(messages: readonly BranchedMessage[], from: ForkSource): { undo: number; users: number; last: string | undefined; prefill: string | undefined } | undefined {
  const at = from.at === undefined ? -1 : messages.findIndex((message) => message.role === from.role && message.timestamp === from.at);
  const target = messages[at];
  if (!target || target.role === 'tool') return undefined;
  const turns = messages.filter(isOwnTurn);
  const cutFrom = target.role === 'user' ? at : at + 1;
  const undo = messages.slice(cutFrom).filter(isOwnTurn).length;
  const kept = messages.slice(0, cutFrom).filter((message) => message.role === 'user' || message.role === 'assistant').at(-1);
  return { undo, users: turns.length - undo, last: kept?.text?.trim() || undefined, prefill: target.role === 'user' ? (target.text ?? undefined) : undefined };
}

/** Inline content as plain words: markup dropped, a link followed by its address (so that copying a message keeps where it pointed). */
function plainInline(inlines: readonly Inline[]): string {
  return inlines
    .map((node) => (node.t === 'link' ? `${plainInline(node.children)}${plainInline(node.children) === node.href ? '' : ` (${node.href})`}` : node.t === 'em' || node.t === 'strong' || node.t === 'del' ? plainInline(node.children) : inlineText([node])))
    .join('');
}

function plainBlock(block: Block): string {
  switch (block.t) {
    case 'paragraph':
    case 'heading':
      return plainInline(block.children);
    case 'code':
    case 'math':
      return block.t === 'code' ? block.text : block.tex;
    case 'quote':
      return block.children.map(plainBlock).join('\n\n');
    case 'rule':
      return '';
    case 'media':
      return block.alt;
    case 'list':
      return block.items.map((item, index) => `${block.ordered ? `${block.start + index}.` : '-'} ${item.checked === undefined ? '' : item.checked ? '[x] ' : '[ ] '}${item.blocks.map(plainBlock).join('\n')}`).join('\n');
    case 'table':
      return [block.head, ...block.rows].map((row) => row.map(plainInline).join('\t')).join('\n');
  }
}

/** A message as plain text, for Copy: the Markdown it is written in read as words, with no markup. Code and tables keep their lines. */
export const plainText = (markdown: string): string =>
  parseMarkdown(markdown)
    .blocks.map(plainBlock)
    .filter((part) => part !== '')
    .join('\n\n');

/** Every action a message can offer. The hover toolbar shows the `quick` ones; the ⋮ menu and the long-press menu show them all. */
export type MessageActionId = 'copy-text' | 'copy-markdown' | 'read-aloud' | 'edit' | 'regenerate' | 'fork' | 'retry' | 'undo' | 'link' | 'task';

export interface MessageEntry {
  id: MessageActionId;
  label: string;
  /** A line under the label in the menu. */
  sub?: string;
  /** In the hover toolbar too. */
  quick: boolean;
  /** Changes something in Hermes (or makes something there): switched off in read-only mode. */
  writes: boolean;
  /** Why it is not available now, when it is not. */
  disabled?: string;
}

/** What is true of a message in its chat: which message it is, and whether Hermes is busy (it refuses to cut or undo its history while a turn runs). */
export interface MessageContext {
  /** The message is the last one Hermes holds (what undo takes away, and what a reply is regenerated for). */
  last: boolean;
  /** A turn is running or being shown. */
  busy: boolean;
  /** The message has an address (its link) and may start a task. */
  link: boolean;
  task: boolean;
  /** The chat is read-only (another process owns the session): nothing that edits its history is offered; Branch is how it is continued. */
  readOnly?: true;
}

export const BUSY_REASON = 'Hermes is writing a reply. Stop it first, or wait for it to finish.';

/**
 * What a message offers the owner. Every message can be copied; a message of the owner's can be edited; the last reply can be regenerated; the last message
 * can be undone; a failed turn offers Retry; any message Hermes holds can be forked from. A message with no row of Hermes's yet (the turn in progress) offers nothing
 * but Copy: Hermes cannot be asked about what it does not hold.
 */
export function messageEntries(message: Pick<ChatMessage, 'id' | 'role' | 'text' | 'failed' | 'activity'>, { last, busy, link, task, readOnly }: MessageContext): MessageEntry[] {
  if (message.activity) return [];
  const held = message.id !== undefined;
  const hold = (entry: Omit<MessageEntry, 'disabled'>): MessageEntry => ({ ...entry, ...(busy ? { disabled: BUSY_REASON } : {}) });
  const entries: MessageEntry[] = [];
  if (message.text.trim() !== '') entries.push({ id: 'copy-text', label: 'Copy text', quick: true, writes: false }, { id: 'copy-markdown', label: 'Copy as Markdown', sub: 'The message as it was written, with its formatting', quick: false, writes: false });
  if (!held) return entries;
  // A reply is read aloud by Hermes's text to speech (M7 #07); it changes nothing in Hermes, so a read-only session offers it too.
  if (message.role === 'assistant' && !message.failed && message.text.trim() !== '') entries.push({ id: 'read-aloud', label: 'Read aloud', sub: 'Speaks the reply with Hermes\'s voice', quick: true, writes: false });
  if (readOnly) {
    if (link) entries.push({ id: 'link', label: 'Copy link', quick: false, writes: false });
    if (task && message.text.trim() !== '') entries.push({ id: 'task', label: 'Make this a task', quick: false, writes: true });
    return entries;
  }
  if (message.role === 'user') entries.push(hold({ id: 'edit', label: 'Edit and resend…', sub: 'Replaces this message and everything after it', quick: true, writes: true }));
  if (message.failed && last) entries.push(hold({ id: 'retry', label: 'Retry', sub: 'Send the message again', quick: true, writes: true }));
  if (message.role === 'assistant' && !message.failed && last && message.text.trim() !== '') entries.push(hold({ id: 'regenerate', label: 'Regenerate…', sub: 'Replaces this reply with a new one', quick: true, writes: true }));
  entries.push(hold({ id: 'fork', label: 'Fork from here', sub: 'A new chat that starts at this message', quick: true, writes: true }));
  if (last) entries.push(hold({ id: 'undo', label: 'Undo last exchange', sub: 'Takes the last message and its reply out of the chat', quick: false, writes: true }));
  if (link) entries.push({ id: 'link', label: 'Copy link', quick: false, writes: false });
  if (task && message.text.trim() !== '') entries.push({ id: 'task', label: 'Make this a task', quick: false, writes: true });
  return entries;
}
