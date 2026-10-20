import { describe, expect, test } from 'vitest';
import { filesFromDiff, parseReviewList } from '../src/modules/artifacts/changed-files.ts';

// The pure part of the chat's Artifacts tab (M6 #05): Hermes's review list and a checkpoint's unified diff read as the files a session changed.
describe('the files a session changed', () => {
  test('Hermes’s review list reads as rows, and an answer that is not a list is refused', () => {
    expect(parseReviewList({ files: [{ path: 'src/a.ts', added: 3, removed: 1, status: 'M', staged: false }, { path: 'notes.md', added: 12, removed: 0, status: '?', staged: false }, { nope: 1 }], base: null })).toEqual([
      { path: 'src/a.ts', status: 'M', added: 3, removed: 1 },
      { path: 'notes.md', status: '?', added: 12, removed: 0 },
    ]);
    expect(parseReviewList({ files: [] })).toEqual([]);
    expect(parseReviewList(null)).toBeUndefined();
    expect(parseReviewList({ detail: 'not a repository' })).toBeUndefined();
  });

  test('a checkpoint’s diff is split by file, with counts, the kind of change and the file’s own text', () => {
    const diff = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 111..222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,3 @@',
      ' keep',
      '-old',
      '+new',
      '+more',
      'diff --git a/docs/new.md b/docs/new.md',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/docs/new.md',
      '@@ -0,0 +1 @@',
      '+hello',
      'diff --git a/gone.txt b/gone.txt',
      'deleted file mode 100644',
      '--- a/gone.txt',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      '-bye',
      '',
    ].join('\n');
    const files = filesFromDiff(`\u001b[1m${diff}\u001b[0m`);
    expect(files.map(({ diff: _diff, ...row }) => row)).toEqual([
      { path: 'src/a.ts', status: 'M', added: 2, removed: 1 },
      { path: 'docs/new.md', status: 'A', added: 1, removed: 0 },
      { path: 'gone.txt', status: 'D', added: 0, removed: 1 },
    ]);
    expect(files[0].diff.startsWith('diff --git a/src/a.ts')).toBe(true);
    expect(files[0].diff).not.toContain('docs/new.md');
    expect(filesFromDiff('')).toEqual([]);
  });
});
