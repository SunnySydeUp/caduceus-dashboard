// Where a glossary pop-up (M1 #02) opens: beside the term that asked for it and always inside the viewport, which a pop-up
// in the browser's top layer (a `popover`) has to work out for itself. Pure geometry, in CSS pixels from the viewport's edges.

export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** The clear gap between the term and its pop-up, and between the pop-up and the viewport's edge. */
const GAP = 8;

/**
 * The offsets of the pop-up from the viewport's block-start and inline-start edges (`inset-block-start` and
 * `inset-inline-start`, which in a right-to-left page count from the right edge, so `rtl` says which). It opens below the
 * term with its start edge under the term's; with no room below it opens above, and with room on neither side it stays
 * below, pulled up to fit. Along the line it is pulled back from the end edge, and a pop-up wider than the viewport sits
 * at the margin.
 */
export function placePopover({ anchor, size, viewport, rtl }: { anchor: Box; size: { width: number; height: number }; viewport: { width: number; height: number }; rtl: boolean }): {
  inlineStart: number;
  blockStart: number;
} {
  const inline = rtl ? viewport.width - anchor.right : anchor.left;
  const below = anchor.bottom + GAP;
  const above = anchor.top - GAP - size.height;
  const preferred = below + size.height <= viewport.height - GAP ? below : above >= GAP ? above : below;
  return {
    inlineStart: Math.max(GAP, Math.min(inline, viewport.width - GAP - size.width)),
    blockStart: Math.max(GAP, Math.min(preferred, viewport.height - GAP - size.height)),
  };
}
