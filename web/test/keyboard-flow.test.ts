import { describe, expect, test } from 'vitest';
import { IDLE, keyFlow, type FlowContext, type FlowState } from '../src/keyboard-flow.ts';
import { createModuleRegistry, type ModuleDefinition } from '../src/module-registry.ts';
import { buildKeymap, DEFAULT_KEYBOARD_SETTINGS, shortcutDefs, type KeyboardSettings, type KeyInput } from '../src/shortcuts.ts';

// The registry is generic over what a route renders, so these tests use plain strings as screens.
type Screen = string;
const module = (id: string, key?: string): ModuleDefinition<Screen> => ({ id, title: id, icon: 'stack', desk: 'today', path: `/${id}`, summary: id, key, routes: [{ path: `/${id}`, screen: id }] });
const registry = createModuleRegistry<Screen>();
[module('home', 'h'), module('inbox', 'i'), module('health', 'e')].forEach((m) => registry.register(m));
const defs = shortcutDefs(registry);

/** A key press as the browser reports it; only what a test cares about is set. */
const press = (key: string, modifiers: Partial<KeyInput> = {}): KeyInput => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...modifiers });
/** Focus is on the page: no text field, no sheet open, not choosing a new key. */
const onPage: FlowContext = { platform: 'mac', editable: false, layerOpen: false, capturing: false };

/** Types `keys` one after another and returns what ran, as a person at the keyboard would trigger it. */
function type(keys: (KeyInput | 'timeout')[], context: FlowContext = onPage, settings: KeyboardSettings = DEFAULT_KEYBOARD_SETTINGS) {
  const keymap = buildKeymap(defs, settings);
  let state: FlowState = IDLE;
  const ran: string[] = [];
  const handled: boolean[] = [];
  for (const key of keys) {
    const result = keyFlow(state, key, context, keymap);
    state = result.state;
    handled.push(result.handled);
    if (result.run) ran.push(result.run);
  }
  return { ran, handled, state };
}

describe('keyboard flow', () => {
  test('`g` then a module’s key goes to that module', () => {
    const afterG = type([press('g')]);
    // `g` waits for the next key, and the browser is told this key press was ours.
    expect(afterG.state).toEqual({ pending: 'g' });
    expect(afterG.handled).toEqual([true]);

    const jump = type([press('g'), press('i')]);
    expect(jump.ran).toEqual(['go:inbox']);
    expect(jump.state).toEqual(IDLE);
    expect(jump.handled).toEqual([true, true]);
  });

  test('⌘K and Ctrl+K open the palette from anywhere, even while typing in a field or over an open sheet', () => {
    const typing: FlowContext = { ...onPage, editable: true, layerOpen: true };
    expect(type([press('k', { metaKey: true })], typing).ran).toEqual(['palette.open']);
    expect(type([press('k', { ctrlKey: true })], { ...typing, platform: 'other' }).ran).toEqual(['palette.open']);
    // Ctrl+K is not ⌘K on a Mac.
    expect(type([press('k', { ctrlKey: true })], typing).ran).toEqual([]);
  });

  test('`?` opens the help for this screen, however the keyboard layout reaches it', () => {
    expect(type([press('?', { shiftKey: true })]).ran).toEqual(['help.open']);
    expect(type([press('?')]).ran).toEqual(['help.open']);
  });

  test('single keys are typing, not shortcuts, in a text field and over an open sheet, and never with ⌘ or Ctrl held', () => {
    const jump = [press('g'), press('i')];
    expect(type(jump, { ...onPage, editable: true }).ran).toEqual([]);
    expect(type(jump, { ...onPage, layerOpen: true }).ran).toEqual([]);
    expect(type([press('?')], { ...onPage, editable: true }).ran).toEqual([]);
    expect(type([press('g', { metaKey: true }), press('i')]).ran).toEqual([]);
    // Focus moving into a field between the two keys stops the jump too.
    const keymap = buildKeymap(defs, DEFAULT_KEYBOARD_SETTINGS);
    const afterG = keyFlow(IDLE, press('g'), onPage, keymap);
    expect(keyFlow(afterG.state, press('i'), { ...onPage, editable: true }, keymap)).toEqual({ state: IDLE, handled: false });
  });

  test('with single-key shortcuts turned off nothing but the ⌘ and Ctrl shortcuts runs', () => {
    const off = { ...DEFAULT_KEYBOARD_SETTINGS, singleKey: false };
    const result = type([press('g'), press('i'), press('?', { shiftKey: true }), press('k', { metaKey: true })], onPage, off);
    expect(result.ran).toEqual(['palette.open']);
    // The browser keeps `g` and `?` for itself.
    expect(result.handled).toEqual([false, false, false, true]);
  });

  test('a remapped shortcut answers to its new keys', () => {
    const settings = { singleKey: true, remaps: { 'go:inbox': 'g x', 'palette.open': 'mod+j' } };
    expect(type([press('g'), press('x')], onPage, settings).ran).toEqual(['go:inbox']);
    expect(type([press('g'), press('i')], onPage, settings).ran).toEqual([]);
    expect(type([press('j', { metaKey: true })], onPage, settings).ran).toEqual(['palette.open']);
    expect(type([press('k', { metaKey: true })], onPage, settings).ran).toEqual([]);
  });

  test('a pending `g` ends on the timeout or on a key that is no destination, which then counts as an ordinary key; a bare Shift changes nothing', () => {
    expect(type([press('g'), 'timeout', press('i')]).ran).toEqual([]);
    expect(type([press('g'), press('z')]).state).toEqual(IDLE);
    // `g` then `?` is not a jump, but the `?` is still help's key.
    expect(type([press('g'), press('?', { shiftKey: true })]).ran).toEqual(['help.open']);
    // `g` `g` `i`: the second `g` starts over.
    expect(type([press('g'), press('g'), press('i')]).ran).toEqual(['go:inbox']);
    // A bare Shift between the two keys does not cancel the jump.
    expect(type([press('g'), press('Shift', { shiftKey: true }), press('i')]).ran).toEqual(['go:inbox']);
  });

  test('nothing runs while a new binding is being chosen, a held key does not repeat a shortcut, and an input method’s keys are its own', () => {
    expect(type([press('k', { metaKey: true })], { ...onPage, capturing: true }).ran).toEqual([]);
    expect(type([press('g'), press('i')], { ...onPage, capturing: true }).ran).toEqual([]);
    expect(type([press('k', { metaKey: true, repeat: true })]).ran).toEqual([]);
    expect(type([press('g'), press('i', { isComposing: true })]).ran).toEqual([]);
  });
});
