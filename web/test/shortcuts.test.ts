import { describe, expect, test } from 'vitest';
import { createAppRegistry } from '../src/modules/index.ts';
import { createModuleRegistry, type ModuleDefinition } from '../src/module-registry.ts';
import { buildKeymap, DEFAULT_KEYBOARD_SETTINGS, groupRows, keycaps, parseKeyboardSettings, shortcutDefs, stepOf, type KeyInput } from '../src/shortcuts.ts';

/** A key press as the browser reports it; only what a test cares about is set. */
const press = (key: string, modifiers: Partial<KeyInput> = {}): KeyInput => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...modifiers });

describe('key presses as shortcut steps', () => {
  test('⌘ on a Mac and Ctrl elsewhere are the same `mod`, and the other platform’s modifier matches nothing', () => {
    expect(stepOf(press('k', { metaKey: true }), 'mac')).toBe('mod+k');
    expect(stepOf(press('k', { ctrlKey: true }), 'other')).toBe('mod+k');
    expect(stepOf(press('k', { ctrlKey: true }), 'mac')).toBeUndefined();
    expect(stepOf(press('k', { metaKey: true }), 'other')).toBeUndefined();
  });

  test('letters keep their Shift, symbols do not (the character already says it), and bare modifiers are no step at all', () => {
    // Chrome reports the shifted capital for ⇧⌘O.
    expect(stepOf(press('O', { metaKey: true, shiftKey: true }), 'mac')).toBe('mod+shift+o');
    expect(stepOf(press('g'), 'mac')).toBe('g');
    expect(stepOf(press('G', { shiftKey: true }), 'mac')).toBe('shift+g');
    expect(stepOf(press('?', { shiftKey: true }), 'mac')).toBe('?');
    expect(stepOf(press('Shift', { shiftKey: true }), 'mac')).toBeUndefined();
    expect(stepOf(press('Meta', { metaKey: true }), 'mac')).toBeUndefined();
  });

  test('named keys are lower-cased words, and an Option chord on a Mac uses the physical key, not the character it types', () => {
    expect(stepOf(press('ArrowDown'), 'mac')).toBe('arrowdown');
    expect(stepOf(press(' '), 'mac')).toBe('space');
    expect(stepOf(press('˚', { altKey: true, code: 'KeyK' }), 'mac')).toBe('alt+k');
  });
});

// The registry is generic over what a route renders, so these tests use plain strings as screens.
type Screen = string;

/** A module as a later ticket would write it: nothing here is known to the shell. */
function testModule(id: string, overrides: Partial<ModuleDefinition<Screen>> = {}): ModuleDefinition<Screen> {
  return { id, title: id[0].toUpperCase() + id.slice(1), icon: 'stack', desk: 'today', path: `/${id}`, summary: id, routes: [{ path: `/${id}`, screen: id }], ...overrides };
}
const registryWith = (...modules: ModuleDefinition<Screen>[]) => {
  const registry = createModuleRegistry<Screen>();
  modules.forEach((module) => registry.register(module));
  return registry;
};

describe('the shortcuts modules declare', () => {
  test('a module’s key is `g` then that key, a command keeps the shortcut it declares, and ⌘K and ? (help for this screen) are always there', () => {
    const keymap = buildKeymap(
      shortcutDefs(
        registryWith(
          testModule('home', { key: 'h' }),
          testModule('health', { key: 'e' }),
          testModule('tasks', { paletteCommands: () => [{ id: 'retry', label: 'Retry the task', shortcut: 'mod+shift+r', run: () => {} }] }),
        ),
      ),
      DEFAULT_KEYBOARD_SETTINGS,
    );

    expect(keymap.bindingOf('palette.open')).toBe('mod+k');
    expect(keymap.bindingOf('help.open')).toBe('?');
    expect(keymap.bindingOf('go:home')).toBe('g h');
    expect(keymap.bindingOf('go:tasks')).toBeUndefined();
    expect(keymap.bindingOf('cmd:tasks:retry')).toBe('mod+shift+r');
    expect(keymap.actionFor('g e')).toBe('go:health');
    expect(keymap.actionFor('g x')).toBeUndefined();
  });
});

describe('single-key shortcuts', () => {
  const defs = shortcutDefs(registryWith(testModule('home', { key: 'h' }), testModule('tasks', { paletteCommands: () => [{ id: 'retry', label: 'Retry', shortcut: 'mod+shift+r', run: () => {} }] })));

  test('turning them off switches off `g` then a key and `?`, and leaves the ⌘ and Ctrl shortcuts alone', () => {
    const on = buildKeymap(defs, DEFAULT_KEYBOARD_SETTINGS);
    expect(on.actionFor('g h')).toBe('go:home');
    expect(on.actionFor('?')).toBe('help.open');
    expect(on.startsSequence('g')).toBe(true);
    expect(on.startsSequence('mod+k')).toBe(false);

    const off = buildKeymap(defs, { ...DEFAULT_KEYBOARD_SETTINGS, singleKey: false });
    expect(off.actionFor('g h')).toBeUndefined();
    expect(off.actionFor('?')).toBeUndefined();
    expect(off.startsSequence('g')).toBe(false);
    expect(off.actionFor('mod+k')).toBe('palette.open');
    expect(off.actionFor('mod+shift+r')).toBe('cmd:tasks:retry');
    expect(off.bindingOf('go:home')).toBeUndefined();
    expect(off.bindingOf('palette.open')).toBe('mod+k');
    // The shortcuts tab of the help panel and Settings › Keyboard still list the switched-off ones.
    expect(off.rows.filter((row) => !row.active).map((row) => [row.def.action, row.binding])).toEqual([
      ['help.open', '?'],
      ['go:home', 'g h'],
    ]);
  });
});

describe('remapping', () => {
  const defs = shortcutDefs(registryWith(testModule('home', { key: 'h' }), testModule('health', { key: 'e' })));

  test('a remapped action answers to the new binding and no longer to its default', () => {
    const keymap = buildKeymap(defs, { singleKey: true, remaps: { 'go:home': 'g x', 'palette.open': 'mod+j' } });

    expect(keymap.actionFor('g x')).toBe('go:home');
    expect(keymap.actionFor('g h')).toBeUndefined();
    expect(keymap.actionFor('mod+j')).toBe('palette.open');
    expect(keymap.actionFor('mod+k')).toBeUndefined();
    expect(keymap.rows.filter((row) => row.remapped).map((row) => row.def.action)).toEqual(['palette.open', 'go:home']);
    // Everything else keeps its default.
    expect(keymap.actionFor('g e')).toBe('go:health');
  });

  test('⇧⌘O is New chat’s alone, and a remap onto a binding another shortcut holds is ignored', () => {
    const run = () => {};
    const registry = registryWith(
      testModule('chat', { key: 'c', paletteCommands: () => [{ id: 'new-chat', label: 'New chat', shortcut: 'mod+shift+o', run }] }),
      testModule('home', { key: 'h' }),
      testModule('tasks', { paletteCommands: () => [{ id: 'grab', label: 'Grab a task', shortcut: 'mod+shift+o', run }] }),
    );
    const keymap = buildKeymap(shortcutDefs(registry), { singleKey: true, remaps: { 'go:home': 'g c', 'palette.open': 'mod+shift+o' } });

    expect(keymap.actionFor('mod+shift+o')).toBe('cmd:chat:new-chat');
    // Another module declaring ⇧⌘O gets no key; the remaps onto it, and onto Chat's `g c`, fall back to the defaults.
    expect(keymap.bindingOf('cmd:tasks:grab')).toBeUndefined();
    expect(keymap.bindingOf('palette.open')).toBe('mod+k');
    expect(keymap.bindingOf('go:home')).toBe('g h');
    expect(keymap.actionFor('g c')).toBe('go:chat');
  });

  test('a new binding is refused when it is not a real key combination, is reserved, is held by another shortcut, or would hide one', () => {
    const keymap = buildKeymap(defs, DEFAULT_KEYBOARD_SETTINGS);

    expect(keymap.check('go:home', 'g x')).toBeUndefined();
    // Its own current binding is fine to keep.
    expect(keymap.check('go:home', 'g h')).toBeUndefined();
    expect(keymap.check('go:home', 'mod+shift+o')).toEqual({ kind: 'reserved', for: 'New chat' });
    expect(keymap.check('go:home', 'mod+k')).toEqual({ kind: 'taken', by: 'Open the command palette' });
    expect(keymap.check('go:home', 'g e')).toEqual({ kind: 'taken', by: 'Go to Health' });
    // `g` alone would swallow the first key of `g e`; `? x` could never get past `?`.
    expect(keymap.check('go:home', 'g')).toEqual({ kind: 'prefix', with: 'Go to Health' });
    expect(keymap.check('go:home', '? x')).toEqual({ kind: 'prefix', with: 'Show help for this screen' });
    for (const nonsense of ['', 'escape', 'tab', 'mod+', 'shift', 'a b c', 'mod+shift+alt+x']) expect(keymap.check('go:home', nonsense)).toEqual({ kind: 'invalid' });
    // After a plain-key leader comes a plain key: `g ⌘K` would be a jump nobody could find or type by accident.
    expect(keymap.check('go:home', 'g mod+k')).toEqual({ kind: 'invalid' });
    expect(keymap.check('go:home', 'mod+j x')).toBeUndefined();
    // Escape is fine with a modifier.
    expect(keymap.check('go:home', 'mod+escape')).toBeUndefined();
  });
});

describe('the settings a device stores', () => {
  test('read back as saved, and anything unreadable falls back to the defaults rather than breaking the keyboard', () => {
    expect(parseKeyboardSettings('{"singleKey":false,"remaps":{"go:home":"g x"}}')).toEqual({ singleKey: false, remaps: { 'go:home': 'g x' } });
    expect(parseKeyboardSettings(null)).toEqual(DEFAULT_KEYBOARD_SETTINGS);
    expect(parseKeyboardSettings('{not json')).toEqual(DEFAULT_KEYBOARD_SETTINGS);
    expect(parseKeyboardSettings('[1]')).toEqual(DEFAULT_KEYBOARD_SETTINGS);
    // Only the parts that make sense are kept.
    expect(parseKeyboardSettings('{"singleKey":"off","remaps":{"go:home":7,"go:health":"g x"}}')).toEqual({ singleKey: true, remaps: { 'go:health': 'g x' } });
  });
});

describe('showing a binding', () => {
  test('one key cap per step, with the symbols a Mac prints and the words other keyboards print', () => {
    expect(keycaps('mod+shift+o', 'mac')).toEqual(['⇧⌘O']);
    expect(keycaps('mod+shift+o', 'other')).toEqual(['Ctrl+Shift+O']);
    expect(keycaps('mod+k', 'mac')).toEqual(['⌘K']);
    expect(keycaps('alt+arrowup', 'mac')).toEqual(['⌥↑']);
    expect(keycaps('alt+arrowup', 'other')).toEqual(['Alt+↑']);
    expect(keycaps('g h', 'other')).toEqual(['G', 'H']);
    expect(keycaps('?', 'mac')).toEqual(['?']);
    expect(keycaps('shift+g', 'other')).toEqual(['Shift+G']);
    expect(keycaps('mod+enter', 'mac')).toEqual(['⌘↵']);
  });
});

describe('the shortcuts the app ships with', () => {
  test('every one of them gets its default key: none is dropped for clashing with another', () => {
    const keymap = buildKeymap(shortcutDefs(createAppRegistry()), DEFAULT_KEYBOARD_SETTINGS);

    expect(keymap.rows.filter((row) => row.binding !== row.def.default)).toEqual([]);
    expect(keymap.rows.map((row) => [row.def.action, row.binding])).toEqual([
      ['palette.open', 'mod+k'],
      ['help.open', '?'],
      ['go:today', 'g h'],
      ['go:chat', 'g c'],
      ['go:work-overview', 'g w'],
      ['go:work', 'g b'],
      ['go:tasks', 'g t'],
      ['go:schedules', 'g s'],
      ['go:profiles', 'g p'],
      ['go:gateway', 'g n'],
      ['go:channels', 'g k'],
      ['go:logs', 'g l'],
      ['go:health', 'g e'],
      ['go:config', 'g o'],
      ['go:settings', 'g ,'],
      // The key ⇧⌘O has been reserved for it since M0 #06; the Chat module (M1 #03) is the one that registers the command.
      ['cmd:chat:new-chat', 'mod+shift+o'],
    ]);
  });
});

describe('listing the shortcuts', () => {
  test('rows sit under their headings, in the order each heading first appears', () => {
    const registry = registryWith(
      testModule('home', { key: 'h' }),
      testModule('tasks', { paletteCommands: () => [{ id: 'retry', label: 'Retry', shortcut: 'mod+shift+r', run: () => {} }] }),
      testModule('health', { key: 'e' }),
    );
    const groups = groupRows(buildKeymap(shortcutDefs(registry), DEFAULT_KEYBOARD_SETTINGS).rows);

    expect(groups.map(({ group, rows }) => [group, rows.map((row) => row.def.action)])).toEqual([
      ['Everywhere', ['palette.open', 'help.open']],
      ['Go to', ['go:home', 'go:health']],
      ['Tasks', ['cmd:tasks:retry']],
    ]);
  });
});
