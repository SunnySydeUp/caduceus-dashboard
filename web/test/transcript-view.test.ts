import { describe, expect, test } from 'vitest';
import { DEFAULT_CHIPS } from '@caduceus/contracts/chat-chips';
import { composerPaths } from '../src/modules/chat/composer-controls.ts';
import { viewPaths, viewRows } from '../src/modules/chat/transcript-view.ts';

// The View menu (M8 #09, the last pass): the transcript's tools and the activity mode were thirteen buttons above the thread; they are one button now, and every
// one of them is a row of its menu. Pure: the menu draws what this says.
describe('what the View menu holds', () => {
  test('a chat with messages has find, expand, collapse and copy, then the four roles, then the activity mode', () => {
    expect(viewRows({ hasMessages: true })).toEqual(['find', 'expand', 'collapse', 'copy', 'role:user', 'role:assistant', 'role:tool', 'role:reasoning', 'activity:worklog', 'activity:stream', 'activity:final']);
  });

  test('a chat with no messages yet has only the activity mode, which is the owner’s to choose before the first reply', () => {
    expect(viewRows({ hasMessages: false })).toEqual(['activity:worklog', 'activity:stream', 'activity:final']);
  });
});

// Nothing is deleted, only moved: every control the screen showed above the thread, and where it is now.
describe('every control above the thread is still reachable', () => {
  const settled = { hasMessages: true };
  const before: readonly (readonly [control: string, reach: () => string[], path: string])[] = [
    ['Find', () => viewPaths(settled), 'view > find'],
    ['You', () => viewPaths(settled), 'view > role:user'],
    ['the assistant’s role', () => viewPaths(settled), 'view > role:assistant'],
    ['Tools', () => viewPaths(settled), 'view > role:tool'],
    ['Reasoning', () => viewPaths(settled), 'view > role:reasoning'],
    ['Expand all', () => viewPaths(settled), 'view > expand'],
    ['Collapse all', () => viewPaths(settled), 'view > collapse'],
    ['Copy chat', () => viewPaths(settled), 'view > copy'],
    ['Worklog', () => viewPaths(settled), 'view > activity:worklog'],
    ['Stream', () => viewPaths(settled), 'view > activity:stream'],
    ['Final only', () => viewPaths(settled), 'view > activity:final'],
    ['Worklog in a new chat', () => viewPaths({ hasMessages: false }), 'view > activity:worklog'],
    ['YOLO for this chat', () => composerPaths({ empty: true, running: false, intent: 'ask' }, { preference: DEFAULT_CHIPS, touch: false }), 'context > yolo'],
  ];

  test.each(before)('%s', (_control, reach, path) => {
    expect(reach()).toContain(path);
  });
});
