import { describe, expect, test } from 'vitest';
import { flagsOf, headerControls, threadMenu, type ThreadMenuInput } from '../src/modules/chat/talk-header.ts';

// The Talk header holds the agent, the title, Details and a More menu (M8 #09). Every control the header and its menu had before is still one tap away.
const live: ThreadMenuInput = { readOnlySession: false, taskOffered: true, busy: false, empty: false, terminal: true, pinned: false, archived: false };
const ids = (input: ThreadMenuInput) => threadMenu(input).map((entry) => entry.id);

/** What the header and its Chat actions menu offered before the calm header, and where each is now. */
const BEFORE: { was: string; reach(): boolean }[] = [
  { was: 'Make this a task (header button, large screens)', reach: () => ids(live).includes('task') },
  { was: 'Chat actions: Rename', reach: () => ids(live).includes('rename') },
  { was: 'Chat actions: Regenerate title', reach: () => ids(live).includes('regenerate-title') },
  { was: 'Chat actions: Fork this chat', reach: () => ids(live).includes('fork') },
  { was: 'Chat actions: Undo last exchange', reach: () => ids(live).includes('undo') },
  { was: 'Chat actions: Write a handoff summary', reach: () => ids(live).includes('handoff-summary') },
  { was: 'Chat actions: Make this a task', reach: () => ids(live).includes('task') },
  { was: 'Chat actions: Export', reach: () => ids(live).includes('export') },
  { was: 'Chat actions: Share link', reach: () => ids(live).includes('share') },
  { was: 'Chat actions (read-only session): Branch to continue', reach: () => ids({ ...live, readOnlySession: true }).includes('branch') },
  { was: 'Chat actions (read-only session): Write a handoff summary', reach: () => ids({ ...live, readOnlySession: true }).includes('handoff-summary') },
  { was: 'Chat actions (read-only session): Export', reach: () => ids({ ...live, readOnlySession: true }).includes('export') },
  { was: 'Chat actions (read-only session): Share link', reach: () => ids({ ...live, readOnlySession: true }).includes('share') },
  { was: 'Terminal mode (app bar button)', reach: () => ids(live).includes('terminal') },
  { was: 'Details (header button)', reach: () => headerControls({ compact: false, titled: true, viewable: true }).includes('details') && headerControls({ compact: true, titled: false, viewable: true }).includes('details') },
  { was: 'Sessions (header button, phone)', reach: () => headerControls({ compact: true, titled: true, viewable: true }).includes('sessions') },
  { was: 'Chat actions (header button)', reach: () => headerControls({ compact: false, titled: true, viewable: true }).includes('more') },
  { was: 'the transcript tools and the activity mode (above the thread)', reach: () => headerControls({ compact: false, titled: false, viewable: true }).includes('view') },
];

describe('every control the header had is still reachable', () => {
  test.each(BEFORE)('$was', ({ reach }) => {
    expect(reach()).toBe(true);
  });

  test('Pin and Archive, which the session list had, are in the menu too', () => {
    expect(ids(live)).toEqual(expect.arrayContaining(['pin', 'archive']));
  });
});

describe('the header', () => {
  test('is New chat, Details, View and More on a large screen; on a phone Sessions, Details, View and More, with no room for New chat beside the name', () => {
    expect(headerControls({ compact: false, titled: true, viewable: true })).toEqual(['new', 'details', 'view', 'more']);
    expect(headerControls({ compact: true, titled: true, viewable: true })).toEqual(['sessions', 'details', 'view', 'more']);
  });

  test('has no New chat and no More menu before the chat has a session: it is a new chat already', () => {
    expect(headerControls({ compact: false, titled: false, viewable: true })).toEqual(['details', 'view']);
    expect(headerControls({ compact: true, titled: false, viewable: true })).toEqual(['sessions', 'details', 'view']);
  });

  test('has no View menu in a Fast chat, which has no activity and no transcript tools', () => {
    expect(headerControls({ compact: false, titled: true, viewable: false })).toEqual(['new', 'details', 'more']);
  });
});

describe('the More menu', () => {
  test('puts Rename, Pin, Make this a task and Archive first, in that order', () => {
    expect(ids(live).slice(0, 4)).toEqual(['rename', 'pin', 'task', 'archive']);
  });

  test('offers Make this a task only when the chat has words to start it from', () => {
    expect(ids({ ...live, taskOffered: false })).not.toContain('task');
  });

  test('offers the terminal only where terminal mode is offered', () => {
    expect(ids({ ...live, terminal: false })).not.toContain('terminal');
  });

  test('says Unpin and Restore from archive for a session that is pinned or archived', () => {
    const entries = threadMenu({ ...live, pinned: true, archived: true });
    expect(entries.find((entry) => entry.id === 'pin')?.label).toBe('Unpin');
    expect(entries.find((entry) => entry.id === 'archive')?.label).toBe('Restore from archive');
  });

  test('switches Fork and Undo off, with the reason, while a reply is being written, and Undo when there is nothing to undo', () => {
    const busy = threadMenu({ ...live, busy: true });
    expect(busy.find((entry) => entry.id === 'fork')?.disabled).toMatch(/Hermes is writing a reply/);
    expect(busy.find((entry) => entry.id === 'undo')?.disabled).toMatch(/Hermes is writing a reply/);
    expect(threadMenu({ ...live, empty: true }).find((entry) => entry.id === 'undo')?.disabled).toMatch(/nothing to undo/);
    expect(threadMenu(live).find((entry) => entry.id === 'fork')?.disabled).toBeUndefined();
  });

  test('a session that is only read has no edits, only what leaves it alone: branch, summary, a task, export, share', () => {
    expect(ids({ ...live, readOnlySession: true })).toEqual(['branch', 'handoff-summary', 'task', 'export', 'share', 'terminal']);
  });

  test('marks what changes Hermes as a write, so read-only mode switches it off, and what does not as not', () => {
    const writes = Object.fromEntries(threadMenu(live).map((entry) => [entry.id, entry.writes]));
    expect(writes).toMatchObject({ rename: true, pin: true, task: true, archive: true, fork: true, share: true, export: false, 'handoff-summary': false, terminal: false });
  });
});

describe('whether the open session is pinned or archived, as Hermes says it', () => {
  test('reads true, and the 1 Hermes’s own table holds, and nothing else', () => {
    expect(flagsOf({ pinned: true, archived: 1 })).toEqual({ pinned: true, archived: true });
    expect(flagsOf({ pinned: 0, archived: false })).toEqual({ pinned: false, archived: false });
    expect(flagsOf({ pinned: 'yes' })).toEqual({ pinned: false, archived: false });
    expect(flagsOf(undefined)).toEqual({ pinned: false, archived: false });
  });
});
