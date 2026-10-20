// Worktree sessions (M1 #17): a session can start in a fresh git worktree of its workspace, and the worktree can be removed again. The git work is Hermes's
// (`POST /api/git/worktree/add`, `…/remove`, and the reads `…/worktrees`, `…/base-branches`, `…/status`); Caduceus keeps nothing about a worktree. A session
// "is in a worktree" when its workspace is a linked worktree of its repository, which Hermes's own list says. No DOM and no React.
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { TieredRequest, TieredResult } from '../../tiered-fetch.ts';
import { failureOf, type Outcome } from './sessions-actions.ts';

/** One working tree of a repository, as Hermes's `git worktree list` reads it. */
export interface Worktree {
  path: string;
  /** The branch checked out there; `null` for a detached HEAD. */
  branch: string | null;
  /** The repository's own folder, which is not a linked worktree and is never removed here. */
  isMain: boolean;
  locked: boolean;
}

/** A branch a new worktree can start from. */
export interface BaseBranch {
  name: string;
  isRemote: boolean;
  /** The repository's default branch (the remote's `HEAD`, else the local trunk): preselected. */
  isDefault: boolean;
}

/** What Hermes made: the worktree's folder and branch, and the repository's own folder. */
export interface AddedWorktree {
  path: string;
  branch: string;
  repoRoot: string;
}

const text = (value: unknown): string | undefined => (typeof value === 'string' && value !== '' ? value : undefined);

const query = (path: string, cwd: string): string => `${path}?path=${encodeURIComponent(cwd)}`;

/** The worktrees of the repository `cwd` is in, main one first. Rejects when Hermes cannot read it (not a repository, or the folder is gone). */
export async function readWorktrees(read: (path: string) => Promise<unknown>, cwd: string): Promise<Worktree[]> {
  const body = await read(query('/api/git/worktrees', cwd));
  const listed = isRecord(body) && Array.isArray(body.worktrees) ? body.worktrees : [];
  return listed.flatMap((entry): Worktree[] => {
    const path = isRecord(entry) ? text(entry.path) : undefined;
    return path === undefined || !isRecord(entry) ? [] : [{ path, branch: text(entry.branch) ?? null, isMain: entry.isMain === true, locked: entry.locked === true }];
  });
}

/** The branches a new worktree can start from, the default one first. Rejects when Hermes cannot read the repository. */
export async function readBaseBranches(read: (path: string) => Promise<unknown>, cwd: string): Promise<BaseBranch[]> {
  const body = await read(query('/api/git/base-branches', cwd));
  const listed = isRecord(body) && Array.isArray(body.branches) ? body.branches : [];
  const branches = listed.flatMap((entry): BaseBranch[] => {
    const name = isRecord(entry) ? text(entry.name) : undefined;
    return name === undefined || !isRecord(entry) ? [] : [{ name, isRemote: entry.isRemote === true, isDefault: entry.isDefault === true }];
  });
  return branches.toSorted((a, b) => Number(b.isDefault) - Number(a.isDefault));
}

/** Whether `inner` is `outer` or a folder inside it. */
export function isWithin(inner: string, outer: string): boolean {
  const base = outer.replace(/\/+$/, '');
  return inner === base || inner.startsWith(`${base}/`);
}

/** The linked worktree (never the main one) that the workspace `cwd` is, or is inside of; the deepest one when worktrees nest (Hermes keeps them in `<repo>/.worktrees`, inside the main tree). */
export function linkedWorktreeOf(cwd: string, worktrees: readonly Worktree[]): Worktree | undefined {
  const holding = worktrees.filter((tree) => isWithin(cwd, tree.path)).toSorted((a, b) => b.path.length - a.path.length)[0];
  return holding !== undefined && !holding.isMain ? holding : undefined;
}

/** What a git branch name may not be (`git check-ref-format`); the sentence says what to change, or `undefined` when the name is fine. */
export function branchNameProblem(name: string): string | undefined {
  if (name.trim() === '') return 'Give the branch a name.';
  if (name !== name.trim()) return 'A branch name cannot start or end with a space.';
  if (/[\s~^:?*[\\\u0000-\u001f\u007f]/.test(name)) return 'A branch name cannot contain spaces or any of ~ ^ : ? * [ \\.';
  if (name === '@') return 'A branch cannot be called just @.';
  if (name.startsWith('-')) return 'A branch name cannot start with a dash.';
  if (name.startsWith('/') || name.endsWith('/') || name.includes('//')) return 'A branch name cannot start or end with a slash, or have two in a row.';
  if (name.includes('..') || name.includes('@{')) return 'A branch name cannot contain .. or @{.';
  if (name.endsWith('.')) return 'A branch name cannot end with a dot.';
  if (name.split('/').some((part) => part.startsWith('.') || part.endsWith('.lock'))) return 'No part of a branch name can start with a dot or end with .lock.';
  return undefined;
}

/** How a Hermes git call ended: its answer, or why not. */
type Called<T> = { kind: 'sent'; body: T } | Extract<Outcome, { kind: 'cancelled' | 'failed' }>;

async function call(send: (request: TieredRequest) => Promise<TieredResult>, request: TieredRequest): Promise<Called<unknown>> {
  const result = await send(request);
  if (result.kind === 'cancelled') return result;
  if (result.kind === 'refused') return { kind: 'failed', message: result.refusal.message };
  if (!result.response.ok) return { kind: 'failed', message: await failureOf(result.response) };
  return { kind: 'sent', body: await result.response.json().catch(() => undefined) };
}

export type AddOutcome = { kind: 'added'; worktree: AddedWorktree } | Extract<Outcome, { kind: 'cancelled' | 'failed' }>;

export interface WorktreeIo {
  /** Calls a Hermes route through the policy (`fetchTiered`). */
  send(request: TieredRequest): Promise<TieredResult>;
  /** Reads a Hermes route (a plain GET through Caduceus). */
  read(path: string): Promise<unknown>;
}

/**
 * Makes a worktree of the repository `cwd` is in, on a new branch `branch` cut from `base` (Hermes's default when left out): Tier 1, so the owner confirms.
 * Hermes puts it in `<repository>/.worktrees/` and says where.
 */
export async function addWorktree({ send }: WorktreeIo, { cwd, branch, base }: { cwd: string; branch: string; base?: string }): Promise<AddOutcome> {
  const problem = branchNameProblem(branch);
  if (problem) return { kind: 'failed', message: problem };
  const answered = await call(send, {
    method: 'POST',
    path: '/api/git/worktree/add',
    body: { path: cwd, name: branch, branch, ...(base ? { base } : {}) },
    confirm: {
      title: `Make a worktree on “${branch}”?`,
      text: `Hermes makes a new folder inside ${cwd}/.worktrees with its own copy of the files, on a new branch${base ? ` cut from ${base}` : ''}. Nothing in the repository's own folder changes.`,
      object: branch,
      confirmLabel: 'Make worktree',
    },
  });
  if (answered.kind !== 'sent') return answered;
  const made = isRecord(answered.body) ? answered.body : {};
  const path = text(made.path);
  if (path === undefined) return { kind: 'failed', message: 'Hermes made the worktree but did not say where.' };
  return { kind: 'added', worktree: { path, branch: text(made.branch) ?? branch, repoRoot: text(made.repoRoot) ?? cwd } };
}

export type RemoveOutcome = { kind: 'removed'; changes: number } | Extract<Outcome, { kind: 'cancelled' | 'failed' }>;

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;

/**
 * Takes a linked worktree away. Hermes's git status is read first: a clean one is a Tier 1 removal; one with uncommitted changes is refused outright unless the owner
 * confirms the Tier 3 path (step-up and typing the branch), whose request is the only one that forces it. Without the force git itself refuses a worktree with
 * changes, so a change made between the check and the removal is never lost either.
 */
export async function removeWorktree({ send, read }: WorktreeIo, { worktree, repoRoot }: { worktree: Worktree; repoRoot: string }): Promise<RemoveOutcome> {
  if (worktree.isMain) return { kind: 'failed', message: 'This is the repository’s own folder, not a worktree, so it is not removed.' };
  const status = await read(query('/api/git/status', worktree.path)).catch((error: unknown) => error);
  const changed = isRecord(status) && typeof status.changed === 'number' ? status.changed : undefined;
  if (changed === undefined) {
    const why = status instanceof Error ? ` (${status.message})` : '';
    return { kind: 'failed', message: `Hermes could not read the changes in ${worktree.path}${why}, so it was not removed.` };
  }
  const name = worktree.branch ?? worktree.path.split('/').filter(Boolean).at(-1) ?? worktree.path;
  const dirty = changed > 0;
  const answered = await call(send, {
    method: 'POST',
    path: '/api/git/worktree/remove',
    body: { path: repoRoot, worktreePath: worktree.path, force: dirty },
    confirm: dirty
      ? {
          title: `Remove the worktree “${name}” and lose its changes?`,
          text: `It has ${plural(changed, 'uncommitted change')}. They are lost for good when the folder is removed.`,
          object: name,
          confirmLabel: 'Remove and lose the changes',
          recoverability: { undoable: false, note: 'Uncommitted changes are not in any commit and cannot be brought back.' },
        }
      : {
          title: `Remove the worktree “${name}”?`,
          text: `It has no uncommitted changes. Its folder is removed; the branch stays in the repository.`,
          object: worktree.path,
          confirmLabel: 'Remove worktree',
        },
  });
  if (answered.kind !== 'sent') return answered;
  return { kind: 'removed', changes: changed };
}
