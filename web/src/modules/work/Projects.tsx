// Work › Projects (M3 #10): Hermes's projects tree across profiles, Discover repos, and the workspace registry. The tree is read from Hermes every time
// (`GET /api/profiles/projects/tree`); creating, renaming and Make active are Tier 1 gateway calls for the profile in use (`projects.*`), and the page
// reads the tree again after each. On a phone the tree is a list you drill into: a project opens its overview, where its repositories are listed.
import { useState } from 'react';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { useProfileProjects, useProjectActions, useProjectTree } from './projects-data.ts';
import { groupTree, withOwnedProjects, type ProjectNode } from './projects-model.ts';
import { DiscoverSheet, NewProjectSheet, RenameSheet } from './ProjectSheets.tsx';
import { useDefaultFolder } from './workspace-data.ts';
import { Workspaces } from './Workspaces.tsx';
import './projects.css';
import './work.css';
import './workspace.css';

/** The project's address: a declared project's id, or the folder a derived one is named by. */
export const projectHref = (id: string) => `/work/projects/${encodeURIComponent(id)}`;

/** `3 sessions`, `1 session`, `No sessions`. */
export const sessionsText = (count: number) => (count === 0 ? 'No sessions' : `${count} ${count === 1 ? 'session' : 'sessions'}`);

function lastActiveText(seconds: number): string {
  return seconds > 0 ? `last used ${new Date(seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'never used';
}

function Row({ node, mine, active, onRename, onActivate }: { node: ProjectNode; mine: boolean; active: boolean; onRename(): void; onActivate(): void }) {
  return (
    <li className="pj__item">
      <div className="pj__row">
        <AppLink className="pj__link" to={projectHref(node.id)}>
          <Icon name={node.isAuto ? 'git' : 'folder'} />
          <span className="pj__main">
            <span className="pj__name">
              {node.name}
              {node.tone && <span className="tag" data-tone={node.tone}>{node.tone}</span>}
              {active && <span className="tag" data-tone="success">Active</span>}
            </span>
            <span className="mono subtle pj__path">{node.path ?? 'No folder'}</span>
            <span className="subtle pj__meta">
              {sessionsText(node.sessionCount)} · {lastActiveText(node.lastActive)}
            </span>
          </span>
          <Icon name="chev-r" small />
        </AppLink>
        {mine && (
          <span className="pj__actions">
            <button type="button" className="btn btn--secondary btn--sm" onClick={onRename}>
              Rename<span className="sr-only"> {node.name}</span>
            </button>
            <WriteButton type="button" className="btn btn--secondary btn--sm" onClick={onActivate}>
              {active ? 'Stop using as active' : 'Make active'}
              <span className="sr-only"> {node.name}</span>
            </WriteButton>
          </span>
        )}
      </div>
      {node.repos.length > 0 && (
        <ul className="pj__repos" aria-label={`Repositories of ${node.name}`}>
          {node.repos.map((repo) => (
            <li key={repo.path} className="pj__repo">
              <Icon name="git" small />
              <span className="truncate">{repo.label}</span>
              <span className="mono subtle truncate">{repo.path}</span>
              <span className="subtle">{sessionsText(repo.sessionCount)}</span>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

export function Projects() {
  const { effective } = useProfileScope();
  const profile = effective?.name;
  const tree = useProjectTree();
  const owned = useProfileProjects(profile);
  const actions = useProjectActions();
  const home = useDefaultFolder();
  const [sheet, setSheet] = useState<'new' | 'discover' | { rename: ProjectNode }>();
  const grouped = tree.value ? groupTree(withOwnedProjects(tree.value.projects, owned.value?.projects ?? [])) : undefined;
  const mineIds = new Set(owned.value?.projects.map((project) => project.id));
  const reload = () => {
    tree.reload();
    owned.reload();
  };

  const toggleActive = async (node: ProjectNode) => {
    if (profile === undefined) return;
    const active = owned.value?.activeId === node.id;
    const outcome = await actions.activate(profile, active ? undefined : node);
    if (outcome.kind === 'cancelled') return;
    if (outcome.kind === 'failed') return toast(outcome.message, { tone: 'danger' });
    toast(active ? 'No active project now' : `“${node.name}” is the active project`, { tone: 'success' });
    reload();
  };

  const count = grouped ? grouped.owned.length + grouped.found.length : 0;
  return (
    <div className="bpage pj">
      <PageHeader
        overline="Work"
        title="Projects"
        subtitle={grouped ? `${grouped.owned.length} ${grouped.owned.length === 1 ? 'project' : 'projects'}${grouped.found.length > 0 ? `, ${grouped.found.length} more found by Hermes` : ''}` : 'Hermes’s projects and your workspaces'}
        actions={
          <>
            <button type="button" className="btn btn--secondary" disabled={profile === undefined} onClick={() => setSheet('discover')}>
              <Icon name="search" />
              Discover repos
            </button>
            <button type="button" className="btn btn--primary" disabled={profile === undefined} onClick={() => setSheet('new')}>
              <Icon name="plus" />
              New project
            </button>
          </>
        }
      />
      <p className="help-text">
        A <Term id="project">project</Term> is a named set of folders that Hermes groups sessions and Kanban boards by. Hermes keeps them and builds this tree from every profile’s sessions, so what you see is what Hermes has. Your <Term id="workspace">workspaces</Term> are below.
      </p>

      {tree.error && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">Hermes did not give its projects: {tree.error}</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={tree.reload}>
            Try again
          </button>
        </div>
      )}
      {tree.value && tree.value.errors.length > 0 && (
        <div className="banner" data-tone="warning" role="status">
          <Icon name="alert" />
          <div className="banner__content">
            <p>Hermes could not read the sessions of some profiles, so their projects may be missing:</p>
            <ul>
              {tree.value.errors.map((problem) => (
                <li key={problem} className="mono">
                  {problem}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {!tree.error && tree.value === undefined && <p role="status">Asking Hermes for its projects…</p>}

      {grouped && (
        <section className="sb__section pj__tree" aria-labelledby="pj-projects">
          <h2 id="pj-projects">Projects</h2>
          {count === 0 ? (
            <div className="empty">
              <Icon name="folder" />
              <h3>No projects yet</h3>
              <p>Make one of a folder, or let Hermes find the repositories you work in.</p>
              <div className="row">
                <button type="button" className="btn btn--primary" disabled={profile === undefined} onClick={() => setSheet('new')}>
                  New project
                </button>
                <button type="button" className="btn btn--secondary" disabled={profile === undefined} onClick={() => setSheet('discover')}>
                  Discover repos
                </button>
              </div>
            </div>
          ) : (
            <>
              {profile !== undefined && grouped.owned.length > 0 && <p className="subtle">Rename and Make active are offered for the projects of the profile in use, {profile}.</p>}
              {grouped.owned.length > 0 && (
                <ul className="pj__list" aria-label="Projects you made">
                  {grouped.owned.map((node) => (
                    <Row key={node.id} node={node} mine={mineIds.has(node.id)} active={owned.value?.activeId === node.id} onRename={() => setSheet({ rename: node })} onActivate={() => void toggleActive(node)} />
                  ))}
                </ul>
              )}
              {grouped.found.length > 0 && (
                <>
                  <h3 className="pj__sub">Found by Hermes</h3>
                  <p className="subtle">Repositories your sessions worked in. Nobody made these projects: Discover repos turns them into real ones.</p>
                  <ul className="pj__list" aria-label="Repositories Hermes found">
                    {grouped.found.map((node) => (
                      <Row key={node.id} node={node} mine={false} active={false} onRename={() => undefined} onActivate={() => undefined} />
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
          {grouped.home && grouped.home.sessionCount > 0 && <p className="subtle">{sessionsText(grouped.home.sessionCount)} {grouped.home.sessionCount === 1 ? 'belongs' : 'belong'} to no project.</p>}
        </section>
      )}

      <Workspaces />

      {sheet === 'new' && profile !== undefined && <NewProjectSheet profile={profile} actions={actions} onDone={reload} onClose={() => setSheet(undefined)} />}
      {sheet === 'discover' && profile !== undefined && <DiscoverSheet profile={profile} actions={actions} owned={owned.value} startFolder={home} onDone={reload} onClose={() => setSheet(undefined)} />}
      {typeof sheet === 'object' && profile !== undefined && (
        <RenameSheet
          title="Rename project"
          initial={sheet.rename.name}
          max={80}
          onClose={() => setSheet(undefined)}
          save={async (name) => {
            const outcome = await actions.rename(profile, sheet.rename, name);
            if (outcome.kind === 'cancelled') return 'cancelled';
            if (outcome.kind === 'failed') return outcome.message;
            toast(`Renamed the project to “${name}”`, { tone: 'success' });
            reload();
            return undefined;
          }}
        />
      )}
    </div>
  );
}
