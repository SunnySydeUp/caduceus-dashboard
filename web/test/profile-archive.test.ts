import { afterEach, describe, expect, test } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { ArchiveError, importPreview, readArchive, type ArchiveSummary } from '../src/modules/profiles/profile-archive.ts';
import { runProgram } from '../../server/test/fixtures/run-program.ts';

// Archives are made by the system's own `tar`, the way Hermes's export makes them (a gzip-compressed tar with one folder in it).
const folders: string[] = [];
afterEach(() => {
  for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

async function archiveOf(files: Record<string, string>, root = 'work'): Promise<Blob> {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-archive-'));
  folders.push(parent);
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(parent, root, name)), { recursive: true });
    fs.writeFileSync(path.join(parent, root, name), content);
  }
  await runProgram('tar', ['-czf', path.join(parent, 'out.tar.gz'), '-C', parent, root]);
  return new Blob([fs.readFileSync(path.join(parent, 'out.tar.gz'))]);
}

describe('reading an archive', () => {
  test('lists what a profile archive holds: its folder, files, config, SOUL and skills, and the start of the SOUL', async () => {
    const archive = await archiveOf({ 'config.yaml': 'model: {}\n', 'SOUL.md': '# Scribe\n\nYou write.\n', 'skills/a/SKILL.md': 'a', 'skills/b/SKILL.md': 'b', 'skills/b/notes.md': 'n', 'memories/MEMORY.md': 'm' });

    expect(await readArchive(archive)).toEqual({ roots: ['work'], files: 6, hasConfig: true, hasSoul: true, skills: 2, soul: '# Scribe\n\nYou write.\n' });
  });

  test('reads a path longer than a tar header holds (a long name comes as an entry of its own)', async () => {
    const deep = `skills/${'category-'.repeat(12)}/${'skill-'.repeat(12)}/SKILL.md`;

    const summary = await readArchive(await archiveOf({ [deep]: 'x', 'config.yaml': '' }));

    expect(summary).toMatchObject({ roots: ['work'], files: 2, skills: 1, hasConfig: true, hasSoul: false, soul: undefined });
  });

  test('only the start of a long SOUL is kept', async () => {
    const summary = await readArchive(await archiveOf({ 'SOUL.md': 'x'.repeat(100_000) }));

    expect(summary.soul).toHaveLength(600);
  });

  test('a file that is not gzip, a gzip that is not a tar, and an empty archive are refused with words', async () => {
    await expect(readArchive(new Blob(['just text']))).rejects.toThrow(ArchiveError);
    await expect(readArchive(new Blob([gzipSync(Buffer.from('not a tar file at all, only text '.repeat(40)))]))).rejects.toThrow(/damaged|not a \.tar\.gz/);
    await expect(readArchive(new Blob([gzipSync(Buffer.alloc(1024))]))).rejects.toThrow('This archive is empty');
  });

  test('an archive with two top-level folders lists both, so the preview can refuse it', async () => {
    const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'caduceus-archive-'));
    folders.push(parent);
    for (const root of ['one', 'two']) {
      fs.mkdirSync(path.join(parent, root));
      fs.writeFileSync(path.join(parent, root, 'config.yaml'), '');
    }
    await runProgram('tar', ['-czf', path.join(parent, 'out.tar.gz'), '-C', parent, 'one', 'two']);

    expect((await readArchive(new Blob([fs.readFileSync(path.join(parent, 'out.tar.gz'))]))).roots).toEqual(['one', 'two']);
  });
});

describe('what an import would do', () => {
  const summary = (roots: string[]): ArchiveSummary => ({ roots, files: 3, hasConfig: true, hasSoul: true, skills: 0, soul: undefined });

  test('names the profile after the archive’s folder, and says so when that name is free', () => {
    expect(importPreview(summary(['scribe']), '', ['default'])).toEqual({ name: 'scribe', problem: undefined, needsName: false });
  });

  test('a name a profile already has is a conflict, and choosing another name clears it', () => {
    expect(importPreview(summary(['scribe']), '', ['default', 'scribe'])).toMatchObject({ name: 'scribe', problem: 'A profile called “scribe” already exists.' });
    expect(importPreview(summary(['scribe']), 'scribe-2', ['default', 'scribe'])).toEqual({ name: 'scribe-2', problem: undefined, needsName: false });
  });

  test('an archive of the root profile needs a new name, and default is never a name to import as', () => {
    expect(importPreview(summary(['default']), '', ['default'])).toMatchObject({ name: undefined, needsName: true });
    expect(importPreview(summary(['default']), 'copy', ['default'])).toEqual({ name: 'copy', problem: undefined, needsName: false });
    expect(importPreview(summary(['scribe']), 'default', ['default'])).toMatchObject({ problem: 'Hermes does not import as default: that is its root profile.' });
  });

  test('an archive that does not hold exactly one folder is not a profile archive', () => {
    expect(importPreview(summary(['one', 'two']), '', [])).toMatchObject({ name: undefined, problem: expect.stringContaining('exactly one profile folder') });
    expect(importPreview(summary([]), '', [])).toMatchObject({ name: undefined });
  });

  test('a name Hermes would not take is refused before anything is uploaded', () => {
    expect(importPreview(summary(['scribe']), 'Bad Name!', [])).toMatchObject({ problem: 'Use lowercase letters, numbers, - or _.' });
  });
});
