import { describe, expect, test } from 'vitest';
import { branchNameProblem, linkedWorktreeOf, type Worktree } from '../src/modules/chat/worktrees.ts';

describe('branch names (git check-ref-format)', () => {
  test.each(['feature/login', 'fix-123', 'release_2026.10', 'a', 'user/name/topic', 'v1.2.x', 'ünï'])('%s is a name git takes', (name) => {
    expect(branchNameProblem(name)).toBeUndefined();
  });

  test.each([
    ['', 'Give the branch a name.'],
    ['   ', 'Give the branch a name.'],
    [' padded', 'A branch name cannot start or end with a space.'],
    ['two words', 'A branch name cannot contain spaces or any of ~ ^ : ? * [ \\.'],
    ['a~1', 'A branch name cannot contain spaces or any of ~ ^ : ? * [ \\.'],
    ['a:b', 'A branch name cannot contain spaces or any of ~ ^ : ? * [ \\.'],
    ['a\\b', 'A branch name cannot contain spaces or any of ~ ^ : ? * [ \\.'],
    ['a\u0007b', 'A branch name cannot contain spaces or any of ~ ^ : ? * [ \\.'],
    ['@', 'A branch cannot be called just @.'],
    ['-delete', 'A branch name cannot start with a dash.'],
    ['--upload-pack=x', 'A branch name cannot start with a dash.'],
    ['/a', 'A branch name cannot start or end with a slash, or have two in a row.'],
    ['a/', 'A branch name cannot start or end with a slash, or have two in a row.'],
    ['a//b', 'A branch name cannot start or end with a slash, or have two in a row.'],
    ['a..b', 'A branch name cannot contain .. or @{.'],
    ['a@{b', 'A branch name cannot contain .. or @{.'],
    ['a.', 'A branch name cannot end with a dot.'],
    ['.hidden', 'No part of a branch name can start with a dot or end with .lock.'],
    ['a/.b', 'No part of a branch name can start with a dot or end with .lock.'],
    ['topic.lock', 'No part of a branch name can start with a dot or end with .lock.'],
    ['a.lock/b', 'No part of a branch name can start with a dot or end with .lock.'],
  ])('%j is refused: %s', (name, problem) => {
    expect(branchNameProblem(name)).toBe(problem);
  });
});

describe('which linked worktree a workspace is in', () => {
  const tree = (path: string, isMain = false): Worktree => ({ path, branch: isMain ? 'main' : path.split('/').at(-1)!, isMain, locked: false });
  const trees = [tree('/repo', true), tree('/repo/.worktrees/a'), tree('/repo/.worktrees/a-b'), tree('/elsewhere/c')];

  test('the worktree itself, or a folder inside it', () => {
    expect(linkedWorktreeOf('/repo/.worktrees/a', trees)?.path).toBe('/repo/.worktrees/a');
    expect(linkedWorktreeOf('/repo/.worktrees/a/src/deep', trees)?.path).toBe('/repo/.worktrees/a');
    expect(linkedWorktreeOf('/elsewhere/c/', trees)?.path).toBe('/elsewhere/c');
  });

  test('a folder that only starts with the same letters is not inside it', () => {
    expect(linkedWorktreeOf('/repo/.worktrees/a-b', trees)?.path).toBe('/repo/.worktrees/a-b');
    expect(linkedWorktreeOf('/repo/.worktrees/ab', trees)).toBeUndefined();
  });

  test('the repository’s own folder, and a folder in it that is no worktree, are not worktrees even though the worktrees live inside it', () => {
    expect(linkedWorktreeOf('/repo', trees)).toBeUndefined();
    expect(linkedWorktreeOf('/repo/src', trees)).toBeUndefined();
    expect(linkedWorktreeOf('/other', trees)).toBeUndefined();
    expect(linkedWorktreeOf('/repo', [])).toBeUndefined();
  });
});
