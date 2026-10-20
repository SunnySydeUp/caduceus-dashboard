// What a key press does (information architecture §8): a pure step function over the keymap, so the whole keyboard
// flow (the `g` then a key jump, ⌘K, `?`, single-key shortcuts that stay out of text fields and open sheets) is tested
// with no browser. The shell feeds it real key presses and carries out what it says to run.

import { isSingleKey, stepOf, type Keymap, type KeyInput, type Platform } from './shortcuts.ts';

export interface FlowState {
  /** The first step of a two-step binding that has been typed (`g`), while the next key is awaited. */
  pending: string | undefined;
}

export const IDLE: FlowState = { pending: undefined };

/** Where the key press happened. */
export interface FlowContext {
  platform: Platform;
  /** Focus is in a text field, where single keys are typing. */
  editable: boolean;
  /** A sheet, dialog or the palette is open over the page. */
  layerOpen: boolean;
  /** Settings › Keyboard is waiting for the keys of a new binding, so no shortcut may run. */
  capturing: boolean;
}

export interface FlowResult {
  state: FlowState;
  /** The action id to carry out. */
  run?: string;
  /** The key press was a shortcut's: the browser's own handling (`preventDefault`) should not happen. */
  handled: boolean;
}

/**
 * One key press, or the timeout that ends a pending `g`. Shortcuts with ⌘, Ctrl or Alt work everywhere; single-key
 * shortcuts (and the `g` that begins a jump) only on the page itself: not while typing in a field, not over an open
 * sheet. A key that does not complete a pending jump cancels it and is then treated as any other key. A bare modifier
 * (Shift pressed on the way to `?`) changes nothing.
 */
export function keyFlow(state: FlowState, input: KeyInput | 'timeout', context: FlowContext, keymap: Keymap): FlowResult {
  if (input === 'timeout' || context.capturing) return { state: IDLE, handled: false };
  if (input.repeat || input.isComposing) return { state, handled: false };
  const step = stepOf(input, context.platform);
  if (step === undefined) return { state, handled: false };

  const reachable = (binding: string) => !isSingleKey(binding) || (!context.editable && !context.layerOpen);
  if (state.pending !== undefined) {
    const jump = `${state.pending} ${step}`;
    const action = keymap.actionFor(jump);
    if (action !== undefined && reachable(jump)) return { state: IDLE, run: action, handled: true };
  }
  const action = keymap.actionFor(step);
  if (action !== undefined && reachable(step)) return { state: IDLE, run: action, handled: true };
  if (keymap.startsSequence(step) && reachable(step)) return { state: { pending: step }, handled: true };
  return { state: IDLE, handled: false };
}
