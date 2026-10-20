// The transcript's own tools (M1 #15): which roles are shown, search inside the transcript, and the transcript as text. No DOM and no React;
// they read what the transcript draws, `{ key, message }` items, so what they count and copy is what is on screen.
import type { ActivityItem } from './activity.ts';
import type { ChatMessage } from './chat-session.ts';
import { splitAttachments } from './message-attachments.ts';
import { plainText } from './message-actions.ts';

/** What can be shown or hidden. A subagent is a tool call that delegates, so it follows `tool`. */
export type Role = 'user' | 'assistant' | 'tool' | 'reasoning';
export type RoleSet = Readonly<Record<Role, boolean>>;
export const ROLES: readonly Role[] = ['user', 'assistant', 'tool', 'reasoning'];
export const ALL_ROLES: RoleSet = { user: true, assistant: true, tool: true, reasoning: true };

export interface TranscriptEntry {
  key: string;
  message: ChatMessage;
}

const cardRole = (card: ActivityItem): Role => (card.kind === 'reasoning' ? 'reasoning' : 'tool');

/** The entries the filters leave: a run of cards keeps the cards whose role is on, and goes when none is. */
export function filterItems<T extends TranscriptEntry>(items: readonly T[], roles: RoleSet): T[] {
  return items.flatMap((entry) => {
    const { message } = entry;
    if (!message.activity) return roles[message.role] ? [entry] : [];
    const cards = message.activity.filter((card) => roles[cardRole(card)]);
    if (cards.length === 0) return [];
    return cards.length === message.activity.length ? [entry] : [{ ...entry, message: { ...message, activity: cards } }];
  });
}

// ── Search inside the transcript ─────────────────────────────────────────────────────────────

/** A piece of the transcript that is searched: a message, or one card of a run of cards. */
export interface FindUnit {
  /** The transcript item it is in: what a jump scrolls to. */
  itemKey: string;
  /** The card, for a unit inside a run of cards: a card that holds a match opens. */
  cardKey?: string;
  role: Role;
  /** The words as shown, with no Markdown marks. */
  text: string;
}

const lines = (...parts: (string | undefined)[]) => parts.filter((part): part is string => part !== undefined && part !== '').join('\n');

/** What a card says, as searchable words. */
function cardText(card: ActivityItem): string {
  if (card.kind === 'reasoning') return card.text;
  if (card.kind === 'subagent') return lines(card.goal, card.summary, card.note);
  return lines(card.name, card.context, card.args && Object.keys(card.args).length > 0 ? JSON.stringify(card.args, null, 2) : undefined, card.error, card.diff, card.output ?? card.summary);
}

/** The searchable pieces of the entries, in the order they are drawn. */
export function findUnits(items: readonly TranscriptEntry[]): FindUnit[] {
  return items.flatMap(({ key, message }): FindUnit[] => {
    if (message.activity) return message.activity.map((card) => ({ itemKey: key, cardKey: card.key, role: cardRole(card), text: cardText(card) }));
    const text = message.failed ? message.failed.error : plainText(message.role === 'user' ? splitAttachments(message.text).body : message.text);
    return [{ itemKey: key, role: message.role, text }];
  });
}

export interface FindMatch {
  /** Index in the units. */
  unit: number;
  /** Which occurrence in that unit (0 is the first). */
  occurrence: number;
}

/** Every occurrence of `query` (one phrase, any case) in the units. */
export function findMatches(units: readonly FindUnit[], query: string): FindMatch[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [];
  return units.flatMap((unit, index) => {
    const hay = unit.text.toLowerCase();
    const found: FindMatch[] = [];
    for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) found.push({ unit: index, occurrence: found.length });
    return found;
  });
}

/** The match after (1) or before (-1) the current one, going round; the first or the last when there is no current one. */
export function stepMatch(current: number | undefined, count: number, direction: 1 | -1): number | undefined {
  if (count === 0) return undefined;
  if (current === undefined) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}

// ── The transcript as text ───────────────────────────────────────────────────────────────────

export type CopyFormat = 'markdown' | 'plain';

/** The whole of what the filters leave, for Copy: Markdown (each message as written, under a heading for who said it) or plain words. */
export function transcriptText(items: readonly TranscriptEntry[], roles: RoleSet, format: CopyFormat, names: { user: string; assistant: string }): string {
  const markdown = format === 'markdown';
  return filterItems(items, roles)
    .flatMap(({ message }): string[] => {
      if (!message.activity) {
        const body = message.failed ? message.failed.error : message.role === 'user' ? splitAttachments(message.text).body : message.text;
        const who = names[message.role];
        return markdown ? [`### ${who}`, body] : [`${who}: ${plainText(body)}`];
      }
      return message.activity.flatMap((card): string[] => {
        if (card.kind === 'reasoning') return markdown ? ['#### Reasoning', card.text] : [`Reasoning: ${card.text}`];
        if (card.kind === 'subagent') {
          const said = lines(card.summary, card.note);
          return markdown ? [`#### Subagent: ${card.goal}`, ...(said === '' ? [] : [said])] : [`Subagent: ${card.goal}${said === '' ? '' : `: ${said}`}`];
        }
        const result = card.error ?? card.output ?? card.summary;
        const label = `${card.name}${card.context ? ` (${card.context})` : ''}`;
        return markdown ? [`#### Tool: ${label}`, ...(result === undefined ? [] : [`\`\`\`\n${result}\n\`\`\``])] : [`Tool ${label}${result === undefined ? '' : `: ${result}`}`];
      });
    })
    .join('\n\n');
}

// ── Keeping the place among the matches ──────────────────────────────────────────────────────

/** A match named by where it is: what stays true when older messages load above it. */
export interface MatchId {
  itemKey: string;
  cardKey?: string;
  occurrence: number;
}

export function matchId(units: readonly FindUnit[], match: FindMatch): MatchId {
  const { itemKey, cardKey } = units[match.unit]!;
  return { itemKey, ...(cardKey === undefined ? {} : { cardKey }), occurrence: match.occurrence };
}

/** Where the named match is among the matches now; undefined when it is not there (the query or the filters changed). */
export function indexOfMatch(units: readonly FindUnit[], matches: readonly FindMatch[], id: MatchId | undefined): number | undefined {
  if (id === undefined) return undefined;
  const at = matches.findIndex((match) => {
    const unit = units[match.unit]!;
    return unit.itemKey === id.itemKey && unit.cardKey === id.cardKey && match.occurrence === id.occurrence;
  });
  return at < 0 ? undefined : at;
}

/** The first match in the item `itemKey` or after it, in the order the items are drawn; the first match when `itemKey` is not among them. */
export function firstAtOrAfter(units: readonly FindUnit[], matches: readonly FindMatch[], items: readonly TranscriptEntry[], itemKey: string | undefined): number {
  const from = itemKey === undefined ? -1 : items.findIndex((entry) => entry.key === itemKey);
  if (from < 0) return 0;
  const order = new Map(items.map((entry, index) => [entry.key, index]));
  const at = matches.findIndex((match) => (order.get(units[match.unit]!.itemKey) ?? -1) >= from);
  return at < 0 ? 0 : at;
}

// ── The filters, in words ────────────────────────────────────────────────────────────────────

/** What a screen reader hears when a role filter changes. */
export function rolesAnnouncement(roles: RoleSet, assistantName: string): string {
  const label: Record<Role, string> = { user: 'your messages', assistant: `${assistantName}’s replies`, tool: 'tool calls', reasoning: 'reasoning' };
  const list = (on: boolean) => ROLES.filter((role) => roles[role] === on).map((role) => label[role]);
  const words = (parts: string[]) => (parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`);
  const shown = list(true);
  const hidden = list(false);
  if (hidden.length === 0) return 'Showing everything.';
  if (shown.length === 0) return 'Everything is hidden.';
  return `Showing ${words(shown)}. Hiding ${words(hidden)}.`;
}
