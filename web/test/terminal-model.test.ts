import { describe, expect, test } from 'vitest';
import { endedNotice, lastOutputText, parseServerFrame, ptySocketUrl, showsPhoneNotice, terminalModeOffered, terminalSocketUrl, xtermTheme } from '../src/modules/terminal/terminal-model.ts';

describe('terminal model', () => {
  test('the socket address carries the folder, the profile and the window size, over wss on a secure page', () => {
    expect(terminalSocketUrl({ origin: 'https://mac.tail1234.ts.net:9443', cwd: '/Users/me/my project', profile: 'research', cols: 120, rows: 32 })).toBe(
      'wss://mac.tail1234.ts.net:9443/_caduceus/api/terminal?cwd=%2FUsers%2Fme%2Fmy+project&cols=120&rows=32&profile=research',
    );
    expect(terminalSocketUrl({ origin: 'http://localhost:9130', cwd: '/tmp', cols: 80, rows: 24 })).toBe('ws://localhost:9130/_caduceus/api/terminal?cwd=%2Ftmp&cols=80&rows=24');
    // No folder is the owner's home folder, which the server fills in.
    expect(terminalSocketUrl({ origin: 'http://localhost:9130', cols: 80, rows: 24 })).toBe('ws://localhost:9130/_caduceus/api/terminal?cols=80&rows=24');
  });

  test('reads the frames the server sends and nothing else', () => {
    expect(parseServerFrame('{"type":"output","data":"hi\\r\\n"}')).toEqual({ type: 'output', data: 'hi\r\n' });
    expect(parseServerFrame('{"type":"attached","cwd":"/tmp","running":true,"cols":80,"rows":24}')).toEqual({ type: 'attached', cwd: '/tmp', running: true, cols: 80, rows: 24 });
    expect(parseServerFrame('{"type":"ended","reason":"idle"}')).toEqual({ type: 'ended', reason: 'idle' });
    expect(parseServerFrame('{"type":"restarted"}')).toEqual({ type: 'restarted' });
    expect(parseServerFrame('{"type":"output"}')).toBeUndefined();
    expect(parseServerFrame('{"type":"ended","reason":"because"}')).toBeUndefined();
    expect(parseServerFrame('{"type":"unknown"}')).toBeUndefined();
    expect(parseServerFrame('not json')).toBeUndefined();
  });

  test('says in words why a shell ended', () => {
    expect(endedNotice({ type: 'ended', reason: 'exited', code: 0 })).toBe('The shell exited.');
    expect(endedNotice({ type: 'ended', reason: 'exited', code: 3 })).toBe('The shell exited with code 3.');
    expect(endedNotice({ type: 'ended', reason: 'idle' })).toBe('The shell ended because nothing was typed for 30 minutes.');
    expect(endedNotice({ type: 'ended', reason: 'abandoned' })).toBe('The shell ended because no screen was watching it for 10 minutes.');
    expect(endedNotice({ type: 'ended', reason: 'stopping' })).toBe('The shell ended because Caduceus stopped.');
  });

  test('a phone gets the explanation until the owner opens the terminal anyway', () => {
    expect([showsPhoneNotice('compact', false), showsPhoneNotice('compact', true), showsPhoneNotice('medium', false), showsPhoneNotice('large', false)]).toEqual([true, false, false, false]);
  });

  test('the palette is built from the appearance tokens, resolved by the page, and from nothing else', () => {
    const asked: string[] = [];
    const theme = xtermTheme((token) => {
      asked.push(token);
      return `resolved(${token})`;
    });

    expect(theme.background).toBe('resolved(--cd-bg-inset)');
    expect(theme.foreground).toBe('resolved(--cd-fg-default)');
    expect(theme.cursor).toBe('resolved(--cd-accent-fg)');
    expect(theme.red).toBe('resolved(--cd-tone-danger-fg)');
    expect(theme.brightGreen).toBe('resolved(--cd-tone-success-fg)');
    expect(Object.values(theme).every((value) => /^resolved\(--cd-[a-z0-9-]+\)$/.test(value))).toBe(true);
    // Every one of the 16 ANSI colours is there, plus background, foreground, cursor, cursor accent and selection.
    expect(new Set(asked).size).toBeGreaterThan(8);
    expect(Object.keys(theme)).toHaveLength(21);
  });

  test('terminal mode is offered on a tablet or a computer and never on a phone', () => {
    expect([terminalModeOffered('compact'), terminalModeOffered('medium'), terminalModeOffered('large')]).toEqual([false, true, true]);
  });

  test('the TUI socket asks Hermes\'s PTY for the session and profile, at the size of the window', () => {
    expect(ptySocketUrl({ origin: 'https://mac.tail1234.ts.net:9443', session: '20261019_1_ab', profile: 'research', cols: 120, rows: 32 })).toBe('wss://mac.tail1234.ts.net:9443/api/pty?resume=20261019_1_ab&cols=120&rows=32&profile=research');
    expect(ptySocketUrl({ origin: 'http://localhost:9130', session: 's1', cols: 80, rows: 24 })).toBe('ws://localhost:9130/api/pty?resume=s1&cols=80&rows=24');
  });

  test('the last output is what came after the line the owner last sent, without the empty lines at its end', () => {
    expect(lastOutputText(['$ ls', 'a.txt', 'b.txt', '', ''])).toBe('a.txt\nb.txt');
    expect(lastOutputText(['$ true', '', ''])).toBe('');
    expect(lastOutputText([])).toBe('');
    // Lines keep their own spaces; only the empty ones at the end go.
    expect(lastOutputText(['> hi', '  indented', '', 'after a gap', ''])).toBe('  indented\n\nafter a gap');
  });
});
