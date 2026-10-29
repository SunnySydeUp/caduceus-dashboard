// What Workspace › Git knows about a repository, free of the DOM and of React (M7 #03): Hermes's status, branches and worktrees as the page shows
// them, a unified diff as rows (unified and split), what a git error means for the owner, and the request that has Hermes draft a commit message.
// Everything is Hermes's (D1): the repository is asked again after every operation, and no git state is kept anywhere.
import { isRecord } from '@caduceus/contracts/policy/guards';

export interface GitFile {
  path: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
  conflicted: boolean;
}

export interface RepoStatus {
  /** `undefined` when the head is detached. */
  branch: string | undefined;
  detached: boolean;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  changed: number;
  files: GitFile[];
}

const count = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
const text = (value: unknown) => (typeof value === 'string' && value !== '' ? value : undefined);

/** Reads `GET /api/git/status`: `null` for a folder in no repository (Hermes answers `null`), `undefined` for an answer that is not a status. */
export function parseStatus(body: unknown): RepoStatus | null | undefined {
  if (body === null) return null;
  if (!isRecord(body) || !Array.isArray(body.files)) return undefined;
  const files = body.files.flatMap((entry): GitFile[] =>
    isRecord(entry) && typeof entry.path === 'string' ? [{ path: entry.path, staged: entry.staged === true, unstaged: entry.unstaged === true, untracked: entry.untracked === true, conflicted: entry.conflicted === true }] : [],
  );
  return {
    branch: text(body.branch),
    detached: body.detached === true,
    ahead: count(body.ahead),
    behind: count(body.behind),
    staged: count(body.staged),
    unstaged: count(body.unstaged),
    untracked: count(body.untracked),
    conflicted: count(body.conflicted),
    changed: count(body.changed),
    files,
  };
}

export interface Branch {
  name: string;
  checkedOut: boolean;
  isDefault: boolean;
  isRemote: boolean;
}

export function parseBranches(body: unknown): Branch[] {
  const rows = isRecord(body) && Array.isArray(body.branches) ? body.branches : [];
  return rows.flatMap((row): Branch[] => (isRecord(row) && typeof row.name === 'string' ? [{ name: row.name, checkedOut: row.checkedOut === true, isDefault: row.isDefault === true, isRemote: row.isRemote === true }] : []));
}

export interface Worktree {
  path: string;
  branch: string | undefined;
  isMain: boolean;
  detached: boolean;
  locked: boolean;
}

export function parseWorktrees(body: unknown): Worktree[] {
  const rows = isRecord(body) && Array.isArray(body.worktrees) ? body.worktrees : [];
  return rows.flatMap((row): Worktree[] => (isRecord(row) && typeof row.path === 'string' ? [{ path: row.path, branch: text(row.branch), isMain: row.isMain === true, detached: row.detached === true, locked: row.locked === true }] : []));
}

export interface DiffRow {
  kind: 'hunk' | 'context' | 'add' | 'delete';
  oldNo: number | undefined;
  newNo: number | undefined;
  text: string;
}

export interface DiffFile {
  name: string;
  binary: boolean;
  rows: DiffRow[];
}

/** A unified diff (as `git diff` writes it) as one entry per file, its rows numbered on each side. File headers are not rows. */
export function diffFiles(diff: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | undefined;
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const name = /^diff --git a\/(.+?) b\/(.+)$/.exec(line)?.[2] ?? line.slice('diff --git '.length);
      file = { name, binary: false, rows: [] };
      files.push(file);
      inHunk = false;
    } else if (!file) {
      continue;
    } else if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
      oldNo = Number(m?.[1] ?? 0);
      newNo = Number(m?.[2] ?? 0);
      inHunk = true;
      file.rows.push({ kind: 'hunk', oldNo: undefined, newNo: undefined, text: line });
    } else if (!inHunk) {
      if (line.startsWith('Binary files ') || line === 'GIT binary patch') file.binary = true;
    } else if (line.startsWith('+')) file.rows.push({ kind: 'add', oldNo: undefined, newNo: newNo++, text: line.slice(1) });
    else if (line.startsWith('-')) file.rows.push({ kind: 'delete', oldNo: oldNo++, newNo: undefined, text: line.slice(1) });
    else if (line.startsWith(' ')) file.rows.push({ kind: 'context', oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
  }
  return files;
}

export interface SplitRow {
  kind: 'hunk' | 'line';
  text: string;
  left: { no: number | undefined; text: string; changed: boolean } | undefined;
  right: { no: number | undefined; text: string; changed: boolean } | undefined;
}

/** A file's rows as two columns: a run of deleted lines beside the added lines that follow it, line by line; lines with no partner stand alone. */
export function splitRows(rows: readonly DiffRow[]): SplitRow[] {
  const out: SplitRow[] = [];
  for (let index = 0; index < rows.length; ) {
    const row = rows[index];
    if (row.kind === 'hunk') {
      out.push({ kind: 'hunk', text: row.text, left: undefined, right: undefined });
      index++;
    } else if (row.kind === 'context') {
      out.push({ kind: 'line', text: row.text, left: { no: row.oldNo, text: row.text, changed: false }, right: { no: row.newNo, text: row.text, changed: false } });
      index++;
    } else {
      const deleted: DiffRow[] = [];
      const added: DiffRow[] = [];
      while (rows[index]?.kind === 'delete') deleted.push(rows[index++]);
      while (rows[index]?.kind === 'add') added.push(rows[index++]);
      for (let at = 0; at < Math.max(deleted.length, added.length); at++) {
        const left = deleted[at];
        const right = added[at];
        out.push({
          kind: 'line',
          text: (right ?? left).text,
          left: left && { no: left.oldNo, text: left.text, changed: true },
          right: right && { no: right.newNo, text: right.text, changed: true },
        });
      }
    }
  }
  return out;
}

export interface Advice {
  /** What went wrong, in words. */
  message: string;
  /** What to do next, when Caduceus knows. */
  next: string | undefined;
}

const KNOWN: { when: RegExp; message: string; next: string }[] = [
  { when: /CONFLICT|unmerged|merge conflict|Automatic merge failed/i, message: 'Git stopped on a conflict: two changes touch the same lines.', next: 'Resolve the conflict in the files it names, stage them, then commit.' },
  { when: /Authentication failed|could not read Username|could not read Password|Invalid username or password/i, message: 'The remote did not accept your sign-in.', next: 'Sign in again on the Mac that runs Hermes (gh auth login, or update the stored credential), then push again.' },
  { when: /Permission denied \(publickey\)|Host key verification failed|Could not read from remote repository/i, message: 'This Mac could not sign in to the remote: it has no access.', next: 'Check the SSH key or run gh auth login on the Mac that runs Hermes, then try again.' },
  { when: /\[rejected\]|non-fast-forward|fetch first|failed to push some refs/i, message: 'The remote rejected the push: it has commits this branch does not.', next: 'Pull or fetch and merge those commits in a terminal on the Mac, then push again.' },
  { when: /has no upstream branch|no upstream/i, message: 'This branch has no upstream branch on the remote yet.', next: 'Push sets it up the first time; if it still fails, check that the repository has a remote.' },
  { when: /No configured push destination|does not appear to be a git repository|No such remote/i, message: 'This repository has no remote to push to.', next: 'Add a remote in a terminal on the Mac (git remote add origin <url>), then push.' },
  { when: /nothing (added )?to commit/i, message: 'There is nothing to commit.', next: 'Stage a change first, or edit a file.' },
  { when: /contains modified or untracked files|use --force to delete it/i, message: 'That worktree has changes that are not committed (modified or untracked files).', next: 'Commit or discard them in the worktree first, or remove it anyway with force, which loses them.' },
  { when: /Please tell me who you are|Author identity unknown|unable to auto-detect email/i, message: 'Git does not know who you are, so it cannot commit (no identity).', next: 'Set user.name and user.email (git config) on the Mac that runs Hermes.' },
];

/** What a git error from Hermes means and what to do about it. Hermes's message is the fallback, cut down to its last line when it is a Python stack. */
export function gitAdvice(raw: string): Advice {
  const known = KNOWN.find((entry) => entry.when.test(raw));
  if (known) return { message: known.message, next: known.next };
  const lines = raw.split('\n').map((line) => line.trimEnd()).filter((line) => line.trim() !== '');
  if (lines.some((line) => line.startsWith('Traceback'))) return { message: lines.at(-1) ?? raw, next: undefined };
  return { message: raw.trim(), next: undefined };
}

export interface CommitContext {
  diff: string;
  recent: string;
}

/** What Hermes's `review/commit-context` gave: the diff that will be committed and the latest commit subjects. */
export function parseCommitContext(body: unknown): CommitContext {
  return isRecord(body) ? { diff: typeof body.diff === 'string' ? body.diff : '', recent: typeof body.recent === 'string' ? body.recent : '' } : { diff: '', recent: '' };
}

const MAX_MESSAGE_TOKENS = 200;

/** The `llm.oneshot` parameters that have Hermes's model draft a commit message from the context. */
export function commitMessageRequest(context: CommitContext, profile: string): { profile: string; instructions: string; input: string; max_tokens: number } {
  return {
    profile,
    instructions:
      'Write a git commit message for the change below. Reply with the message only: one subject line of at most 72 characters in the imperative mood, then, only if the change needs it, a blank line and a short body. No quotes, no code fences, no preamble. Follow the style of the recent commit subjects.',
    input: `Recent commit subjects:\n${context.recent || '(none)'}\n\nChange:\n${context.diff}`,
    max_tokens: MAX_MESSAGE_TOKENS,
  };
}

/** The model's answer as a commit message: fences, quotes and a leading label taken off. `undefined` when nothing is left. */
export function cleanCommitMessage(answer: string): string | undefined {
  let message = answer.trim().replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  message = message.replace(/^(commit message|message)\s*:\s*/i, '');
  if (/^(["'`]).*\1$/s.test(message)) message = message.slice(1, -1).trim();
  return message === '' ? undefined : message;
}

/**
 * Where the repository stands against its remote, in words. Hermes's status has no field for a remote, only the counts (0 and 0 whether
 * the branch is in step or has nothing to be in step with), so a remote is known by a branch of it in the branch list (`origin/main`).
 */
export function remoteWords(status: Pick<RepoStatus, 'ahead' | 'behind'>, branches: readonly Branch[]): { line: string; canPush: boolean; why: string | undefined } {
  if (!branches.some((branch) => branch.isRemote)) {
    return { line: 'No remote', canPush: false, why: 'This repository has no remote to push to. Add one in a terminal on the Mac that runs Hermes (git remote add origin <url>, then git fetch), and Push works.' };
  }
  return { line: status.ahead === 0 && status.behind === 0 ? 'In step with its remote' : `${status.ahead} ahead, ${status.behind} behind`, canPush: true, why: undefined };
}
