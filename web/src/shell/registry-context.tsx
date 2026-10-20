import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { AppRegistry } from '../app-registry.ts';

const RegistryContext = createContext<AppRegistry | undefined>(undefined);

export function RegistryProvider({ registry, children }: { registry: AppRegistry; children: ReactNode }) {
  return <RegistryContext value={registry}>{children}</RegistryContext>;
}

/** The module registry: the one thing the shell reads to know what exists. */
export function useRegistry(): AppRegistry {
  const registry = useContext(RegistryContext);
  if (!registry) throw new Error('useRegistry needs a RegistryProvider');
  return registry;
}

/** Whether the help pages and glossary have loaded; a component that reads them re-renders when they do. */
export function useHelpLoaded(): boolean {
  const registry = useRegistry();
  return useSyncExternalStore(registry.onHelpLoaded, registry.helpLoaded);
}
