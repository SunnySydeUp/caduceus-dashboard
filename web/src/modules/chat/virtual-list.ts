// The maths of the virtualised, end-anchored transcript (M1 #04): pure, in pixels. The screen measures what is on show and feeds
// the heights in; everything else (which messages to put in the DOM, whether to follow the reply, where to put the page again after
// older messages were added above) is decided here, so that it is checked without a browser.

/** Within this many pixels of the end the reader counts as being at the end. */
export const FOLLOW_THRESHOLD = 80;

export interface Layout {
  /** `offsets[i]` is where item `i` starts; every item is followed by `gap`, so the last entry is the total height. */
  offsets: number[];
  total: number;
}

/** The layout of items whose heights are `heights` (undefined: not measured yet, `estimate` stands in), `gap` apart. */
export function layoutOf(heights: readonly (number | undefined)[], estimate: number, gap: number): Layout {
  const offsets = [0];
  for (const height of heights) offsets.push(offsets.at(-1)! + (height ?? estimate) + gap);
  return { offsets, total: offsets.at(-1)! };
}

export interface VisibleWindow {
  /** First item to render. */
  start: number;
  /** One past the last item to render. */
  end: number;
  /** Height standing in for the items before `start` and after `end`. */
  before: number;
  after: number;
}

/** The index of the item that holds `position`: the last one that starts at or before it. */
function itemAt(offsets: readonly number[], count: number, position: number): number {
  let low = 0;
  let high = count - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (offsets[middle]! <= position) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** Which items are in the DOM for a viewport of `viewport` pixels at `scrollTop`, with `overscan` extra items either side. */
export function visibleWindow({ layout, scrollTop, viewport, overscan }: { layout: Layout; scrollTop: number; viewport: number; overscan: number }): VisibleWindow {
  const count = layout.offsets.length - 1;
  if (count === 0) return { start: 0, end: 0, before: 0, after: 0 };
  const top = Math.max(0, Math.min(scrollTop, layout.total));
  const first = itemAt(layout.offsets, count, top);
  const last = itemAt(layout.offsets, count, Math.min(Math.max(top, top + viewport - 1), layout.total - 1));
  const start = Math.max(0, first - overscan);
  const end = Math.min(count, last + 1 + overscan);
  return { start, end, before: layout.offsets[start]!, after: layout.total - layout.offsets[end]! };
}

export interface FollowState {
  /** The page follows the reply as it grows. */
  following: boolean;
  /** Where the page was scrolled to last time, to tell the reader scrolling up from the page growing. A scroll the page makes itself must set it, or the next scroll reads as the reader moving up. */
  lastTop: number;
}

export const distanceFromEnd = ({ scrollTop, viewport, total }: { scrollTop: number; viewport: number; total: number }) => Math.max(0, total - viewport - scrollTop);

/**
 * What a scroll does to following: any move up by the reader stops it, even inside the threshold (a touch or trackpad scroll moves a few
 * pixels a frame, so a threshold check alone would pull the page back down at every step); being on the end (a bounce past it settles
 * there) or moving down into the threshold resumes it; and the page merely growing changes nothing.
 */
export function scrolled(state: FollowState, now: { scrollTop: number; viewport: number; total: number }): FollowState {
  const distance = distanceFromEnd(now);
  if (distance <= 1) return { following: true, lastTop: now.scrollTop };
  if (now.scrollTop < state.lastTop - 1) return { following: false, lastTop: now.scrollTop };
  return { following: state.following || distance <= FOLLOW_THRESHOLD, lastTop: now.scrollTop };
}

/** Jump to latest: follow again, from the last screen. */
export function jumpToLatest({ total, viewport }: { total: number; viewport: number }): FollowState {
  return { following: true, lastTop: Math.max(0, total - viewport) };
}

export interface Anchor {
  key: string;
  /** How far the top of the screen was below the start of the item. */
  delta: number;
}

/** Remembers which item is at the top of the screen, before the list changes above it. */
export function captureAnchor({ keys, layout, scrollTop }: { keys: readonly string[]; layout: Layout; scrollTop: number }): Anchor | undefined {
  if (keys.length === 0) return undefined;
  const index = itemAt(layout.offsets, keys.length, scrollTop);
  return { key: keys[index]!, delta: scrollTop - layout.offsets[index]! };
}

/** Where to scroll so that the anchored item is where it was on screen; undefined when it is no longer in the list. */
export function restoreAnchor(anchor: Anchor, keys: readonly string[], layout: Layout): number | undefined {
  const index = keys.indexOf(anchor.key);
  return index < 0 ? undefined : layout.offsets[index]! + anchor.delta;
}
