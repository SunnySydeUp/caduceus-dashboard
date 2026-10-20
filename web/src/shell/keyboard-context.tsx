import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { buildKeymap, keycaps, shortcutDefs, type KeyboardSettings, type Keymap, type Platform, type ShortcutDef } from '../shortcuts.ts';
import { useKeyboardSettings } from './keyboard-settings.ts';
import { useRegistry } from './registry-context.tsx';

/** ⌘ on Macs and iPads (an iPad with a hardware keyboard reports a Mac), Ctrl elsewhere. */
const PLATFORM: Platform = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'mac' : 'other';

export interface KeyboardValue {
  platform: Platform;
  defs: ShortcutDef[];
  keymap: Keymap;
  settings: KeyboardSettings;
}

const KeyboardContext = createContext<KeyboardValue | undefined>(undefined);

/** The shortcuts every registered module declares, with this device's remaps and single-key switch applied. */
export function KeyboardProvider({ children }: { children: ReactNode }) {
  const registry = useRegistry();
  const settings = useKeyboardSettings();
  const value = useMemo<KeyboardValue>(() => {
    const defs = shortcutDefs(registry);
    return { platform: PLATFORM, defs, keymap: buildKeymap(defs, settings), settings };
  }, [registry, settings]);
  return <KeyboardContext value={value}>{children}</KeyboardContext>;
}

export function useKeyboard(): KeyboardValue {
  const value = useContext(KeyboardContext);
  if (!value) throw new Error('useKeyboard needs a KeyboardProvider');
  return value;
}

/** A binding as key caps (`⌘K`, `G` `H`). They are decoration: the shortcut's name is always beside them. */
export function Keycaps({ binding }: { binding: string }) {
  const { platform } = useKeyboard();
  return (
    <span className="kbds">
      {keycaps(binding, platform).map((cap, index) => (
        <kbd key={index}>{cap}</kbd>
      ))}
    </span>
  );
}
