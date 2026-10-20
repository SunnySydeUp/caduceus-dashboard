// After navigating, focus moves to the new page's heading, so keyboard and screen-reader users start at the top of
// the new page (mobile spec §9). The shell asks for it when the shown route changes; the heading claims it when it
// mounts, or the shell focuses a heading that is already there.

let wanted = false;

/** The shell: the route changed, so the page heading should take focus. Focuses it now if it is already there. */
export function requestHeadingFocus(): void {
  // While the new screen's code loads, React keeps the old page hidden in the DOM; a hidden heading cannot take focus.
  const heading = [...document.querySelectorAll<HTMLElement>('main h1')].find((h) => h.getClientRects().length > 0);
  if (heading) heading.focus({ preventScroll: true });
  else wanted = true;
}

/** A page heading that just mounted: should it take focus? */
export function claimHeadingFocus(): boolean {
  const claimed = wanted;
  wanted = false;
  return claimed;
}
