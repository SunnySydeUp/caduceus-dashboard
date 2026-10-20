// Details beside or over the conversation (M8 #09): a column from 1280 px and a panel over the thread's end on a tablet. Escape closes it and gives the keyboard
// back to the button that opened it: in the column while the keyboard is in the panel or on the button, and anywhere while the panel covers the thread. A press outside an overlay closes it too. A phone's
// Details is a sheet (`Chat.tsx`), which has its own layer.
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { openDismissible } from '../../overlays/layers.ts';

/** The clear space between the Details button and the overlay below it. */
const GAP_PX = 8;

export const DETAILS_ID = 'talk-details';
/** What the header's button controls on a phone, where Details is the content of a sheet. */
export const DETAILS_SHEET_ID = 'talk-details-sheet';

export function DetailsPanel({ layout, profile, opener, onClose, children }: { layout: 'column' | 'overlay'; profile: string; /** The button that opens and closes it. */ opener: RefObject<HTMLButtonElement | null>; onClose(): void; children: ReactNode }) {
  const panel = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const covering = layout === 'overlay';

  // Beside the thread, Escape closes it while the keyboard is in the panel or on its button.
  useEffect(() => {
    if (covering) return;
    const escape = (event: KeyboardEvent) => {
      const here = document.activeElement;
      if (event.key !== 'Escape' || event.defaultPrevented || !(here instanceof Node) || !(panel.current?.contains(here) || opener.current?.contains(here))) return;
      event.preventDefault();
      close.current();
      opener.current?.focus();
    };
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [covering, opener]);

  // Over the thread, the panel starts below the header's Details button (which stays in reach to close it), or at the top bar when the page is scrolled past it.
  useEffect(() => {
    if (!covering) return;
    let frame = 0;
    const place = () => {
      frame = 0;
      const bar = document.querySelector('.appbar')?.getBoundingClientRect().bottom ?? 0;
      const below = opener.current?.getBoundingClientRect().bottom ?? 0;
      panel.current?.style.setProperty('inset-block-start', `${Math.max(bar, below + GAP_PX)}px`);
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(place);
    };
    place();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [covering, opener]);

  useEffect(() => {
    if (!covering) return;
    const forget = openDismissible(() => {
      close.current();
      opener.current?.focus();
    });
    const outside = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && (panel.current?.contains(target) || opener.current?.contains(target))) return;
      // A sheet or dialog over the page (a confirmation Take over asks for) is not "outside": it belongs to what the panel opened.
      if (target instanceof Element && target.closest('#overlays')) return;
      close.current();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => {
      forget();
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [covering, opener]);

  return (
    <aside
      ref={panel}
      id={DETAILS_ID}
      className={`talk__panel${covering ? ' talk__panel--over' : ' chat__context'}`}
      aria-label={`Details of ${profile}`}
      tabIndex={-1}
    >
      {children}
    </aside>
  );
}
