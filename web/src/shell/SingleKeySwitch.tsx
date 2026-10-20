import { useId } from 'react';
import { saveKeyboardSettings } from './keyboard-settings.ts';
import { useKeyboard } from './keyboard-context.tsx';

/**
 * The switch for single-key shortcuts (`g` then a letter, `?`), one of the two ways WCAG 2.1.4 asks for (the other is
 * remapping). It is per device, and shown wherever the shortcuts are: the `?` sheet and Settings › Keyboard.
 */
export function SingleKeySwitch() {
  const { settings } = useKeyboard();
  const id = useId();
  return (
    <div className="switch-row">
      <label htmlFor={id}>
        <strong id={`${id}-name`}>Single-key shortcuts</strong>
        <br />
        <span id={`${id}-help`} className="subtle">
          G then a letter, and ?. Turn them off if they get in the way of speech input or a screen reader. ⌘ and Ctrl shortcuts stay on.
        </span>
      </label>
      <button
        type="button"
        id={id}
        className="switch"
        role="switch"
        aria-checked={settings.singleKey}
        aria-labelledby={`${id}-name`}
        aria-describedby={`${id}-help`}
        onClick={() => saveKeyboardSettings({ ...settings, singleKey: !settings.singleKey })}
      />
    </div>
  );
}
