import { describe, expect, test } from 'vitest';
import { wrapProse } from '../src/modules/skills/prose.ts';

describe('markdown that was wrapped by hand', () => {
  test('a paragraph written over several lines becomes one line, so it wraps to the screen', () => {
    expect(wrapProse('Use this skill when you need to\nrebase a branch and the\nconflicts are many.\n\nSecond paragraph\nof two lines.')).toBe('Use this skill when you need to rebase a branch and the conflicts are many.\n\nSecond paragraph of two lines.');
  });

  test('headings, list items, quotes, tables and fenced code keep their lines', () => {
    const source = '# Title\nIntro line\ncontinues here.\n\n- one\n- two\n  continues two\n1. first\n2. second\n\n> quoted\n> lines\n\n| a | b |\n| - | - |\n\n```sh\nnpm run a\nnpm run b\n```\nAfter the fence\nends.';

    expect(wrapProse(source)).toBe('# Title\nIntro line continues here.\n\n- one\n- two continues two\n1. first\n2. second\n\n> quoted\n> lines\n\n| a | b |\n| - | - |\n\n```sh\nnpm run a\nnpm run b\n```\nAfter the fence ends.');
  });

  test('a line the writer ended with two spaces or a backslash stays a hard break', () => {
    expect(wrapProse('first  \nsecond\\\nthird\nfourth')).toBe('first  \nsecond\\\nthird fourth');
  });

  test('the Windows line ends and a text without a newline are left alone', () => {
    expect(wrapProse('a\r\nb')).toBe('a b');
    expect(wrapProse('one line')).toBe('one line');
    expect(wrapProse('')).toBe('');
  });
});
