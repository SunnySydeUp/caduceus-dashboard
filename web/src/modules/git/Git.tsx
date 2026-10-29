import { useEffect, useId, useState, type FormEvent } from 'react';
import { useSearch } from '@tanstack/react-router';
import { Icon } from '../../icons.tsx';
import { closeAllLayers } from '../../overlays/layers.ts';
import { Sheet } from '../../overlays/Sheet.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { filesUrl } from '../files/files-model.ts';
import { DiffView, useSplitDiff } from './DiffView.tsx';
import { useFolderChoices } from './folder-choices.ts';
import { addWorktree, commit, discard, draftMessage, push, removeWorktree, stage, switchBranch, unstage, type GitOutcome } from './git-actions.ts';
import { useDiff, useRepo } from './git-data.ts';
import { remoteWords, type Branch, type GitFile, type RepoStatus, type Worktree } from './git-model.ts';
import '../profiles/profiles.css';
import './git.css';

const gitUrl = (folder: string | undefined) => (folder ? `/workspace/git?folder=${encodeURIComponent(folder)}` : '/workspace/git');
const flagWords = (file: GitFile) => (file.conflicted ? 'Conflict' : file.untracked ? 'New' : file.staged && file.unstaged ? 'Staged + more' : file.staged ? 'Staged' : 'Changed');

function Advice({ outcome }: { outcome: Extract<GitOutcome, { kind: 'failed' }> }) {
  return (
    <div className="banner" data-tone="danger" role="alert">
      <Icon name="alert" />
      <div className="banner__content">
        <strong>{outcome.advice.message}</strong>
        {outcome.advice.next && <p>{outcome.advice.next}</p>}
      </div>
    </div>
  );
}

function BranchesSheet({ branches, busy, onSwitch, onWorktree, onClose }: { branches: Branch[]; busy: boolean; onSwitch(branch: Branch): void; onWorktree(branch: Branch): void; onClose(): void }) {
  return (
    <Sheet title="Branches" detents={['half', 'full']} onClose={onClose}>
      <ul className="pf-acts">
        {branches.map((branch) => (
          <li key={branch.name} className="gt-branch">
            <span className="gt-branch__name">
              <Icon name="git" />
              <span>{branch.name}</span>
              {branch.checkedOut && <span className="chip">checked out</span>}
              {branch.isDefault && <span className="chip">default</span>}
              {branch.isRemote && <span className="chip">remote</span>}
            </span>
            <span className="row">
              {!branch.isRemote && (
                <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy || branch.checkedOut} aria-label={`Switch to ${branch.name}`} onClick={() => onSwitch(branch)}>
                  Switch…
                </WriteButton>
              )}
              <WriteButton type="button" className="btn btn--ghost btn--sm" disabled={busy} aria-label={`Open ${branch.name} in a worktree`} onClick={() => onWorktree(branch)}>
                Worktree…
              </WriteButton>
            </span>
          </li>
        ))}
        {branches.length === 0 && <li className="subtle">This repository has no branches yet.</li>}
      </ul>
    </Sheet>
  );
}

function WorktreesSheet({ worktrees, branches, busy, onAdd, onRemove, onClose }: { worktrees: Worktree[]; branches: Branch[]; busy: boolean; onAdd(options: { name?: string; branch?: string; base?: string }): void; onRemove(tree: Worktree): void; onClose(): void }) {
  const id = useId();
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('');
  const [base, setBase] = useState(branches.find((entry) => entry.isDefault && !entry.isRemote)?.name ?? '');
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onAdd({ name: name.trim() || undefined, branch: branch.trim() || undefined, base: base || undefined });
  };
  return (
    <Sheet title="Worktrees" detents={['half', 'full']} onClose={onClose}>
      <div className="stack">
        <p className="subtle">
          A <Term id="worktree">worktree</Term> is another working folder of this repository, so a second branch can be open at the same time.
        </p>
        <ul className="pf-acts">
          {worktrees.map((tree) => (
            <li key={tree.path} className="gt-branch">
              <span className="gt-branch__name">
                <Icon name="folder" />
                <span className="gt-path">{tree.path}</span>
                {tree.branch && <span className="chip">{tree.branch}</span>}
                {tree.isMain && <span className="chip">main folder</span>}
                {tree.locked && <span className="chip">locked</span>}
              </span>
              {!tree.isMain && (
                <span className="row">
                  <AppLink className="btn btn--ghost btn--sm" to={gitUrl(tree.path)}>
                    Open
                  </AppLink>
                  <WriteButton type="button" className="btn btn--ghost btn--sm gt-danger" disabled={busy} aria-label={`Remove the worktree ${tree.path}`} onClick={() => onRemove(tree)}>
                    Remove…
                  </WriteButton>
                </span>
              )}
            </li>
          ))}
        </ul>
        <form className="stack" onSubmit={submit}>
          <h3 className="gt-h">Add a worktree on a new branch</h3>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-name`}>
              Folder name
            </label>
            <input id={`${id}-name`} className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="spike" autoComplete="off" autoCapitalize="none" spellCheck={false} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-branch`}>
              New branch
            </label>
            <input id={`${id}-branch`} className="input" value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="hermes/spike" autoComplete="off" autoCapitalize="none" spellCheck={false} />
          </div>
          <div className="field">
            <label className="field__label" htmlFor={`${id}-base`}>
              Start from
            </label>
            <select id={`${id}-base`} className="input" value={base} onChange={(event) => setBase(event.target.value)}>
              <option value="">The current commit</option>
              {branches.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>
          <WriteButton type="submit" className="btn btn--primary" disabled={busy}>
            <Icon name="plus" />
            Add worktree…
          </WriteButton>
        </form>
      </div>
    </Sheet>
  );
}

function FileRow({ file, selected, busy, onSelect, onStage, onUnstage, onMenu }: { file: GitFile; selected: boolean; busy: boolean; onSelect(): void; onStage(): void; onUnstage(): void; onMenu(): void }) {
  return (
    <li className="gt-file" data-selected={selected || undefined}>
      <button type="button" className="gt-file__name" aria-current={selected ? 'true' : undefined} onClick={onSelect}>
        <Icon name="file" />
        <span className="gt-file__text">{file.path}</span>
        <span className="chip">{flagWords(file)}</span>
      </button>
      {file.staged && (
        <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy} aria-label={`Unstage ${file.path}`} onClick={onUnstage}>
          Unstage
        </WriteButton>
      )}
      {(file.unstaged || file.untracked) && (
        <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy} aria-label={`Stage ${file.path}`} onClick={onStage}>
          Stage
        </WriteButton>
      )}
      <button type="button" className="btn btn--ghost btn--icon" aria-label={`Actions for ${file.path}`} aria-haspopup="dialog" onClick={onMenu}>
        <Icon name="dots-v" />
      </button>
    </li>
  );
}

function Changes({ status, folder, profile, reload }: { status: RepoStatus; folder: string; profile: string | undefined; reload(): Promise<void> }) {
  const split = useSplitDiff();
  const [selected, setSelected] = useState<string>();
  const [stagedView, setStagedView] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Extract<GitOutcome, { kind: 'failed' }>>();
  const [menu, setMenu] = useState<GitFile>();
  const [drafting, setDrafting] = useState(false);
  const messageId = useId();
  const file = status.files.find((candidate) => candidate.path === selected);
  const showStaged = file ? (file.staged && !file.unstaged ? true : stagedView && file.staged) : false;
  const diff = useDiff(folder, file?.path, showStaged, status);

  useEffect(() => {
    if (selected !== undefined && !status.files.some((candidate) => candidate.path === selected)) setSelected(undefined);
  }, [status, selected]);

  const run = async (action: () => Promise<GitOutcome>, success?: string) => {
    setBusy(true);
    setFailure(undefined);
    try {
      const outcome = await action();
      if (outcome.kind === 'failed') setFailure(outcome);
      else if (outcome.kind === 'done' && success) toast(success, { tone: 'success' });
      if (outcome.kind !== 'cancelled') await reload();
      return outcome;
    } finally {
      setBusy(false);
    }
  };

  const staged = status.files.filter((candidate) => candidate.staged);
  const unstaged = status.files.filter((candidate) => candidate.unstaged || candidate.untracked);
  const toCommit = staged.length > 0 ? staged.length : status.files.length;

  const draft = async () => {
    setDrafting(true);
    setFailure(undefined);
    try {
      const outcome = await draftMessage(folder, profile ?? 'default');
      if (outcome.kind === 'done') setMessage(outcome.message);
      else if (outcome.kind === 'failed') setFailure(outcome);
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div className="gt-changes">
      {failure && <Advice outcome={failure} />}
      <section className="gt-panel" aria-label="Changes">
        <div className="gt-bar">
          <h3 className="gt-h">Changes</h3>
          <span className="row">
            <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy || unstaged.length === 0} onClick={() => void run(() => stage(folder))}>
              Stage all
            </WriteButton>
            <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy || staged.length === 0} onClick={() => void run(() => unstage(folder))}>
              Unstage all
            </WriteButton>
          </span>
        </div>
        {status.files.length === 0 ? (
          <div className="empty">
            <span className="empty__icon">
              <Icon name="check" />
            </span>
            <p>Nothing to commit: the working tree is clean.</p>
          </div>
        ) : (
          <>
            {staged.length > 0 && (
              <>
                <h4 className="gt-sub">
                  <Term id="git-stage">Staged</Term> ({staged.length})
                </h4>
                <ul className="gt-files">
                  {staged.map((entry) => (
                    <FileRow key={`s:${entry.path}`} file={entry} selected={selected === entry.path} busy={busy} onSelect={() => { setSelected(entry.path); setStagedView(true); }} onStage={() => void run(() => stage(folder, entry.path))} onUnstage={() => void run(() => unstage(folder, entry.path))} onMenu={() => setMenu(entry)} />
                  ))}
                </ul>
              </>
            )}
            {unstaged.length > 0 && (
              <>
                <h4 className="gt-sub">Not staged ({unstaged.length})</h4>
                <ul className="gt-files">
                  {unstaged.map((entry) => (
                    <FileRow key={`u:${entry.path}`} file={entry} selected={selected === entry.path} busy={busy} onSelect={() => { setSelected(entry.path); setStagedView(false); }} onStage={() => void run(() => stage(folder, entry.path))} onUnstage={() => void run(() => unstage(folder, entry.path))} onMenu={() => setMenu(entry)} />
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>
      {file && (
        <section className="gt-panel gt-diffpane" aria-label={`Diff of ${file.path}`}>
          <div className="gt-bar">
            <h3 className="gt-h gt-path">{file.path}</h3>
            {file.staged && file.unstaged && (
              <button type="button" className="btn btn--secondary btn--sm" aria-pressed={stagedView} onClick={() => setStagedView((now) => !now)}>
                {stagedView ? 'Show unstaged changes' : 'Show staged changes'}
              </button>
            )}
          </div>
          {diff === undefined ? <p role="status">Loading…</p> : <DiffView diff={diff} split={split} />}
        </section>
      )}
      <section className="gt-panel gt-commit" aria-label="Commit">
        <h3 className="gt-h">Commit</h3>
        <div className="field">
          <label className="field__label" htmlFor={messageId}>
            Message
          </label>
          <textarea id={messageId} className="input gt-message" rows={4} value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Describe the change" spellCheck />
          <p className="subtle">{staged.length > 0 ? `Commits the ${staged.length} staged ${staged.length === 1 ? 'file' : 'files'}.` : status.files.length > 0 ? 'Nothing is staged, so Commit stages everything first.' : 'There is nothing to commit.'}</p>
        </div>
        <div className="row">
          <WriteButton type="button" className="btn btn--secondary" disabled={busy || drafting || status.files.length === 0} onClick={() => void draft()}>
            <Icon name="bolt" />
            {drafting ? 'Drafting…' : 'Write a message with AI…'}
          </WriteButton>
          <WriteButton
            type="button"
            className="btn btn--primary"
            disabled={busy || message.trim() === '' || status.files.length === 0}
            onClick={() =>
              void run(() => commit(folder, message.trim(), profile, toCommit, status.branch), 'Committed').then((outcome) => {
                if (outcome?.kind === 'done') setMessage('');
              })
            }
          >
            <Icon name="check" />
            Commit…
          </WriteButton>
        </div>
      </section>
      {menu && (
        <Sheet title={menu.path} onClose={() => setMenu(undefined)}>
          <ul className="pf-acts">
            <li>
              <button
                type="button"
                className="pf-act pf-act--danger"
                onClick={() => {
                  const target = menu;
                  setMenu(undefined);
                  void closeAllLayers().then(() => run(() => discard(folder, target.path, profile), `Discarded the changes to ${target.path}`));
                }}
              >
                <Icon name="trash" />
                <span>
                  <span>Discard changes…</span>
                  <small>Cannot be undone: restores the last commit</small>
                </span>
              </button>
            </li>
          </ul>
        </Sheet>
      )}
    </div>
  );
}

/** Workspace › Git: the repository behind a workspace or project folder. */
export function Git() {
  const search = useSearch({ strict: false }) as { folder?: unknown };
  const navigate = useAppNavigate();
  const { effective } = useProfileScope();
  const profile = effective?.name;
  const choices = useFolderChoices();
  const picked = typeof search.folder === 'string' && search.folder !== '' ? search.folder : undefined;
  const folder = picked ?? choices?.[0]?.path;
  const { repo, reload } = useRepo(folder);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState<'branches' | 'worktrees'>();
  const [failure, setFailure] = useState<Extract<GitOutcome, { kind: 'failed' }>>();
  const pickerId = useId();

  const ready = repo.state === 'ready' ? repo : undefined;
  const remote = ready ? remoteWords(ready.status, ready.branches) : undefined;
  const remoteNoteId = useId();
  const act = async (action: () => Promise<GitOutcome>, success?: (outcome: Extract<GitOutcome, { kind: 'done' }>) => string) => {
    setBusy(true);
    setFailure(undefined);
    try {
      const outcome = await action();
      if (outcome.kind === 'failed') setFailure(outcome);
      else if (outcome.kind === 'done' && success) toast(success(outcome), { tone: 'success' });
      if (outcome.kind !== 'cancelled') await reload();
      return outcome;
    } finally {
      setBusy(false);
    }
  };

  const withSheetClosed = (run: () => Promise<unknown>) => {
    setSheet(undefined);
    void closeAllLayers().then(run);
  };

  const removeTree = async (tree: Worktree) => {
    if (!folder) return;
    const outcome = await act(() => removeWorktree(folder, tree.path, false, profile), () => `Removed the worktree ${tree.path}`);
    if (outcome.kind === 'failed' && /modified or untracked|changes/i.test(outcome.advice.message)) {
      toast(outcome.advice.message, { tone: 'danger', detail: outcome.advice.next, action: { label: 'Remove anyway…', onClick: () => void act(() => removeWorktree(folder, tree.path, true, profile), () => `Removed the worktree ${tree.path}`) } });
    }
  };

  return (
    <div className="gt">
      <PageHeader
        overline="Workspace"
        title="Git"
        subtitle={
          <>
            The repository behind a workspace or project: <Term id="git-stage">stage</Term>, commit and push, with Hermes doing the git work.
          </>
        }
      />
      {choices === undefined && <p role="status">Loading…</p>}
      {choices !== undefined && choices.length === 0 && picked === undefined && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="git" />
          </span>
          <p>There is no workspace or project to show yet. Add a workspace on Work › Projects, or browse a folder in Files.</p>
          <div className="row">
            <AppLink className="btn btn--primary" to="/work/projects">
              Open Projects
            </AppLink>
            <AppLink className="btn btn--secondary" to={filesUrl(undefined)}>
              Open Files
            </AppLink>
          </div>
        </div>
      )}
      {folder !== undefined && (
        <div className="gt-top">
          <div className="field">
            <label className="field__label" htmlFor={pickerId}>
              Workspace
            </label>
            <select id={pickerId} className="input" value={folder} onChange={(event) => void navigate(gitUrl(event.target.value), { replace: true })}>
              {!choices?.some((choice) => choice.path === folder) && <option value={folder}>{folder}</option>}
              {choices?.map((choice) => (
                <option key={choice.path} value={choice.path}>
                  {choice.label}
                </option>
              ))}
            </select>
          </div>
          {ready && remote && (
            <div className="gt-actions">
              <span className="chip gt-branchchip">
                <Icon name="git" />
                {ready.status.detached ? 'detached HEAD' : (ready.status.branch ?? 'no branch')}
              </span>
              <span className="subtle">{remote.line}</span>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setSheet('branches')}>
                <Icon name="git" />
                Branches
              </button>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => setSheet('worktrees')}>
                <Icon name="folder" />
                Worktrees
              </button>
              <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={busy || !remote.canPush} aria-describedby={remote.why ? remoteNoteId : undefined} onClick={() => void act(() => push(folder, profile, ready.status.branch), () => 'Pushed')}>
                <Icon name="arrow-up" />
                Push…
              </WriteButton>
              {remote.why && (
                <p id={remoteNoteId} className="subtle" role="note">
                  {remote.why}
                </p>
              )}
            </div>
          )}
        </div>
      )}
      {repo.state === 'loading' && <p role="status">Loading…</p>}
      {repo.state === 'failed' && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <span className="banner__content">{repo.message}</span>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void reload()}>
            <Icon name="refresh" />
            Retry
          </button>
        </div>
      )}
      {repo.state === 'none' && folder !== undefined && (
        <div className="empty">
          <span className="empty__icon">
            <Icon name="git" />
          </span>
          <p>{folder} is not in a git repository, so there is no status or diff to show. Git needs a folder that was set up with git init or cloned.</p>
          <AppLink className="btn btn--primary" to={filesUrl(folder)}>
            Look at it in Files
          </AppLink>
        </div>
      )}
      {failure && <Advice outcome={failure} />}
      {ready && folder !== undefined && <Changes status={ready.status} folder={folder} profile={profile} reload={reload} />}
      {sheet === 'branches' && ready && folder !== undefined && (
        <BranchesSheet
          branches={ready.branches}
          busy={busy}
          onSwitch={(branch) => withSheetClosed(() => act(() => switchBranch(folder, branch.name, profile), () => `Switched to ${branch.name}`))}
          onWorktree={(branch) => withSheetClosed(() => act(() => addWorktree(folder, { existingBranch: branch.name }, profile), (outcome) => `Opened ${branch.name} in ${(outcome.body as { path?: string }).path ?? 'a worktree'}`))}
          onClose={() => setSheet(undefined)}
        />
      )}
      {sheet === 'worktrees' && ready && folder !== undefined && (
        <WorktreesSheet
          worktrees={ready.worktrees}
          branches={ready.branches.filter((entry) => !entry.isRemote)}
          busy={busy}
          onAdd={(options) => withSheetClosed(() => act(() => addWorktree(folder, options, profile), (outcome) => `Added a worktree at ${(outcome.body as { path?: string }).path ?? ''}`))}
          onRemove={(tree) => withSheetClosed(() => removeTree(tree))}
          onClose={() => setSheet(undefined)}
        />
      )}
    </div>
  );
}
