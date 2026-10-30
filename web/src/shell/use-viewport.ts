import { useEffect, useState } from 'react';

/** The phone's dock shrinks after the page scrolled down this far (px), and on the way down only. */
const SHRINK_AFTER_PX = 72;
/** Scroll movements smaller than this do not flip the bar (touch jitter). */
const SCROLL_JITTER_PX = 6;
/** The viewport must shrink by more than this (px) for it to be the soft keyboard, not browser toolbars. */
const KEYBOARD_MIN_PX = 120;

/** Whether `element` takes typing, so a soft keyboard is likely open while it has focus. */
function isEditable(element: Element | null): boolean {
  return element instanceof HTMLElement && element.matches('input:not([type="checkbox"],[type="radio"],[type="button"],[type="submit"]), textarea, select, [contenteditable=""], [contenteditable="true"]');
}

/**
 * The phone's floating dock shrinks while the page scrolls down and returns to full size on scroll up (information architecture §2). It stays full size
 * while focus is inside it, and returns on every navigation.
 */
export function useTabBarShrunk(enabled: boolean, pathname: string): boolean {
  const [shrunk, setShrunk] = useState(false);

  useEffect(() => setShrunk(false), [pathname, enabled]);
  useEffect(() => {
    if (!enabled) return;
    let lastY = window.scrollY;
    const onScroll = () => {
      const delta = window.scrollY - lastY;
      if (Math.abs(delta) < SCROLL_JITTER_PX) return;
      const focusInside = document.querySelector('.tabbar')?.contains(document.activeElement) ?? false;
      setShrunk(delta > 0 && window.scrollY > SHRINK_AFTER_PX && !focusInside);
      lastY = window.scrollY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [enabled]);

  return shrunk;
}

/**
 * Whether the soft keyboard is open. A `visualViewport` listener also publishes the covered height as `--kb-inset`
 * (mobile spec §1), so toasts and composers sit above the keyboard. Browsers either shrink the visual viewport
 * (iOS) or resize the layout viewport (`interactive-widget=resizes-content`, Chrome on Android); both count, but
 * only while a field has focus, so collapsing browser toolbars never look like a keyboard.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let baseline = viewport.height;
    let width = window.innerWidth;
    const update = () => {
      const typing = isEditable(document.activeElement);
      // Rotating changes what "full height" is.
      if (window.innerWidth !== width) {
        width = window.innerWidth;
        baseline = viewport.height;
      }
      if (!typing) baseline = Math.max(viewport.height, window.innerHeight);
      const covered = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      document.documentElement.style.setProperty('--kb-inset', `${covered}px`);
      setOpen(typing && Math.max(covered, baseline - viewport.height) > KEYBOARD_MIN_PX);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    document.addEventListener('focusin', update);
    document.addEventListener('focusout', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      document.removeEventListener('focusin', update);
      document.removeEventListener('focusout', update);
      document.documentElement.style.removeProperty('--kb-inset');
    };
  }, []);

  return open;
}
