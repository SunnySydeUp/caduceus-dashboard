import { describe, expect, test } from 'vitest';
import { interruptionOf, isAutoContinueNote, isFailedTurnNotice, readStopped, writeStopped, type InterruptionFacts } from '../src/modules/chat/turn-recovery.ts';

// Turns that did not finish (M1 #12). The notes are Hermes's own words (`agent/turn_failure_copy.py`, `tui_gateway/session_history.py`); the judgement of a transcript is the page's.
describe('what Hermes writes for a turn that did not finish', () => {
  test('knows the two notes that close a failed turn, exactly, and no reply that only sounds like them', () => {
    expect(isFailedTurnNotice('Your request was not processed. Send it again if you still want me to carry it out.')).toBe(true);
    expect(isFailedTurnNotice('This turn did not complete. Some actions may already have run; verify their effects before resending.')).toBe(true);
    expect(isFailedTurnNotice('Your request was not processed.')).toBe(false);
    expect(isFailedTurnNotice('Sorry, your request was not processed. Send it again if you still want me to carry it out.')).toBe(false);
  });

  test('knows the note of a turn Hermes picked up again, typed or from before rows were typed', () => {
    expect(isAutoContinueNote({ display_kind: 'auto_continue' }, 'anything')).toBe(true);
    expect(isAutoContinueNote({}, '[System note: Your previous turn was interrupted mid-run — the app or its backend process stopped]\n\nCount')).toBe(true);
    expect(isAutoContinueNote({}, 'Why was my previous turn interrupted mid-run?')).toBe(false);
  });
});

describe('whether the last turn was interrupted', () => {
  const idle: Omit<InterruptionFacts, 'messages'> = { turn: undefined, running: false, syncing: false, hasNewer: false };
  const user = { role: 'user' as const };
  const reply = { role: 'assistant' as const };

  test('a transcript that ends on a message of the owner\'s, on agent activity, or on a reply the owner stopped', () => {
    expect(interruptionOf({ ...idle, messages: [user, reply, user] })).toBe('unanswered');
    expect(interruptionOf({ ...idle, messages: [user, { ...reply, activity: [] }] })).toBe('cut-off');
    expect(interruptionOf({ ...idle, messages: [user, { ...reply, stopped: true }] })).toBe('stopped');
  });

  test('is not one when the turn ended with a reply, failed (it has its bubble), or was picked up again by Hermes', () => {
    expect(interruptionOf({ ...idle, messages: [user, reply] })).toBeUndefined();
    expect(interruptionOf({ ...idle, messages: [user, { ...reply, failed: { error: 'x' } }] })).toBeUndefined();
    expect(interruptionOf({ ...idle, messages: [user, { ...user, note: 'continued' }] })).toBeUndefined();
    expect(interruptionOf({ ...idle, messages: [] })).toBeUndefined();
  });

  test('says nothing while a turn is running or being shown, the chat is catching up, or the window is not at the newest message', () => {
    const open = [user];
    expect(interruptionOf({ ...idle, messages: open, running: true })).toBeUndefined();
    expect(interruptionOf({ ...idle, messages: open, turn: {} })).toBeUndefined();
    expect(interruptionOf({ ...idle, messages: open, syncing: true })).toBeUndefined();
    expect(interruptionOf({ ...idle, messages: open, hasNewer: true })).toBeUndefined();
  });
});

describe('the replies the owner stopped, kept in the browser', () => {
  const memory = () => {
    const kept = new Map<string, string>();
    return { getItem: (key: string) => kept.get(key) ?? null, setItem: (key: string, value: string) => void kept.set(key, value), removeItem: (key: string) => void kept.delete(key) };
  };

  test('are kept by profile and session, newest fifty only, and an unreadable store is none', () => {
    const storage = memory();
    writeStopped(storage, 'work', 's1', new Set(Array.from({ length: 60 }, (_, n) => n)));
    writeStopped(storage, 'default', 's1', new Set([7]));

    expect([...readStopped(storage, 'work', 's1')]).toEqual(Array.from({ length: 50 }, (_, n) => n + 10));
    expect([...readStopped(storage, undefined, 's1')]).toEqual([7]);
    expect(readStopped(storage, 'work', 's2').size).toBe(0);
    storage.setItem('caduceus.chat.stopped.work.s3', 'not json');
    expect(readStopped(storage, 'work', 's3').size).toBe(0);
    expect(readStopped(undefined, 'work', 's1').size).toBe(0);
  });
});
