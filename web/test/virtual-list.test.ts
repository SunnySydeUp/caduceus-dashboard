import { describe, expect, test } from 'vitest';
import { FOLLOW_THRESHOLD, captureAnchor, distanceFromEnd, jumpToLatest, layoutOf, restoreAnchor, scrolled, visibleWindow, type FollowState } from '../src/modules/chat/virtual-list.ts';

const estimate = 100;
const none = (count: number) => Array.from<number | undefined>({ length: count });

describe('the visible window', () => {
  test('a 2,000-message transcript at the top: only the first screen and its overscan are in the window', () => {
    const layout = layoutOf(none(2000), estimate, 0);
    const window = visibleWindow({ layout, scrollTop: 0, viewport: 800, overscan: 3 });
    expect(window).toMatchObject({ start: 0, end: 11, before: 0 });
    expect(window.after).toBe((2000 - 11) * estimate);
    expect(layout.total).toBe(200_000);
  });

  test('anchored to the end: the last screen, and the spacer before it makes up the rest', () => {
    const layout = layoutOf(none(2000), estimate, 0);
    const window = visibleWindow({ layout, scrollTop: layout.total - 800, viewport: 800, overscan: 3 });
    expect(window.end).toBe(2000);
    expect(window.start).toBe(1989);
    expect(window.after).toBe(0);
    expect(window.before).toBe(1989 * estimate);
  });

  test('measured heights replace the estimate, and the gap between messages counts', () => {
    const layout = layoutOf([300, 50, undefined, 400, undefined], estimate, 10);
    expect(layout.offsets).toEqual([0, 310, 370, 480, 890, 1000]);
    const window = visibleWindow({ layout, scrollTop: 380, viewport: 100, overscan: 0 });
    expect(window).toMatchObject({ start: 2, end: 3 });
  });

  test('the window never leaves the list: an empty list and a scroll past the end', () => {
    expect(visibleWindow({ layout: layoutOf([], estimate, 0), scrollTop: 0, viewport: 800, overscan: 3 })).toEqual({ start: 0, end: 0, before: 0, after: 0 });
    const layout = layoutOf(none(5), estimate, 0);
    expect(visibleWindow({ layout, scrollTop: 99_999, viewport: 800, overscan: 1 }).end).toBe(5);
  });
});

describe('auto-follow', () => {
  const total = 10_000;
  const viewport = 800;
  const atEnd: FollowState = { following: true, lastTop: total - viewport };

  test('at the end it follows; the reply growing under it does not stop that', () => {
    expect(scrolled(atEnd, { scrollTop: total - viewport, viewport, total: total + 400 }).following).toBe(true);
  });

  test('scrolling up stops following; a jump to the latest resumes', () => {
    const up = scrolled(atEnd, { scrollTop: total - viewport - 500, viewport, total });
    expect(up.following).toBe(false);
    expect(jumpToLatest({ total, viewport })).toEqual({ following: true, lastTop: total - viewport });
  });

  test('once up, growth of the reply does not drag the page back down', () => {
    const up: FollowState = { following: false, lastTop: 4000 };
    expect(scrolled(up, { scrollTop: 4000, viewport, total: total + 900 }).following).toBe(false);
  });

  test('scrolling back down to the end by hand resumes following', () => {
    const up: FollowState = { following: false, lastTop: 4000 };
    expect(scrolled(up, { scrollTop: total - viewport - FOLLOW_THRESHOLD + 1, viewport, total }).following).toBe(true);
  });

  test('the reader scrolling up in small steps (a touch or trackpad scroll, a few pixels a frame) stops following at the first step', () => {
    const step = scrolled(atEnd, { scrollTop: total - viewport - 20, viewport, total });
    expect(step.following).toBe(false);
    expect(scrolled(step, { scrollTop: total - viewport - 40, viewport, total }).following).toBe(false);
  });

  test('a rubber-band bounce past the end, settling back on it, does not stop following', () => {
    const overshoot = scrolled(atEnd, { scrollTop: total - viewport + 60, viewport, total });
    expect(scrolled(overshoot, { scrollTop: total - viewport, viewport, total }).following).toBe(true);
  });

  test('distance from the end is what the jump-to-latest button is shown by', () => {
    expect(distanceFromEnd({ scrollTop: 4000, viewport, total })).toBe(5200);
    expect(distanceFromEnd({ scrollTop: total, viewport, total })).toBe(0);
  });
});

describe('load earlier keeps the reader where they were', () => {
  test('older messages added above: the message at the top of the screen stays at the same place on screen', () => {
    const keys = ['m5', 'm6', 'm7', 'm8'];
    const before = layoutOf([120, 80, 200, 90], estimate, 10);
    const anchor = captureAnchor({ keys, layout: before, scrollTop: 140 });
    expect(anchor).toEqual({ key: 'm6', delta: 10 });

    const nowKeys = ['m1', 'm2', 'm3', 'm4', ...keys];
    const after = layoutOf([60, 60, 60, 60, 120, 80, 200, 90], estimate, 10);
    expect(restoreAnchor(anchor!, nowKeys, after)).toBe(after.offsets[nowKeys.indexOf('m6')]! + 10);
  });

  test('an anchor whose message is gone gives nothing to restore', () => {
    expect(restoreAnchor({ key: 'gone', delta: 5 }, ['a'], layoutOf([10], estimate, 0))).toBeUndefined();
    expect(captureAnchor({ keys: [], layout: layoutOf([], estimate, 0), scrollTop: 0 })).toBeUndefined();
  });
});
