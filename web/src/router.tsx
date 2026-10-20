import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router';
import type { AppRegistry } from './app-registry.ts';
import { AppShell } from './shell/AppShell.tsx';
import { Control } from './shell/Control.tsx';
import { NotFound } from './shell/NotFound.tsx';

/** `:name` and `*name` (information architecture §7) in TanStack Router's `$name` and `$` syntax. */
function toRouterPath(path: string): string {
  return path.replace(/:(\w+)/g, '$$$1').replace(/\*\w*$/, '$');
}

/**
 * Query strings are plain `?key=value` text (`?profile=coder`, `?q=memory`), kept as strings: the default parser would
 * turn `?q=123` into a number, and list state in the URL has to read back as it was typed.
 */
const parseSearch = (search: string) => Object.fromEntries(new URLSearchParams(search));
const stringifySearch = (search: Record<string, unknown>) => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) if (value !== undefined) query.set(key, String(value));
  const text = query.toString();
  return text ? `?${text}` : '';
};

/** The app's router: the shell around whatever routes the registered modules declare. */
export function createAppRouter(registry: AppRegistry) {
  const root = createRootRoute({ component: AppShell, notFoundComponent: NotFound });
  const screens = registry
    .routes()
    .map(({ path, screen, moduleId, title, parent }) =>
      createRoute({ getParentRoute: () => root, path: toRouterPath(path), component: screen, staticData: { moduleId, title, parent } }),
    );
  const control = createRoute({ getParentRoute: () => root, path: '/control', component: Control, staticData: { title: 'Control' } });
  // A phone's tab bar called Control "More" before the Desk: a bookmark to it still lands.
  const more = createRoute({
    getParentRoute: () => root,
    path: '/more',
    beforeLoad: () => {
      throw redirect({ to: '/control', search: true, replace: true });
    },
  });
  // `/`, each placement's and each group's base path lead to the first module they hold, and a module's moved addresses to where they went; the query string
  // (`?profile=`, `?fromTask=`) and any `:name` parameter go along.
  const redirects = registry.redirects().map(({ from, to }) =>
    createRoute({
      getParentRoute: () => root,
      path: toRouterPath(from),
      beforeLoad: () => {
        throw redirect({ to: toRouterPath(to), params: true, search: true, replace: true });
      },
    }),
  );
  return createRouter({ routeTree: root.addChildren([...screens, control, more, ...redirects]), parseSearch, stringifySearch, scrollRestoration: true });
}
