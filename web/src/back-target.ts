// Where the app bar's "Back" button leads on a phone. Pure: the app bar reads the route and the module and says what the button does.
import type { AppModule } from './app-registry.ts';
import type { RouteInfo } from './shell/navigation.tsx';

/** What the Back button does: go back in history (the user came from another screen of the app), or open `to` (a direct load has nothing to go back to). */
export interface BackAction {
  /** The page "up" from here; the link's address, and where a press leads when there is no history to go back through. */
  to: string;
  /** Go back through the browser history. */
  history: boolean;
}

/**
 * The page one level up from this route: its parent, else one level up inside the module, else Control (for a module in Control) or nowhere (`null`: the
 * page is a top-level screen). A Talk thread's parent is the Talk list, which on a phone opens the latest thread again, so there "up" is Today.
 */
export function upTarget(info: RouteInfo, module: AppModule | undefined): string | null {
  const up = (() => {
    if (info.parent) return info.parent;
    if (info.title === 'Control') return null;
    if (!module) return '/';
    if (info.pathname === module.path) return module.desk === 'control' ? '/control' : null;
    const above = info.pathname.slice(0, info.pathname.lastIndexOf('/'));
    return above.startsWith(module.path) ? above : module.path;
  })();
  return up !== null && module?.desk === 'talk' && up === module.path ? '/today' : up;
}

/**
 * "Back" goes where the user came from when they arrived from another screen of the app (`canGoBack`), so a task opened from Today returns to Today.
 * On a direct load (a link, a reload with no history) there is nothing to go back to, so it goes up the tree.
 */
export function backAction(info: RouteInfo, module: AppModule | undefined, canGoBack: boolean): BackAction | null {
  const to = upTarget(info, module);
  return to === null ? null : { to, history: canGoBack };
}
