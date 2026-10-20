import { describe, expect, test } from 'vitest';
import type { SavedPrompt } from '@caduceus/contracts/chat-drafts';
import { filterPrompts, forProfile, insertAtCaret, parseTags, tagsOf } from '../src/modules/chat/saved-prompts.ts';

// The saved-prompts library's logic (M1 #11): finding a prompt, the tags to filter by, and putting one into the message box at the caret.
const prompt = (name: string, text: string, tags: string[] = [], profile: string | null = null): SavedPrompt => ({ id: name, name, text, tags, profile, updatedAt: 1 });
const LIBRARY = [
  prompt('Code review', 'Review this diff for bugs and style:', ['review', 'code']),
  prompt('Standup notes', 'Summarise yesterday’s commits', ['daily']),
  prompt('Release notes', 'Draft release notes from these commits', ['review', 'daily'], 'coder'),
];

describe('finding a saved prompt', () => {
  test('words match the name, the text or a tag, all of them, whatever the case; a tag narrows to the prompts that carry it', () => {
    const names = (query: string, tag?: string) => filterPrompts(LIBRARY, { query, tag }).map((found) => found.name);
    expect(names('')).toEqual(['Code review', 'Standup notes', 'Release notes']);
    expect(names('NOTES')).toEqual(['Standup notes', 'Release notes']);
    expect(names('commits notes')).toEqual(['Standup notes', 'Release notes']);
    expect(names('bugs')).toEqual(['Code review']);
    expect(names('daily')).toEqual(['Standup notes', 'Release notes']);
    expect(names('', 'review')).toEqual(['Code review', 'Release notes']);
    expect(names('notes', 'review')).toEqual(['Release notes']);
    expect(names('nothing like this')).toEqual([]);
  });

  test('the tags to choose from are the ones in use, most used first, then alphabetical', () => {
    expect(tagsOf(LIBRARY)).toEqual([
      { tag: 'daily', count: 2 },
      { tag: 'review', count: 2 },
      { tag: 'code', count: 1 },
    ]);
  });

  test('tags typed as a line are split at commas, trimmed, lower-cased and kept once', () => {
    expect(parseTags(' Review, code ,, review , Daily Notes ')).toEqual(['review', 'code', 'daily notes']);
    expect(parseTags('')).toEqual([]);
  });
});

describe('the profile a prompt is for', () => {
  test('a prompt scoped to another profile is hidden; one with no scope shows in every profile', () => {
    expect(forProfile(LIBRARY, 'coder').map((found) => found.name)).toEqual(['Code review', 'Standup notes', 'Release notes']);
    expect(forProfile(LIBRARY, 'default').map((found) => found.name)).toEqual(['Code review', 'Standup notes']);
  });
});

describe('inserting a prompt', () => {
  test('goes in at the caret, and the caret ends after it; a selection is replaced', () => {
    expect(insertAtCaret('Please . Thanks', { start: 7, end: 7 }, 'review this')).toEqual({ text: 'Please review this. Thanks', caret: 18 });
    expect(insertAtCaret('', { start: 0, end: 0 }, 'Hello')).toEqual({ text: 'Hello', caret: 5 });
    expect(insertAtCaret('Say XXX now', { start: 4, end: 7 }, 'hi')).toEqual({ text: 'Say hi now', caret: 6 });
  });
});
