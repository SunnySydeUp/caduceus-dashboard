import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

const Provider = lazy(() => import('./Memory.tsx').then((m) => ({ default: m.ProviderScreen })));
const Engine = lazy(() => import('./Memory.tsx').then((m) => ({ default: m.EngineScreen })));
const BuiltIn = lazy(() => import('./Memory.tsx').then((m) => ({ default: m.BuiltInScreen })));
const Graph = lazy(() => import('./Memory.tsx').then((m) => ({ default: m.GraphScreen })));
const Context = lazy(() => import('./Memory.tsx').then((m) => ({ default: m.ContextScreen })));
const Hindsight = lazy(() => import('./Memory.tsx').then((m) => ({ default: m.HindsightScreen })));
const Notes = lazy(() => import('./Memory.tsx').then((m) => ({ default: m.NotesScreen })));
const Wiki = lazy(() => import('./Memory.tsx').then((m) => ({ default: m.WikiScreen })));

/** Agents › Memory: a profile's memory provider and its settings, its context engine, the built-in MEMORY.md and USER.md, the learning graph, project context and the LLM Wiki. Hindsight, when it is the provider, and external notes from MCP servers. */
export const memoryModule: AppModule = {
  id: 'memory',
  title: 'Memory',
  icon: 'database',
  desk: 'control',
  group: 'agents',
  path: '/agents/memory',
  order: 4,
  summary: 'The memory provider and context engine of a profile, its built-in memory, what it has learned, project context and the LLM Wiki',
  profileScoped: true,
  routes: [
    { path: '/agents/memory', screen: Provider },
    { path: '/agents/memory/engine', screen: Engine, title: 'Context engine', parent: '/agents/memory' },
    { path: '/agents/memory/built-in', screen: BuiltIn, title: 'Built-in memory', parent: '/agents/memory' },
    { path: '/agents/memory/graph', screen: Graph, title: 'Learning graph', parent: '/agents/memory' },
    { path: '/agents/memory/context', screen: Context, title: 'Project context', parent: '/agents/memory' },
    { path: '/agents/memory/hindsight', screen: Hindsight, title: 'Hindsight', parent: '/agents/memory' },
    { path: '/agents/memory/notes', screen: Notes, title: 'Notes', parent: '/agents/memory' },
    { path: '/agents/memory/wiki', screen: Wiki, title: 'LLM Wiki', parent: '/agents/memory' },
  ],
  help: () => import('./help.ts').then((m) => m.memoryHelp),
};
