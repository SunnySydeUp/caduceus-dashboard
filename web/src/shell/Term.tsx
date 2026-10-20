import { useEffect, useId, useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { openDismissible } from '../overlays/layers.ts';
import { placePopover } from '../popover-placement.ts';
import { useHelp } from './help-context.tsx';
import { useHelpLoaded, useRegistry } from './registry-context.tsx';

/**
 * A glossary term in the UI (M1 #02). It reads as text with a dotted underline. Tapping it, or moving keyboard focus to it, opens a
 * short definition with a "More" link to the term's help page; Escape, a tap elsewhere, scrolling or moving on closes it. Focus
 * stays on the term, so reading is never interrupted: the definition is announced through the page's one polite live region, and
 * is the next thing in the tab order for whoever wants More. Name the term with a string (`<Term id="risk-tiers">`): a test checks
 * every one against the glossary the modules registered.
 *
 * The term is a `role="button"` span, not a `<button>`: a button is always an inline block, which would cut the line of text
 * around it, while a span wraps with the words beside it.
 */
export function Term({ id, children }: { id: string; children?: ReactNode }) {
  const registry = useRegistry();
  // The glossary loads the first time a term is wanted, not with the first paint (it is about 100 KB the first screen can do without):
  // a term is a button from the start, and its pop-up waits for the glossary. Once loaded, a name it does not know is plain text.
  const loaded = useHelpLoaded();
  const term = registry.glossary().find((candidate) => candidate.id === id);
  const { openHelp } = useHelp();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLSpanElement>(null);
  const popup = useRef<HTMLSpanElement>(null);
  /** A pointer is down inside the term: focus moving off the term must not close the pop-up before the click on More lands (Safari does not focus buttons). */
  const pressing = useRef(false);
  /** The term is being given focus back by this component itself, which is not a reason to open it. */
  const refocusing = useRef(false);
  const popupId = useId();

  // Beside the term, inside the viewport, in the top layer (so no scroll container or transform clips it).
  useLayoutEffect(() => {
    const element = popup.current;
    if (!open || !element || !trigger.current) return;
    if (typeof element.showPopover === 'function') element.showPopover();
    const rtl = getComputedStyle(trigger.current).direction === 'rtl';
    const at = placePopover({
      anchor: trigger.current.getBoundingClientRect(),
      size: { width: element.offsetWidth, height: element.offsetHeight },
      viewport: { width: document.documentElement.clientWidth, height: window.innerHeight },
      rtl,
    });
    element.style.insetInlineStart = `${at.inlineStart}px`;
    element.style.insetBlockStart = `${at.blockStart}px`;
  }, [open, term]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const outside = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) close();
    };
    const forgetEscape = openDismissible(close);
    document.addEventListener('pointerdown', outside, true);
    // The term would move away from its pop-up, and the pop-up cannot follow a scroll inside a panel.
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      forgetEscape();
      pressing.current = false;
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open]);

  if (loaded && !term) return <>{children ?? id}</>;

  const show = () => {
    void registry.loadHelp();
    setOpen(true);
  };
  const onFocus = (event: FocusEvent<HTMLSpanElement>) => {
    // Keyboard focus only: a pointer press focuses the term too, and the click that follows would close what the focus opened.
    if (!refocusing.current && event.currentTarget.matches(':focus-visible')) show();
  };
  const onBlur = (event: FocusEvent<HTMLSpanElement>) => {
    if (!pressing.current && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    // Enter or Space on a term that focus already opened keeps it open: Escape or Tab closes it.
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    show();
  };
  const more = () => {
    // The help panel hands focus back to whatever had it when it opened, so that is to be the term, not the button that is about to go.
    refocusing.current = true;
    trigger.current?.focus({ preventScroll: true });
    refocusing.current = false;
    setOpen(false);
    openHelp({ term: id });
  };

  return (
    <span ref={wrap} className="term-wrap" onBlur={onBlur} onPointerDown={() => (pressing.current = true)} onPointerUp={() => (pressing.current = false)} onPointerCancel={() => (pressing.current = false)}>
      <span ref={trigger} role="button" tabIndex={0} className="term" aria-expanded={open} aria-controls={open ? popupId : undefined} onFocus={onFocus} onClick={() => (open ? setOpen(false) : show())} onKeyDown={onKeyDown}>
        {children ?? term?.term ?? id}
      </span>
      {open && term && (
        <>
          <span ref={popup} id={popupId} className="term-pop" role="group" aria-label={term.term} popover="manual">
            <strong className="term-pop__term">{term.term}</strong>
            <span className="term-pop__text">{term.definition}</span>
            <button type="button" className="btn btn--secondary btn--sm term-pop__more" onClick={more}>
              More
            </button>
          </span>
          {createPortal(<span className="sr-only">{`${term.term}: ${term.definition}`}</span>, document.getElementById('toasts')!)}
        </>
      )}
    </span>
  );
}
