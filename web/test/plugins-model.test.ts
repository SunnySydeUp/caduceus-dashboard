import { describe, expect, test } from 'vitest';
import { categoriesOf, classifySource, filterCatalogue, foldOperation, installRequest, startOperation, updateRequest, type CatalogueEntry, type OperationState } from '../src/modules/plugins/plugins-model.ts';

const entry = (over: Partial<CatalogueEntry>): CatalogueEntry => ({
  name: 'thing',
  description: 'Does a thing.',
  maintainer: 'Someone',
  tier: 'community',
  category: 'tools',
  version: '1.0.0',
  pin: 'abcdef0',
  repo: 'https://github.com/someone/thing',
  docs: undefined,
  requiresHermes: '',
  platforms: [],
  capabilities: { tools: [], hooks: [], middleware: [], requiresEnv: [] },
  installed: false,
  updateAvailable: false,
  ...over,
});

describe('what the owner types to install a plugin', () => {
  test('a bare word is a catalogue entry, and an address of any of git’s forms is a git install', () => {
    expect(classifySource('strava')).toEqual({ kind: 'catalogue', identifier: 'strava', warnings: [] });
    expect(classifySource('  owner/repo  ')).toEqual({ kind: 'git', identifier: 'owner/repo', warnings: [] });
    expect(classifySource('owner/repo/plugins/notes')).toMatchObject({ kind: 'git', identifier: 'owner/repo/plugins/notes' });
    expect(classifySource('https://github.com/owner/repo')).toEqual({ kind: 'git', identifier: 'https://github.com/owner/repo', warnings: [] });
    expect(classifySource('git@github.com:owner/repo.git')).toMatchObject({ kind: 'git', identifier: 'git@github.com:owner/repo.git' });
    expect(classifySource('ssh://git@host.example/owner/repo.git')).toMatchObject({ kind: 'git' });
  });

  test('says what is risky about an address, and refuses what Hermes cannot take', () => {
    expect(classifySource('http://host.example/owner/repo.git')).toMatchObject({ kind: 'git', warnings: [expect.stringContaining('not encrypted')] });
    expect(classifySource('file:///Users/me/plugin')).toMatchObject({ kind: 'git', warnings: [expect.stringContaining('on this Mac')] });
    expect(classifySource('https://me:token@host.example/o/r.git')).toMatchObject({ kind: 'git', warnings: [expect.stringContaining('token in the address')] });
    expect(classifySource('')).toMatchObject({ kind: 'invalid', problem: expect.stringContaining('Type') });
    expect(classifySource('two words')).toMatchObject({ kind: 'invalid', problem: expect.stringContaining('spaces') });
    expect(classifySource('--force')).toMatchObject({ kind: 'invalid' });
  });

  test('a git install is typed by its address without credentials; a catalogue install by its name', () => {
    expect(installRequest({ kind: 'git', identifier: 'https://me:token@host.example/o/r.git', warnings: [] }, { enable: true }).confirmTarget).toBe('https://host.example/o/r.git');
    expect(installRequest({ kind: 'catalogue', identifier: 'strava', warnings: [] }, { enable: false })).toMatchObject({
      confirmTarget: 'strava',
      method: 'POST',
      path: '/_caduceus/api/plugins/operations',
      body: { action: 'install', identifier: 'strava', catalogue: true, enable: false },
    });
    expect(installRequest({ kind: 'git', identifier: 'owner/repo', warnings: [] }, { enable: true, force: true, ref: ' ' }).body).toEqual({ action: 'install', identifier: 'owner/repo', enable: true, force: true });
    expect(installRequest({ kind: 'git', identifier: 'owner/repo', warnings: [] }, { enable: true, ref: 'a'.repeat(40) }).body).toMatchObject({ ref: 'a'.repeat(40) });
    expect(updateRequest('fixture-notes')).toMatchObject({ method: 'POST', path: '/_caduceus/api/plugins/operations', body: { action: 'update', name: 'fixture-notes' }, confirmTarget: 'fixture-notes' });
  });
});

describe('the catalogue as a list', () => {
  const entries = [
    entry({ name: 'alpha', description: 'Posts to Slack', category: 'platform', tier: 'official' }),
    entry({ name: 'beta', description: 'Tracks runs from Strava', category: 'tools', capabilities: { tools: ['strava_activities'], hooks: [], middleware: [], requiresEnv: ['STRAVA_TOKEN'] } }),
    entry({ name: 'gamma', description: 'Plays music', category: 'tools', installed: true }),
  ];

  test('is narrowed by words of the name, the description and the tools, by category, and by installed state', () => {
    expect(filterCatalogue(entries, { query: '', category: 'all', show: 'all' }).map((e) => e.name)).toEqual(['alpha', 'beta', 'gamma']);
    expect(filterCatalogue(entries, { query: 'strava', category: 'all', show: 'all' }).map((e) => e.name)).toEqual(['beta']);
    expect(filterCatalogue(entries, { query: 'STRAVA_ACTIVITIES', category: 'all', show: 'all' }).map((e) => e.name)).toEqual(['beta']);
    expect(filterCatalogue(entries, { query: 'posts slack', category: 'all', show: 'all' }).map((e) => e.name)).toEqual(['alpha']);
    expect(filterCatalogue(entries, { query: '', category: 'tools', show: 'all' }).map((e) => e.name)).toEqual(['beta', 'gamma']);
    expect(filterCatalogue(entries, { query: '', category: 'all', show: 'installed' }).map((e) => e.name)).toEqual(['gamma']);
    expect(filterCatalogue(entries, { query: '', category: 'all', show: 'available' }).map((e) => e.name)).toEqual(['alpha', 'beta']);
    expect(filterCatalogue(entries, { query: 'nothing like this', category: 'all', show: 'all' })).toEqual([]);
  });

  test('has categories in the order of how many plugins each holds', () => {
    expect(categoriesOf(entries)).toEqual([
      { id: 'tools', count: 2 },
      { id: 'platform', count: 1 },
    ]);
  });
});

describe('the log of an install or update', () => {
  const begin: OperationState = startOperation();

  test('grows line by line while it runs, and ends in success or failure with Hermes’s sentence', () => {
    let state = foldOperation(begin, { event: 'line', data: { text: 'Cloning file:///x...' } });
    state = foldOperation(state, { event: 'line', data: { text: 'Installed.' } });
    expect(state).toEqual({ status: 'running', lines: ['Cloning file:///x...', 'Installed.'], message: '' });
    expect(foldOperation(state, { event: 'end', data: { ok: true, code: 0, message: 'Hermes finished the install.' } })).toEqual({ status: 'ok', lines: ['Cloning file:///x...', 'Installed.'], message: 'Hermes finished the install.' });
    expect(foldOperation(state, { event: 'end', data: { ok: false, code: 1, message: 'Error: nope' } })).toMatchObject({ status: 'failed', message: 'Error: nope' });
  });

  test('ignores an event it does not know and one that is not shaped as the server sends it', () => {
    expect(foldOperation(begin, { event: 'ping', data: {} })).toBe(begin);
    expect(foldOperation(begin, { event: 'line', data: { text: 7 } })).toBe(begin);
    expect(foldOperation(begin, { event: 'end', data: { ok: 'yes' } })).toBe(begin);
  });

  test('a stream that drops before the end is a failure the page can say in words', () => {
    const dropped = foldOperation(foldOperation(begin, { event: 'line', data: { text: 'Cloning…' } }), { event: 'dropped', data: undefined });
    expect(dropped.status).toBe('lost');
    expect(dropped.message).toContain('Caduceus lost the connection');
    // Once it has ended, a drop is only the stream closing.
    const ended = foldOperation(begin, { event: 'end', data: { ok: true, code: 0, message: 'Done.' } });
    expect(foldOperation(ended, { event: 'dropped', data: undefined })).toBe(ended);
  });
});
