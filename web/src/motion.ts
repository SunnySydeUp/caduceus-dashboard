// One way to animate a change of the page in place: a View Transition when the browser has one and the owner has not asked for less motion,
// else the change at once. Navigation between pages does not come here: the router runs its own transition (`useAppNavigate`).
import { flushSync } from 'react-dom';

/** True when the owner asked for less motion, in the system or in Caduceus's Appearance setting (`data-motion="reduce"`). */
export function motionReduced(): boolean {
  return document.documentElement.dataset.motion === 'reduce' || matchMedia('(prefers-reduced-motion: reduce)').matches;
}

let current: ViewTransition | undefined;

/**
 * Makes `update` (React state changes in it are flushed at once) inside a View Transition. `types` name the kind of change for CSS
 * (`:active-view-transition-type(...)`), where the browser knows them. A change asked for while another is still running waits until that one has
 * made its own change, then is made without an animation of its own, so two quick changes always land in the order they were asked for. Resolves
 * when the animation has finished (as soon as the change is made when there is none).
 */
export async function morph(update: () => void, { types }: { types?: string[] } = {}): Promise<void> {
  if (current) {
    await current.updateCallbackDone.catch(() => undefined);
    flushSync(update);
    return;
  }
  if (typeof document.startViewTransition !== 'function' || motionReduced()) {
    flushSync(update);
    return;
  }
  const callback = () => flushSync(update);
  let transition: ViewTransition;
  try {
    transition = types ? document.startViewTransition({ update: callback, types }) : document.startViewTransition(callback);
  } catch {
    // Safari 18.0 has View Transitions but not the options object.
    transition = document.startViewTransition(callback);
  }
  current = transition;
  // A transition the browser skips (the tab was hidden) rejects `ready` and `finished`; the change itself is still made.
  transition.ready.catch(() => undefined);
  try {
    await transition.finished;
  } catch {
    // Skipped, or the update itself threw (React reports that).
  } finally {
    if (current === transition) current = undefined;
  }
}
