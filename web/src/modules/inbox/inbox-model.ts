// The Inbox's pure part (M2 #01): which items a profile chip shows, what a card says and how a question's answer is put to Hermes. No DOM and no React. The items themselves are derived by the Caduceus server (`server/src/inbox.ts`).
import type { ActivityEvent, InboxAction, InboxClarify, InboxItem } from '@caduceus/contracts/inbox';
import { clipWords } from '@caduceus/contracts/clip-words';

/**
 * The items a profile scope shows: every item for `all` (and while the scope is not known yet), else the profile's own. An item whose profile
 * Caduceus could not tell is shown in every scope: a decision is never hidden by a filter.
 */
export function inScope(items: readonly InboxItem[], scope: string | undefined): InboxItem[] {
  if (scope === undefined || scope === 'all') return [...items];
  return items.filter((item) => item.profile === undefined || item.profile === scope);
}

/** The text equivalent of the badge: what the number counts. */
export function badgeLabel(count: number): string {
  return count === 1 ? '1 item needs a decision' : `${count} items need a decision`;
}

/** The one line a card shows of what it is about: an approval's command, a question's first question. */
export function previewOf(item: InboxItem): string {
  if (item.kind === 'notice') return item.detail ?? item.title;
  if (item.kind === 'approval') return item.command || item.description || 'A tool wants to run';
  const [first] = item.questions;
  const rest = item.questions.length - 1;
  return `${first?.question ?? 'A question'}${rest > 0 ? ` (and ${rest} more)` : ''}`;
}

/** How long ago an item first appeared, in words that need no clock beside them. */
export function ageWords(at: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

/** The `result` Hermes takes for a question: `{answers}` by question id. Hermes reads a result without `answers` as cancel-all, so a single question is answered this way too. */
export type ClarifyResult = { answers: Record<string, string> };

/**
 * The `result` Hermes takes for a question, by question id. What the owner typed wins over
 * what they picked; a multiple-choice pick is a JSON list, as Hermes reads it; nothing given is `''`, which skips the question.
 */
export function clarifyAnswer(item: InboxClarify, picked: Readonly<Record<string, readonly string[]>>, typed: Readonly<Record<string, string>>): ClarifyResult {
  const text = (qid: string, multiSelect: boolean): string => {
    const written = typed[qid]?.trim();
    if (written) return written;
    const picks = picked[qid] ?? [];
    if (multiSelect) return picks.length === 0 ? '' : JSON.stringify(picks);
    return picks[0] ?? '';
  };
  return { answers: Object.fromEntries(item.questions.map((question) => [question.qid, text(question.qid, question.multiSelect)])) };
}

/** The events of the feed newer than the last one a page has already heard of: what is worth a toast. */
export function newActivity(events: readonly ActivityEvent[], heard: number): ActivityEvent[] {
  return events.filter((event) => event.seq > heard);
}

/** How much of the owner's own words the confirmation says back. */
const SAID_BACK_MAX = 240;

/** What the words an action asked for are called when they are said back. */
const WORDS_NAME: Record<string, string> = { note: 'Your note', answer: 'Your answer', profile: 'Give it to' };

/**
 * The confirmation of an action, once the owner has written the words it asked for: it says them back, so the step that confirms shows what is about to be sent.
 * An action with no words of its own to say keeps the confirmation its source gave it, or a plain question.
 */
export function confirmWithWords(action: InboxAction, typed: string | undefined): NonNullable<InboxAction['confirm']> {
  const base = action.confirm ?? { title: `${action.label}?` };
  if (!action.input || typed === undefined || typed.trim() === '') return base;
  const said = `${WORDS_NAME[action.input.field] ?? 'You wrote'}: \u201c${clipWords(typed.trim(), SAID_BACK_MAX)}\u201d.`;
  return { ...base, text: base.text ? `${said} ${base.text}` : said };
}

/** What a screen tells the owner once an action on a notice has gone: what it did and, where there is something to say, what happens next. */
export function doneWords(action: InboxAction, profile: string | undefined): { message: string; detail?: string } {
  const to = profile === undefined ? '' : ` to ${profile}`;
  switch (action.id) {
    case 'answer':
      return { message: `Answer sent${to}`, detail: 'The task is back in work.' };
    case 'approve':
      return { message: 'Approved', detail: action.request.path.includes('/pairing/') ? 'They can now talk to the bot.' : 'The task is done.' };
    case 'reject':
      return { message: `Sent back${to}`, detail: 'It is back in work, with your note.' };
    case 'retry':
      return { message: 'Retrying', detail: 'A worker picks it up again.' };
    case 'acknowledge':
      return { message: 'Acknowledged', detail: 'The task is marked done.' };
    case 'reassign':
      return { message: 'Reassigned', detail: 'The new profile picks it up.' };
    case 'decline':
      return { message: 'Declined', detail: 'The request is cleared. They can ask again.' };
    default:
      return { message: `${action.label}: sent` };
  }
}
