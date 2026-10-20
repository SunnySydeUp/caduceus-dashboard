import { describe, expect, test } from 'vitest';
import { CANCEL_DISTANCE_PX, HOLD_MS, initialPress, pressStep, type PressEvent, type PressState, type PressEffect } from '../src/modules/voice/hold-to-talk.ts';

// The phone's hold-to-talk (mobile-and-interaction.md §3): hold the mic to talk, release to finish, slide away to cancel; a quick tap is the
// visible alternative, which starts listening and keeps on until the next tap. Pure: the page feeds it pointer events.
function run(events: PressEvent[], from: PressState = initialPress): { state: PressState; effects: PressEffect[] } {
  let state = from;
  const effects: PressEffect[] = [];
  for (const event of events) {
    const step = pressStep(state, event);
    state = step.state;
    if (step.effect) effects.push(step.effect);
  }
  return { state, effects };
}

describe('hold to talk', () => {
  test('pressing starts listening at once', () => {
    expect(run([{ type: 'down', x: 100, y: 500, at: 0 }]).effects).toEqual(['start']);
  });

  test('releasing after a hold, in place, finishes the recording', () => {
    const { effects, state } = run([
      { type: 'down', x: 100, y: 500, at: 0 },
      { type: 'up', x: 102, y: 498, at: HOLD_MS + 50 },
    ]);
    expect(effects).toEqual(['start', 'finish']);
    expect(state).toEqual(initialPress);
  });

  test('sliding away and releasing cancels, and sliding back in time finishes after all', () => {
    const away = { x: 100 + CANCEL_DISTANCE_PX + 1, y: 500 };
    expect(run([{ type: 'down', x: 100, y: 500, at: 0 }, { type: 'move', ...away }, { type: 'up', ...away, at: 900 }]).effects).toEqual(['start', 'cancel']);
    expect(run([{ type: 'down', x: 100, y: 500, at: 0 }, { type: 'move', ...away }, { type: 'move', x: 100, y: 500 }, { type: 'up', x: 100, y: 500, at: 900 }]).effects).toEqual(['start', 'finish']);
  });

  test('the press says when it is about to cancel, so the screen can tell the owner', () => {
    const down = pressStep(initialPress, { type: 'down', x: 100, y: 500, at: 0 }).state;
    expect(down.away).toBe(false);
    expect(pressStep(down, { type: 'move', x: 100, y: 500 - CANCEL_DISTANCE_PX - 1 }).state.away).toBe(true);
  });

  test('a quick tap keeps listening until the next tap, which finishes', () => {
    const tapped = run([
      { type: 'down', x: 100, y: 500, at: 0 },
      { type: 'up', x: 100, y: 500, at: HOLD_MS - 50 },
    ]);
    expect(tapped.effects).toEqual(['start']);
    expect(tapped.state.phase).toBe('toggled');
    expect(run([{ type: 'down', x: 100, y: 500, at: 5000 }, { type: 'up', x: 100, y: 500, at: 5060 }], tapped.state).effects).toEqual(['finish']);
  });

  test('a tap that slides away is no tap: it cancels', () => {
    expect(run([{ type: 'down', x: 100, y: 500, at: 0 }, { type: 'move', x: 100, y: 500 + CANCEL_DISTANCE_PX + 5 }, { type: 'up', x: 100, y: 500 + CANCEL_DISTANCE_PX + 5, at: 100 }]).effects).toEqual(['start', 'cancel']);
  });

  test('the system taking the touch away (a call, a swipe back) cancels', () => {
    expect(run([{ type: 'down', x: 100, y: 500, at: 0 }, { type: 'abort' }]).effects).toEqual(['start', 'cancel']);
  });

  test('a toggled recording is finished or cancelled by the visible buttons too', () => {
    const toggled: PressState = { phase: 'toggled', startX: 0, startY: 0, away: false };
    expect(run([{ type: 'abort' }], toggled).effects).toEqual(['cancel']);
    expect(run([{ type: 'move', x: 999, y: 999 }], toggled).effects).toEqual([]);
  });
});
