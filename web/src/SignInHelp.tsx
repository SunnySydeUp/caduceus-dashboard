import { useEffect, useMemo } from 'react';
import { resolveHelpTarget } from './help.ts';
import { createAppRegistry } from './modules/index.ts';
import { HelpPanel } from './shell/HelpPanel.tsx';
import { RegistryProvider, useHelpLoaded, useRegistry } from './shell/registry-context.tsx';

/** The panel once the help has loaded (from the build's precached files when offline). */
function Panel({ onClose }: { onClose(): void }) {
  const registry = useRegistry();
  const loaded = useHelpLoaded();
  useEffect(() => void registry.loadHelp(), [registry]);
  return loaded ? <HelpPanel view={resolveHelpTarget(registry, { screen: '/sign-in' })} onClose={onClose} /> : null;
}

/**
 * The help panel on the sign-in screen, which runs outside the shell (no router, no keyboard shortcuts), so it has the page for
 * signing in, the list of topics and the glossary but no Shortcuts tab. It is its own chunk: the sign-in screen stays small, and
 * this loads, from the build's precached files when offline, only when help is asked for.
 */
export default function SignInHelp({ onClose }: { onClose(): void }) {
  const registry = useMemo(() => createAppRegistry(), []);
  return (
    <RegistryProvider registry={registry}>
      <Panel onClose={onClose} />
    </RegistryProvider>
  );
}
