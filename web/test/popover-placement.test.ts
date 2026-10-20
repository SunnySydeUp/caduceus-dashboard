import { describe, expect, test } from 'vitest';
import { placePopover } from '../src/popover-placement.ts';

/** A term 60 px wide and 20 px tall, `left` px from the viewport's left edge and `top` px from its top. */
const term = (left: number, top: number) => ({ left, right: left + 60, top, bottom: top + 20 });
const popup = { width: 200, height: 100 };
const phone = { width: 320, height: 568 };

describe('placing a glossary pop-up beside its term', () => {
  test('it opens below the term, its start edge under the term’s, and one clear gap away', () => {
    expect(placePopover({ anchor: term(40, 100), size: popup, viewport: phone, rtl: false })).toEqual({ inlineStart: 40, blockStart: 128 });
  });

  test('it stays inside the viewport: a term near the end edge pulls it back, and a pop-up wider than the viewport sits at the margin', () => {
    // 260 + 200 would run past 312 (the viewport less its margin): the pop-up ends at the margin instead.
    expect(placePopover({ anchor: term(260, 100), size: popup, viewport: phone, rtl: false })).toEqual({ inlineStart: 112, blockStart: 128 });
    expect(placePopover({ anchor: term(10, 100), size: { width: 400, height: 100 }, viewport: phone, rtl: false })).toEqual({ inlineStart: 8, blockStart: 128 });
  });

  test('in a right-to-left page the inline offset counts from the right edge, so the pop-up still lines up with the term', () => {
    // The term's right edge is at 280, so its start edge is 40 from the right edge of a 320 px viewport.
    expect(placePopover({ anchor: term(220, 100), size: popup, viewport: phone, rtl: true })).toEqual({ inlineStart: 40, blockStart: 128 });
    // A term near the left edge, which is its end edge here, pulls the pop-up back from the right edge instead.
    expect(placePopover({ anchor: term(10, 100), size: popup, viewport: phone, rtl: true })).toEqual({ inlineStart: 112, blockStart: 128 });
  });

  test('with no room below it opens above the term, and with room on neither side it stays below, pulled up to fit inside the viewport', () => {
    expect(placePopover({ anchor: term(40, 500), size: popup, viewport: phone, rtl: false })).toEqual({ inlineStart: 40, blockStart: 392 });
    // A 520 px pop-up in a 568 px viewport fits neither below a term at 300 (328 + 520 is past 560) nor above it.
    expect(placePopover({ anchor: term(40, 300), size: { width: 200, height: 520 }, viewport: phone, rtl: false })).toEqual({ inlineStart: 40, blockStart: 40 });
  });

  test('a pop-up that ends exactly one gap short of the viewport’s edge fits below, and one pixel more sends it above', () => {
    // The term's bottom is at 452, so the pop-up spans 460–560 of 568: its margin to the edge is exactly the gap.
    expect(placePopover({ anchor: term(40, 432), size: popup, viewport: phone, rtl: false }).blockStart).toBe(460);
    expect(placePopover({ anchor: term(40, 433), size: popup, viewport: phone, rtl: false }).blockStart).toBe(325);
    // Inside the gap to the edge is not fitting: 564 is within the viewport, but not clear of its margin.
    expect(placePopover({ anchor: term(40, 436), size: popup, viewport: phone, rtl: false }).blockStart).toBe(328);
  });

  test('a pop-up that fits above with exactly one gap to spare opens above, and with less it stays below, pulled up to fit', () => {
    const tall = { width: 200, height: 500 };
    // Above the term at 516 the pop-up starts at 8, the gap from the viewport's edge.
    expect(placePopover({ anchor: term(40, 516), size: tall, viewport: phone, rtl: false }).blockStart).toBe(8);
    // At 510 it would start at 2, past the margin: it stays below, pulled up to end one gap from the edge (568 less 8 less 500).
    expect(placePopover({ anchor: term(40, 510), size: tall, viewport: phone, rtl: false }).blockStart).toBe(60);
  });

  test('a pop-up taller than the viewport starts at the margin and runs off the far edge', () => {
    expect(placePopover({ anchor: term(40, 100), size: { width: 200, height: 600 }, viewport: phone, rtl: false }).blockStart).toBe(8);
  });
});
