import { createContext, useContext } from 'react';
import type { HelpTarget } from '../help.ts';

export interface HelpActions {
  /** Opens help on a page or a glossary term. */
  openHelp(target: HelpTarget): void;
}

/**
 * What a glossary term's "More" link calls. The shell provides it (it opens the help panel); the panel provides its own over its
 * content, which turns the page it is showing instead of opening a second panel.
 */
export const HelpContext = createContext<HelpActions | undefined>(undefined);

export function useHelp(): HelpActions {
  const actions = useContext(HelpContext);
  if (!actions) throw new Error('useHelp needs a HelpContext provider (the shell, or the help panel)');
  return actions;
}
