import { describe, expect, test } from 'vitest';
import { resolveNewChatLink, UNKNOWN_PROFILE_NOTICE } from '../src/modules/chat/deep-link.ts';

const profiles = ['default', 'coder'];

describe('/chat/new?prompt=&profile= (M1 #17)', () => {
  test('the prompt comes back as it was written, with spaces, newlines, quotes and a plus sign', () => {
    const search = `?prompt=${encodeURIComponent('Fix the "login" bug\nthen add 1+1 tests')}&profile=coder`;
    expect(resolveNewChatLink(search, profiles)).toEqual({ prompt: 'Fix the "login" bug\nthen add 1+1 tests', unknownProfile: undefined, remaining: '?profile=coder' });
  });

  test('a prompt that looks like a number or JSON is still text', () => {
    expect(resolveNewChatLink('?prompt=123', profiles).prompt).toBe('123');
    expect(resolveNewChatLink('?prompt=true', profiles).prompt).toBe('true');
    expect(resolveNewChatLink(`?prompt=${encodeURIComponent('{"a":1}')}`, profiles).prompt).toBe('{"a":1}');
  });

  test('an empty or blank prompt is no prompt, and is dropped from the address', () => {
    expect(resolveNewChatLink('?prompt=', profiles)).toEqual({ prompt: undefined, unknownProfile: undefined, remaining: '' });
    expect(resolveNewChatLink('?prompt=%20%0A', profiles).prompt).toBeUndefined();
    expect(resolveNewChatLink('?profile=coder', profiles)).toEqual({ prompt: undefined, unknownProfile: undefined, remaining: '?profile=coder' });
  });

  test('a profile Hermes does not have is reported and dropped from the address, so the tab falls back to its own profile; the prompt is kept', () => {
    expect(resolveNewChatLink('?profile=ghost&prompt=hello', profiles)).toEqual({ prompt: 'hello', unknownProfile: 'ghost', remaining: '' });
    expect(UNKNOWN_PROFILE_NOTICE('ghost')).toBe('There is no profile “ghost”, so this chat uses your current profile.');
  });

  test('other parameters stay in the address', () => {
    expect(resolveNewChatLink('?profile=ghost&prompt=hi&source=cli', profiles).remaining).toBe('?source=cli');
  });

  test('a repeated prompt or profile: the last one counts, as Hermes’s own links do', () => {
    expect(resolveNewChatLink('?prompt=a&prompt=b&profile=default&profile=coder', profiles)).toMatchObject({ prompt: 'b', unknownProfile: undefined, remaining: '?profile=coder' });
  });

  test('a link without a query changes nothing', () => {
    expect(resolveNewChatLink('', profiles)).toEqual({ prompt: undefined, unknownProfile: undefined, remaining: '' });
  });
});
