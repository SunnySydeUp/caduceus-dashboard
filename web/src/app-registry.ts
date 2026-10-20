import type { FunctionComponent } from 'react';
import type { ModuleDefinition, ModuleRegistry } from './module-registry.ts';

/**
 * What a route renders: a lazily loaded screen, so a module's code loads when its route is first visited. A `lazy` one shows a blank until its
 * code is in; a `lazyRouteComponent` one (TanStack Router) is waited for by the router, which then shows the shell and the screen together.
 */
export type Screen = FunctionComponent;

/** A feature module as the web app declares it. */
export type AppModule = ModuleDefinition<Screen>;

export type AppRegistry = ModuleRegistry<Screen>;
