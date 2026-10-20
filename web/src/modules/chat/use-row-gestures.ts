// What a finger does to a session row on a phone (M1 #14): a swipe right archives, a swipe left pins, a long press opens the row's menu (with a haptic
// tick where the device has one). The rules are `sessions-gestures.ts`; this is only the touch events and the state the row is drawn from. A gesture
// that ended on the row also swallows the click that follows it, so that a swipe or a long press never opens the session.
import { useRef, useState, type MouseEvent, type TouchEvent } from 'react';
import { LONG_PRESS_MS, pressMoved, swipeAction, swipeIntent, swipeOffset } from './sessions-gestures.ts';

export type SwipeKind = 'archive' | 'pin';

interface Options {
  /** Off while the owner is selecting rows, where a touch means choosing. */
  enabled: boolean;
  onSwipe(action: SwipeKind): void;
  onLongPress(): void;
}

interface Drag {
  /** Where the row is drawn (px sideways). */
  offset: number;
  /** What letting go now would do. */
  action: SwipeKind | undefined;
}

const REST: Drag = { offset: 0, action: undefined };

/** A short tick from the device where it has one (not every browser does, and none is asked to). */
const tick = () => void navigator.vibrate?.(10);

/** How long (ms) after the finger comes up a click is still taken for the tail of the press that opened the menu. */
const RELEASE_CLICK_MS = 600;

/**
 * The menu a long press opens appears under the finger, and some browsers send a click when it lifts: it would choose the entry beneath. The first click
 * after the finger comes up is swallowed. A browser that sends none loses nothing: the guard lapses `RELEASE_CLICK_MS` after the release.
 */
export function swallowReleaseClick(): void {
  const stop = (event: Event) => {
    event.stopPropagation();
    event.preventDefault();
    lift();
  };
  const lift = () => {
    window.removeEventListener('click', stop, true);
    window.removeEventListener('touchend', released, true);
    window.removeEventListener('touchcancel', released, true);
  };
  const released = () => {
    window.removeEventListener('touchend', released, true);
    window.removeEventListener('touchcancel', released, true);
    window.setTimeout(lift, RELEASE_CLICK_MS);
  };
  window.addEventListener('click', stop, true);
  window.addEventListener('touchend', released, true);
  window.addEventListener('touchcancel', released, true);
}

export function useRowGestures({ enabled, onSwipe, onLongPress }: Options) {
  const finger = useRef<{ startX: number; startY: number; intent: 'horizontal' | 'vertical' | undefined; dx: number } | undefined>(undefined);
  const timer = useRef<number | undefined>(undefined);
  const last = useRef<SwipeKind | undefined>(undefined);
  const swallow = useRef(false);
  const [drag, setDrag] = useState<Drag>(REST);

  const stopTimer = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  const settle = () => {
    stopTimer();
    finger.current = undefined;
    last.current = undefined;
    setDrag(REST);
  };

  return {
    offset: drag.offset,
    action: drag.action,
    handlers: {
      onTouchStart(event: TouchEvent) {
        if (!enabled || event.touches.length !== 1) return;
        const touch = event.touches[0]!;
        swallow.current = false;
        finger.current = { startX: touch.clientX, startY: touch.clientY, intent: undefined, dx: 0 };
        stopTimer();
        timer.current = window.setTimeout(() => {
          if (finger.current?.intent === 'horizontal') return;
          swallow.current = true;
          settle();
          tick();
          swallowReleaseClick();
          onLongPress();
        }, LONG_PRESS_MS);
      },
      onTouchMove(event: TouchEvent) {
        const now = finger.current;
        if (!now) return;
        const touch = event.touches[0]!;
        const moved = { startX: now.startX, startY: now.startY, x: touch.clientX, y: touch.clientY };
        if (pressMoved(moved)) stopTimer();
        now.intent ??= swipeIntent(moved);
        if (now.intent !== 'horizontal') return;
        now.dx = moved.x - moved.startX;
        const action = swipeAction(now.dx);
        if (action !== undefined && action !== last.current) tick();
        last.current = action;
        setDrag({ offset: swipeOffset(now.dx), action });
      },
      onTouchEnd() {
        const done = finger.current;
        const action = done?.intent === 'horizontal' ? swipeAction(done.dx) : undefined;
        if (done?.intent === 'horizontal') swallow.current = true;
        settle();
        if (action !== undefined) onSwipe(action);
      },
      onTouchCancel: settle,
      /** Android opens a context menu on a long press: it is the row's menu that opens, not the browser's. */
      onContextMenu(event: MouseEvent) {
        if (enabled && finger.current === undefined && swallow.current) event.preventDefault();
      },
    },
    /** Called by the row's link before it follows itself: true when a gesture just ended there and the click is its tail. */
    swallowsClick(): boolean {
      const swallowed = swallow.current;
      swallow.current = false;
      return swallowed;
    },
  };
}
