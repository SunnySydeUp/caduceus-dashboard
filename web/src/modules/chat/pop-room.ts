// How much room a composer popover has above the composer (M8 #09). A popover opens upward from the composer, which in a short chat sits in the middle of the page and in a
// long one at the bottom of the window; either way the panel must stop where the page's own scrolling area, or the app bar over it, begins, and scroll inside. The room is
// measured when the popover is asked to open and kept on the composer as `--pop-room`, which the panels' CSS reads.

/** Smallest room worth measuring to: a menu of two rows still shows. */
const LEAST_PX = 128;

/** The distance from the top of what the composer's popovers may cover down to the composer, less a margin. */
export function popRoom(composer: HTMLElement): number {
  let top = Math.max(document.querySelector('.appbar')?.getBoundingClientRect().bottom ?? 0, document.querySelector('.talk__header')?.getBoundingClientRect().bottom ?? 0);
  for (let parent = composer.parentElement; parent; parent = parent.parentElement) {
    if (getComputedStyle(parent).overflowY !== 'visible') {
      top = Math.max(top, parent.getBoundingClientRect().top);
      break;
    }
  }
  return Math.max(LEAST_PX, composer.getBoundingClientRect().top - top - 8);
}

/** Records the room above the composer that holds `from`, for the popover about to open. */
export function measureRoom(from: HTMLElement): void {
  const composer = from.closest<HTMLElement>('form');
  composer?.style.setProperty('--pop-room', `${Math.round(popRoom(composer))}px`);
}
