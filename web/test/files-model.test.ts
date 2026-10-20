import { describe, expect, test } from 'vitest';
import { crumbs, filesUrl, formatSize, htmlFrame, nameProblem, OFFICE_LIMIT, parseCsv, parseListing, pathFromSplat, previewKind, sortRows, TEXT_PREVIEW_LIMIT, toBase64, underWorkspace } from '../src/modules/files/files-model.ts';

describe('addresses', () => {
  test('a path is the address after /workspace/files, one encoded segment each, and reads back as it was', () => {
    const path = '/Users/me/My Notes/50% done #1.md';
    expect(filesUrl(path)).toBe('/workspace/files/Users/me/My%20Notes/50%25%20done%20%231.md');
    expect(filesUrl(undefined)).toBe('/workspace/files');
    expect(pathFromSplat('Users/me/My%20Notes/50%25%20done%20%231.md')).toBe(path);
    expect(pathFromSplat('')).toBeUndefined();
    expect(pathFromSplat(undefined)).toBeUndefined();
  });

  test('a bad escape in the address is taken as written rather than thrown', () => {
    expect(pathFromSplat('tmp/100%')).toBe('/tmp/100%');
  });

  test('crumbs lead from the top folder to the current one', () => {
    expect(crumbs('/Users/me/src')).toEqual([
      { name: 'Users', path: '/Users' },
      { name: 'me', path: '/Users/me' },
      { name: 'src', path: '/Users/me/src' },
    ]);
  });
});

describe('what a file previews as', () => {
  test.each([
    ['main.ts', 'code'],
    ['notes.md', 'markdown'],
    ['table.csv', 'csv'],
    ['photo.PNG', 'image'],
    ['icon.svg', 'image'],
    ['song.mp3', 'audio'],
    ['clip.mp4', 'video'],
    ['paper.pdf', 'pdf'],
    ['page.html', 'html'],
    ['page.htm', 'html'],
    ['LICENSE', 'text'],
    ['report.docx', 'office'],
    ['Budget.XLSX', 'office'],
    ['deck.pptx', 'office'],
    ['old.doc', 'binary'],
    ['data.bin', 'binary'],
    ['archive.zip', 'binary'],
  ])('%s is %s', (name, kind) => {
    expect(previewKind(name)).toBe(kind);
  });

  test('the text limit is 1 MiB', () => {
    expect(TEXT_PREVIEW_LIMIT).toBe(1024 * 1024);
  });
});

describe('sizes and listings', () => {
  test.each([
    [0, '0 B'],
    [999, '999 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [5 * 1024 * 1024, '5.0 MB'],
  ])('%i bytes is %s', (bytes, words) => {
    expect(formatSize(bytes)).toBe(words);
  });

  test('a listing keeps what the page shows and drops what is not a well-formed entry', () => {
    const listing = parseListing({
      path: '/root',
      parent: null,
      root: null,
      entries: [
        { name: 'src', path: '/root/src', is_directory: true, size: null, mtime: 1_700_000_000.5, mime_type: null },
        { name: 'a.txt', path: '/root/a.txt', is_directory: false, size: 3, mtime: 1_700_000_001, mime_type: 'text/plain' },
        { name: 5 },
        'x',
      ],
    });
    expect(listing).toEqual({
      path: '/root',
      parent: undefined,
      entries: [
        { name: 'src', path: '/root/src', directory: true, size: undefined, modified: 1_700_000_000_500 },
        { name: 'a.txt', path: '/root/a.txt', directory: false, size: 3, modified: 1_700_000_001_000 },
      ],
    });
    expect(parseListing({ detail: 'Path not found' })).toBeUndefined();
  });

  test('a path is in a workspace when it is the workspace or inside it, and not when it only shares a prefix', () => {
    const workspaces = ['/work/app', '/work/site/'];
    expect(underWorkspace('/work/app', workspaces)).toBe(true);
    expect(underWorkspace('/work/app/src/a.ts', workspaces)).toBe(true);
    expect(underWorkspace('/work/site/index.html', workspaces)).toBe(true);
    expect(underWorkspace('/work/application/a.ts', workspaces)).toBe(false);
    expect(underWorkspace('/etc/hosts', workspaces)).toBe(false);
  });
});

describe('a CSV as a table', () => {
  test('reads quoted fields, escaped quotes, commas and newlines inside quotes, and CRLF', () => {
    expect(parseCsv('name,note\r\n"Smith, J","said ""hi"""\n"two\nlines",x\n')).toEqual([
      ['name', 'note'],
      ['Smith, J', 'said "hi"'],
      ['two\nlines', 'x'],
    ]);
  });

  test('sorts a column as numbers when every cell is one, otherwise as words, and either way back', () => {
    const rows = [['b', '10'], ['a', '9'], ['c', '100']];
    expect(sortRows(rows, 1, 'asc').map((row) => row[1])).toEqual(['9', '10', '100']);
    expect(sortRows(rows, 1, 'desc').map((row) => row[1])).toEqual(['100', '10', '9']);
    expect(sortRows(rows, 0, 'asc').map((row) => row[0])).toEqual(['a', 'b', 'c']);
    expect(rows[0][0]).toBe('b');
  });
});

describe('an HTML file', () => {
  test('previews in a frame that has no script, no same-origin, nothing: it cannot reach Caduceus cookies, storage or APIs', () => {
    const frame = htmlFrame('<script>fetch("/_caduceus/api/audit");document.cookie</script><p>hi</p>');
    expect(frame.sandbox).toBe('');
    const policy = /Content-Security-Policy" content="([^"]+)"/.exec(frame.srcDoc)?.[1] ?? '';
    expect(policy).toContain("default-src 'none'");
    expect(policy).not.toMatch(/connect-src|script-src|frame-src/);
  });
});

describe('a new name', () => {
  test('is a file name: not empty, not . or .., and with no slash, backslash or NUL (the server says the same, and the page tells the owner first)', () => {
    expect(['report.md', 'my notes (1).txt', '.gitignore'].map(nameProblem)).toEqual([undefined, undefined, undefined]);
    expect(['', '  ', '.', '..', 'a/b', 'a\\b', 'a\0b', 'x'.repeat(256)].map((name) => nameProblem(name) !== undefined)).toEqual(Array(8).fill(true));
  });
});

describe('the bytes of an Office document', () => {
  test('travel as base64, whatever their length, and the editor opens a document up to 25 MiB', () => {
    const bytes = Uint8Array.from({ length: 70_001 }, (_, index) => (index * 31) % 256);
    expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'));
    expect(toBase64(new Uint8Array())).toBe('');
    expect(OFFICE_LIMIT).toBe(25 * 1024 * 1024);
  });
});
