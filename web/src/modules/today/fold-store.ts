// The cards of Needs you that are answering or have folded away, kept for the whole page and not for the screen that lists them: leaving Today and coming back while the
// Inbox's stream still lists an answered card must not draw it again with live buttons. What the lists mean is in `fold-model.ts`.
import { useEffect, useSyncExternalStore } from 'react';
import type { InboxItem } from '@caduceus/contracts/inbox';
import { mapBlock, type Block } from '../../use-block.ts';
import { type HeldCard, shownDecisions, stillListed } from './fold-model.ts';

interface FoldState {
  held: ReadonlyMap<string, HeldCard>;
  folded: ReadonlySet<string>;
}

let state: FoldState = { held: new Map(), folded: new Set() };
const listeners = new Set<() => void>();

function change(next: FoldState) {
  if (next.held === state.held && next.folded === state.folded) return;
  state = next;
  for (const listener of [...listeners]) listener();
}

export const foldState = () => state;

/** An answer to `item` is on its way: the card stays at place `at` of the list, whatever the stream says meanwhile. */
export function holdCard(item: InboxItem, at: number) {
  change({ ...state, held: new Map(state.held).set(item.id, { item, at }) });
}

/** The answer came back without going (it failed, or was declined): the card is the stream's again. */
export function releaseCard(id: string) {
  if (!state.held.has(id)) return;
  change({ ...state, held: new Map([...state.held].filter(([held]) => held !== id)) });
}

/** The card has folded away (or its screen was left before it could): it is no longer held, and stays hidden for as long as the stream lists it. */
export function foldAway(id: string) {
  change({ held: new Map([...state.held].filter(([held]) => held !== id)), folded: new Set(state.folded).add(id) });
}

/** Forgets the folded cards the stream no longer lists, so that the same id asked again shows. */
export function pruneFolded(live: readonly InboxItem[]) {
  const kept = stillListed(state.folded, live);
  if (kept !== state.folded) change({ ...state, folded: kept });
}

/** The decisions to draw, as a block: the stream's list with the held cards kept in place and the folded ones left out. The pill and the title both count this list. */
export function useVisibleDecisions(block: Block<InboxItem[]>): Block<InboxItem[]> {
  const { held, folded } = useSyncExternalStore((listener) => (listeners.add(listener), () => void listeners.delete(listener)), foldState);
  const live = block.state.status === 'ready' ? block.state.data : undefined;
  useEffect(() => {
    if (live) pruneFolded(live);
  }, [live, folded]);
  return mapBlock(block, (items) => shownDecisions(items, held, folded));
}
