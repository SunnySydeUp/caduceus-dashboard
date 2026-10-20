// Work › Projects › one project (M3 #10; `/work/projects/:projectId`): the repository's path, branch, how far it is from its upstream and its changed
// files, its recent commits, the README and the Markdown files of its docs folder (previewed as Markdown), and the Kanban boards and tasks Hermes links
// to the project. Everything is read from Hermes when the page opens (D1); each part is read on its own, so one that fails does not hide the others.
import { useParams } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { Term } from '../../shell/Term.tsx';
import { Rich } from '../chat/Rich.tsx';
import { useDocText, useLinked, useOverview, useProfileProjects, useProjectTree, type Reading } from './projects-data.ts';
import { gitSentence, withOwnedProjects, type RepoDoc } from './projects-model.ts';
import { sessionsText } from './Projects.tsx';
import { STATUS_META } from './board-model.ts';
import { taskHref } from './TaskPeek.tsx';
import './projects.css';
import './work.css';

/** The state of a read in words, for a section that has no value yet. */
function Waiting({ reading, what }: { reading: Reading<unknown>; what: string }) {
  if (reading.error) {
    return (
      <div className="banner" data-tone="danger" role="alert">
        <Icon name="alert" />
        <span className="banner__content">Hermes did not give {what}: {reading.error}</span>
        <button type="button" className="btn btn--secondary btn--sm" onClick={reading.reload}>
          Try again
        </button>
      </div>
    );
  }
  return reading.value === undefined ? <p role="status">Reading {what}…</p> : null;
}

function DocPreview({ doc }: { doc: RepoDoc }) {
  const text = useDocText(doc.path);
  if (text.error || text.value === undefined) return <Waiting reading={text} what={doc.where} />;
  if (text.value.kind === 'binary') return <p className="subtle">{doc.where} is not a text file, so there is nothing to show.</p>;
  if (text.value.kind === 'unreadable') return <p className="subtle">Hermes did not give the text of {doc.where}.</p>;
  return (
    <>
      <Rich text={text.value.text} anchor={`doc-${doc.where}`} />
      {text.value.truncated && <p className="subtle">Hermes sent the start of this file; the rest is cut.</p>}
    </>
  );
}

export function Project() {
  const { projectId = '' } = useParams({ strict: false }) as { projectId?: string };
  const { effective } = useProfileScope();
  const tree = useProjectTree();
  const owned = useProfileProjects(effective?.name);
  const node = tree.value ? withOwnedProjects(tree.value.projects, owned.value?.projects ?? []).find((project) => project.id === projectId) : undefined;
  // A repository to read: the project's folder when Hermes resolved it to a repository, else the first repository it lists.
  const repos = node ? [...new Map([...(node.path !== undefined ? [{ path: node.path, label: node.path, sessionCount: 0 }] : []), ...node.repos].map((repo) => [repo.path, repo])).values()] : [];
  const [chosen, setChosen] = useState<string>();
  const folder = chosen !== undefined && repos.some((repo) => repo.path === chosen) ? chosen : (node?.repos[0]?.path ?? node?.path);
  const overview = useOverview(folder);
  const linked = useLinked(node && !node.isAuto && !node.isHome ? node.id : undefined);
  const [docPath, setDocPath] = useState<string>();
  const docs = overview.docs.value;
  const doc = docs?.find((entry) => entry.path === docPath) ?? docs?.[0];
  useEffect(() => setDocPath(undefined), [folder]);
  const gone = tree.value !== undefined && node === undefined;

  return (
    <div className="bpage pj pjo">
      <PageHeader
        overline={node?.isAuto ? 'Repository found by Hermes' : 'Project'}
        title={node?.name ?? (gone ? 'Project not found' : 'Project')}
        subtitle={node ? `${sessionsText(node.sessionCount)}${node.path ? ` · ${node.path}` : ''}` : undefined}
        actions={
          <AppLink className="btn btn--secondary" to="/work/projects">
            <Icon name="chev-l" />
            Projects
          </AppLink>
        }
      />
      {tree.error && <Waiting reading={tree} what="the project" />}
      {!tree.error && tree.value === undefined && <p role="status">Asking Hermes…</p>}
      {gone && (
        <div className="empty">
          <Icon name="folder" />
          <h2>Hermes has no project with this address</h2>
          <p>It may belong to a profile Hermes could not read, or it was deleted.</p>
          <AppLink className="btn btn--primary" to="/work/projects">
            Back to projects
          </AppLink>
        </div>
      )}

      {node && repos.length > 1 && (
        <div className="field pjo__repo">
          <label className="field__label" htmlFor="pjo-repo">
            Repository
          </label>
          <select id="pjo-repo" className="input" value={folder ?? ''} onChange={(event) => setChosen(event.target.value)}>
            {repos.map((repo) => (
              <option key={repo.path} value={repo.path}>
                {repo.label === repo.path ? repo.path : `${repo.label} — ${repo.path}`}
              </option>
            ))}
          </select>
        </div>
      )}

      {node && folder === undefined && (
        <div className="empty">
          <Icon name="folder" />
          <h2>This project has no folder</h2>
          <p>Hermes has no folder for it, so there is no repository to show. Add a folder to the project in Hermes.</p>
        </div>
      )}

      {node && folder !== undefined && (
        <div className="pjo__grid">
          <section className="sb__section" aria-labelledby="pjo-repo-h">
            <h2 id="pjo-repo-h">Repository</h2>
            <p className="mono pj__path">{folder}</p>
            <Waiting reading={overview.git} what="the repository’s status" />
            {overview.git.value === null && <p className="subtle">This folder is not in a git repository, so there is no branch or history to show.</p>}
            {overview.git.value && (
              <dl className="pjo__facts">
                <div>
                  <dt>Branch</dt>
                  <dd className="mono">{overview.git.value.detached ? 'Detached head' : (overview.git.value.branch ?? 'No branch yet')}</dd>
                </div>
                <div>
                  <dt>Ahead / behind</dt>
                  <dd>
                    {overview.git.value.ahead} ahead, {overview.git.value.behind} behind
                  </dd>
                </div>
                <div>
                  <dt>Changed files</dt>
                  <dd>{overview.git.value.dirty}</dd>
                </div>
                <div className="pjo__sentence">
                  <dt className="sr-only">Summary</dt>
                  <dd className="subtle">{gitSentence(overview.git.value)}</dd>
                </div>
              </dl>
            )}
          </section>

          <section className="sb__section" aria-labelledby="pjo-commits-h">
            <h2 id="pjo-commits-h">Recent commits</h2>
            <Waiting reading={overview.commits} what="the recent commits" />
            {overview.commits.value && overview.commits.value.length === 0 && <p className="subtle">There are no commits to show.</p>}
            {overview.commits.value && overview.commits.value.length > 0 && (
              <ol className="pjo__commits">
                {overview.commits.value.map((subject, index) => (
                  <li key={`${index}-${subject}`}>{subject}</li>
                ))}
              </ol>
            )}
          </section>

          <section className="sb__section pjo__docs" aria-labelledby="pjo-docs-h">
            <h2 id="pjo-docs-h">Documents</h2>
            <Waiting reading={overview.docs} what="the documents" />
            {docs && docs.length === 0 && <p className="subtle">No README or Markdown files in a docs folder were found in this folder.</p>}
            {docs && docs.length > 0 && (
              <div className="pjo__docsbody">
                <ul className="pjo__doclist" aria-label="Documents">
                  {docs.map((entry) => (
                    <li key={entry.path}>
                      <button type="button" className="pjo__doc" aria-current={doc?.path === entry.path ? 'true' : undefined} onClick={() => setDocPath(entry.path)}>
                        <Icon name="file" small />
                        <span className="truncate">{entry.where}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="pjo__preview" aria-live="polite">
                  {doc && <DocPreview doc={doc} />}
                </div>
              </div>
            )}
          </section>

          <section className="sb__section" aria-labelledby="pjo-work-h">
            <h2 id="pjo-work-h">Boards and tasks</h2>
            {node.isAuto || node.isHome ? (
              <p className="subtle">Hermes links boards and tasks to the projects you make, not to the repositories it found. Make this one a project with Discover repos to link a board.</p>
            ) : (
              <>
                <Waiting reading={linked} what="the linked boards and tasks" />
                {linked.value && linked.value.boards.length === 0 && linked.value.tasks.length === 0 && (
                  <p className="subtle">No board is linked to this project and no task names it. Choose it as the project of a board, or of a task in the Brief editor.</p>
                )}
                {linked.value && linked.value.boards.length > 0 && (
                  <>
                    <h3 className="pj__sub">Boards</h3>
                    <ul className="pjo__links">
                      {linked.value.boards.map((board) => (
                        <li key={board.slug}>
                          <AppLink className="pjo__link" to={`/work/board/${encodeURIComponent(board.slug)}`}>
                            <Icon name="work" small />
                            <span className="truncate">{board.name}</span>
                            <Icon name="chev-r" small />
                          </AppLink>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
                {linked.value && linked.value.tasks.length > 0 && (
                  <>
                    <h3 className="pj__sub">Tasks</h3>
                    <ul className="pjo__links">
                      {linked.value.tasks.map((task) => (
                        <li key={`${task.board}/${task.id}`}>
                          <AppLink className="pjo__link" to={taskHref(task.id, task.board)}>
                            <Icon name="tasks" small />
                            <span className="truncate">{task.title}</span>
                            <span className="tag">{STATUS_META[task.status].label}</span>
                            <Icon name="chev-r" small />
                          </AppLink>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            )}
          </section>
        </div>
      )}
      <p className="subtle pjo__note">
        This page only reads. The <Term id="project">project</Term> and its repository belong to Hermes; Caduceus keeps nothing of them.
      </p>
    </div>
  );
}
