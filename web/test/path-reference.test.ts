import { describe, expect, test } from 'vitest';
import { applyPath, listingPath, pathItems, pathTokenAt, type FolderEntry } from '../src/modules/chat/path-reference.ts';

// Path references in the composer (M1 #09): `@` names a file or folder of the session's workspace for Hermes to read (its own `@file:` and `@folder:`
// references), `~/` a path from the owner's home. What is listed is Hermes's file listing (`GET /api/fs/list`); this is only the words around it.
const entries: FolderEntry[] = [
  { name: 'docs', path: '/work/docs', isDirectory: true },
  { name: 'src', path: '/work/src', isDirectory: true },
  { name: 'my notes', path: '/work/my notes', isDirectory: true },
  { name: '.hidden', path: '/work/.hidden', isDirectory: false },
  { name: 'README.md', path: '/work/README.md', isDirectory: false },
  { name: 'index.ts', path: '/work/index.ts', isDirectory: false },
  { name: 'my file.txt', path: '/work/my file.txt', isDirectory: false },
];
const at = (text: string) => pathTokenAt(text, text.length);

describe('the path being typed', () => {
  test('an @ at the start of a word is a reference into the workspace: the folder typed so far and the name being typed', () => {
    expect(at('look at @')).toMatchObject({ start: 8, end: 9, lead: 'at', root: 'workspace', dir: '', prefix: '' });
    expect(at('look at @RE')).toMatchObject({ root: 'workspace', dir: '', prefix: 'RE' });
    expect(at('@src/mod')).toMatchObject({ root: 'workspace', dir: 'src/', prefix: 'mod' });
    expect(at('@src/')).toMatchObject({ dir: 'src/', prefix: '' });
  });

  test('~/ starts a path from the home folder, with or without an @ in front of it', () => {
    expect(at('open ~/Doc')).toMatchObject({ start: 5, lead: 'home', root: 'home', dir: '~/', prefix: 'Doc' });
    expect(at('~/work/pro')).toMatchObject({ root: 'home', dir: '~/work/', prefix: 'pro' });
    expect(at('@~/work/')).toMatchObject({ lead: 'at', root: 'home', dir: '~/work/', prefix: '' });
  });

  test('an absolute path after the @ is listed from there', () => {
    expect(at('@/etc/ho')).toMatchObject({ root: 'absolute', dir: '/etc/', prefix: 'ho' });
  });

  test('Hermes’s own @file: and @folder: forms are read: the kind narrows what is listed', () => {
    expect(at('@file:src/ma')).toMatchObject({ dir: 'src/', prefix: 'ma', only: 'file' });
    expect(at('@folder:do')).toMatchObject({ dir: '', prefix: 'do', only: 'folder' });
  });

  test('an @ inside a word (an address) and a ~ that is not followed by a slash are not references', () => {
    expect(at('mail me@example')).toBeUndefined();
    expect(at('about ~5 files')).toBeUndefined();
    expect(at('plain words')).toBeUndefined();
  });

  test('only the word at the caret counts, whatever comes after it', () => {
    expect(pathTokenAt('@src/ and more', 5)).toMatchObject({ dir: 'src/', prefix: '', start: 0, end: 5 });
  });
});

describe('which folder to ask Hermes for', () => {
  test('a workspace reference lists the workspace folder (or the one inside it); a home reference lists from ~; an absolute one from where it points', () => {
    expect(listingPath(at('@sr')!, '/work')).toBe('/work');
    expect(listingPath(at('@src/')!, '/work')).toBe('/work/src/');
    expect(listingPath(at('~/work/pro')!, '/work')).toBe('~/work/');
    expect(listingPath(at('@/etc/ho')!, '/work')).toBe('/etc/');
  });

  test('with no workspace known a workspace reference cannot be listed, while the others can', () => {
    expect(listingPath(at('@sr')!, undefined)).toBeUndefined();
    expect(listingPath(at('~/x')!, undefined)).toBe('~/');
  });
});

describe('what is offered', () => {
  test('entries that start with what is typed, folders first as Hermes lists them, without hidden files unless a dot was typed', () => {
    expect(pathItems(at('@')!, entries).map((item) => item.label)).toEqual(['docs/', 'src/', 'my notes/', 'README.md', 'index.ts', 'my file.txt']);
    expect(pathItems(at('@re')!, entries).map((item) => item.label)).toEqual(['README.md']);
    expect(pathItems(at('@.')!, entries).map((item) => item.label)).toEqual(['.hidden']);
  });

  test('@file: lists only files and @folder: only folders', () => {
    expect(pathItems(at('@file:')!, entries).every((item) => !item.directory)).toBe(true);
    expect(pathItems(at('@folder:')!, entries).every((item) => item.directory)).toBe(true);
  });

  test('a file becomes an @file: reference that ends the word; a folder is opened, so that the list goes on inside it', () => {
    const [docs, , , readme] = pathItems(at('@')!, entries);
    expect(docs).toMatchObject({ directory: true, insert: '@docs/', detail: 'Folder' });
    expect(readme).toMatchObject({ directory: false, insert: '@file:README.md ', detail: 'File' });
    expect(pathItems(at('@src/')!, [{ name: 'main.ts', path: '/work/src/main.ts', isDirectory: false }]).at(-1)).toMatchObject({ insert: '@file:src/main.ts ' });
  });

  test('inside a folder the first row is the whole folder, as an @folder: reference', () => {
    const items = pathItems(at('@src/')!, [{ name: 'main.ts', path: '/work/src/main.ts', isDirectory: false }]);
    expect(items[0]).toMatchObject({ label: 'src/', detail: 'The whole folder', insert: '@folder:src/ ', directory: true });
    // Not once something is typed to narrow the list, and not at the top of the workspace.
    expect(pathItems(at('@src/ma')!, [{ name: 'main.ts', path: '/work/src/main.ts', isDirectory: false }])[0]!.label).toBe('main.ts');
    expect(pathItems(at('@')!, entries)[0]!.label).toBe('docs/');
  });

  test('a name with spaces is quoted the way Hermes reads it back, and is not opened', () => {
    const items = pathItems(at('@my')!, entries);
    expect(items.map((item) => item.insert)).toEqual(['@folder:`my notes` ', '@file:`my file.txt` ']);
  });

  test('~/ paths are plain text from the home folder: a file ends the word, a folder is opened', () => {
    const items = pathItems(at('~/')!, [
      { name: 'Documents', path: '/Users/me/Documents', isDirectory: true },
      { name: 'todo.txt', path: '/Users/me/todo.txt', isDirectory: false },
    ]);
    expect(items.map((item) => item.insert)).toEqual(['~/Documents/', '~/todo.txt ']);
  });

  test('a long folder is cut to thirty entries', () => {
    const many = Array.from({ length: 80 }, (_, n) => ({ name: `f${String(n).padStart(2, '0')}.txt`, path: `/work/f${n}.txt`, isDirectory: false }));
    expect(pathItems(at('@')!, many)).toHaveLength(30);
  });
});

describe('putting a choice in the text', () => {
  test('the choice replaces the word and leaves the rest of the text', () => {
    const token = pathTokenAt('read @sr and then', 8)!;
    const [item] = pathItems(token, entries.filter((entry) => entry.name === 'src'));
    expect(applyPath('read @sr and then', token, item!)).toEqual({ text: 'read @src/ and then', caret: 10 });
    const [readme] = pathItems(pathTokenAt('read @RE and then', 8)!, entries);
    expect(applyPath('read @RE and then', pathTokenAt('read @RE and then', 8)!, readme!)).toEqual({ text: 'read @file:README.md and then', caret: 20 });
  });
});
