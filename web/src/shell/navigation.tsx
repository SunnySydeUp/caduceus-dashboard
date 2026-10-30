import type { ComponentProps, MouseEvent } from 'react';
import { useMatches, useRouter, useSearch } from '@tanstack/react-router';
import { motionReduced } from '../motion.ts';
import { withProfile } from '../profile-scope.ts';
import { closeAllLayers } from '../overlays/layers.ts';
import { deskTravel, placementOfPage } from './nav-order.ts';
import { useRegistry } from './registry-context.tsx';

/** What the router knows about the page being shown. `staticData` comes from the module registry's routes. */
export interface RouteInfo {
  /** The URL path the shown route matched. */
  pathname: string;
  moduleId: string | undefined;
  /** The app bar title when it differs from the module's. A `:name` in it stands for that route parameter (`:name` on `/agents/profiles/:name` is the profile's name). */
  title: string | undefined;
  parent: string | undefined;
}

declare module '@tanstack/react-router' {
  interface StaticDataRouteOption {
    moduleId?: string;
    title?: string;
    parent?: string;
  }
}

export function useRouteInfo(): RouteInfo {
  const match = useMatches().at(-1);
  const { moduleId, title, parent } = match?.staticData ?? {};
  const params: Record<string, string> = match?.params ?? {};
  return { pathname: match?.pathname ?? '/', moduleId, title: title?.replace(/:(\w+)/g, (token, name: string) => params[name] ?? token), parent };
}

/** The `?profile=` parameter of this tab's URL. */
export function useUrlProfile(): string | undefined {
  const { profile } = useSearch({ strict: false }) as { profile?: unknown };
  return typeof profile === 'string' ? profile : undefined;
}

/**
 * The sigil of a Talk header on screen. A crew row that flies to the new Talk header (`flight`) is named for it only when the old page has none: the
 * same name twice on a page cancels the whole transition.
 */
const TALK_HEADER_SIGIL = '.talk__header .sigil';

/**
 * Goes to an in-app path, keeping this tab's `?profile=`. Layers close first, so history is back where the page left it before the new entry is pushed.
 * A push is a View Transition (`shell.css`, "Moving across the Desk"): the types say which way the page slides, by the Desk's order Today, Talk, Work, Control.
 * A replace is never one: Talk's own step from an agent to its latest chat must not start a second transition on top of the first. Under reduced motion
 * there is none either. `flight` is the link the owner pressed, a crew row whose sigil and name fly to the Talk header of the page that opens.
 */
export function useAppNavigate(): (to: string, options?: { replace?: boolean; flight?: HTMLElement }) => Promise<void> {
  const router = useRouter();
  const registry = useRegistry();
  const profile = useUrlProfile();
  const placementAt = (pathname: string | undefined) => {
    if (pathname === undefined) return undefined;
    const { moduleId, title } = router.getMatchedRoutes(pathname)[2]?.options.staticData ?? {};
    return placementOfPage(registry, { moduleId, title, pathname });
  };
  return async (to, { replace = false, flight } = {}) => {
    await closeAllLayers();
    const href = withProfile(to, profile);
    if (replace) {
      router.history.replace(href);
      return;
    }
    // A navigation a blocker held back (an unsaved form) never settles, so its row may still hold the names: only one row ever may.
    for (const stale of document.querySelectorAll('[data-flight]')) stale.removeAttribute('data-flight');
    const flying = !motionReduced() && document.querySelector(TALK_HEADER_SIGIL) === null ? flight : undefined;
    flying?.setAttribute('data-flight', '');
    // Not awaited, as the push it replaces was not: callers go on when the address has changed. The row holds its names only until the page has rendered, because
    // the new page's header must be the only one holding them when the browser looks at the new state (`shell.css`, `desk-flight`).
    const arrival = router.navigate({
      href,
      viewTransition: {
        types: ({ fromLocation, toLocation }) => {
          if (motionReduced()) return false;
          const travel = deskTravel(placementAt(fromLocation?.pathname), placementAt(toLocation.pathname));
          return ['desk-page', `desk-${travel}`, ...(flying ? ['desk-flight'] : [])];
        },
      },
    });
    const settle = () => flying?.removeAttribute('data-flight');
    void arrival.then(settle, settle);
  };
}

/**
 * Changes the query of the page being shown, in place: the entry is replaced and open layers stay open (a filter or a search set in a sheet does not
 * leave it). The history entry a layer owns keeps its layer count, so closing the sheet afterwards still undoes exactly that entry.
 */
export function useAddressReplace(): (to: string) => void {
  const router = useRouter();
  const profile = useUrlProfile();
  return (to) => {
    const layers = (history.state as { cdLayers?: number } | null)?.cdLayers;
    router.history.replace(withProfile(to, profile), layers === undefined ? undefined : { cdLayers: layers });
  };
}

/**
 * A link between pages of the app: it keeps this tab's `?profile=` and never reloads the page. `flight`: see `useAppNavigate`. `preload`: the page's code starts to
 * load as soon as the owner reaches for the link (pointer over it, finger or button down, keyboard on it), so that it is in when a page transition takes its new
 * picture, and the crew row's sigil can fly to the header that is then on the page.
 */
export function AppLink({ to, flight, preload, onClick, onPointerEnter, onPointerDown, onFocus, ...rest }: ComponentProps<'a'> & { to: string; flight?: boolean; preload?: boolean }) {
  const navigate = useAppNavigate();
  const router = useRouter();
  const profile = useUrlProfile();
  const href = withProfile(to, profile);
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || rest.target) return;
    event.preventDefault();
    void navigate(to, { flight: flight ? event.currentTarget : undefined });
  };
  // A page that cannot be loaded ahead is found out when the owner opens it, not here.
  const reach = () => {
    const { pathname, searchParams } = new URL(href, location.origin);
    void router.preloadRoute({ to: pathname, search: Object.fromEntries(searchParams) }).catch(() => undefined);
  };
  return (
    <a
      {...rest}
      href={href}
      onClick={follow}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        if (preload) reach();
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (preload) reach();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        if (preload) reach();
      }}
    />
  );
}
