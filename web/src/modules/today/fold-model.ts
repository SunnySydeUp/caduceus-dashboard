// What Needs you lists while answers go and cards fold away. The Inbox's stream is the truth about what waits, and it says the whole list on every change, so it can drop an item at
// any moment: before the answer's own reply has come back, or while the card is still confirming. The card must not vanish then: it stays where it stood until it has folded into
// its agent. And once it has folded, it stays gone even though the stream still lists it for a moment. Pure: no DOM and no React.
import type { InboxItem } from '@caduceus/contracts/inbox';

/** A card whose answer is on its way, or has gone and is confirming, and which has not folded away yet; `at` is the place it had in the list. */
export interface HeldCard {
  item: InboxItem;
  at: number;
}

/**
 * The decisions to draw: what the stream lists, less the cards that have folded away, plus the held cards the stream no longer lists, each back in the place it had.
 * Where the stream lists a held card still, its own, newer, copy is drawn.
 */
export function shownDecisions(live: readonly InboxItem[], held: ReadonlyMap<string, HeldCard>, folded: ReadonlySet<string>): InboxItem[] {
  const shown = live.filter((item) => !folded.has(item.id));
  const dropped = [...held.values()].filter(({ item }) => !folded.has(item.id) && !live.some((listed) => listed.id === item.id)).sort((a, b) => a.at - b.at);
  // In order of their places, each place counts what was put back before it.
  for (const { item, at } of dropped) shown.splice(Math.min(at, shown.length), 0, item);
  return shown;
}

/**
 * The folded cards the stream still lists. Once it has dropped one there is nothing left to hide, and the same id coming back (Hermes asking again) is a new question that must show.
 * It is the same set when nothing was dropped, so that keeping it in state does not render again.
 */
export function stillListed(folded: ReadonlySet<string>, live: readonly InboxItem[]): ReadonlySet<string> {
  const kept = [...folded].filter((id) => live.some((item) => item.id === id));
  return kept.length === folded.size ? folded : new Set(kept);
}
