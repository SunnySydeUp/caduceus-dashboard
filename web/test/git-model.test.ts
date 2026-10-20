import { describe, expect, test } from 'vitest';
import { cleanCommitMessage, commitMessageRequest, diffFiles, gitAdvice, parseBranches, parseStatus, parseWorktrees, splitRows } from '../src/modules/git/git-model.ts';

describe('the repository status', () => {
  test('reads the branch, the counts and the changed files; a folder in no repository is null', () => {
    const status = parseStatus({
      branch: 'main',
      detached: false,
      ahead: 1,
      behind: 2,
      staged: 1,
      unstaged: 2,
      untracked: 1,
      conflicted: 0,
      changed: 3,
      files: [
        { path: 'a.txt', staged: true, unstaged: true, untracked: false, conflicted: false },
        { path: 'new.txt', staged: false, unstaged: true, untracked: true, conflicted: false },
        { nope: true },
      ],
    });
    expect(status).toMatchObject({ branch: 'main', detached: false, ahead: 1, behind: 2, changed: 3 });
    expect(status?.files).toEqual([
      { path: 'a.txt', staged: true, unstaged: true, untracked: false, conflicted: false },
      { path: 'new.txt', staged: false, unstaged: true, untracked: true, conflicted: false },
    ]);
    expect(parseStatus(null)).toBeNull();
    expect(parseStatus({ detail: 'x' })).toBeUndefined();
  });

  test('branches and worktrees keep what the page lists', () => {
    expect(parseBranches({ branches: [{ name: 'main', checkedOut: true, isDefault: true, isRemote: false, worktreePath: '/r' }, { name: 'origin/x', isRemote: true }, 3] })).toEqual([
      { name: 'main', checkedOut: true, isDefault: true, isRemote: false },
      { name: 'origin/x', checkedOut: false, isDefault: false, isRemote: true },
    ]);
    expect(parseWorktrees({ worktrees: [{ path: '/r', branch: 'main', isMain: true, detached: false, locked: false }, { path: '/r/.worktrees/x', branch: null, isMain: false, detached: true, locked: true }] })).toEqual([
      { path: '/r', branch: 'main', isMain: true, detached: false, locked: false },
      { path: '/r/.worktrees/x', branch: undefined, isMain: false, detached: true, locked: true },
    ]);
  });
});

const DIFF = `diff --git a/a.txt b/a.txt
index 1..2 100644
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,4 @@
 keep
-old one
-old two
+new one
+new two
+extra
 tail
@@ -20 +21 @@
-x
+y
`;

describe('a diff as rows', () => {
  test('unified rows carry line numbers on each side, and the headers are not rows of the text', () => {
    const [file] = diffFiles(DIFF);
    expect(file.name).toBe('a.txt');
    expect(file.rows.map((row) => [row.kind, row.oldNo, row.newNo, row.text])).toEqual([
      ['hunk', undefined, undefined, '@@ -1,3 +1,4 @@'],
      ['context', 1, 1, 'keep'],
      ['delete', 2, undefined, 'old one'],
      ['delete', 3, undefined, 'old two'],
      ['add', undefined, 2, 'new one'],
      ['add', undefined, 3, 'new two'],
      ['add', undefined, 4, 'extra'],
      ['context', 4, 5, 'tail'],
      ['hunk', undefined, undefined, '@@ -20 +21 @@'],
      ['delete', 20, undefined, 'x'],
      ['add', undefined, 21, 'y'],
    ]);
  });

  test('split rows put each deleted line beside the added line that replaced it, and the extra lines beside nothing', () => {
    const [file] = diffFiles(DIFF);
    expect(splitRows(file.rows).map((row) => (row.kind === 'hunk' ? row.text : [row.left?.text, row.right?.text]))).toEqual([
      '@@ -1,3 +1,4 @@',
      ['keep', 'keep'],
      ['old one', 'new one'],
      ['old two', 'new two'],
      [undefined, 'extra'],
      ['tail', 'tail'],
      '@@ -20 +21 @@',
      ['x', 'y'],
    ]);
  });

  test('an empty diff has no files, and a diff of a new file is all additions', () => {
    expect(diffFiles('')).toEqual([]);
    const [added] = diffFiles('diff --git a/n.txt b/n.txt\nnew file mode 100644\n--- /dev/null\n+++ b/n.txt\n@@ -0,0 +1,2 @@\n+a\n+b\n');
    expect(added.name).toBe('n.txt');
    expect(added.rows.filter((row) => row.kind === 'add')).toHaveLength(2);
  });

  test('a binary file has no rows, and says so', () => {
    const [binary] = diffFiles('diff --git a/p.png b/p.png\nindex 1..2 100644\nBinary files a/p.png and b/p.png differ\n');
    expect(binary).toMatchObject({ name: 'p.png', binary: true, rows: [] });
  });
});

describe('what a git error means', () => {
  test.each([
    ['CONFLICT (content): Merge conflict in a.txt\nAutomatic merge failed', /conflict/i, /resolve/i],
    ['fatal: Authentication failed for https://github.com/x/y.git', /sign/i, /gh auth login|credential/i],
    ['git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.', /sign|access/i, /ssh|gh auth login|credential/i],
    [' ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs', /rejected/i, /pull|fetch|terminal/i],
    ['fatal: The current branch x has no upstream branch.', /upstream|remote/i, /push/i],
    ['fatal: No configured push destination.', /remote/i, /add|terminal/i],
    ['error: nothing to commit, working tree clean', /nothing/i, /stage|change/i],
    ['fatal: contains modified or untracked files, use --force to delete it', /changes|modified|untracked/i, /force|commit|discard/i],
    ['Author identity unknown\n*** Please tell me who you are.', /identity|name/i, /user\.name|config/i],
  ])('%s', (raw, saysWhat, sayswhatNext) => {
    const advice = gitAdvice(raw);
    expect(advice.message).toMatch(saysWhat);
    expect(advice.next).toMatch(sayswhatNext);
  });

  test('a message it does not know is kept as Hermes wrote it, and never a stack', () => {
    expect(gitAdvice('fatal: something odd happened')).toEqual({ message: 'fatal: something odd happened', next: undefined });
    const stack = gitAdvice('Traceback (most recent call last):\n  File "x.py", line 1\nRuntimeError: boom');
    expect(stack.message).toBe('RuntimeError: boom');
    expect(stack.message).not.toContain('Traceback');
  });
});

describe('the commit message request', () => {
  test('asks Hermes for one subject line from the diff and the recent subjects, and carries nothing else', () => {
    const request = commitMessageRequest({ diff: '+added\n', recent: 'first\nsecond' }, 'coder');
    expect(request.profile).toBe('coder');
    expect(request.input).toContain('+added');
    expect(request.input).toContain('first');
    expect(request.instructions).toMatch(/commit message/i);
    expect(request.max_tokens).toBeGreaterThan(0);
  });

  test('the answer is cleaned of fences, quotes and a leading label, and kept to what a commit message is', () => {
    expect(cleanCommitMessage('```\nAdd a second line\n```')).toBe('Add a second line');
    expect(cleanCommitMessage('"Fix the thing"')).toBe('Fix the thing');
    expect(cleanCommitMessage('Commit message: Fix it\n\nBecause it was broken.')).toBe('Fix it\n\nBecause it was broken.');
    expect(cleanCommitMessage('   ')).toBeUndefined();
  });
});
