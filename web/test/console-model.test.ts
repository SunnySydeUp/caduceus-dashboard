import { describe, expect, test } from 'vitest';
import { cancelFrame, commandFrame, commandSent, confirmFrame, consoleHiddenOn, foldConsole, startConsole } from '../src/modules/maintenance/console-model.ts';

describe('the console transcript as the page folds Hermes’s frames', () => {
  test('is ready with Hermes’s prompt, echoes the command, shows its output and is free again when it completes', () => {
    let state = foldConsole(startConsole(), { type: 'ready', profile: 'current', prompt: 'hermes> ' });
    state = commandSent(state, 'status');
    state = foldConsole(state, { type: 'output', id: 1, stream: 'stdout', data: 'All good', command: 'status' });

    expect(state).toMatchObject({ status: 'ready', prompt: 'hermes> ', busy: true });
    expect(state.entries).toEqual([
      { kind: 'command', text: 'hermes> status' },
      { kind: 'output', text: 'All good' },
    ]);
    expect(foldConsole(state, { type: 'complete', id: 1, status: 'ok', command: 'status', prompt: 'hermes> ' }).busy).toBe(false);
  });

  test('shows what Hermes refused as an error', () => {
    const state = foldConsole(commandSent(foldConsole(startConsole(), { type: 'ready', prompt: 'hermes> ' }), 'ls'), { type: 'error', id: 1, message: 'Unsupported Hermes Console command: ls.', command: 'ls' });

    expect(state.entries.at(-1)).toEqual({ kind: 'error', text: 'Unsupported Hermes Console command: ls.' });
  });

  test('holds a command that changes something until the owner confirms or cancels it', () => {
    let state = foldConsole(startConsole(), { type: 'ready', prompt: 'hermes> ' });
    state = commandSent(state, 'auth reset openai');
    state = foldConsole(state, { type: 'confirm_required', id: 1, command: 'auth reset openai', message: 'Clear exhaustion status for openai?', prompt: 'hermes> ' });
    state = foldConsole(state, { type: 'complete', id: 1, status: 'confirm_required', command: 'auth reset openai', prompt: 'hermes> ' });

    expect(state.pending).toEqual({ command: 'auth reset openai', message: 'Clear exhaustion status for openai?' });
    expect(state.busy).toBe(false);
    expect(foldConsole(state, { type: 'complete', status: 'cancelled', prompt: 'hermes> ' }).pending).toBeUndefined();
  });

  test('clear empties the screen, and an exit ends the session', () => {
    const state = commandSent(foldConsole(startConsole(), { type: 'ready', prompt: 'hermes> ' }), 'status');

    expect(foldConsole(state, { type: 'clear', id: 1 }).entries).toEqual([]);
    expect(foldConsole(state, { type: 'complete', id: 1, status: 'exit', command: 'exit', prompt: '' }).status).toBe('closed');
  });

  test('ignores a frame it does not know', () => {
    const state = startConsole();

    expect(foldConsole(state, { type: 'pong', prompt: 'hermes> ' })).toBe(state);
    expect(foldConsole(state, { nothing: true })).toBe(state);
  });
});

describe('the frames the page sends', () => {
  test('a command, its confirmation and a cancel are the frames Hermes’s console defines', () => {
    expect(commandFrame('status')).toEqual({ type: 'command', line: 'status' });
    expect(confirmFrame('auth reset openai')).toEqual({ type: 'confirm', command: 'auth reset openai' });
    expect(cancelFrame()).toEqual({ type: 'cancel' });
  });
});

describe('where the console is offered', () => {
  test('not on a phone, where a terminal is not made to be used (the page offers "open anyway")', () => {
    expect(consoleHiddenOn('compact')).toBe(true);
    expect(consoleHiddenOn('medium')).toBe(false);
    expect(consoleHiddenOn('large')).toBe(false);
  });
});
