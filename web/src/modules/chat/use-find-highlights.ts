// Marks the words a transcript search is for, on the page (M1 #15). The words are marked with the browser's CSS Custom Highlight API: ranges over
// the text that is already drawn, painted by `::highlight(find-all)` and `::highlight(find-current)` (chat.css), so nothing in the React tree
// changes and a message drawn again is marked again. The transcript is virtualised, so only the messages near the screen have text to mark;
// a mutation observer marks what scrolls into view. A browser without the API still counts and steps through the matches.
import { useEffect, useRef, type RefObject } from 'react';
import type { MatchId } from './transcript-tools.ts';

export interface FindView {
  query: string;
  /** The match the reader is on. */
  at: MatchId | undefined;
  /** A new number each time the reader asks to go to `at` (next, previous, typing): the page scrolls to it. */
  nonce: number;
}

const supported = () => typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

/** The ranges of `needle` (any case) in the text of `scope`, in order, leaving out the message toolbars and the cost line. */
function rangesIn(scope: Element, needle: string): Range[] {
  const found: Range[] = [];
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('.msgbar, .chat__stats') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node as Text).data.toLowerCase();
    for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
      const range = new Range();
      range.setStart(node, at);
      range.setEnd(node, at + needle.length);
      found.push(range);
    }
  }
  return found;
}

/** The part of the page the reader can read: below the app bar and the find bar, above the composer. */
export interface ReadableBand {
  top(): number;
  bottom(): number;
}

/** Marks every match in `root` and the current one, and scrolls to the current one when `find.nonce` says so (as soon as its message is drawn). */
export function useFindHighlights(root: RefObject<HTMLElement | null>, find: FindView | undefined, band: ReadableBand): void {
  const latest = useRef({ find, band });
  latest.current = { find, band };
  const scrolled = useRef(0);

  useEffect(() => {
    const list = root.current;
    const needle = find?.query.trim().toLowerCase() ?? '';
    if (!list || !supported() || needle === '') {
      if (supported()) {
        CSS.highlights.delete('find-all');
        CSS.highlights.delete('find-current');
      }
      return;
    }
    let frame = 0;
    const apply = () => {
      frame = 0;
      const { find: wanted, band: readable } = latest.current;
      const all = rangesIn(list, needle);
      CSS.highlights.set('find-all', new Highlight(...all));
      const id = wanted?.at;
      const item = id === undefined ? null : [...list.children].find((child) => (child as HTMLElement).dataset.key === id.itemKey);
      const scope = item && id?.cardKey !== undefined ? [...item.querySelectorAll('[data-card]')].find((card) => (card as HTMLElement).dataset.card === id.cardKey) : item;
      const current = scope && id ? rangesIn(scope, needle)[id.occurrence] : undefined;
      if (current) CSS.highlights.set('find-current', new Highlight(current));
      else CSS.highlights.delete('find-current');
      // Scroll once for each request, as soon as the match's text is on the page.
      if (current && wanted && scrolled.current !== wanted.nonce) {
        scrolled.current = wanted.nonce;
        const rect = current.getBoundingClientRect();
        const [top, bottom] = [readable.top(), readable.bottom()];
        if (rect.top < top || rect.bottom > bottom) window.scrollBy({ top: rect.top - top - (bottom - top) / 3, behavior: 'instant' });
      }
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(apply);
    };
    schedule();
    const watch = new MutationObserver(schedule);
    watch.observe(list, { childList: true, subtree: true, characterData: true });
    return () => {
      watch.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [root, find?.query, find?.at?.itemKey, find?.at?.cardKey, find?.at?.occurrence, find?.nonce]);

  useEffect(
    () => () => {
      if (supported()) {
        CSS.highlights.delete('find-all');
        CSS.highlights.delete('find-current');
      }
    },
    [],
  );
}
