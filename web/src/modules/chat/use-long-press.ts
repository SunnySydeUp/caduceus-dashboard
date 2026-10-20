// A press and hold on a message opens its menu (M1 #12), with a haptic tick where the device has one. Only a press that stays put counts, and one that
// began selecting text does not: the owner holding a word to select it is not asking for a menu. The ⋮ button opens the same menu without a gesture.
import { useRef, type TouchEvent } from 'react';
import { LONG_PRESS_MS, pressMoved } from './sessions-gestures.ts';
import { swallowReleaseClick } from './use-row-gestures.ts';

/** What on a message is its own control: a press there is that control's, not the message's. */
const OWN_CONTROLS = 'a, button, input, textarea, select, summary, [role="button"], [data-no-press]';

export function useLongPress(onLongPress: () => void, enabled = true) {
  const timer = useRef<number | undefined>(undefined);
  const start = useRef<{ x: number; y: number } | undefined>(undefined);
  const stop = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    start.current = undefined;
  };
  return {
    onTouchStart(event: TouchEvent) {
      if (!enabled || event.touches.length !== 1 || (event.target as Element).closest(OWN_CONTROLS)) return;
      const touch = event.touches[0]!;
      start.current = { x: touch.clientX, y: touch.clientY };
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        stop();
        if ((window.getSelection()?.toString() ?? '') !== '') return;
        navigator.vibrate?.(10);
        swallowReleaseClick();
        onLongPress();
      }, LONG_PRESS_MS);
    },
    onTouchMove(event: TouchEvent) {
      const from = start.current;
      const touch = event.touches[0];
      if (from && touch && pressMoved({ startX: from.x, startY: from.y, x: touch.clientX, y: touch.clientY })) stop();
    },
    onTouchEnd: stop,
    onTouchCancel: stop,
  };
}
