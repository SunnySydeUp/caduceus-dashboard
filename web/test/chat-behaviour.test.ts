import { describe, expect, test } from 'vitest';
import { DEFAULT_DEVICE_BEHAVIOUR, resolveSendKey } from '@caduceus/contracts/chat-behaviour';
import { followsGrowth, pinRefusal, sendsMessage, timeLabel } from '../src/modules/chat/chat-behaviour.ts';

// The chat behaviour settings (M1 #20) at their pure edges: what each setting makes the chat do.
const key = (name: string, extra: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; isComposing: boolean }> = {}) => ({ key: name, metaKey: false, ctrlKey: false, shiftKey: false, isComposing: false, ...extra });

describe('the send key', () => {
  test('⌘/Ctrl+Enter sends and Enter is a new line, or Enter sends and Shift+Enter is a new line', () => {
    expect(sendsMessage(key('Enter', { metaKey: true }), 'mod-enter')).toBe(true);
    expect(sendsMessage(key('Enter', { ctrlKey: true }), 'mod-enter')).toBe(true);
    expect(sendsMessage(key('Enter'), 'mod-enter')).toBe(false);

    expect(sendsMessage(key('Enter'), 'enter')).toBe(true);
    expect(sendsMessage(key('Enter', { shiftKey: true }), 'enter')).toBe(false);
    expect(sendsMessage(key('Enter', { metaKey: true }), 'enter')).toBe(true);
    expect(sendsMessage(key('a'), 'enter')).toBe(false);
  });

  test('an Enter that confirms a word of an input method (IME) never sends', () => {
    expect(sendsMessage(key('Enter', { isComposing: true }), 'enter')).toBe(false);
    expect(sendsMessage(key('Enter', { metaKey: true, isComposing: true }), 'mod-enter')).toBe(false);
  });

  test('Automatic sends with Enter where there is a fine pointer and with ⌘/Ctrl+Enter on touch; a chosen key wins everywhere', () => {
    expect(DEFAULT_DEVICE_BEHAVIOUR.sendKey).toBe('auto');
    expect(resolveSendKey('auto', true)).toBe('enter');
    expect(resolveSendKey('auto', false)).toBe('mod-enter');
    expect(resolveSendKey('mod-enter', true)).toBe('mod-enter');
    expect(resolveSendKey('enter', false)).toBe('enter');
  });
});

describe('the time under a message', () => {
  const now = new Date(2026, 9, 19, 15, 0).getTime() / 1000;
  const at = (month: number, day: number, hour: number, minute: number, year = 2026) => new Date(year, month, day, hour, minute).getTime() / 1000;

  test('is the clock time for today and the date with it for another day', () => {
    expect(timeLabel(at(9, 19, 9, 5), now)).toBe('09:05');
    expect(timeLabel(at(9, 18, 23, 59), now)).toBe('18 Oct, 23:59');
    expect(timeLabel(at(11, 31, 8, 0, 2025), now)).toBe('31 Dec 2025, 08:00');
  });
});

describe('the pin limit', () => {
  test('refuses a pin that would pass it, naming the limit, and allows one that reaches it', () => {
    expect(pinRefusal({ pinned: 2, adding: 1, limit: 3 })).toBeUndefined();
    expect(pinRefusal({ pinned: 3, adding: 1, limit: 3 })).toMatch(/at most 3/);
    expect(pinRefusal({ pinned: 1, adding: 3, limit: 3 })).toMatch(/at most 3/);
  });
});

describe('auto-follow', () => {
  test('a growing transcript scrolls to its end only while the reader is at the end and the setting is on', () => {
    expect(followsGrowth({ autoFollow: true, following: true })).toBe(true);
    expect(followsGrowth({ autoFollow: true, following: false })).toBe(false);
    expect(followsGrowth({ autoFollow: false, following: true })).toBe(false);
  });
});
