// The gestures on a card: a long press on touch opens its menu (or, where the board has columns to drag between, lifts it), and a mouse can drag it. Both are
// only enhancements: every change a gesture makes is in the card's menu (⋮, Move to…), which the keyboard reaches. A pointer-events engine, not HTML5
// drag and drop, so that touch and mouse take one path and a long press lifts a card on a phone as well as a drag does on a desktop.
import { useEffect, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';

/** How long a finger rests on a card before it counts as a long press. */
const LONG_PRESS_MS = 450;
/** A finger that moves further than this before the press is long is scrolling. */
const SCROLL_SLOP_PX = 8;
/** A mouse that moves further than this with the button down is dragging. */
const DRAG_SLOP_PX = 5;
/** How long after a drag or a long press a click is still taken to be its release. */
const SWALLOW_MS = 400;

export interface Dragging {
  taskId: string;
  x: number;
  y: number;
}

/** What a card listens to for the gestures: spread on its element. */
export interface CardBinding {
  onPointerDown(event: ReactPointerEvent): void;
  onContextMenu(event: { preventDefault(): void }): void;
}

export interface CardGestures {
  /** The card being carried, where the pointer is. */
  dragging: Dragging | undefined;
  /** The lane under the pointer while a card is carried (its `data-lane`). */
  overLane: string | undefined;
  /** Props for a card: what it listens to. Anything inside it marked `data-nodrag` (its buttons) is left alone. */
  bind(taskId: string): CardBinding;
}

interface Gesture {
  taskId: string;
  pointerId: number;
  type: string;
  startX: number;
  startY: number;
  timer: number | undefined;
  /** The long press fired (a menu opened, or a card was lifted). */
  pressed: boolean;
  dragging: boolean;
}

export interface GestureOptions {
  /** The board has columns to drag between (a wide window), so a mouse drags and a long press lifts. */
  canDrag: boolean;
  /** A long press where nothing is dragged: the card's menu. */
  onMenu(taskId: string): void;
  /** The card was dropped on a lane. */
  onDrop(taskId: string, lane: string): void;
}

const laneAt = (x: number, y: number): string | undefined => document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-lane]')?.dataset.lane;

/** The click that follows a drag or a long press would open the card's peek: it is swallowed. */
function swallowNextClick() {
  const swallow = (event: Event) => event.stopPropagation();
  window.addEventListener('click', swallow, { capture: true, once: true });
  // A touch release can answer with its click a moment later, over the sheet the long press just opened.
  window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), SWALLOW_MS);
}

interface GestureEngine {
  stop(): void;
  /** A card is lifted now. */
  carrying(): boolean;
  /** The pointer that is down is a finger (or its press has fired), so the system's own menu is not wanted. */
  isTouchGesture(): boolean;
  start(taskId: string, event: ReactPointerEvent): void;
}

/** One engine for the life of the board: its listeners are the same functions when they are added and when they are removed. */
function createEngine(options: { current: GestureOptions }, show: (dragging: Dragging | undefined, lane: string | undefined) => void): GestureEngine {
  let gesture: Gesture | undefined;

  const stop = () => {
    window.clearTimeout(gesture?.timer);
    gesture = undefined;
    show(undefined, undefined);
    document.documentElement.classList.remove('is-card-dragging');
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', key);
  };

  const lift = (current: Gesture, x: number, y: number) => {
    current.dragging = true;
    current.pressed = true;
    document.documentElement.classList.add('is-card-dragging');
    navigator.vibrate?.(10);
    show({ taskId: current.taskId, x, y }, laneAt(x, y));
  };

  function move(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const distance = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
    if (!gesture.dragging) {
      if (gesture.type === 'mouse') {
        if (distance > DRAG_SLOP_PX && options.current.canDrag) lift(gesture, event.clientX, event.clientY);
      } else if (!gesture.pressed && distance > SCROLL_SLOP_PX) {
        // The finger moved before the press was long: it is scrolling the board.
        stop();
      }
      return;
    }
    show({ taskId: gesture.taskId, x: event.clientX, y: event.clientY }, laneAt(event.clientX, event.clientY));
  }

  function up(event: PointerEvent) {
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const lane = gesture.dragging ? laneAt(event.clientX, event.clientY) : undefined;
    const { taskId, pressed } = gesture;
    stop();
    if (pressed) swallowNextClick();
    if (lane !== undefined) options.current.onDrop(taskId, lane);
  }

  function cancel(event: PointerEvent) {
    if (event.pointerId !== gesture?.pointerId) return;
    // The sheet a long press opens makes the page inert, which cancels the pointer; the release must still not press what is under the finger.
    if (gesture.pressed) swallowNextClick();
    stop();
  }

  function key(event: KeyboardEvent) {
    if (event.key === 'Escape' && gesture?.dragging) {
      swallowNextClick();
      stop();
    }
  }

  return {
    stop,
    carrying: () => gesture?.dragging === true,
    isTouchGesture: () => gesture?.pressed === true || gesture?.type === 'touch',
    start(taskId: string, event: ReactPointerEvent) {
      if (gesture || (event.pointerType === 'mouse' && event.button !== 0)) return;
      if (event.target instanceof Element && event.target.closest('[data-nodrag]')) return;
      const current: Gesture = { taskId, pointerId: event.pointerId, type: event.pointerType, startX: event.clientX, startY: event.clientY, timer: undefined, pressed: false, dragging: false };
      gesture = current;
      if (event.pointerType !== 'mouse') {
        current.timer = window.setTimeout(() => {
          if (gesture !== current) return;
          if (options.current.canDrag) lift(current, current.startX, current.startY);
          else {
            current.pressed = true;
            navigator.vibrate?.(10);
            options.current.onMenu(taskId);
          }
        }, LONG_PRESS_MS);
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', cancel);
      window.addEventListener('keydown', key);
    },
  };
}

export function useCardGestures(gestureOptions: GestureOptions): CardGestures {
  const [state, setState] = useState<{ dragging: Dragging | undefined; overLane: string | undefined }>({ dragging: undefined, overLane: undefined });
  // The latest options, read by listeners that outlive a render.
  const options = useRef(gestureOptions);
  options.current = gestureOptions;
  const engine = useRef<GestureEngine>(undefined);
  engine.current ??= createEngine(options, (dragging, overLane) => setState({ dragging, overLane }));
  const running = engine.current;

  // While a card is carried on a touch screen, the page must not scroll under the finger.
  useEffect(() => {
    const hold = (event: TouchEvent) => {
      if (running.carrying()) event.preventDefault();
    };
    document.addEventListener('touchmove', hold, { passive: false });
    return () => {
      document.removeEventListener('touchmove', hold);
      running.stop();
    };
  }, [running]);

  return {
    ...state,
    bind: (taskId) => ({
      onPointerDown: (event) => running.start(taskId, event),
      // A long press on a phone would also open the system's own menu for the card's link.
      onContextMenu: (event) => {
        if (running.isTouchGesture()) event.preventDefault();
      },
    }),
  };
}

const WIDE = '(min-width: 1024px)';

/** Whether the window is wide enough to drag cards between columns (1024 px and up). */
export function useWide(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener('change', notify);
      return () => query.removeEventListener('change', notify);
    },
    () => window.matchMedia(WIDE).matches,
  );
}
