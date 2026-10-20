import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { isArchive, unpackArchive } from '../src/modules/chat/archive.ts';
import { attachFiles } from '../src/modules/chat/attach-files.ts';

// An archive is unpacked in the browser and each file in it is attached on its own (M1 #10). The archives are made by the system's `zip` and `tar`,
// not by a builder written for this test, so that what is read is what real tools write.
let dir: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-archive-'));
  fs.mkdirSync(path.join(dir, 'src/docs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/readme.txt'), 'Read me first.\n');
  fs.writeFileSync(path.join(dir, 'src/docs/guide.md'), '# Guide\n'.repeat(500));
  fs.writeFileSync(path.join(dir, 'src/.DS_Store'), 'junk');
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const run = (command: string, args: string[], cwd = dir) => execFileSync(command, args, { cwd, stdio: 'pipe' });
const open = (name: string) => ({ name, body: new Blob([fs.readFileSync(path.join(dir, name))]) });
const texts = async (entries: { name: string; body: Blob }[]) => Object.fromEntries(await Promise.all(entries.map(async (entry) => [entry.name, await entry.body.text()])));

describe('a zip', () => {
  test('is unpacked: each file in it comes out on its own with its text, named by its own name and with the archive and path it came from; folders and system litter are not files', async () => {
    run('zip', ['-qr', 'bundle.zip', 'src'], dir);
    const { entries, problems } = await unpackArchive(open('bundle.zip'), 20);

    expect(problems).toEqual([]);
    expect(entries.map(({ name, origin }) => [name, origin]).sort()).toEqual([
      ['guide.md', 'bundle.zip › src/docs/guide.md'],
      ['readme.txt', 'bundle.zip › src/readme.txt'],
    ]);
    expect(await texts(entries)).toEqual({ 'readme.txt': 'Read me first.\n', 'guide.md': '# Guide\n'.repeat(500) });
  });
});

describe('what an archive is', () => {
  test('.zip, .tar, .tar.gz and .tgz are archives; other files are not, whatever their kind', () => {
    expect(['a.zip', 'A.ZIP', 'b.tar', 'c.tar.gz', 'd.tgz'].map(isArchive)).toEqual([true, true, true, true, true]);
    expect(['a.gz', 'b.txt', 'c.pdf', 'zip', 'd.rar', 'e.7z'].map(isArchive)).toEqual([false, false, false, false, false, false]);
  });
});

describe('what cannot be unpacked is reported, not dropped', () => {
  test('a password protected entry, a link, an empty file and an image over 25 MB are each named with the reason, and the rest of the archive still comes out', async () => {
    fs.mkdirSync(path.join(dir, 'mixed'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'mixed/good.txt'), 'good');
    fs.writeFileSync(path.join(dir, 'mixed/empty.txt'), '');
    fs.writeFileSync(path.join(dir, 'mixed/huge.png'), Buffer.alloc(25 * 1024 * 1024 + 1));
    fs.symlinkSync('good.txt', path.join(dir, 'mixed/link.txt'));
    run('zip', ['-qry', 'mixed.zip', 'mixed'], dir);
    fs.writeFileSync(path.join(dir, 'secret.txt'), 'hidden');
    run('zip', ['-q', '-P', 'pw', 'locked.zip', 'secret.txt'], dir);

    const mixed = await unpackArchive(open('mixed.zip'), 20);
    expect(Object.keys(await texts(mixed.entries))).toEqual(['good.txt']);
    expect(mixed.problems.map(({ name, reason }) => `${name}: ${reason}`).sort()).toEqual([
      'mixed.zip › mixed/empty.txt: It is empty.',
      'mixed.zip › mixed/huge.png: An image may be at most 25 MB; this one is 25.0 MB.',
      'mixed.zip › mixed/link.txt: It is a link, not a file.',
    ]);

    const locked = await unpackArchive(open('locked.zip'), 20);
    expect(locked).toEqual({ entries: [], problems: [{ name: 'locked.zip › secret.txt', reason: 'It is password protected.' }] });
  });

  test('entries beyond the room left in the message are named, not unpacked', async () => {
    fs.mkdirSync(path.join(dir, 'many'), { recursive: true });
    for (const n of [1, 2, 3, 4]) fs.writeFileSync(path.join(dir, `many/f${n}.txt`), `file ${n}`);
    run('zip', ['-qr', 'many.zip', 'many'], dir);
    const { entries, problems } = await unpackArchive(open('many.zip'), 2);
    expect(entries).toHaveLength(2);
    expect(problems).toHaveLength(2);
    expect(problems[0]!.reason).toBe('A message takes at most 20 attachments.');
  });

  test('something that is not a zip, and a zip whose entry holds more than it says, are reported', async () => {
    fs.writeFileSync(path.join(dir, 'notzip.zip'), 'just text');
    expect(await unpackArchive(open('notzip.zip'), 20)).toEqual({ entries: [], problems: [{ name: 'notzip.zip', reason: 'It is not a zip archive, or it is damaged.' }] });

    // Make an entry claim to be smaller than it is, in the central directory (where the page reads it).
    fs.writeFileSync(path.join(dir, 'liar.txt'), 'x'.repeat(1000));
    run('zip', ['-q', 'liar.zip', 'liar.txt'], dir);
    const bytes = fs.readFileSync(path.join(dir, 'liar.zip'));
    const central = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(10, central + 24);
    fs.writeFileSync(path.join(dir, 'liar.zip'), bytes);
    expect(await unpackArchive(open('liar.zip'), 20)).toEqual({ entries: [], problems: [{ name: 'liar.zip › liar.txt', reason: 'It could not be unpacked: the archive is damaged.' }] });
  });
});

describe('a tar', () => {
  test('.tar, .tar.gz and .tgz are unpacked the same way; a link in a tar is reported', async () => {
    fs.mkdirSync(path.join(dir, 'pack'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'pack/one.txt'), 'one');
    fs.writeFileSync(path.join(dir, `pack/${'long-'.repeat(30)}name.txt`), 'long name');
    fs.symlinkSync('one.txt', path.join(dir, 'pack/link.txt'));
    run('tar', ['-cf', 'pack.tar', 'pack'], dir);
    run('tar', ['-czf', 'pack.tar.gz', 'pack'], dir);
    fs.copyFileSync(path.join(dir, 'pack.tar.gz'), path.join(dir, 'pack.tgz'));

    for (const name of ['pack.tar', 'pack.tar.gz', 'pack.tgz']) {
      const { entries, problems } = await unpackArchive(open(name), 20);
      expect(await texts(entries), name).toEqual({ 'one.txt': 'one', [`${'long-'.repeat(30)}name.txt`]: 'long name' });
      expect(problems, name).toEqual([{ name: `${name} › pack/link.txt`, reason: 'It is a link, not a file.' }]);
    }
  });

  test('a gzip that is not a tar is reported', async () => {
    fs.writeFileSync(path.join(dir, 'plain.txt'), 'x'.repeat(2000));
    run('gzip', ['-kf', 'plain.txt'], dir);
    fs.renameSync(path.join(dir, 'plain.txt.gz'), path.join(dir, 'plain.tar.gz'));
    expect(await unpackArchive(open('plain.tar.gz'), 20)).toEqual({ entries: [], problems: [{ name: 'plain.tar.gz', reason: 'It is not a tar archive, or it is damaged.' }] });
  });
});

describe('picking an archive among other files', () => {
  test('its files join the attachments one by one beside the others, and what does not fit in 20 is named', async () => {
    const zip = { ...open('many.zip') };
    const picked = [{ name: 'notes.txt', body: new Blob(['n']) }, zip, { name: 'old.rar', body: new Blob(['Rar!']) }];
    const first = await attachFiles([], picked);
    expect(first.problems).toEqual([]);
    // In the order they were picked, the archive's files in its place; an archive Hermes cannot be given opened (.rar) goes as the one file it is.
    const inside = first.attachments.slice(1, -1);
    expect(first.attachments[0]).toMatchObject({ name: 'notes.txt', kind: 'file' });
    expect(inside.map(({ name }) => name).sort()).toEqual(['f1.txt', 'f2.txt', 'f3.txt', 'f4.txt']);
    expect(inside.map(({ origin }) => origin).sort()).toEqual(['f1.txt', 'f2.txt', 'f3.txt', 'f4.txt'].map((name) => `many.zip › many/${name}`));
    expect(first.attachments.at(-1)).toMatchObject({ name: 'old.rar', kind: 'file' });

    // 18 are attached already: the zip has room for two of its four files.
    const filled = (await attachFiles([], Array.from({ length: 18 }, (_, index) => ({ name: `a${index}.txt`, body: new Blob(['a']) })))).attachments;
    const crowded = await attachFiles(filled, [zip]);
    expect(crowded.attachments).toHaveLength(20);
    expect(crowded.problems.map(({ reason }) => reason)).toEqual(['A message takes at most 20 attachments.', 'A message takes at most 20 attachments.']);
  });
});
