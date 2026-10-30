// An answered decision leaves Needs you by folding into where its agent is drawn (design-system.md §4.7, "Moving across the Desk"): the card is one View Transition
// element (`fold`) and the agent's sigil is its other end, so the browser carries the card across the screen and into the sigil. The cards and blocks below it are named
// (`decision-*`) so that they glide up into the gap instead of jumping. The look of it, as the browser draws it, is in `decision-card.css`.
import { morph } from '../../motion.ts';

/** The places the crew is drawn on a wide screen and on a phone: the sidebar's list, the rail's, and Today's row of tiles. */
const CREW_PLACES = ['.crewlist', '.rail__crew', '.today-tiles'];

/** Where the phone's tab bar counts what needs the owner, and the pill at the top of Today that says it in words. */
const COUNTS = ['.tabbar .tab[href^="/today"] .count', '.today-pill'];

/** What stays where it is on the screen while a card glides: the app bar, the sticky status banner, the phone's tab bar and the toasts. */
const CHROME = '.appbar, .banners[data-sticky], .tabbar, .toasts';

/** What a card offers to do, as a keyboard moves to it: the answer's own buttons, its choices and its field. */
const ACTIONS = '[data-act]:not(:disabled), .chip:not(:disabled), input:not(:disabled)';

/**
 * Where a folded card lands: the agent's sigil in the crew (sidebar, rail or Today's tiles), the first of them that is on screen; else the tab bar's count of what
 * needs the owner, else the pill at the top of Today. Nothing, when none of these is on screen: the card then only fades away.
 */
function landingFor(profile: string | undefined): HTMLElement | undefined {
  const sigils = profile === undefined ? [] : CREW_PLACES.flatMap((place) => [...document.querySelectorAll<HTMLElement>(`${place} .sigil[data-profile="${CSS.escape(profile)}"]`)]);
  const counts = COUNTS.flatMap((selector) => [...document.querySelectorAll<HTMLElement>(selector)]);
  return [...sigils, ...counts].find((element) => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && box.bottom > 0 && box.right > 0 && box.top < window.innerHeight && box.left < window.innerWidth;
  });
}

/**
 * Takes the card away (`remove` makes the change in React's state) as a morph into where its agent is drawn. The other cards and the blocks after the card's own block are
 * named for it, so they glide up into the gap. The page's fixed and sticky chrome is named too: a named element is drawn above the page's own snapshot, so without a name
 * of its own a card that glides under the tab bar, the app bar or a toast would cover it. When the keyboard was in the card, it moves, in the same change that removes the
 * card (also when there is no animation), to the next card's first action, else the previous card's, else the block's title. Resolves when the animation has finished, and the
 * landing place has given its small spring bump.
 */
export async function fold(card: HTMLElement, profile: string | undefined, remove: () => void): Promise<void> {
  const landing = landingFor(profile);
  const neighbours = [...(card.parentElement?.children ?? [])].filter((sibling) => sibling !== card);
  for (let after = card.closest('.today-block')?.nextElementSibling; after; after = after.nextElementSibling) neighbours.push(after);
  const movers = neighbours.filter((neighbour) => neighbour instanceof HTMLElement);
  const chrome = [...document.querySelectorAll<HTMLElement>(CHROME)];
  const kept = card.contains(document.activeElement) || document.activeElement === document.body || document.activeElement === null;
  const refocus = kept
    ? [card.nextElementSibling, card.previousElementSibling].flatMap((sibling) => sibling?.querySelector<HTMLElement>(ACTIONS) ?? [])[0] ?? card.closest('.today-block')?.querySelector<HTMLElement>('.today-block__title')
    : undefined;
  movers.forEach((mover, at) => {
    mover.style.setProperty('view-transition-name', `decision-${at}`);
    mover.style.setProperty('view-transition-class', 'decision');
  });
  chrome.forEach((bar, at) => bar.style.setProperty('view-transition-name', `decision-chrome-${at}`));
  card.style.setProperty('view-transition-name', 'fold');
  try {
    await morph(() => {
      remove();
      landing?.style.setProperty('view-transition-name', 'fold');
      if (refocus?.isConnected) {
        // A title takes the focus only from a program.
        if (refocus.tabIndex < 0 && !refocus.hasAttribute('tabindex')) refocus.tabIndex = -1;
        refocus.focus({ preventScroll: true });
      }
    });
  } finally {
    for (const element of [...movers, ...chrome]) {
      element.style.removeProperty('view-transition-name');
      element.style.removeProperty('view-transition-class');
    }
    landing?.style.removeProperty('view-transition-name');
  }
  if (landing) void land(landing);
}

/** The place a card folded into gives a small spring bump (`[data-landed]` in `decision-card.css`; none under reduced motion, where its duration is 0). */
async function land(landing: HTMLElement): Promise<void> {
  landing.setAttribute('data-landed', '');
  await Promise.allSettled(landing.getAnimations().map((animation) => animation.finished));
  landing.removeAttribute('data-landed');
}
