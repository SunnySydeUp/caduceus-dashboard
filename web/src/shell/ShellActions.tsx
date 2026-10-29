import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { resolveHelpTarget, type HelpTarget, type HelpView } from '../help.ts';
import { closeAllLayers, hasOpenLayer } from '../overlays/layers.ts';
import { IDLE, keyFlow, type FlowState } from '../keyboard-flow.ts';
import type { PaletteEntry } from '../palette.ts';
import { settled } from '../settled.ts';
import { HELP_OPEN, PALETTE_OPEN, SHORTCUTS_OPEN, SIGN_OUT, type KeyInput } from '../shortcuts.ts';
import { HelpContext } from './help-context.tsx';
import { Keycaps, useKeyboard } from './keyboard-context.tsx';
import { useAppNavigate, useRouteInfo } from './navigation.tsx';
import { useRegistry } from './registry-context.tsx';
import { getTierConfirmer } from './tier-confirmation.ts';
import { signOut } from './sign-out.ts';
import { toast } from './toasts.ts';

// Help is bundled with the app (it is precached, so it works offline) but not in the first load: the panel and every page load when it is first opened.
const HelpPanel = lazy(() => import('./HelpPanel.tsx').then((module) => ({ default: module.HelpPanel })));
// The palette, its entries and the shortcut list are not in the first load either: they load once the page has settled (below), or when first wanted.
const Palette = lazy(() => import('./Palette.tsx').then((module) => ({ default: module.Palette })));
const ShortcutsPane = lazy(() => import('./ShortcutsPane.tsx').then((module) => ({ default: module.ShortcutsPane })));

interface ShellActions {
  openPalette(): void;
}

const ShellActionsContext = createContext<ShellActions | undefined>(undefined);

export function useShellActions(): ShellActions {
  const actions = useContext(ShellActionsContext);
  if (!actions) throw new Error('useShellActions needs a ShellActionsProvider');
  return actions;
}

/** How long a `g` waits for the key after it before the jump is given up. */
const SEQUENCE_TIMEOUT_MS = 1500;

/** Text fields, where a single key is typing. */
const EDITABLE = 'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="combobox"], [role="searchbox"], [role="spinbutton"]';

/**
 * Owns the shell's keyboard: the palette and the help panel (opened from the app bar, ⌘K or `?`), the document key listener
 * that runs the keyboard flow over this device's keymap, and the `g` hint. A shortcut runs exactly what choosing the same
 * entry in the palette runs, so a tiered action is confirmed on either path. It also gives every screen the means to open help
 * (`useHelp`), which is what a glossary term's "More" link calls.
 */
export function ShellActionsProvider({ children }: { children: ReactNode }) {
  const registry = useRegistry();
  const { keymap, platform } = useKeyboard();
  const navigate = useAppNavigate();
  const { moduleId, pathname } = useRouteInfo();
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** What the help panel shows, and which opening it is: a new one (from the palette, over an open panel) starts the panel again. */
  const [help, setHelp] = useState<{ view: HelpView; opening: number }>();
  const [pending, setPending] = useState<string>();

  const openHelp = useCallback(
    // The pages load the first time help is wanted (the panel, the palette, a glossary term), not with the first screen, so this waits for them.
    (target: HelpTarget) => void registry.loadHelp().then(() => setHelp((open) => ({ view: resolveHelpTarget(registry, target), opening: (open?.opening ?? 0) + 1 }))),
    [registry],
  );
  const run = useCallback(
    async (entry: PaletteEntry) => {
      const confirmer = getTierConfirmer();
      const { runEntry } = await import('../palette.ts');
      const outcome = await runEntry(entry, {
        navigate,
        shell: (action) => {
          if (action === HELP_OPEN) openHelp({ screen: pathname });
          else if (action === SHORTCUTS_OPEN) openHelp({ shortcuts: true });
          else if (action === SIGN_OUT) void signOut();
        },
        help: openHelp,
        settled: closeAllLayers,
        confirm: confirmer && (async (request) => (await confirmer(request)) !== undefined),
      });
      if (outcome === 'unconfirmable') toast(`“${entry.label}” needs a confirmation that cannot be asked for yet, so it was not run.`, { tone: 'danger' });
    },
    [navigate, openHelp, pathname],
  );

  /** Carries out what a key press asked for. */
  const perform = (action: string) => {
    if (action === PALETTE_OPEN) setPaletteOpen((open) => !open);
    else {
      void import('../palette.ts').then(({ paletteEntries }) => {
        const entry = paletteEntries(registry, moduleId, keymap).find((candidate) => candidate.action === action);
        if (entry) void run(entry);
      });
    }
  };
  const latest = useRef(perform);
  latest.current = perform;

  // Nothing on the first screen waits for the palette: its code is fetched once the page is done, so it is there before the first ⌘K.
  useEffect(() => {
    void settled.then(() => Promise.all([import('./Palette.tsx'), import('./ShortcutsPane.tsx')]));
  }, []);

  useEffect(() => {
    let state: FlowState = IDLE;
    let timer: number | undefined;
    const feed = (input: KeyInput | 'timeout', target: EventTarget | null) => {
      const element = target instanceof Element ? target : null;
      const result = keyFlow(state, input, { platform, editable: element?.closest(EDITABLE) != null, layerOpen: hasOpenLayer(), capturing: element?.closest('[data-key-capture]') != null }, keymap);
      state = result.state;
      window.clearTimeout(timer);
      if (state.pending !== undefined) timer = window.setTimeout(() => feed('timeout', null), SEQUENCE_TIMEOUT_MS);
      setPending(state.pending);
      return result;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const result = feed(event, event.target);
      if (result.handled) event.preventDefault();
      if (result.run) latest.current(result.run);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      window.clearTimeout(timer);
    };
  }, [keymap, platform]);

  return (
    <ShellActionsContext value={{ openPalette: () => setPaletteOpen(true) }}>
      <HelpContext value={{ openHelp }}>
        {children}
        {paletteOpen && (
          <Suspense fallback={null}>
            <Palette
              onClose={() => setPaletteOpen(false)}
              onRun={(entry) => {
                setPaletteOpen(false);
                void run(entry);
              }}
            />
          </Suspense>
        )}
        {help && (
          <Suspense fallback={null}>
            <HelpPanel
              key={help.opening}
              view={help.view}
              shortcuts={
                <Suspense fallback={null}>
                  <ShortcutsPane />
                </Suspense>
              }
              onClose={() => setHelp(undefined)}
            />
          </Suspense>
        )}
        {pending !== undefined && (
          <div className="ghint" role="status">
            <Keycaps binding={pending} />
            <span>then a key…</span>
          </div>
        )}
      </HelpContext>
    </ShellActionsContext>
  );
}
