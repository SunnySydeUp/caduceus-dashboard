import { groupRows } from '../shortcuts.ts';
import { Keycaps, useKeyboard } from './keyboard-context.tsx';
import { AppLink } from './navigation.tsx';
import { SingleKeySwitch } from './SingleKeySwitch.tsx';

/** What the keyboard does inside a sheet or the palette; these keys are not shortcuts to remap. */
const FIXED: { caps: string[]; what: string }[] = [
  { caps: ['Esc'], what: 'Close the top sheet or step back' },
  { caps: ['↑', '↓'], what: 'Move through the palette’s results' },
  { caps: ['↵'], what: 'Run the active result' },
];

/** What the keyboard does inside the Chat module's sessions list: they work while the focus is in the list, so they are not shortcuts to remap. */
const SESSION_KEYS: { caps: string[]; what: string }[] = [
  { caps: ['j', '↓'], what: 'Next session' },
  { caps: ['k', '↑'], what: 'Previous session' },
  { caps: ['Home', 'End'], what: 'First or last session' },
  { caps: ['↵'], what: 'Open the session' },
];

/** What the keyboard does inside the Notices list: they work while the focus is in the list, so they are not shortcuts to remap. */
const NOTICES_KEYS: { caps: string[]; what: string }[] = [
  { caps: ['j', '↓'], what: 'Next notice' },
  { caps: ['k', '↑'], what: 'Previous notice' },
  { caps: ['↵'], what: 'Open the notice' },
];

/** What the keyboard does inside a terminal (the chat's terminal mode and Workspace › Terminal): they work while the focus is in it, so they are not shortcuts to remap. The terminal keeps every other key for itself. */
function terminalKeys(platform: 'mac' | 'other'): { caps: string[]; what: string }[] {
  const mac = platform === 'mac';
  return [
    { caps: mac ? ['⌘', 'C'] : ['Ctrl', 'Shift', 'C'], what: 'Copy the selection (Ctrl-C stays the shell’s own)' },
    { caps: mac ? ['⌘', 'V'] : ['Ctrl', 'Shift', 'V'], what: 'Paste' },
    { caps: mac ? ['⇧', '⌘', 'L'] : ['Ctrl', 'Shift', 'L'], what: 'Copy the last output' },
    { caps: ['Shift', 'Esc'], what: 'Leave the terminal, so Escape, the palette and ? work again' },
  ];
}

/** The shortcuts tab of the help panel: every shortcut as it is bound on this device, and the switch for the single-key ones. */
export function ShortcutsPane() {
  const { keymap, platform } = useKeyboard();
  return (
    <>
      <SingleKeySwitch />
      <div className="shortcuts">
        {groupRows(keymap.rows).map(({ group, rows }) => (
          <table className="kbd-table" key={group}>
            <caption className="overline">{group}</caption>
            <tbody>
              {rows.map((row) => (
                <tr key={row.def.action} className={row.active ? undefined : 'is-off'}>
                  <td>{row.binding ? <Keycaps binding={row.binding} /> : <span className="subtle">Not set</span>}</td>
                  <td>
                    {row.def.label}
                    {row.binding && !row.active && <span className="subtle"> (off)</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
        {[
          { caption: 'In sheets and the palette', keys: FIXED },
          { caption: 'In the Chat sessions list', keys: SESSION_KEYS },
          { caption: 'In the Notices list', keys: NOTICES_KEYS },
          { caption: 'In a terminal', keys: terminalKeys(platform) },
        ].map(({ caption, keys }) => (
          <table className="kbd-table" key={caption}>
            <caption className="overline">{caption}</caption>
            <tbody>
              {keys.map(({ caps, what }) => (
                <tr key={what}>
                  <td>
                    <span className="kbds">
                      {caps.map((cap) => (
                        <kbd key={cap}>{cap}</kbd>
                      ))}
                    </span>
                  </td>
                  <td>{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
      </div>
      <p className="subtle">
        Change a shortcut, or turn single-key shortcuts off for good, in <AppLink to="/settings/keyboard">Settings › Keyboard</AppLink>.
      </p>
    </>
  );
}
