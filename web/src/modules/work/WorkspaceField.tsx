// Where a task runs: a scratch folder, a folder on the Mac that runs Hermes, or a git worktree (optionally anchored by a project). The folder is typed or
// browsed with Hermes's own file listing, and checked against Hermes as it is typed. Once the task exists the workspace cannot change, so it is shown read-only.
import { useId, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { Term } from '../../shell/Term.tsx';
import { RemoteBadge } from '../tools/RemoteBadge.tsx';
import { useRemoteWorkspace } from '../tools/terminal-data.ts';
import type { RemoteWorkspace } from '../tools/terminal-model.ts';
import type { TaskWorkspace } from './create-task-script.ts';
import { Field } from './FormParts.tsx';
import { useWorkspaceChoices } from './workspace-registry-data.ts';
import { isAbsolutePath, useBranches, useDefaultFolder, useListing, useProjects } from './workspace-data.ts';
import { folderProblem, parentFolder, type Branch } from './workspace-model.ts';
import './workspace.css';

export interface WorkspaceFieldProps {
  /** The profile whose worker runs the task: its terminal backend says whether the workspace is on a remote machine. */
  profile: string;
  /** The current value. */
  workspace: TaskWorkspace;
  onChange(workspace: TaskWorkspace): void;
  /** The Hermes project that anchors a worktree; empty for none. */
  project: string;
  onProjectChange(id: string): void;
  /** The problems the form shows, by key: `workspace` (the folder), `branch` and `project`. */
  errors: Record<string, string>;
  /** Marks a field as one the owner has left, so its problem shows. */
  touch(name: string): void;
  /** The task exists: Hermes cannot move a task's workspace, so it is shown read-only. */
  locked?: boolean;
}

const KINDS = [
  { value: 'scratch', label: 'A fresh scratch folder' },
  { value: 'dir', label: 'A folder on this Mac' },
  { value: 'worktree', label: 'A git worktree' },
] as const;

/** The workspace of another kind that keeps the folder and branch where they still apply. */
function workspaceOf(kind: TaskWorkspace['kind'], previous: TaskWorkspace): TaskWorkspace {
  const path = 'path' in previous ? previous.path : undefined;
  if (kind === 'scratch') return { kind };
  if (kind === 'dir') return { kind, path: path ?? '' };
  return { kind, ...(path ? { path } : {}), ...('branch' in previous && previous.branch ? { branch: previous.branch } : {}) };
}

export function WorkspaceField({ locked, ...props }: WorkspaceFieldProps) {
  return locked ? <LockedWorkspace workspace={props.workspace} project={props.project} profile={props.profile} /> : <EditableWorkspace {...props} />;
}

function LockedWorkspace({ workspace, project, profile }: Pick<WorkspaceFieldProps, 'workspace' | 'project' | 'profile'>) {
  const remote = useRemoteWorkspace(profile);
  return (
    <div className="ws">
      <dl className="ws__facts">
        <div className="ws__fact">
          <dt>Workspace</dt>
          <dd>{KINDS.find((kind) => kind.value === workspace.kind)?.label}</dd>
        </div>
        {workspace.kind !== 'scratch' && workspace.path && (
          <div className="ws__fact">
            <dt>{workspace.kind === 'dir' ? 'Folder' : 'Repository folder'}</dt>
            <dd>
              <span className="mono">{workspace.path}</span> <RemoteBadge remote={remote} />
            </dd>
          </div>
        )}
        {workspace.kind === 'worktree' && workspace.branch && (
          <div className="ws__fact">
            <dt>Branch for the worktree</dt>
            <dd className="mono">{workspace.branch}</dd>
          </div>
        )}
        {workspace.kind === 'worktree' && project !== '' && <ProjectFact project={project} />}
      </dl>
      <p className="field__help">Hermes cannot change a task’s workspace after it is made. Use Duplicate with changes.</p>
    </div>
  );
}

function ProjectFact({ project }: { project: string }) {
  const projects = useProjects();
  const known = projects?.find((candidate) => candidate.id === project || candidate.slug === project);
  return (
    <div className="ws__fact">
      <dt>Project</dt>
      <dd>{known?.name ?? project}</dd>
    </div>
  );
}

function EditableWorkspace({ profile, workspace, onChange, project, onProjectChange, errors, touch }: Omit<WorkspaceFieldProps, 'locked'>) {
  const remote = useRemoteWorkspace(profile);
  const [browsing, setBrowsing] = useState(false);
  const kind = workspace.kind;
  const path = workspace.kind === 'scratch' ? '' : (workspace.path ?? '');
  const typed = path.trim();
  const { listing, loading } = useListing(path);
  const inside = workspace.kind === 'worktree' && listing?.kind === 'folder' ? typed : '';
  const branches = useBranches(inside);

  const changePath = (next: string) => {
    if (workspace.kind === 'dir') onChange({ kind: 'dir', path: next });
    else if (workspace.kind === 'worktree') onChange({ kind: 'worktree', ...(next ? { path: next } : {}), ...(workspace.branch ? { branch: workspace.branch } : {}) });
  };

  // The owner's registered workspaces (Work › Projects), in the owner's order: a tap fills the folder.
  const choices = useWorkspaceChoices(path);
  const listingProblem = listing && folderProblem(listing, remote);
  const folderError = listingProblem ?? errors.workspace;
  const folderLabel = kind === 'dir' ? 'Folder' : project === '' ? 'Repository folder' : 'Repository folder (optional)';
  const folderHelp = kind === 'worktree' && project !== '' ? 'A full path on the Mac that runs Hermes. Leave it empty to use the project’s repository.' : 'A full path on the Mac that runs Hermes, such as /Users/you/project.';

  return (
    <div className="ws">
      <Field label="Workspace" help="Where the worker runs." name="kind">
        {(aria) => (
          <select
            {...aria}
            className="input"
            value={kind}
            onChange={(event) => {
              const next = event.target.value as TaskWorkspace['kind'];
              onChange(workspaceOf(next, workspace));
              if (next !== 'worktree' && project !== '') onProjectChange('');
            }}
          >
            {KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        )}
      </Field>
      {kind !== 'scratch' && choices !== undefined && choices.length > 0 && (
        <div className="ws__choices">
          <p className="field__label" id="ws-choices">
            Your workspaces
          </p>
          <ul className="ws__chips" aria-labelledby="ws-choices">
            {choices.map((choice) => (
              <li key={choice.id}>
                <button
                  type="button"
                  className="chip"
                  aria-pressed={choice.current}
                  title={choice.path}
                  onClick={() => {
                    changePath(choice.path);
                    touch('workspace');
                  }}
                >
                  <Icon name="folder" small />
                  {choice.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {kind !== 'scratch' && (
        <div className="ws__folder">
          <Field label={<>{folderLabel} <RemoteBadge remote={remote} /></>} help={remote ? <>{folderHelp} The terminal backend of this profile is {remote.label}: the agent works on that machine, a <Term id="remote-workspace">remote workspace</Term>.</> : folderHelp} error={folderError} name="workspace">
            {(aria) => (
              <div className="ws__path">
                <input {...aria} className="input input--mono" value={path} onChange={(event) => changePath(event.target.value)} onBlur={() => touch('workspace')} autoComplete="off" autoCapitalize="none" spellCheck={false} />
                <button type="button" className="btn btn--secondary" onClick={() => setBrowsing(true)}>
                  <Icon name="folder" />
                  Browse
                </button>
              </div>
            )}
          </Field>
          {!folderError && loading && (
            <p className="ws__status" role="status">
              Checking the folder…
            </p>
          )}
          {!folderError && listing?.kind === 'folder' && (
            <p className="ws__status" role="status" data-tone="ok">
              <Icon name="check" small />
              This folder exists.
            </p>
          )}
          {branches?.length === 0 && (
            <p className="ws__status" role="status">
              This folder is not in a git repository, so Hermes cannot make a worktree there.
            </p>
          )}
        </div>
      )}
      {workspace.kind === 'worktree' && (
        <>
          <BranchField branch={workspace.branch ?? ''} branches={branches ?? []} error={errors.branch} onChange={(branch) => onChange({ kind: 'worktree', ...(workspace.path ? { path: workspace.path } : {}), ...(branch ? { branch } : {}) })} touch={touch} />
          <ProjectField project={project} error={errors.project} onChange={onProjectChange} touch={touch} />
        </>
      )}
      {browsing && (
        <FolderPicker
          remote={remote}
          start={listing?.kind === 'folder' ? typed : undefined}
          onPick={(picked) => {
            changePath(picked);
            touch('workspace');
            setBrowsing(false);
          }}
          onClose={() => setBrowsing(false)}
        />
      )}
    </div>
  );
}

function BranchField({ branch, branches, error, onChange, touch }: { branch: string; branches: readonly Branch[]; error: string | undefined; onChange(branch: string): void; touch(name: string): void }) {
  return (
    <Field label="Branch for the worktree" help="Leave empty and Hermes picks a branch name. A branch that is checked out elsewhere cannot be used for a second worktree." error={error} name="branch">
      {(aria) => (
        <>
          <input {...aria} className="input input--mono" list={branches.length > 0 ? `${aria.id}-branches` : undefined} value={branch} onChange={(event) => onChange(event.target.value)} onBlur={() => touch('branch')} autoComplete="off" autoCapitalize="none" spellCheck={false} placeholder="wt/my-change" />
          {branches.length > 0 && (
            <datalist id={`${aria.id}-branches`}>
              {branches.map((candidate) => (
                <option key={candidate.name} value={candidate.name} label={[candidate.name, candidate.isDefault && 'default branch', candidate.checkedOut && 'checked out elsewhere'].filter(Boolean).join(' · ')} />
              ))}
            </datalist>
          )}
        </>
      )}
    </Field>
  );
}

function ProjectField({ project, error, onChange, touch }: { project: string; error: string | undefined; onChange(id: string): void; touch(name: string): void }) {
  const projects = useProjects();
  const known = projects?.find((candidate) => candidate.id === project || candidate.slug === project);
  const value = known?.id ?? project;
  return (
    <Field label="Project" help="A project anchors the worktree under its repository with a branch name Hermes derives." error={error} name="project">
      {(aria) => (
        <select {...aria} className="input" value={value} onChange={(event) => onChange(event.target.value)} onBlur={() => touch('project')}>
          <option value="">No project</option>
          {value !== '' && !known && <option value={value}>{value}</option>}
          {projects?.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/** A sheet that walks Hermes's folders: tap a folder to go in, Up to go out, then use the folder shown. */
export function FolderPicker({ start, remote, onPick, onClose }: { start: string | undefined; /** The remote backend the agent works on, when it is not the local one. */ remote?: RemoteWorkspace; onPick(path: string): void; onClose(): void }) {
  const fallback = useDefaultFolder();
  const [chosen, setChosen] = useState(start);
  const here = chosen ?? fallback;
  const { listing } = useListing(here ?? '', 0);
  const up = here === undefined ? undefined : parentFolder(here);
  const hereId = useId();
  const problem = listing && folderProblem(listing, remote);
  return (
    <Sheet
      title="Choose a folder"
      detents={['full']}
      onClose={onClose}
      footer={
        <button type="button" className="btn btn--primary" disabled={here === undefined || listing?.kind !== 'folder'} onClick={() => here !== undefined && onPick(here)}>
          Use this folder
        </button>
      }
    >
      {here === undefined ? (
        <p className="ws-pick__note" role="status">
          Finding where to start…
        </p>
      ) : (
        <>
          {remote && (
            <p className="ws-pick__note" role="status">
              <RemoteBadge remote={remote} /> These are the folders of the Mac that runs Hermes. The agent of this profile works on {remote.label}, so a folder chosen here must exist there too.
            </p>
          )}
          <div className="ws-pick__here">
            <button type="button" className="btn btn--secondary" disabled={up === undefined} onClick={() => up !== undefined && setChosen(up)}>
              <Icon name="arrow-up" />
              Up
            </button>
            <p id={hereId} className="ws-pick__path mono">
              {here}
            </p>
          </div>
          {listing === undefined && (
            <p className="ws-pick__note" role="status">
              Reading the folder…
            </p>
          )}
          {problem && (
            <p className="field__error" role="alert">
              <Icon name="alert" small />
              {problem}
            </p>
          )}
          {listing?.kind === 'folder' &&
            (listing.folders.length === 0 ? (
              <p className="ws-pick__note">There are no folders inside this one.</p>
            ) : (
              <ul className="ws-pick__list" aria-labelledby={hereId}>
                {listing.folders.map((folder) => (
                  <li key={folder.path}>
                    <button type="button" className="ws-pick__row" onClick={() => setChosen(folder.path)}>
                      <Icon name="folder" />
                      <span className="truncate">{folder.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ))}
        </>
      )}
    </Sheet>
  );
}
