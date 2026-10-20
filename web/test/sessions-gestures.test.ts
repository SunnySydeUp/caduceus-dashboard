import { describe, expect, test } from 'vitest';
import {
  EMPTY_SELECTION,
  keepPresent,
  LONG_PRESS_SLOP,
  pressMoved,
  selectAll,
  selectRange,
  swipeAction,
  swipeIntent,
  swipeOffset,
  SWIPE_COMMIT,
  SWIPE_MAX,
  toggle,
} from '../src/modules/chat/sessions-gestures.ts';

// The pure rules behind bulk select and the phone gestures of the sessions list: which rows a click or a shift-click selects, and what a finger on a row means.
const order = ['a', 'b', 'c', 'd', 'e', 'f'];

describe('selecting rows', () => {
  test('a click toggles one row and makes it the anchor of the next range', () => {
    const one = toggle(EMPTY_SELECTION, 'b');
    expect(one).toEqual({ ids: ['b'], anchor: 'b' });
    expect(toggle(one, 'd')).toEqual({ ids: ['b', 'd'], anchor: 'd' });
    expect(toggle(toggle(one, 'd'), 'b')).toEqual({ ids: ['d'], anchor: 'b' });
  });

  test('a shift-click selects every row from the anchor to the one clicked, in either direction, and keeps what was selected', () => {
    const anchored = toggle(toggle(EMPTY_SELECTION, 'f'), 'b');
    expect(selectRange(anchored, order, 'd')).toEqual({ ids: ['f', 'b', 'c', 'd'], anchor: 'b' });
    expect(selectRange(anchored, order, 'a')).toEqual({ ids: ['f', 'b', 'a'], anchor: 'b' });
    expect(selectRange(toggle(EMPTY_SELECTION, 'e'), order, 'b').ids).toEqual(['e', 'd', 'c', 'b']);
  });

  test('a shift-click with no anchor, or an anchor that has left the list, is a plain click', () => {
    expect(selectRange(EMPTY_SELECTION, order, 'c')).toEqual({ ids: ['c'], anchor: 'c' });
    expect(selectRange({ ids: ['gone'], anchor: 'gone' }, order, 'c')).toEqual({ ids: ['gone', 'c'], anchor: 'c' });
  });

  test('select all takes every row there is, and what the list no longer has drops out of a selection', () => {
    expect(selectAll(order)).toEqual({ ids: order, anchor: undefined });
    expect(keepPresent({ ids: ['a', 'gone', 'c'], anchor: 'gone' }, order)).toEqual({ ids: ['a', 'c'], anchor: undefined });
    const same = { ids: ['a'], anchor: 'a' };
    expect(keepPresent(same, order)).toBe(same);
  });
});

describe('a finger on a row', () => {
  test('a movement is horizontal or vertical once it is clear which, and vertical means the owner is scrolling', () => {
    expect(swipeIntent({ startX: 100, startY: 100, x: 104, y: 106 })).toBeUndefined();
    expect(swipeIntent({ startX: 100, startY: 100, x: 140, y: 108 })).toBe('horizontal');
    expect(swipeIntent({ startX: 100, startY: 100, x: 60, y: 90 })).toBe('horizontal');
    expect(swipeIntent({ startX: 100, startY: 100, x: 108, y: 150 })).toBe('vertical');
    // A diagonal that is not clearly sideways is a scroll.
    expect(swipeIntent({ startX: 100, startY: 100, x: 130, y: 130 })).toBe('vertical');
  });

  test('the row follows the finger with resistance, and never further than the most it can show', () => {
    expect(swipeOffset(0)).toBe(0);
    expect(swipeOffset(40)).toBe(40);
    expect(swipeOffset(-40)).toBe(-40);
    expect(swipeOffset(SWIPE_COMMIT * 3)).toBe(SWIPE_MAX);
    expect(swipeOffset(-SWIPE_COMMIT * 3)).toBe(-SWIPE_MAX);
    expect(swipeOffset(SWIPE_COMMIT + 20)).toBeLessThan(SWIPE_COMMIT + 20);
    expect(swipeOffset(SWIPE_COMMIT + 20)).toBeGreaterThanOrEqual(SWIPE_COMMIT);
  });

  test('letting go right of the commit distance archives, left of it pins, and anything short of it does nothing', () => {
    expect(swipeAction(SWIPE_COMMIT)).toBe('archive');
    expect(swipeAction(SWIPE_COMMIT + 50)).toBe('archive');
    expect(swipeAction(-SWIPE_COMMIT)).toBe('pin');
    expect(swipeAction(-SWIPE_COMMIT - 50)).toBe('pin');
    expect(swipeAction(SWIPE_COMMIT - 1)).toBeUndefined();
    expect(swipeAction(-(SWIPE_COMMIT - 1))).toBeUndefined();
    expect(swipeAction(0)).toBeUndefined();
  });

  test('a press that has moved more than a few pixels is not a long press', () => {
    expect(pressMoved({ startX: 10, startY: 10, x: 10 + LONG_PRESS_SLOP, y: 10 })).toBe(false);
    expect(pressMoved({ startX: 10, startY: 10, x: 10, y: 10 - LONG_PRESS_SLOP - 1 })).toBe(true);
    expect(pressMoved({ startX: 10, startY: 10, x: 16, y: 16 })).toBe(true);
  });
});
