// Duplicate and worktree sessions in the UI (M1 #17): the "Worktree" badge on a row and in a chat's header, the sheet that starts a session in a new worktree, and the
// three actions the row menu runs (Duplicate, New session in a worktree, Remove worktree). What they do is `session-branch.ts` and `worktrees.ts`; everything
// changed is Hermes's.
import { useEffect, useId, useMemo, useState, type FormEvent } from 'react';
import { gatewayConnection } from '../../gateway.ts';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { useAppNavigate } from '../../shell/navigation.tsx';
import { toast } from '../../shell/toasts.ts';
import { fetchTiered } from '../../tiered.ts';
import { readHermes } from './read-hermes.ts';
import { branchStored } from './session-branch.ts';
import { ChangeButton, report } from './SessionOrganiser.tsx';
import { nameOf, type Outcome } from './sessions-actions.ts';
import type { SessionItem } from './sessions-model.ts';
import { offerWorkspace } from './workspace-handoff.ts';
import { addWorktree, branchNameProblem, isWithin, linkedWorktreeOf, readBaseBranches, readWorktrees, removeWorktree, type BaseBranch, type Worktree } from './worktrees.ts';

/** How long what Hermes said about a folder is believed: a worktree made or removed from a terminal shows up within this. */
const FRESH_MS = 60_000;
/** How many folders are asked about at once, and in all: each is a few `git` commands in Hermes. */
const PARALLEL = 3;
const MOST_FOLDERS = 100;

/** What Hermes said about each workspace folder: the linked worktree it is in, or none. Shared by every row and header, for as long as it is fresh. */
const known = new Map<string, { at: number; tree: Worktree | undefined }>();
const fresh = (cwd: string): boolean => {
  const entry = known.get(cwd);
  return entry !== undefined && Date.now() - entry.at < FRESH_MS;
};

/** Forgets what was read, after a worktree was made or removed here. */
export function forgetWorktrees(): void {
  known.clear();
}

/**
 * Which of these workspace folders are in a linked worktree, as Hermes's worktree list says (`GET /api/git/worktrees`). The answer for a folder comes in after
 * the list does; a folder that is not in a repository, or that Hermes cannot read, is simply not in a worktree. One answer covers every folder inside the
 * worktrees it lists.
 */
export function useLinkedWorktrees(cwds: readonly string[]): (cwd: string) => Worktree | undefined {
  const [, changed] = useState(0);
  const key = [...new Set(cwds.filter((cwd) => cwd !== ''))].slice(0, MOST_FOLDERS).join('\n');
  useEffect(() => {
    let current = true;
    const wanted = key === '' ? [] : key.split('\n');
    const queue = wanted.filter((cwd) => !fresh(cwd));
    const worker = async () => {
      for (let cwd = queue.shift(); cwd !== undefined; cwd = queue.shift()) {
        if (!current) return;
        // A sibling's answer may have covered it.
        if (fresh(cwd)) continue;
        const trees = await readWorktrees(readHermes, cwd).catch(() => []);
        const at = Date.now();
        for (const other of wanted) if (other === cwd || trees.some((tree) => isWithin(other, tree.path))) known.set(other, { at, tree: linkedWorktreeOf(other, trees) });
        if (current) changed((count) => count + 1);
      }
    };
    void Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
    return () => {
      current = false;
    };
  }, [key]);
  return (cwd) => known.get(cwd)?.tree;
}

/** "Worktree": this session works in a linked git worktree. */
export function WorktreeTag({ tree }: { tree: Worktree }) {
  return (
    <span className="tag wt-tag" data-wt="tag" title={tree.branch === null ? 'A git worktree' : `A git worktree on ${tree.branch}`}>
      <Icon name="git" small />
      <span>Worktree</span>
      {tree.branch !== null && <span className="sr-only"> on {tree.branch}</span>}
    </span>
  );
}

/** Under a chat's title: the worktree it works in and its branch, when its workspace is a linked worktree. */
export function WorktreeBar({ cwd }: { cwd: string | undefined }) {
  const tree = useLinkedWorktrees(cwd === undefined ? [] : [cwd])(cwd ?? '');
  if (tree === undefined) return null;
  return (
    <div className="chat__origin" data-wt="bar">
      <WorktreeTag tree={tree} />
      {tree.branch !== null && <span className="subtle mono">{tree.branch}</span>}
    </div>
  );
}

/**
 * Starting a session in a new worktree: the branch it is made on, and the branch it starts from. The bases are read from Hermes first; a folder that is not a git
 * repository with a commit has none, and is not made one here (Hermes would start a repository there).
 */
export function NewWorktreeSheet({ item, onCreate, onClose }: { item: SessionItem; onCreate(input: { branch: string; base: string | undefined }): void; onClose(): void }) {
  const [branch, setBranch] = useState('');
  const [base, setBase] = useState<string>();
  const [bases, setBases] = useState<{ state: 'loading' } | { state: 'ready'; branches: BaseBranch[] } | { state: 'unavailable'; reason: string }>({ state: 'loading' });
  const [touched, setTouched] = useState(false);
  const id = useId();
  useEffect(() => {
    let current = true;
    readBaseBranches(readHermes, item.cwd).then(
      (branches) => {
        if (!current) return;
        setBases(branches.length === 0 ? { state: 'unavailable', reason: 'This workspace is not a git repository with at least one commit, so it cannot have a worktree.' } : { state: 'ready', branches });
        setBase(branches[0]?.name);
      },
      (error: unknown) => current && setBases({ state: 'unavailable', reason: error instanceof Error ? error.message : 'Hermes could not read this workspace.' }),
    );
    return () => {
      current = false;
    };
  }, [item.cwd]);
  const problem = branchNameProblem(branch);
  const shown = touched ? problem : undefined;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (problem === undefined && bases.state === 'ready') onCreate({ branch, base });
  };
  return (
    <Sheet title="New session in a worktree" initialFocus="input" onClose={onClose}>
      <form className="field" onSubmit={submit}>
        <p className="sl-sheet__note">
          A worktree is a second folder of <span className="mono">{item.cwd}</span> with its own copy of the files, on a branch of its own, so a session can change code there without touching your working folder.
        </p>
        <label className="field__label" htmlFor={`${id}-branch`}>
          New branch
        </label>
        <input
          id={`${id}-branch`}
          className="input"
          value={branch}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="feature/login"
          aria-invalid={shown !== undefined}
          aria-describedby={`${id}-branch-help`}
          onBlur={() => setTouched(true)}
          onChange={(event) => setBranch(event.target.value)}
        />
        <p id={`${id}-branch-help`} className={shown === undefined ? 'field__help' : 'field__error'} role={shown === undefined ? undefined : 'alert'}>
          {shown ?? 'Hermes makes this branch and a folder named after it in .worktrees.'}
        </p>
        <label className="field__label" htmlFor={`${id}-base`}>
          Start from
        </label>
        {bases.state === 'ready' ? (
          <select id={`${id}-base`} className="input" value={base ?? ''} onChange={(event) => setBase(event.target.value)}>
            {bases.branches.map((candidate) => (
              <option key={candidate.name} value={candidate.name}>
                {candidate.name}
                {candidate.isDefault ? ' (default)' : ''}
              </option>
            ))}
          </select>
        ) : (
          <p id={`${id}-base`} className="field__help" role={bases.state === 'unavailable' ? 'alert' : 'status'}>
            {bases.state === 'loading' ? 'Reading the branches…' : bases.reason}
          </p>
        )}
        <div className="sl-sheet__actions">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <ChangeButton type="submit" className="btn btn--primary" disabled={bases.state !== 'ready'}>
            Make worktree
          </ChangeButton>
        </div>
      </form>
    </Sheet>
  );
}

export interface WorktreeActions {
  /** Branches the session into a new one with every message (T0) and opens it. */
  duplicate(item: SessionItem): Promise<void>;
  /** Makes a worktree of the session's workspace (T1), and opens a new chat that starts in it. */
  startSession(item: SessionItem, input: { branch: string; base: string | undefined }): Promise<void>;
  /** Removes the linked worktree that is the session's workspace: T1 when it is clean, T3 when it has changes. */
  removeWorktree(item: SessionItem): Promise<void>;
}

/** The row menu's Duplicate, New session in a worktree and Remove worktree for this tab's profile. `changed` runs after anything that may have changed the list. */
export function useWorktreeActions(profile: string, changed: () => void): WorktreeActions {
  const navigate = useAppNavigate();
  return useMemo(() => {
    const scope = (item: SessionItem) => item.profile ?? profile;
    const where = (item: SessionItem, path: string) => (scope(item) === profile ? path : `${path}?profile=${encodeURIComponent(scope(item))}`);
    return {
      async duplicate(item) {
        try {
          const copy = await branchStored(gatewayConnection().client, { storedId: item.id, profile: scope(item) });
          toast('Duplicated into a new session', { tone: 'success', detail: `“${copy.title}” has every message of “${nameOf(item)}”. The original is as it was.` });
          changed();
          await navigate(where(item, `/chat/${encodeURIComponent(copy.storedId)}`));
        } catch (error) {
          toast('Hermes did not duplicate this session', { tone: 'danger', detail: error instanceof Error ? error.message : String(error) });
        }
      },
      async startSession(item, { branch, base }) {
        const outcome = await addWorktree({ send: fetchTiered, read: readHermes }, { cwd: item.cwd, branch, ...(base === undefined ? {} : { base }) });
        if (outcome.kind !== 'added') return report(outcome, changed);
        forgetWorktrees();
        offerWorkspace(scope(item), outcome.worktree.path);
        toast('Worktree ready', { tone: 'success', detail: `${outcome.worktree.path} is on the new branch ${outcome.worktree.branch}. The chat opened here starts there.` });
        await navigate(where(item, '/chat/new'));
      },
      async removeWorktree(item) {
        const outcome = await removeInside(item);
        forgetWorktrees();
        report(outcome, changed);
      },
    };
  }, [profile, changed, navigate]);
}

/** Reads the worktree list fresh (not the badge's memory) and removes the one that is the session's workspace. */
async function removeInside(item: SessionItem): Promise<Outcome> {
  const trees = await readWorktrees(readHermes, item.cwd).catch(() => undefined);
  const tree = trees === undefined ? undefined : linkedWorktreeOf(item.cwd, trees);
  const main = trees?.find((candidate) => candidate.isMain);
  if (tree === undefined || main === undefined) return { kind: 'failed', message: 'This session’s workspace is not a git worktree any more, so there is nothing to remove.' };
  const outcome = await removeWorktree({ send: fetchTiered, read: readHermes }, { worktree: tree, repoRoot: main.path });
  if (outcome.kind !== 'removed') return outcome;
  const lost = outcome.changes > 0 ? ` and discarded ${outcome.changes} uncommitted change${outcome.changes === 1 ? '' : 's'}` : '';
  return { kind: 'done', message: `Removed the worktree ${tree.branch ?? tree.path}${lost}` };
}
