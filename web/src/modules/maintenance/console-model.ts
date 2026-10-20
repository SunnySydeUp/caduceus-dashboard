// The `hermes>` console as the page sees it (M5 #13): Hermes's console frames folded into a transcript, and the frames the page sends back. Hermes's own engine
// decides what a command does and what it refuses; this only shows it. Where the console is offered is here too: not on a phone.
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { SizeClass } from '../../size-class.ts';

export interface ConsoleEntry {
  kind: 'command' | 'output' | 'error';
  text: string;
}

export interface ConsoleState {
  status: 'connecting' | 'ready' | 'closed';
  prompt: string;
  entries: ConsoleEntry[];
  /** A command is running: Hermes takes no other until it completes. */
  busy: boolean;
  /** A command that changes something, held until the owner confirms it. */
  pending?: { command: string; message: string };
}

export const startConsole = (): ConsoleState => ({ status: 'connecting', prompt: 'hermes> ', entries: [], busy: false });

/** The owner sent `line`: it is echoed after the prompt and Hermes is busy with it. */
export const commandSent = (state: ConsoleState, line: string): ConsoleState => ({ ...state, busy: true, entries: [...state.entries, { kind: 'command', text: `${state.prompt}${line}` }] });

/** Folds one frame of Hermes's console into the state; a frame it does not know leaves the state as it was. */
export function foldConsole(state: ConsoleState, frame: unknown): ConsoleState {
  if (!isRecord(frame) || typeof frame.type !== 'string') return state;
  const prompt = typeof frame.prompt === 'string' && frame.prompt !== '' ? frame.prompt : state.prompt;
  switch (frame.type) {
    case 'ready':
      return { ...state, status: 'ready', prompt };
    case 'output':
      return typeof frame.data === 'string' ? { ...state, prompt, entries: [...state.entries, { kind: 'output', text: frame.data }] } : state;
    case 'error':
      return typeof frame.message === 'string' ? { ...state, prompt, entries: [...state.entries, { kind: 'error', text: frame.message }] } : state;
    case 'confirm_required':
      return typeof frame.command === 'string' ? { ...state, prompt, pending: { command: frame.command, message: typeof frame.message === 'string' ? frame.message : `Run \`${frame.command}\`?` } } : state;
    case 'clear':
      return { ...state, entries: [] };
    case 'complete': {
      const status = typeof frame.status === 'string' ? frame.status : 'ok';
      // A cancel (or a command that has run) ends what was waiting for a confirmation; a command that asks for one keeps it.
      const pending = status === 'confirm_required' ? state.pending : undefined;
      return { ...state, prompt, busy: false, pending, status: status === 'exit' ? 'closed' : state.status };
    }
    default:
      return state;
  }
}

export const commandFrame = (line: string) => ({ type: 'command', line });
export const confirmFrame = (command: string) => ({ type: 'confirm', command });
export const cancelFrame = () => ({ type: 'cancel' });

/** A terminal is not made for a phone: the console is offered there only through "open anyway". */
export const consoleHiddenOn = (size: SizeClass): boolean => size === 'compact';
