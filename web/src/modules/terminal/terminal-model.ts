// Workspace › Terminal, the parts that need neither the DOM nor React: the socket's address, the frames the server sends, why a shell ended, when a phone
// gets the explanation, and the terminal's palette as a list of appearance tokens.
import type { TerminalServerFrame } from '@caduceus/contracts/caduceus-api';
import type { SizeClass } from '../../size-class.ts';

/** The route of the shell on the Caduceus server. */
export const TERMINAL_PATH = '/_caduceus/api/terminal';

/** The address of the shell of `cwd` (the owner's home folder when none is named) as this page reaches it: `wss` on a secure page, `ws` on the local one. */
export function terminalSocketUrl({ origin, cwd, profile, cols, rows }: { origin: string; cwd?: string; profile?: string; cols: number; rows: number }): string {
  const url = new URL(TERMINAL_PATH, origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  if (cwd) url.searchParams.set('cwd', cwd);
  url.searchParams.set('cols', String(cols));
  url.searchParams.set('rows', String(rows));
  if (profile) url.searchParams.set('profile', profile);
  return url.toString();
}

/** The address of Hermes's PTY, which the Caduceus server relays, for the TUI of a stored session (and a profile): the chat's terminal mode. */
export function ptySocketUrl({ origin, session, profile, cols, rows }: { origin: string; session: string; profile?: string; cols: number; rows: number }): string {
  const url = new URL('/api/pty', origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('resume', session);
  url.searchParams.set('cols', String(cols));
  url.searchParams.set('rows', String(rows));
  if (profile) url.searchParams.set('profile', profile);
  return url.toString();
}

const ENDED_REASONS = ['exited', 'idle', 'abandoned', 'stopping'] as const;

/** A frame from the server, or `undefined` for anything that is not one the server sends. */
export function parseServerFrame(text: string): TerminalServerFrame | undefined {
  let frame: unknown;
  try {
    frame = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof frame !== 'object' || frame === null || !('type' in frame)) return undefined;
  switch (frame.type) {
    case 'output':
      return 'data' in frame && typeof frame.data === 'string' ? { type: 'output', data: frame.data } : undefined;
    case 'attached':
      return 'running' in frame && typeof frame.running === 'boolean' && 'cols' in frame && typeof frame.cols === 'number' && 'rows' in frame && typeof frame.rows === 'number'
        ? { type: 'attached', ...('cwd' in frame && typeof frame.cwd === 'string' ? { cwd: frame.cwd } : {}), running: frame.running, cols: frame.cols, rows: frame.rows }
        : undefined;
    case 'notice':
      return 'text' in frame && typeof frame.text === 'string' ? { type: 'notice', text: frame.text } : undefined;
    case 'ended':
    {
      const reason = 'reason' in frame ? ENDED_REASONS.find((known) => known === frame.reason) : undefined;
      return reason ? { type: 'ended', reason, ...('code' in frame && typeof frame.code === 'number' ? { code: frame.code } : {}) } : undefined;
    }
    case 'restarted':
      return { type: 'restarted' };
    default:
      return undefined;
  }
}

/** The line shown when the shell is over, which says why in the owner's words. The periods are the server's (`terminal.ts`). */
export function endedNotice(frame: Extract<TerminalServerFrame, { type: 'ended' }>): string {
  switch (frame.reason) {
    case 'exited':
      return frame.code === undefined || frame.code === 0 ? 'The shell exited.' : `The shell exited with code ${frame.code}.`;
    case 'idle':
      return 'The shell ended because nothing was typed for 30 minutes.';
    case 'abandoned':
      return 'The shell ended because no screen was watching it for 10 minutes.';
    case 'stopping':
      return 'The shell ended because Caduceus stopped.';
  }
}

/** A phone (a window under 600 px) explains that the terminal is not made for it, and opens it only when the owner says so. */
export function showsPhoneNotice(size: SizeClass, openAnyway: boolean): boolean {
  return size === 'compact' && !openAnyway;
}

/** Terminal mode of the chat is for a tablet or a computer: it is not offered on a phone, and its address shows the chat there. */
export function terminalModeOffered(size: SizeClass): boolean {
  return size !== 'compact';
}

/**
 * What the terminal printed after the line the owner last sent (the lines from there to the end of the buffer, the first being that line itself), without the
 * empty lines at its end: the text that Copy last output puts on the clipboard.
 */
export function lastOutputText(lines: readonly string[]): string {
  const output = lines.slice(1);
  while (output.length > 0 && output.at(-1)!.trim() === '') output.pop();
  return output.join('\n');
}

/** The appearance tokens the 16 ANSI colours and the terminal's own surfaces are drawn from. A theme or skin change changes them all. */
const PALETTE = {
  background: '--cd-bg-inset',
  foreground: '--cd-fg-default',
  cursor: '--cd-accent-fg',
  cursorAccent: '--cd-bg-inset',
  selectionBackground: '--cd-accent-border',
  black: '--cd-bg-surface-2',
  red: '--cd-tone-danger-fg',
  green: '--cd-tone-success-fg',
  yellow: '--cd-tone-warning-fg',
  blue: '--cd-tone-info-fg',
  magenta: '--cd-tone-paused-fg',
  cyan: '--cd-tone-running-fg',
  white: '--cd-fg-muted',
  brightBlack: '--cd-fg-subtle',
  brightRed: '--cd-tone-danger-fg',
  brightGreen: '--cd-tone-success-fg',
  brightYellow: '--cd-tone-warning-fg',
  brightBlue: '--cd-tone-info-fg',
  brightMagenta: '--cd-tone-paused-fg',
  brightCyan: '--cd-tone-running-fg',
  brightWhite: '--cd-fg-default',
} as const;

export type TerminalTheme = Record<keyof typeof PALETTE, string>;

/** The terminal's colours, each read by `resolve` from the appearance token it is drawn from (the page resolves a token to the colour it has now). */
export function xtermTheme(resolve: (token: string) => string): TerminalTheme {
  const theme: Record<string, string> = {};
  for (const [name, token] of Object.entries(PALETTE)) theme[name] = resolve(token);
  // The keys are the ones of PALETTE, each filled above.
  return theme as TerminalTheme;
}
