import { describe, expect, test } from 'vitest';
import { runCommandOf } from '../src/modules/chat/run-command.ts';

// The three slash commands that run beside the turn (M1 #07), read from what the owner typed in the composer.
describe('the run commands in the composer', () => {
  test('/btw and /background carry the rest of the line as the prompt', () => {
    expect(runCommandOf('/btw what is a monad?')).toEqual({ kind: 'btw', text: 'what is a monad?' });
    expect(runCommandOf('  /background  summarise the logs\nand mail me  ')).toEqual({ kind: 'background', text: 'summarise the logs\nand mail me' });
    expect(runCommandOf('/BTW shout')).toEqual({ kind: 'btw', text: 'shout' });
  });

  test('/goal sets a goal from its words, and clear, pause and resume are the goal\'s own commands', () => {
    expect(runCommandOf('/goal ship the release by Friday')).toEqual({ kind: 'goal', action: 'set', text: 'ship the release by Friday' });
    expect(runCommandOf('/goal clear')).toEqual({ kind: 'goal', action: 'clear' });
    expect(runCommandOf('/goal  PAUSE ')).toEqual({ kind: 'goal', action: 'pause' });
    expect(runCommandOf('/goal resume')).toEqual({ kind: 'goal', action: 'resume' });
    // Only the whole word is a command: a goal may start with one.
    expect(runCommandOf('/goal clear the backlog')).toEqual({ kind: 'goal', action: 'set', text: 'clear the backlog' });
  });

  test('a command with nothing after it says what is missing, and a gate is never typed from here', () => {
    expect(runCommandOf('/btw')).toEqual({ kind: 'missing', command: 'btw' });
    expect(runCommandOf('/background   ')).toEqual({ kind: 'missing', command: 'background' });
    expect(runCommandOf('/goal')).toEqual({ kind: 'missing', command: 'goal' });
    expect(runCommandOf('/goal gate npm test')).toEqual({ kind: 'gate' });
    expect(runCommandOf('/goal GATE')).toEqual({ kind: 'gate' });
  });

  test('anything else is a message: other slash commands, and words that merely begin with a command', () => {
    expect(runCommandOf('hello')).toBeUndefined();
    expect(runCommandOf('/btwx hi')).toBeUndefined();
    expect(runCommandOf('/compress')).toBeUndefined();
    expect(runCommandOf('please /btw this')).toBeUndefined();
    expect(runCommandOf('/goals')).toBeUndefined();
  });
});
