import { useEffect } from 'react';
import { useSearch } from '@tanstack/react-router';
import { useRouteInfo } from './navigation.tsx';
import { useRegistry } from './registry-context.tsx';

/** How long the screen of a settings panel may take to load before the setting is given up on. */
const WAIT_MS = 6000;
/** How long the setting stays highlighted. */
const HIGHLIGHT_MS = 4000;
/** Lets the page heading take its focus first (the shell focuses it when a screen mounts). */
const SETTLE_MS = 120;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Scrolls to, focuses and highlights the setting `panelId/fieldId` marked `data-setting-field`; returns what undoes the highlight. */
function reveal(target: HTMLElement): () => void {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
  const control = target.matches(FOCUSABLE) ? target : (target.querySelector<HTMLElement>(FOCUSABLE) ?? target);
  control.focus({ preventScroll: true });
  target.setAttribute('data-highlight', 'true');
  const clear = () => {
    clearTimeout(timer);
    target.removeAttribute('data-highlight');
    control.removeEventListener('blur', clear);
  };
  const timer = setTimeout(clear, HIGHLIGHT_MS);
  control.addEventListener('blur', clear);
  return clear;
}

/**
 * Opening a settings panel at `?field=<id>` (Settings search, the command palette) scrolls to that setting, focuses it
 * and highlights it for a few seconds. It lives in the shell, so every panel of every module gets it without doing
 * anything but marking the setting's element `data-setting-field="<panel id>/<field id>"`.
 */
export function useRevealSettingField(): void {
  const registry = useRegistry();
  const { pathname } = useRouteInfo();
  const { field } = useSearch({ strict: false }) as { field?: unknown };
  useEffect(() => {
    if (typeof field !== 'string') return;
    const panel = registry.settingsPanels().find((candidate) => candidate.path === pathname);
    if (!panel) return;
    const selector = `[data-setting-field="${CSS.escape(`${panel.id}/${field}`)}"]`;
    let undo: (() => void) | undefined;
    let settle: ReturnType<typeof setTimeout> | undefined;
    const find = () => {
      // A screen that is still loading is hidden in the DOM; only a shown element can take focus.
      const target = [...document.querySelectorAll<HTMLElement>(selector)].find((element) => element.getClientRects().length > 0);
      if (!target) return false;
      observer.disconnect();
      settle = setTimeout(() => (undo = reveal(target)), SETTLE_MS);
      return true;
    };
    const observer = new MutationObserver(find);
    if (!find()) observer.observe(document.body, { childList: true, subtree: true });
    const giveUp = setTimeout(() => observer.disconnect(), WAIT_MS);
    return () => {
      observer.disconnect();
      clearTimeout(giveUp);
      clearTimeout(settle);
      undo?.();
    };
  }, [registry, pathname, field]);
}
