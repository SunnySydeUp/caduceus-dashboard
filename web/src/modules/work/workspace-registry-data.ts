// The workspace registry for the places that only offer it (the composer's workspace chip and the Brief editor's workspace field): read from Caduceus
// each time such a place opens, so an entry added or reordered on Work › Projects shows at once. Nothing is kept here.
import { useEffect, useState } from 'react';
import { parseWorkspaces, workspaceChoices, type WorkspaceChoice } from './workspace-registry.ts';

/**
 * The registry's entries as choices, in the owner's order, with the entry whose folder is `currentPath` marked. `undefined` until Caduceus has
 * answered; an answer that fails is an empty list (the place then offers its own field, as before).
 */
export function useWorkspaceChoices(currentPath?: string): WorkspaceChoice[] | undefined {
  const [entries, setEntries] = useState<ReturnType<typeof parseWorkspaces>>();
  useEffect(() => {
    const controller = new AbortController();
    fetch('/_caduceus/api/work/workspaces', { signal: controller.signal }).then(
      async (response) => !controller.signal.aborted && setEntries(response.ok ? parseWorkspaces(await response.json().catch(() => undefined)) : []),
      () => !controller.signal.aborted && setEntries([]),
    );
    return () => controller.abort();
  }, []);
  return entries === undefined ? undefined : workspaceChoices(entries, currentPath);
}
