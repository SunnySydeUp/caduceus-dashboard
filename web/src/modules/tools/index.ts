import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

const Toolsets = lazy(() => import('./Tools.tsx').then((m) => ({ default: m.ToolsetsScreen })));
const Mcp = lazy(() => import('./Tools.tsx').then((m) => ({ default: m.McpScreen })));
const Catalogue = lazy(() => import('./Tools.tsx').then((m) => ({ default: m.CatalogueScreen })));
const Platforms = lazy(() => import('./Tools.tsx').then((m) => ({ default: m.PlatformsScreen })));
const Routing = lazy(() => import('./Tools.tsx').then((m) => ({ default: m.RoutingScreen })));
const Hooks = lazy(() => import('./Tools.tsx').then((m) => ({ default: m.HooksScreen })));
const Terminal = lazy(() => import('./Tools.tsx').then((m) => ({ default: m.TerminalScreen })));

/** Agents › Tools & MCP: the toolsets of a profile (provider, model, keys, setup), its MCP servers and the catalogue, the toolsets of each platform, how tools are routed, its shell hooks and its terminal backend. */
export const toolsModule: AppModule = {
  id: 'tools',
  title: 'Tools & MCP',
  icon: 'tool',
  desk: 'control',
  group: 'agents',
  path: '/agents/tools',
  order: 5,
  summary: 'The toolsets and MCP servers of a profile, the MCP catalogue, which toolsets each platform gets, how tools are routed, shell hooks and the terminal backend',
  profileScoped: true,
  routes: [
    { path: '/agents/tools', screen: Toolsets },
    { path: '/agents/tools/mcp', screen: Mcp, title: 'MCP servers', parent: '/agents/tools' },
    { path: '/agents/tools/catalogue', screen: Catalogue, title: 'MCP catalogue', parent: '/agents/tools' },
    { path: '/agents/tools/platforms', screen: Platforms, title: 'Toolsets per platform', parent: '/agents/tools' },
    { path: '/agents/tools/routing', screen: Routing, title: 'Tool routing', parent: '/agents/tools' },
    { path: '/agents/tools/hooks', screen: Hooks, title: 'Shell hooks', parent: '/agents/tools' },
    { path: '/agents/tools/terminal', screen: Terminal, title: 'Terminal backend', parent: '/agents/tools' },
  ],
  help: () => import('./help.ts').then((m) => m.toolsHelp),
};
