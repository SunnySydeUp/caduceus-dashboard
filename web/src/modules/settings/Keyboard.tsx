import { useId, useState, type KeyboardEvent } from 'react';
import { groupRows, keycaps, stepOf, type BindingProblem, type ShortcutRow } from '../../shortcuts.ts';
import { Keycaps, useKeyboard } from '../../shell/keyboard-context.tsx';
import { saveKeyboardSettings } from '../../shell/keyboard-settings.ts';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { toast } from '../../shell/toasts.ts';
import { SingleKeySwitch } from '../../shell/SingleKeySwitch.tsx';

function describe(problem: BindingProblem, isJump: boolean): string {
  switch (problem.kind) {
    case 'invalid':
      return isJump ? 'After G, choose a plain key: no ⌘, Ctrl or Alt, and not Esc, Tab, Enter or Space.' : 'That key cannot be a shortcut. Try a letter, or hold ⌘ or Ctrl with a key.';
    case 'reserved':
      return `That combination is kept for “${problem.for}”.`;
    case 'taken':
      return `“${problem.by}” already uses that.`;
    case 'prefix':
      return `That clashes with “${problem.with}”, which starts with the same key.`;
  }
}

/** Settings › Keyboard: the single-key switch and every shortcut, each remappable. Both are stored on this device. */
export function Keyboard() {
  const { keymap, settings, platform } = useKeyboard();
  const idPrefix = useId();
  /** The action waiting for its new keys. */
  const [capturing, setCapturing] = useState<string>();
  const [problem, setProblem] = useState<string>();
  const [status, setStatus] = useState('');

  const choose = (row: ShortcutRow, binding: string) => {
    const refusal = keymap.check(row.def.action, binding);
    if (refusal) {
      setProblem(describe(refusal, row.def.default.includes(' ')));
      return;
    }
    const remaps = { ...settings.remaps };
    if (binding === row.def.default) delete remaps[row.def.action];
    else remaps[row.def.action] = binding;
    saveKeyboardSettings({ ...settings, remaps });
    setCapturing(undefined);
    setProblem(undefined);
    setStatus(`${row.def.label} is now ${keycaps(binding, platform).join(' then ')}.`);
  };

  const reset = (row: ShortcutRow) => {
    const { [row.def.action]: _removed, ...remaps } = settings.remaps;
    saveKeyboardSettings({ ...settings, remaps });
    setStatus(`${row.def.label} is back to ${keycaps(row.def.default, platform).join(' then ')}.`);
  };

  /** While a shortcut waits for its keys, every key press is the new binding, except Tab (so focus is never trapped) and Esc. */
  const onCaptureKey = (event: KeyboardEvent, row: ShortcutRow) => {
    if (capturing !== row.def.action || event.key === 'Tab') return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      setCapturing(undefined);
      setProblem(undefined);
      return;
    }
    const step = stepOf(event.nativeEvent, platform);
    if (step === undefined) return;
    // A `g` jump keeps its `g`: only the key after it is chosen.
    const [first, second] = row.def.default.split(' ');
    choose(row, second === undefined ? step : `${first} ${step}`);
  };

  const hasRemaps = Object.keys(settings.remaps).length > 0;
  return (
    <div className="page-stack">
      <PageHeader title="Keyboard" subtitle="Shortcuts for this device." />
      <p className="sr-only" role="status">
        {status}
      </p>
      <section className="settings-section" aria-labelledby={`${idPrefix}-single`} data-setting-field="keyboard/single-key" tabIndex={-1}>
        <h2 id={`${idPrefix}-single`}>This device</h2>
        <SingleKeySwitch />
        <p className="help-text">This and every change below is kept on this device only. Another device has its own.</p>
      </section>
      {groupRows(keymap.rows).map(({ group, rows }, groupIndex) => (
        <section className="settings-section" key={group} aria-labelledby={`${idPrefix}-group-${groupIndex}`} {...(groupIndex === 0 ? { 'data-setting-field': 'keyboard/shortcuts', tabIndex: -1 } : {})}>
          <h2 id={`${idPrefix}-group-${groupIndex}`}>{group}</h2>
          <ul className="settings-list">
            {rows.map((row) => {
              const waiting = capturing === row.def.action;
              return (
                <li key={row.def.action} className="settings-row">
                  <div className="settings-row-text">
                    <span id={`${idPrefix}-row-${keymap.rows.indexOf(row)}`}>{row.def.label}</span>
                    {row.binding && !row.active && <span className="help-text">Off while single-key shortcuts are off.</span>}
                    {waiting && problem && (
                      <span className="error-text" role="alert">
                        {problem}
                      </span>
                    )}
                  </div>
                  <div className="settings-actions">
                    {row.binding ? <Keycaps binding={row.binding} /> : <span className="help-text">Not set</span>}
                    <button
                      type="button"
                      className={`btn btn--secondary${waiting ? ' is-capturing' : ''}`}
                      data-key-capture={waiting ? '' : undefined}
                      aria-label={waiting ? undefined : `Change shortcut for ${row.def.label}`}
                      aria-describedby={waiting ? `${idPrefix}-row-${keymap.rows.indexOf(row)}` : undefined}
                      onClick={() => {
                        setCapturing(waiting ? undefined : row.def.action);
                        setProblem(undefined);
                      }}
                      onKeyDown={(event) => onCaptureKey(event, row)}
                      onBlur={() => waiting && setCapturing(undefined)}
                    >
                      {waiting ? 'Press the new keys, or Esc to cancel' : 'Change'}
                    </button>
                    {row.remapped && (
                      <button type="button" className="btn btn--ghost" aria-label={`Reset ${row.def.label} to ${keycaps(row.def.default, platform).join(' then ')}`} onClick={() => reset(row)}>
                        Reset
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <div className="settings-actions">
        <button type="button" className="btn btn--secondary" disabled={!hasRemaps} onClick={() => {
            const before = settings;
            saveKeyboardSettings({ ...settings, remaps: {} });
            toast('Every shortcut is back to its default', { tone: 'info', undo: () => saveKeyboardSettings(before) });
          }}>
          Reset all shortcuts
        </button>
      </div>
    </div>
  );
}
