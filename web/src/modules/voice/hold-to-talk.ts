// The phone's hold-to-talk (M7 #07; mobile-and-interaction.md §3), free of the DOM and of React: the mic starts listening the moment it is pressed.
// Held, it finishes on release and cancels when the finger has slid away. A quick tap is the visible alternative: it keeps listening until the next
// tap. The page feeds pointer events in and does what the effect says.

/** A press shorter than this is a tap; a longer one is a hold. */
export const HOLD_MS = 350;
/** How far (px) the finger may slide from where it pressed before releasing cancels. */
export const CANCEL_DISTANCE_PX = 72;

export interface PressState {
  /** `pressing`: the finger is down; `toggled`: a tap started it and it listens until the next tap. */
  phase: 'idle' | 'pressing' | 'toggled';
  startX: number;
  startY: number;
  startAt?: number;
  /** The finger is far enough from where it pressed that releasing now cancels. */
  away: boolean;
}

export type PressEvent = { type: 'down'; x: number; y: number; at: number } | { type: 'move'; x: number; y: number } | { type: 'up'; x: number; y: number; at: number } | { type: 'abort' };

/** What the page does about the event: start listening, take what was said, or throw it away. */
export type PressEffect = 'start' | 'finish' | 'cancel';

export const initialPress: PressState = { phase: 'idle', startX: 0, startY: 0, away: false };

const farFrom = (state: PressState, x: number, y: number) => Math.hypot(x - state.startX, y - state.startY) > CANCEL_DISTANCE_PX;

export function pressStep(state: PressState, event: PressEvent): { state: PressState; effect?: PressEffect } {
  switch (event.type) {
    case 'down':
      // A tap while a tap-started recording listens is the tap that ends it; the release finishes.
      if (state.phase === 'toggled') return { state: { ...state, startAt: event.at, startX: event.x, startY: event.y, away: false } };
      return { state: { phase: 'pressing', startX: event.x, startY: event.y, startAt: event.at, away: false }, effect: 'start' };
    case 'move':
      if (state.phase !== 'pressing') return { state };
      return { state: { ...state, away: farFrom(state, event.x, event.y) } };
    case 'up': {
      if (state.phase === 'toggled') return { state: initialPress, effect: 'finish' };
      if (state.phase !== 'pressing') return { state };
      if (farFrom(state, event.x, event.y) && state.away) return { state: initialPress, effect: 'cancel' };
      if (event.at - (state.startAt ?? event.at) < HOLD_MS) return { state: { ...state, phase: 'toggled', away: false } };
      return { state: initialPress, effect: 'finish' };
    }
    case 'abort':
      return state.phase === 'idle' ? { state } : { state: initialPress, effect: 'cancel' };
  }
}
