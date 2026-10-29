// Keyboard shortcuts, free of the DOM and of React (information architecture §8, mobile spec §8): how a key press reads
// as a shortcut step, which shortcuts exist, which keys they are bound to on this device, and whether a new binding
// is allowed. Single-key shortcuts can be turned off and every shortcut can be remapped, as WCAG 2.1.4 asks.

import type { ModuleRegistry } from './module-registry.ts';
import { deskModules, deskNavigation, ownerName } from './shell/nav-order.ts';

export type Platform = 'mac' | 'other';

/** The parts of a `KeyboardEvent` the keyboard flow reads. */
export interface KeyInput {
  key: string;
  /** The physical key (`KeyK`); it names the key when Option changes what a Mac types. */
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}

const BARE_MODIFIERS = new Set(['shift', 'control', 'alt', 'altgraph', 'meta', 'os', 'capslock', 'fn', 'dead', 'unidentified']);

/**
 * One key press as a step of a binding, in a canonical text form: modifiers in the order `mod` (⌘ on a Mac, Ctrl
 * elsewhere), `alt`, `shift`, then the key, joined by `+`: `mod+shift+o`, `g`, `?`, `arrowdown`. Shift is part of a step
 * for letters and named keys only, because a symbol already says it (`?`). A bare modifier, and the other platform's
 * primary modifier (Ctrl on a Mac, ⌘ elsewhere), are not steps.
 */
export function stepOf(input: KeyInput, platform: Platform): string | undefined {
  const mac = platform === 'mac';
  if (BARE_MODIFIERS.has(input.key.toLowerCase()) || (mac ? input.ctrlKey : input.metaKey)) return undefined;
  const physical = input.altKey ? /^(?:Key([A-Z])|Digit(\d))$/.exec(input.code ?? '') : null;
  const typed = physical ? (physical[1] ?? physical[2]) : input.key;
  const isCharacter = [...typed].length === 1;
  const isLetter = isCharacter && typed.toLowerCase() !== typed.toUpperCase();
  const name = typed === ' ' ? 'space' : typed === '+' ? 'plus' : typed.toLowerCase();
  const modifiers = [(mac ? input.metaKey : input.ctrlKey) && 'mod', input.altKey && 'alt', input.shiftKey && (isLetter || !isCharacter) && 'shift'];
  return [...modifiers.filter(Boolean), name].join('+');
}

/**
 * The ids of the shortcuts the shell owns, and the way the others are named: `go:<module>` and `cmd:<module>:<command>`.
 * `shortcuts.open` has no key of its own: the shortcuts are a tab of the help panel, which `?` opens.
 */
export const PALETTE_OPEN = 'palette.open';
export const HELP_OPEN = 'help.open';
export const SHORTCUTS_OPEN = 'shortcuts.open';
/** The shell's own "Sign out" (the palette's and Control's): it asks to confirm, then ends this device's session. It has no key. */
export const SIGN_OUT = 'shell.sign-out';
export const goAction = (moduleId: string) => `go:${moduleId}`;
export const commandAction = (moduleId: string, commandId: string) => `cmd:${moduleId}:${commandId}`;

/** A shortcut that exists, with the binding it has until the owner changes it on this device. */
export interface ShortcutDef {
  action: string;
  label: string;
  /** The heading the shortcut sheet and Settings › Keyboard list it under. */
  group: string;
  /** One or two steps separated by a space: `mod+k`, `?`, `g i`. */
  default: string;
}

/** Every shortcut that exists now: the shell's two, a `g` jump for each module with a key, and each command's own. */
export function shortcutDefs(registry: ModuleRegistry<unknown>): ShortcutDef[] {
  const navigation = deskNavigation(registry, []);
  const modules = deskModules(navigation);
  return [
    { action: PALETTE_OPEN, label: 'Open the command palette', group: 'Everywhere', default: 'mod+k' },
    { action: HELP_OPEN, label: 'Show help for this screen', group: 'Everywhere', default: '?' },
    ...modules.filter((module) => module.key).map((module) => ({ action: goAction(module.id), label: `Go to ${ownerName(navigation, module)}`, group: 'Go to', default: `g ${module.key!.toLowerCase()}` })),
    ...registry
      .paletteCommands()
      .filter((command) => command.shortcut)
      .map((command) => ({ action: commandAction(command.moduleId, command.id), label: command.label, group: ownerName(navigation, registry.module(command.moduleId)!), default: command.shortcut! })),
  ];
}

/** What the owner changed on this device (stored per device). */
export interface KeyboardSettings {
  /** Single-key shortcuts (`g` then a letter, `?`) work only while this is on. */
  singleKey: boolean;
  /** The binding the owner chose for an action, by action id. */
  remaps: Record<string, string>;
}

export const DEFAULT_KEYBOARD_SETTINGS: KeyboardSettings = { singleKey: true, remaps: {} };

/** The settings as stored on this device; anything unreadable, or of the wrong shape, falls back to the defaults. */
export function parseKeyboardSettings(stored: string | null): KeyboardSettings {
  let value: unknown;
  try {
    value = JSON.parse(stored ?? 'null');
  } catch {
    return DEFAULT_KEYBOARD_SETTINGS;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return DEFAULT_KEYBOARD_SETTINGS;
  const { singleKey, remaps } = value as { singleKey?: unknown; remaps?: unknown };
  const remapEntries = typeof remaps === 'object' && remaps !== null ? Object.entries(remaps).filter((entry): entry is [string, string] => typeof entry[1] === 'string') : [];
  return { singleKey: typeof singleKey === 'boolean' ? singleKey : DEFAULT_KEYBOARD_SETTINGS.singleKey, remaps: Object.fromEntries(remapEntries) };
}

/** A shortcut as the sheet and Settings › Keyboard list it. */
export interface ShortcutRow {
  def: ShortcutDef;
  /** The binding it holds; `undefined` when every key it could have is taken or reserved. */
  binding: string | undefined;
  /** The owner chose this binding; it is not the default. */
  remapped: boolean;
  /** The shortcut works: it has a binding, and is not a single-key shortcut while those are switched off. */
  active: boolean;
}

/** Why a binding cannot be given to a shortcut. `by` and `with` name the other shortcut, `for` the reserved owner. */
export type BindingProblem = { kind: 'invalid' } | { kind: 'reserved'; for: string } | { kind: 'taken'; by: string } | { kind: 'prefix'; with: string };

export interface Keymap {
  rows: ShortcutRow[];
  /** The binding an action answers to now, if it has one and it is switched on. */
  bindingOf(action: string): string | undefined;
  /** The action a typed binding runs. */
  actionFor(binding: string): string | undefined;
  /** Whether this step begins a two-step binding (the `g` of `g h`). */
  startsSequence(step: string): boolean;
  /** Whether `binding` could be given to `action` now; `undefined` means it can. */
  check(action: string, binding: string): BindingProblem | undefined;
}

/** Keys only the shortcut named here may use; New chat (M1) registers ⇧⌘O, so nothing else may take it. */
const RESERVED = [{ binding: 'mod+shift+o', action: commandAction('chat', 'new-chat'), label: 'New chat' }];

/** Keys the shell and the browser need for moving and closing: they are never a shortcut on their own. */
const NEVER_BARE = new Set(['escape', 'tab', 'enter', 'space', 'backspace']);

/** A character-key shortcut (WCAG 2.1.4): no step of it holds ⌘, Ctrl or Alt, so typing text could trigger it. */
export function isSingleKey(binding: string): boolean {
  return binding.split(' ').every((step) => !/^(?:mod|alt)\+/.test(step));
}

function isWellFormed(binding: string): boolean {
  const steps = binding.split(' ');
  const wellFormedSteps =
    steps.length <= 2 &&
    steps.every((step) => {
      const [, modifiers, key] = /^((?:mod\+)?(?:alt\+)?(?:shift\+)?)([^+\s]+)$/.exec(step) ?? [];
      return key !== undefined && !['mod', 'alt', 'shift'].includes(key) && !(modifiers === '' && NEVER_BARE.has(key));
    });
  // After a plain-key leader (`g`) comes a plain key, not a chord.
  return wellFormedSteps && (steps.length < 2 || !isSingleKey(steps[0]) || isSingleKey(steps[1]));
}

/** Whether `binding` can go to `action` beside the shortcuts that already hold `others`. */
function problemOf(action: string, binding: string, others: { action: string; label: string; binding: string }[]): BindingProblem | undefined {
  if (!isWellFormed(binding)) return { kind: 'invalid' };
  const reserved = RESERVED.find((entry) => entry.binding === binding && entry.action !== action);
  if (reserved) return { kind: 'reserved', for: reserved.label };
  const steps = binding.split(' ');
  for (const other of others.filter((entry) => entry.action !== action)) {
    if (other.binding === binding) return { kind: 'taken', by: other.label };
    // `g` cannot be a shortcut of its own and also begin `g h`: the second key would never arrive.
    const otherSteps = other.binding.split(' ');
    if (steps.length !== otherSteps.length && steps[0] === otherSteps[0]) return { kind: 'prefix', with: other.label };
  }
  return undefined;
}

/**
 * The bindings in force: the owner's remap for each shortcut, else its default. Shortcuts are settled in order, and a
 * binding another shortcut already holds (or that is reserved) is not given out twice, so a stale remap, or two modules
 * declaring the same key, leaves the later one on its default or on no key rather than answering to two actions.
 */
export function buildKeymap(defs: ShortcutDef[], settings: KeyboardSettings): Keymap {
  const held: { action: string; label: string; binding: string }[] = [];
  const rows = defs.map((def): ShortcutRow => {
    const remap = settings.remaps[def.action];
    const binding = [remap, def.default].find((candidate) => candidate !== undefined && problemOf(def.action, candidate, held) === undefined);
    if (binding !== undefined) held.push({ action: def.action, label: def.label, binding });
    return { def, binding, remapped: binding !== undefined && binding === remap && remap !== def.default, active: binding !== undefined && (settings.singleKey || !isSingleKey(binding)) };
  });
  const active = rows.filter((row): row is ShortcutRow & { binding: string } => row.active);
  const actions = new Map(active.map((row) => [row.binding, row.def.action]));
  const sequenceStarts = new Set(active.flatMap((row) => (row.binding.includes(' ') ? [row.binding.split(' ')[0]] : [])));
  return {
    rows,
    bindingOf: (action) => active.find((row) => row.def.action === action)?.binding,
    actionFor: (binding) => actions.get(binding),
    startsSequence: (step) => sequenceStarts.has(step),
    check: (action, binding) => problemOf(action, binding, held),
  };
}

const KEY_NAMES: Record<string, string> = { arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→', enter: '↵', escape: 'Esc', backspace: '⌫', plus: '+', space: 'Space' };

/**
 * A binding as key caps, one per step, the way this platform prints it: `⇧⌘O` on a Mac, `Ctrl+Shift+O` elsewhere,
 * `G` `H` for the two steps of `g h`.
 */
export function keycaps(binding: string, platform: Platform): string[] {
  return binding.split(' ').map((step) => {
    const parts = step.split('+');
    const key = parts.pop()!;
    const name = KEY_NAMES[key] ?? (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1));
    if (platform === 'mac') return `${parts.includes('alt') ? '⌥' : ''}${parts.includes('shift') ? '⇧' : ''}${parts.includes('mod') ? '⌘' : ''}${name}`;
    return [...parts.map((part) => (part === 'mod' ? 'Ctrl' : part === 'alt' ? 'Alt' : 'Shift')), name].join('+');
  });
}

/** The rows under their headings (`Everywhere`, `Go to`, a module's name), in the order each heading first appears. */
export function groupRows(rows: ShortcutRow[]): { group: string; rows: ShortcutRow[] }[] {
  const groups: { group: string; rows: ShortcutRow[] }[] = [];
  for (const row of rows) {
    const existing = groups.find(({ group }) => group === row.def.group);
    if (existing) existing.rows.push(row);
    else groups.push({ group: row.def.group, rows: [row] });
  }
  return groups;
}
