import { describe, expect, test } from 'vitest';
import { isListed, leavesWithEdits, listPath, lineDiff, readPath, readResult, yamlProblem } from '../src/modules/profiles/behaviour-files.ts';

// The pure part of the profile file editors (M4 #02): how a file is read from what Hermes answers, the located YAML error that
// blocks a save, and the diff a save conflict shows. What Hermes and the server do with the requests is in `server/test/behaviour-files-hermes.test.ts`.
describe('reading a file from what Hermes answers', () => {
  test('each kind of file has its own route, and an answer is the text, a file that is not there yet, or a refusal to edit', () => {
    expect(readPath({ kind: 'soul', profile: 'coder' })).toBe('/api/profiles/coder/soul');
    expect(readPath({ kind: 'config', profile: 'my profile' })).toBe('/api/config/raw?profile=my%20profile');
    expect(readPath({ kind: 'file', path: '/h/profiles/coder/AGENTS.md' })).toBe('/api/fs/read-text?path=%2Fh%2Fprofiles%2Fcoder%2FAGENTS.md');

    expect(readResult({ kind: 'soul', profile: 'coder' }, 200, { content: 'Be kind.', exists: true })).toEqual({ state: 'ready', text: 'Be kind.', exists: true });
    expect(readResult({ kind: 'soul', profile: 'coder' }, 200, { content: '', exists: false })).toEqual({ state: 'ready', text: '', exists: false });
    expect(readResult({ kind: 'config', profile: 'coder' }, 200, { yaml: 'a: 1\n', path: '/x/config.yaml' })).toEqual({ state: 'ready', text: 'a: 1\n', exists: true });
    expect(readResult({ kind: 'file', path: '/p/AGENTS.md' }, 200, { text: '# Rules', truncated: false, binary: false })).toEqual({ state: 'ready', text: '# Rules', exists: true });
    expect(readResult({ kind: 'file', path: '/p/AGENTS.md' }, 404, { detail: 'File not found' })).toEqual({ state: 'ready', text: '', exists: false });
    expect(readResult({ kind: 'file', path: '/p/AGENTS.md' }, 200, { text: 'start of a long fi', truncated: true })).toMatchObject({ state: 'unsafe' });
    expect(readResult({ kind: 'file', path: '/p/AGENTS.md' }, 200, { text: '\u0000\u0001', binary: true })).toMatchObject({ state: 'unsafe' });
    expect(readResult({ kind: 'file', path: '/p/AGENTS.md' }, 413, { detail: 'File too large' })).toMatchObject({ state: 'unsafe' });
    expect(readResult({ kind: 'soul', profile: 'coder' }, 500, { detail: 'boom' })).toEqual({ state: 'failed', message: 'boom' });
    expect(readResult({ kind: 'soul', profile: 'coder' }, 200, 'not json')).toMatchObject({ state: 'failed' });
  });
});

describe('finding out whether a file exists before reading it', () => {
  test('lists the folder the file is in, because reading a missing file is a 404 the browser logs as an error', () => {
    expect(listPath({ kind: 'file', path: '/h/profiles/coder/memories/MEMORY.md' })).toBe('/api/fs/list?path=%2Fh%2Fprofiles%2Fcoder%2Fmemories');
    const ref = { kind: 'file', path: '/h/profiles/coder/AGENTS.md' } as const;

    expect(isListed(ref, { entries: [{ name: 'SOUL.md', isDirectory: false }, { name: 'AGENTS.md', isDirectory: false }] })).toBe(true);
    expect(isListed(ref, { entries: [{ name: 'SOUL.md', isDirectory: false }] })).toBe(false);
    expect(isListed(ref, { entries: [], error: 'ENOENT' })).toBe(false);
    expect(isListed(ref, { entries: [{ name: 'AGENTS.md', isDirectory: true }] })).toBe(false);
    // An answer that is not a listing says nothing, so the file is read and Hermes answers for itself.
    expect(isListed(ref, 'nonsense')).toBe(true);
  });
});

describe('the YAML check before a config.yaml is saved', () => {
  test('passes a mapping and locates the first error of anything else', async () => {
    expect(await yamlProblem('agent:\n  max_turns: 11\n')).toBeUndefined();
    expect(await yamlProblem('# only a comment\na: 1\n')).toBeUndefined();

    expect(await yamlProblem('agent:\n  max_turns: [1, 2\nother: 3\n')).toMatchObject({ line: expect.any(Number), column: expect.any(Number) });
    const located = await yamlProblem('a: 1\nb: [\n');
    expect(located?.line).toBeGreaterThanOrEqual(2);
    expect(located?.message).not.toBe('');
    expect(await yamlProblem('just a sentence\n')).toMatchObject({ line: 1, message: 'The file must be a mapping of keys to values.' });
    expect(await yamlProblem('- a\n- b\n')).toMatchObject({ line: 1, message: 'The file must be a mapping of keys to values.' });
    expect(await yamlProblem('a: 1\na: 2\n')).toMatchObject({ line: 2 });
  });
});

describe('the diff a save conflict shows', () => {
  test('marks the lines removed and added between two texts, keeping the lines both share', () => {
    expect(lineDiff('a\nb\nc\n', 'a\nB\nc\n')).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'added', text: 'B' },
      { kind: 'same', text: 'c' },
    ]);
    expect(lineDiff('', 'x\ny')).toEqual([
      { kind: 'added', text: 'x' },
      { kind: 'added', text: 'y' },
    ]);
    expect(lineDiff('same\n', 'same\n')).toEqual([{ kind: 'same', text: 'same' }]);
    expect(lineDiff('a\nb', 'b\nc').map((row) => `${row.kind[0]}:${row.text}`)).toEqual(['r:a', 's:b', 'a:c']);
  });

  test('a very large change is shown whole instead of being compared line by line', () => {
    const before = Array.from({ length: 3000 }, (_, i) => `old ${i}`).join('\n');
    const after = Array.from({ length: 3000 }, (_, i) => `new ${i}`).join('\n');

    const rows = lineDiff(before, after);

    expect(rows).toHaveLength(6000);
    expect(rows.filter((row) => row.kind === 'removed')).toHaveLength(3000);
  });
});

describe('when unsaved edits block a navigation', () => {
  const here = { pathname: '/agents/profiles/coder/identity' };

  test('a sheet or a confirm closing pops the history but leaves the page where it is, so it never asks to leave', () => {
    // Save… → Cancel on the confirm: the confirm layer's history entry is undone, the URL does not change.
    expect(leavesWithEdits(true, here, { ...here })).toBe(false);
    expect(leavesWithEdits(true, here, { pathname: here.pathname })).toBe(false);
  });

  test('another page asks only while there are edits', () => {
    expect(leavesWithEdits(true, here, { pathname: '/agents/profiles/coder/model' })).toBe(true);
    expect(leavesWithEdits(true, here, { pathname: '/agents/models' })).toBe(true);
    expect(leavesWithEdits(false, here, { pathname: '/agents/models' })).toBe(false);
  });
});
