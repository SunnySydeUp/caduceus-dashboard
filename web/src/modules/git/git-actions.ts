// The changes Workspace › Git makes, each through `fetchTiered` with the tier the policy map gives the route: stage and unstage are T0, commit, switch branch, add worktree and
// remove worktree are T1, discard, push, a commit that pushes and a forced worktree removal are T3, and the AI message is `llm.oneshot` (T1: the diff goes to Hermes's model).
// The caller shows toasts and reloads the status; this says what happened, with a git error turned into words and a next step (`git-model.ts`).
import { gatewayConnection } from '../../gateway.ts';
import { isReadOnly } from '../../policy-state.ts';
import { confirmTier } from '../../shell/tier-confirmation.ts';
import { fetchTiered } from '../../tiered.ts';
import { READ_ONLY_MESSAGE } from '../../tiered-fetch.ts';
import { runTiered } from '../profiles/profile-actions.ts';
import { cleanCommitMessage, commitMessageRequest, gitAdvice, parseCommitContext, type Advice } from './git-model.ts';

export type GitOutcome<Body = unknown> = { kind: 'done'; body: Body } | { kind: 'cancelled' } | { kind: 'failed'; advice: Advice };

const baseName = (path: string) => path.replace(/\/+$/, '').slice(path.replace(/\/+$/, '').lastIndexOf('/') + 1) || path;

/** An outcome of `runTiered`, with a failure's message read as a git error. */
async function git<Body = unknown>(sending: ReturnType<typeof fetchTiered>): Promise<GitOutcome<Body>> {
  const outcome = await runTiered<Body>(sending);
  return outcome.kind === 'failed' ? { kind: 'failed', advice: gitAdvice(outcome.message) } : outcome;
}

export const stage = (folder: string, file?: string) => git(fetchTiered({ method: 'POST', path: '/api/git/review/stage', body: { path: folder, ...(file ? { file } : {}) } }));
export const unstage = (folder: string, file?: string) => git(fetchTiered({ method: 'POST', path: '/api/git/review/unstage', body: { path: folder, ...(file ? { file } : {}) } }));

/** Commits what is staged (everything, when nothing is). The owner presses Commit: a drafted message is only ever text in the field. */
export function commit(folder: string, message: string, profile: string | undefined, files: number, branch: string | undefined): Promise<GitOutcome> {
  return git(
    fetchTiered({
      method: 'POST',
      path: '/api/git/review/commit',
      body: { path: folder, message, push: false },
      confirm: { title: `Commit ${files === 1 ? '1 file' : `${files} files`}${branch ? ` on ${branch}` : ''}?`, text: message.split('\n')[0], object: message.split('\n')[0], profile, confirmLabel: 'Commit' },
    }),
  );
}

/** Discards changes back to the committed state: tracked files are restored and untracked files deleted. T3: the name is typed, and it cannot be undone. */
export function discard(folder: string, file: string | undefined, profile: string | undefined): Promise<GitOutcome> {
  const name = file ?? baseName(folder);
  return git(
    fetchTiered({
      method: 'POST',
      path: '/api/git/review/revert',
      body: { path: folder, ...(file ? { file } : {}) },
      confirm: {
        title: file ? `Discard the changes to ${file}?` : `Discard every change in ${name}?`,
        text: 'Tracked files go back to the last commit and untracked files are deleted from the Mac. Git keeps no copy of either.',
        object: name,
        profile,
        confirmLabel: 'Discard',
        recoverability: { undoable: false, note: 'Uncommitted changes are not kept anywhere: Caduceus keeps no copy, and git cannot restore them.' },
      },
    }),
  );
}

/** Pushes the current branch to its remote (T3, the folder's name typed). */
export function push(folder: string, profile: string | undefined, branch: string | undefined): Promise<GitOutcome> {
  return git(
    fetchTiered({
      method: 'POST',
      path: '/api/git/review/push',
      body: { path: folder },
      confirm: {
        title: `Push ${branch ?? 'this branch'} to its remote?`,
        text: 'This sends your commits to another computer, where others may see them.',
        object: baseName(folder),
        profile,
        confirmLabel: 'Push',
        recoverability: { undoable: false, note: 'A pushed commit is out of your hands.' },
      },
    }),
  );
}

export const switchBranch = (folder: string, branch: string, profile: string | undefined) =>
  git(
    fetchTiered({
      method: 'POST',
      path: '/api/git/branch/switch',
      body: { path: folder, branch },
      confirm: { title: `Switch to ${branch}?`, text: 'The files in the folder change to that branch. Changes that would be overwritten stop the switch.', object: branch, profile, confirmLabel: 'Switch' },
    }),
  );

export const addWorktree = (folder: string, options: { name?: string; branch?: string; base?: string; existingBranch?: string }, profile: string | undefined) =>
  git<{ path?: string; branch?: string }>(
    fetchTiered({
      method: 'POST',
      path: '/api/git/worktree/add',
      body: { path: folder, ...options },
      confirm: {
        title: options.existingBranch ? `Open ${options.existingBranch} in a worktree?` : 'Add a worktree on a new branch?',
        text: 'A worktree is another working folder of this repository, inside its .worktrees folder, so two branches can be open at once.',
        object: options.existingBranch ?? options.branch ?? options.name ?? 'a new worktree',
        profile,
        confirmLabel: 'Add worktree',
      },
    }),
  );

/** Removes a worktree. Git refuses one with uncommitted changes; `force` removes it anyway (T3: the changes are lost). */
export const removeWorktree = (folder: string, worktreePath: string, force: boolean, profile: string | undefined) =>
  git(
    fetchTiered({
      method: 'POST',
      path: '/api/git/worktree/remove',
      body: { path: folder, worktreePath, force },
      confirm: force
        ? { title: `Remove ${baseName(worktreePath)} and lose its changes?`, text: 'Its uncommitted changes are deleted with it.', object: baseName(worktreePath), profile, confirmLabel: 'Remove anyway', recoverability: { undoable: false, note: 'Uncommitted changes are not kept anywhere.' } }
        : { title: `Remove the worktree ${baseName(worktreePath)}?`, text: 'The folder is deleted; its branch stays.', object: worktreePath, profile, confirmLabel: 'Remove worktree' },
    }),
  );

/** Has Hermes's model draft a commit message from the diff (T1: the owner confirms what is sent). The text only fills the field. */
export async function draftMessage(folder: string, profile: string): Promise<{ kind: 'done'; message: string } | { kind: 'cancelled' } | { kind: 'failed'; advice: Advice }> {
  if (isReadOnly()) return { kind: 'failed', advice: { message: READ_ONLY_MESSAGE, next: undefined } };
  const res = await fetch(`/api/git/review/commit-context?path=${encodeURIComponent(folder)}`).catch(() => undefined);
  const context = parseCommitContext(res?.ok ? await res.json().catch(() => undefined) : undefined);
  if (context.diff.trim() === '') return { kind: 'failed', advice: { message: 'There are no changes to describe.', next: 'Edit or stage a file first.' } };
  const confirmed = await confirmTier({
    tier: 'T1',
    moduleId: 'git',
    action: 'llm.oneshot',
    label: 'Draft a commit message?',
    text: 'The diff of what will be committed, and the latest commit subjects, go to Hermes’s model. The message only fills the field: nothing is committed until you press Commit.',
    object: baseName(folder),
    profile,
    confirmLabel: 'Draft message',
  });
  if (!confirmed) return { kind: 'cancelled' };
  try {
    const answer = await gatewayConnection().client.request<{ text?: unknown }>('llm.oneshot', commitMessageRequest(context, profile));
    const message = typeof answer.text === 'string' ? cleanCommitMessage(answer.text) : undefined;
    return message ? { kind: 'done', message } : { kind: 'failed', advice: { message: 'Hermes’s model did not answer with a message.', next: 'Try again, or write the message yourself.' } };
  } catch (error) {
    return { kind: 'failed', advice: { message: error instanceof Error ? error.message : String(error), next: 'Check the model in Agents › Models, or write the message yourself.' } };
  }
}
