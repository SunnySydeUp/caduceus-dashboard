import { describe, expect, test } from 'vitest';
import type { CommandsCatalogResult } from '@caduceus/contracts/hermes/gateway';
import { DENIED_MESSAGES } from '@caduceus/contracts/policy/tiers';
import catalogue from './fixtures/commands-catalog.json';
import { applyArgument, applyCommand, execQuickCommandNames, filterEntries, slashEntries, slashStage, type SlashEntry } from '../src/modules/chat/slash-menu.ts';

// The slash menu (M1 #09), against a catalogue recorded from Hermes 0.21.4's `commands.catalog`: a temp home with two quick commands (`/shout` exec,
// `/hi` alias) and a custom personality, beside Hermes's own commands and its bundled skills.
const catalog = catalogue as unknown as CommandsCatalogResult;
const entries = (exec: readonly string[] = ['shout']) => slashEntries(catalog, new Set(exec));
const names = (list: readonly SlashEntry[]) => list.map((entry) => entry.command);

describe('what the menu lists', () => {
  test('every command, quick command and skill of Hermes’s catalogue is an entry, with its description and the group Hermes put it in', () => {
    const all = entries();
    const personality = all.find((entry) => entry.command === '/personality');
    expect(personality).toMatchObject({ name: 'personality', description: 'Set a predefined personality (usage: /personality [name])', group: 'Configuration', kind: 'command', takesArgument: true });
    expect(all.find((entry) => entry.command === '/hi')).toMatchObject({ group: 'User commands', description: 'alias → /title Hello', kind: 'command' });
    expect(all.find((entry) => entry.command === '/airtable')).toMatchObject({ group: 'Skills', kind: 'skill', description: 'Airtable REST API via curl. Records CRUD, filters, upserts.' });
    // One entry per command: the catalogue lists skills in `pairs` only, commands in `pairs` and in a category.
    expect(new Set(names(all)).size).toBe(all.length);
    expect(all.length).toBe(catalog.pairs!.length - 1);
  });

  test('a command Hermes marks hidden from its desktop surfaces stays out of the menu, though it can still be typed', () => {
    expect(names(entries())).not.toContain('/model');
  });

  test('commands that the proxy denies are disabled with its reason, never left out', () => {
    const all = entries();
    expect(all.find((entry) => entry.command === '/update')).toMatchObject({ disabled: DENIED_MESSAGES['slash-admin'] });
    expect(all.find((entry) => entry.command === '/shout')).toMatchObject({ disabled: DENIED_MESSAGES['exec-quick-command'] });
    expect(all.find((entry) => entry.command === '/title')!.disabled).toBeUndefined();
    expect(all.find((entry) => entry.command === '/hi')!.disabled).toBeUndefined();
  });

  test('a command that asks for a passkey says so', () => {
    expect(entries().find((entry) => entry.command === '/yolo')).toMatchObject({ note: 'Asks for your passkey' });
  });

  test('the exec quick commands are read from a profile’s config, by lower-cased name', () => {
    expect([...execQuickCommandNames({ quick_commands: { Shout: { type: 'exec', command: 'echo' }, hi: { type: 'alias', target: '/title' }, junk: 4 } })]).toEqual(['shout']);
    expect(execQuickCommandNames(undefined).size).toBe(0);
  });
});

describe('filtering as you type', () => {
  test('an empty query lists Hermes’s commands in its groups, then the skills', () => {
    const list = entries();
    const shown = filterEntries(list, '');
    expect(shown.slice(0, 3).map((entry) => entry.command)).toEqual(['/new', '/clear', '/redraw']);
    expect(shown.findIndex((entry) => entry.kind === 'skill')).toBeGreaterThan(shown.findLastIndex((entry) => entry.kind === 'command') - 1);
  });

  test('a name that starts with the query comes first, then names that contain it, then descriptions, and the match is not case-sensitive', () => {
    const shown = filterEntries(entries(), 'PERS');
    expect(shown[0]!.command).toBe('/personality');
    const byDescription = filterEntries(entries(), 'alias');
    expect(byDescription.map((entry) => entry.command)).toContain('/hi');
    expect(filterEntries(entries(), 'zzzzqq')).toEqual([]);
  });

  test('an alias finds its command', () => {
    expect(names(filterEntries(entries(), 'reset'))[0]).toBe('/new');
  });

  test('a command is found with its slash typed too', () => {
    expect(names(filterEntries(entries(), '/title'))[0]).toBe('/title');
  });
});

describe('where the text is in a command', () => {
  test('a slash at the start of the text and a caret still inside its first word is the command stage, with what is typed so far', () => {
    expect(slashStage('/per', 4)).toEqual({ stage: 'command', query: 'per' });
    expect(slashStage('/', 1)).toEqual({ stage: 'command', query: '' });
    expect(slashStage('/personality pirate', 4)).toEqual({ stage: 'command', query: 'per' });
  });

  test('after the command and a space it is the argument stage, which Hermes completes (the text up to the caret)', () => {
    expect(slashStage('/personality pi', 15)).toEqual({ stage: 'argument', command: 'personality', text: '/personality pi' });
    expect(slashStage('/personality ', 13)).toEqual({ stage: 'argument', command: 'personality', text: '/personality ' });
  });

  test('prose and paths are not commands: the slash has to be the first character, and a second slash makes a path', () => {
    expect(slashStage('hello /per', 10)).toBeUndefined();
    expect(slashStage('/usr/local/bin', 14)).toBeUndefined();
    expect(slashStage(' /per', 5)).toBeUndefined();
    expect(slashStage('first line\n/title', 17)).toBeUndefined();
  });

  test('choosing an entry puts its command in the box with a space after, and keeps what came after the first word', () => {
    expect(applyCommand('/per', entries().find((entry) => entry.command === '/personality')!)).toEqual({ text: '/personality ', caret: 13 });
    expect(applyCommand('/per pirate', entries().find((entry) => entry.command === '/personality')!)).toEqual({ text: '/personality pirate', caret: 13 });
  });

  test('choosing an argument Hermes offers replaces the word being typed', () => {
    expect(applyArgument('/personality pi', 15, 'pirate')).toEqual({ text: '/personality pirate', caret: 19 });
    expect(applyArgument('/model gpt --pro', 16, '--provider')).toEqual({ text: '/model gpt --provider', caret: 21 });
  });
});
