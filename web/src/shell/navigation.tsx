import type { ComponentProps, MouseEvent } from 'react';
import { useMatches, useRouter, useSearch } from '@tanstack/react-router';
import { withProfile } from '../profile-scope.ts';
import { closeAllLayers } from '../overlays/layers.ts';

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
 * Goes to an in-app path, keeping this tab's `?profile=`. Layers close first, so history is back where the page
 * left it before the new entry is pushed.
 */
export function useAppNavigate(): (to: string, options?: { replace?: boolean }) => Promise<void> {
  const router = useRouter();
  const profile = useUrlProfile();
  return async (to, { replace = false } = {}) => {
    await closeAllLayers();
    const href = withProfile(to, profile);
    if (replace) router.history.replace(href);
    else router.history.push(href);
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

/** A link between pages of the app: it keeps this tab's `?profile=` and never reloads the page. */
export function AppLink({ to, onClick, ...rest }: ComponentProps<'a'> & { to: string }) {
  const navigate = useAppNavigate();
  const profile = useUrlProfile();
  const follow = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || rest.target) return;
    event.preventDefault();
    void navigate(to);
  };
  return <a {...rest} href={withProfile(to, profile)} onClick={follow} />;
}
