// The slash commands that run beside the turn (M1 #07), read from what the owner typed in the composer: `/btw` (a side question),
// `/background` (a prompt on its own agent) and `/goal` (the session's goal). The general slash menu and every other command are M1 #09's:
// anything else is sent as a message. No DOM and no React.

export type RunCommand =
  | { kind: 'btw' | 'background'; text: string }
  | { kind: 'goal'; action: 'set'; text: string }
  | { kind: 'goal'; action: 'clear' | 'pause' | 'resume' }
  /** The command was typed with nothing after it. */
  | { kind: 'missing'; command: 'btw' | 'background' | 'goal' }
  /** `/goal gate …` makes Hermes run a shell command after every turn: it is set from Hermes's own terminal, never from here. */
  | { kind: 'gate' };

const GOAL_ACTIONS: Record<string, 'clear' | 'pause' | 'resume'> = { clear: 'clear', pause: 'pause', resume: 'resume' };

/** The run command in `typed`, or undefined when it is a message. */
export function runCommandOf(typed: string): RunCommand | undefined {
  const match = /^\s*\/(btw|background|goal)(?:\s+([\s\S]*))?$/i.exec(typed);
  if (!match) return undefined;
  const command = match[1]!.toLowerCase() as 'btw' | 'background' | 'goal';
  const text = (match[2] ?? '').trim();
  if (text === '') return { kind: 'missing', command };
  if (command !== 'goal') return { kind: command, text };
  const word = text.toLowerCase();
  if (word === 'gate' || /^gate\s/.test(word)) return { kind: 'gate' };
  const action = GOAL_ACTIONS[word];
  if (action) return { kind: 'goal', action };
  return { kind: 'goal', action: 'set', text };
}
