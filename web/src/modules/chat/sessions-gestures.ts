// The pure rules behind bulk select and the phone gestures of the sessions list (M1 #14): which rows a click or a shift-click selects, and what a
// finger on a row means (a swipe to archive or pin, a long press for the row menu). No DOM and no React: the screen only feeds it coordinates.

/** The rows that are selected, in the order they were selected, and the one a shift-click extends from. */
export interface Selection {
  ids: readonly string[];
  anchor: string | undefined;
}

export const EMPTY_SELECTION: Selection = { ids: [], anchor: undefined };

/** A click on a row: selected rows become unselected and the other way round. The row clicked is where a shift-click then extends from. */
export function toggle({ ids }: Selection, id: string): Selection {
  return { ids: ids.includes(id) ? ids.filter((candidate) => candidate !== id) : [...ids, id], anchor: id };
}

/**
 * A shift-click: every row from the anchor to the row clicked, in the list's order (`order`), joins the selection, which keeps what it had. The anchor
 * stays, so that the next shift-click extends from the same place. With no anchor in the list it is a click.
 */
export function selectRange(selection: Selection, order: readonly string[], to: string): Selection {
  const from = selection.anchor === undefined ? -1 : order.indexOf(selection.anchor);
  const target = order.indexOf(to);
  if (from < 0 || target < 0) return toggle(selection, to);
  const step = target >= from ? 1 : -1;
  const ids = [...selection.ids];
  for (let at = from; at !== target + step; at += step) if (!ids.includes(order[at]!)) ids.push(order[at]!);
  return { ids, anchor: selection.anchor };
}

export const selectAll = (order: readonly string[]): Selection => ({ ids: order, anchor: undefined });

/** The selection without the rows the list no longer has (a session was deleted, or the filters changed under it). The same object when nothing left. */
export function keepPresent(selection: Selection, order: readonly string[]): Selection {
  const present = new Set(order);
  const ids = selection.ids.filter((id) => present.has(id));
  const anchor = selection.anchor !== undefined && present.has(selection.anchor) ? selection.anchor : undefined;
  return ids.length === selection.ids.length && anchor === selection.anchor ? selection : { ids, anchor };
}

export interface Finger {
  startX: number;
  startY: number;
  x: number;
  y: number;
}

/** How far a finger goes (px) before it is clear whether it swipes or scrolls. */
const INTENT_LOCK = 10;
/** How far (px) the row has to be pulled sideways, and how far it can show. */
export const SWIPE_COMMIT = 96;
export const SWIPE_MAX = 128;
/** How long a press has to be held (ms) for the row menu, and how far (px) the finger may stray meanwhile. */
export const LONG_PRESS_MS = 500;
export const LONG_PRESS_SLOP = 8;

/** Whether a finger is swiping the row sideways or scrolling the list. Neither until it has gone a few pixels; a movement that is not clearly sideways scrolls. */
export function swipeIntent({ startX, startY, x, y }: Finger): 'horizontal' | 'vertical' | undefined {
  const dx = Math.abs(x - startX);
  const dy = Math.abs(y - startY);
  if (Math.max(dx, dy) < INTENT_LOCK) return undefined;
  return dx > dy * 1.5 ? 'horizontal' : 'vertical';
}

/** Where the row is drawn for a finger that has moved `dx` sideways: with it up to the commit distance, then half as fast, and never past `SWIPE_MAX`. */
export function swipeOffset(dx: number): number {
  const distance = Math.abs(dx);
  const shown = distance <= SWIPE_COMMIT ? distance : SWIPE_COMMIT + (distance - SWIPE_COMMIT) / 2;
  return Math.sign(dx) * Math.min(SWIPE_MAX, shown);
}

/** What letting go after `dx` does: right of the commit distance archives, left of it pins, short of it nothing. Only changes Hermes can take back are on a swipe. */
export function swipeAction(dx: number): 'archive' | 'pin' | undefined {
  if (dx >= SWIPE_COMMIT) return 'archive';
  if (dx <= -SWIPE_COMMIT) return 'pin';
  return undefined;
}

/** The finger has strayed too far for this to be a long press. */
export const pressMoved = ({ startX, startY, x, y }: Finger): boolean => Math.hypot(x - startX, y - startY) > LONG_PRESS_SLOP;
