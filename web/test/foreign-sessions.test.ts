import { describe, expect, test } from 'vitest';
import { folderName, turnsLabel } from '../src/modules/chat/foreign-sessions.ts';

// What a row of the Claude Code and Codex sessions says about where a session was and how long it is (M1 #16). The engine over the real Hermes is `server/test/foreign-sessions.test.ts`.
describe('folderName', () => {
  test.each([
    ['/Users/ana/work/api', 'api'],
    ['/Users/ana/work/api/', 'api'],
    ['C:\\Users\\ana\\work\\api', 'api'],
    ['/', '/'],
  ])('%s is %s', (cwd, name) => {
    expect(folderName(cwd)).toBe(name);
  });
  test('a session with no folder has no name for it', () => {
    expect(folderName(undefined)).toBeUndefined();
  });
});

describe('turnsLabel', () => {
  test.each([
    [1, '1 turn'],
    [2, '2 turns'],
    [0, '0 turns'],
  ])('%i is %s', (count, label) => {
    expect(turnsLabel(count)).toBe(label);
  });
});
