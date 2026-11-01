import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { updateShellPrefs, useShellPrefs } from './shell-prefs.ts';

/** Under this window height the rail draws icons only (`shell.css`, "A rail on a short window"); keep the two in step. */
const SHORT_WINDOW_QUERY = '(max-height: 36rem)';

/** The gap between a rail item and the label tag beside it. */
const TAG_GAP_PX = 8;
/** How long a finger rests on a rail item before its tag shows instead of the page opening. */
const LONG_PRESS_MS = 500;
/** How far a finger may drift while it rests before it counts as a scroll. */
const PRESS_SLOP_PX = 10;
/** How long a long-press tag stays, and the first-time tags of a device. */
const PRESS_TAG_MS = 2500;
const FIRST_HINT_MS = 3000;

/** What the rail draws as an item: the places, the crew, Search, Help, Control and the scope. */
const ITEM = '.rail__item, .scope--rail';

interface Tag {
  text: string;
  top: number;
  start: number;
}

function subscribeToHeight(notify: () => void) {
  const query = matchMedia(SHORT_WINDOW_QUERY);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
}

/** Whether the window is short enough that the rail draws icons only. It follows the window as it is resized. */
function useShortWindow(): boolean {
  return useSyncExternalStore(subscribeToHeight, () => matchMedia(SHORT_WINDOW_QUERY).matches);
}

/** The rail item an event came from. */
function itemOf(target: EventTarget): HTMLElement | undefined {
  return target instanceof Element ? (target.closest<HTMLElement>(ITEM) ?? undefined) : undefined;
}

/** Where an item's tag goes: beside it, centred on it. The name is `data-tag` when an item has a longer one than its label. */
function tagOf(item: HTMLElement): Tag | undefined {
  const text = item.dataset.tag ?? item.querySelector('.nav-label, .scope__name')?.textContent;
  if (!text) return undefined;
  const box = item.getBoundingClientRect();
  const rtl = getComputedStyle(item).direction === 'rtl';
  return { text, top: box.top + box.height / 2, start: rtl ? document.documentElement.clientWidth - box.left + TAG_GAP_PX : box.right + TAG_GAP_PX };
}

/**
 * The names of the rail's items as visible tags beside them, for a window short enough that the rail draws icons only. One mechanism for every item (the places, the
 * crew, Search, Help, Control and the scope): a mouse over the item, the keyboard on it, a finger resting on it for half a second (the page does not open then), and
 * and, the first time a device shows the compact rail, every name for three seconds inside the rail's own column (`hinting`: the icons give way to their names, so nothing
 * lands on the page's text). The name stays the item's name for a screen reader. The tags are drawn in the overlay
 * root, because the rail scrolls and would cut them off.
 */
export function useRailTags() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [hinting, setHinting] = useState(false);
  const short = useShortWindow();
  const { railTagsSeen } = useShellPrefs();
  const rail = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const pressTimer = useRef<number | undefined>(undefined);
  const press = useRef<{ item: HTMLElement; x: number; y: number; fired: boolean } | undefined>(undefined);

  const hide = () => {
    clearTimeout(hideTimer.current);
    setTags([]);
    setHinting(false);
  };
  const show = (items: HTMLElement[], forMs?: number) => {
    clearTimeout(hideTimer.current);
    setTags(items.flatMap((item) => tagOf(item) ?? []));
    if (forMs !== undefined) hideTimer.current = window.setTimeout(() => setTags([]), forMs);
  };

  useEffect(() => {
    if (!short || railTagsSeen || !rail.current) return;
    updateShellPrefs({ railTagsSeen: true });
    setHinting(true);
    hideTimer.current = window.setTimeout(() => setHinting(false), FIRST_HINT_MS);
  }, [short, railTagsSeen]);
  useEffect(() => {
    if (!short) hide();
  }, [short]);
  useEffect(
    () => () => {
      clearTimeout(hideTimer.current);
      clearTimeout(pressTimer.current);
    },
    [],
  );

  const handlers = {
    onPointerOver(event: PointerEvent<HTMLElement>) {
      const item = itemOf(event.target);
      if (short && item && event.pointerType !== 'touch') show([item]);
    },
    onPointerOut(event: PointerEvent<HTMLElement>) {
      if (event.pointerType !== 'touch') hide();
    },
    onFocus(event: SyntheticEvent<HTMLElement>) {
      const item = itemOf(event.target);
      if (short && item?.matches(':focus-visible')) show([item]);
    },
    onBlur: hide,
    onPointerDown(event: PointerEvent<HTMLElement>) {
      hide();
      const item = itemOf(event.target);
      press.current = undefined;
      if (!short || !item || event.pointerType !== 'touch') return;
      const resting = { item, x: event.clientX, y: event.clientY, fired: false };
      press.current = resting;
      pressTimer.current = window.setTimeout(() => {
        resting.fired = true;
        show([item], PRESS_TAG_MS);
      }, LONG_PRESS_MS);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const resting = press.current;
      if (resting && !resting.fired && Math.hypot(event.clientX - resting.x, event.clientY - resting.y) > PRESS_SLOP_PX) clearTimeout(pressTimer.current);
    },
    onPointerUp: () => clearTimeout(pressTimer.current),
    onPointerCancel: () => clearTimeout(pressTimer.current),
    // The tap that ends a long press must not open the page; a touch screen's context menu would cover the tag.
    onClickCapture(event: SyntheticEvent<HTMLElement>) {
      if (press.current?.fired) {
        event.preventDefault();
        event.stopPropagation();
      } else if (itemOf(event.target)?.matches('[aria-haspopup]')) hide();
      press.current = undefined;
    },
    onContextMenu(event: SyntheticEvent<HTMLElement>) {
      if (press.current) event.preventDefault();
    },
  };
  const label = createPortal(
    tags.map((tag) => (
      <span key={tag.text} className="tooltip rail-tag" aria-hidden="true" style={{ insetBlockStart: tag.top, insetInlineStart: tag.start }}>
        {tag.text}
      </span>
    )),
    document.getElementById('overlays')!,
  );
  return { rail, handlers, hide, label, hinting };
}
