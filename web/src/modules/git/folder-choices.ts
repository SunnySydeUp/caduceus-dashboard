// The folders Workspace › Git and Workspace › Checkpoints offer: the owner's workspaces (the M3 #10 registry) and the repositories of Hermes's projects.
import { useMemo } from 'react';
import { useProjectTree } from '../work/projects-data.ts';
import { useWorkspaceChoices } from '../work/workspace-registry-data.ts';

export interface FolderChoice {
  path: string;
  label: string;
}

/** The folders offered: the owner's workspaces first, then the repositories of Hermes's projects that are not one of them. */
export function useFolderChoices(): FolderChoice[] | undefined {
  const workspaces = useWorkspaceChoices();
  const tree = useProjectTree().value;
  return useMemo(() => {
    if (workspaces === undefined) return undefined;
    const choices: FolderChoice[] = workspaces.map((workspace) => ({ path: workspace.path, label: workspace.name }));
    for (const project of tree?.projects ?? []) {
      for (const repo of project.repos) if (!choices.some((choice) => choice.path === repo.path)) choices.push({ path: repo.path, label: `${project.name} · ${repo.label}` });
    }
    return choices;
  }, [workspaces, tree]);
}
