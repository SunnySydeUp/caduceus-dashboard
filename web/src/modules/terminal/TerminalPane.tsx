import { useEffect, useRef } from 'react';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as Xterm, type IMarker } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { askStepUp } from '../../passkeys.ts';
import { openTerminalConnection, type TerminalConnection, type TerminalStatus } from './terminal-connection.ts';
import { endedNotice, lastOutputText, xtermTheme } from './terminal-model.ts';

const FONT_SIZE = 13;

/** The keys a soft keyboard has no way to type, for a touch screen. */
const TOUCH_KEYS = [
  { label: 'Esc', data: '\x1b', name: 'Esc key' },
  { label: 'Tab', data: '\t', name: 'Tab key' },
  { label: '↑', data: '\x1b[A', name: 'Up arrow' },
  { label: '↓', data: '\x1b[B', name: 'Down arrow' },
  { label: 'Ctrl-C', data: '\x03', name: 'Ctrl-C interrupt' },
] as const;

/** The colour an appearance token has now (a theme or skin may have changed it), as a hex colour: tokens can be `light-dark()` or `color-mix()`, which the terminal cannot read. */
function resolveToken(probe: HTMLElement, token: string): string {
  probe.style.color = `var(${token})`;
  const resolved = getComputedStyle(probe).color;
  const canvas = document.createElement('canvas').getContext('2d');
  if (!canvas) return resolved;
  canvas.clearRect(0, 0, 1, 1);
  canvas.fillStyle = resolved;
  canvas.fillRect(0, 0, 1, 1);
  const [r, g, b] = canvas.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

/** ⌘ on a Mac, Ctrl elsewhere: the key the terminal's own shortcuts (copy, paste, copy last output) are built on. */
export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export interface PaneControls {
  /** Copies what is selected; `false` when nothing is. */
  copy(): Promise<boolean>;
  /** Copies what the terminal printed after the last line the owner sent; `false` when there is nothing. */
  copyLastOutput(): Promise<boolean>;
  paste(): Promise<void>;
  send(data: string): void;
  reconnect(): void;
  focus(): void;
}

export interface PaneProps {
  /** The terminal is opened again whenever this changes (the folder, the session). */
  identity: string;
  /** The address to open, at the size the terminal has now. */
  url(size: { cols: number; rows: number }): string;
  /** The `id` of the element that takes the focus when the owner presses Shift-Esc. */
  escapeTargetId: string;
  onStatus(status: TerminalStatus, cwd: string | undefined): void;
  onEnded(notice: string | undefined): void;
  onNotice(text: string | undefined): void;
  controls: { current: PaneControls | undefined };
}

/** The xterm pane and its connection. Both are made when the pane mounts and dropped when `identity` changes or the screen goes. */
export function TerminalPane({ identity, url, escapeTargetId, onStatus, onEnded, onNotice, controls }: PaneProps) {
  const host = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onStatus, onEnded, onNotice, url });
  callbacks.current = { onStatus, onEnded, onNotice, url };

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let connection: TerminalConnection | undefined;
    const cleanups: (() => void)[] = [];

    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const probe = document.createElement('span');
    probe.hidden = true;
    element.append(probe);
    const theme = () => xtermTheme((token) => resolveToken(probe, token));
    const instance = new Xterm({
      fontFamily: getComputedStyle(element).getPropertyValue('--cd-font-mono'),
      fontSize: FONT_SIZE,
      cursorBlink: !reduced.matches,
      scrollback: 5000,
      theme: theme(),
      allowProposedApi: false,
    });
    const fit = new FitAddon();
    instance.loadAddon(fit);
    instance.open(element);
    // The terminal's own keyboard input is not something to tap, so it is not one of the page's touch targets.
    instance.textarea?.classList.add('sr-only');
    fit.fit();

    // The page keeps the colours of the appearance tokens: a change of theme, skin or the system's colour scheme changes them here, and so does the motion preference.
    const retheme = () => {
      instance.options.theme = theme();
    };
    const attributes = new MutationObserver(retheme);
    attributes.observe(document.documentElement, { attributes: true });
    const scheme = matchMedia('(prefers-color-scheme: dark)');
    scheme.addEventListener('change', retheme);
    const motion = () => {
      instance.options.cursorBlink = !reduced.matches;
    };
    reduced.addEventListener('change', motion);
    cleanups.push(() => attributes.disconnect(), () => scheme.removeEventListener('change', retheme), () => reduced.removeEventListener('change', motion));

    const copy = async () => {
      const text = instance.getSelection();
      if (!text) return false;
      await navigator.clipboard.writeText(text);
      return true;
    };
    // A marker sits on the line of the last Enter the owner pressed: what follows it is the last output.
    let lastSent: IMarker | undefined;
    const copyLastOutput = async () => {
      if (!lastSent || lastSent.isDisposed) return false;
      const buffer = instance.buffer.active;
      const lines: string[] = [];
      for (let row = lastSent.line; row < buffer.length; row++) lines.push(buffer.getLine(row)?.translateToString(true) ?? '');
      const text = lastOutputText(lines);
      if (text === '') return false;
      await navigator.clipboard.writeText(text);
      return true;
    };
    const paste = async () => {
      const text = await navigator.clipboard.readText();
      if (text) instance.paste(text);
    };
    // Copy and paste with the keys of the platform (⌘C and ⌘V on a Mac; Ctrl-Shift-C and -V elsewhere, since Ctrl-C belongs to the shell); copy last output is ⇧⌘L (Ctrl-Shift-L).
    // Anything else with ⌘ is left to the page. Shift-Escape is the way out: it moves focus off the terminal so the page's own keys (Escape, the palette, `?`) work again.
    instance.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const key = event.key.toLowerCase();
      const withMod = isMac ? event.metaKey : event.ctrlKey && event.shiftKey;
      if (withMod && key === 'c' && instance.hasSelection()) {
        void copy();
        return false;
      }
      if (withMod && key === 'v') return false; // the browser's own paste event reaches the terminal
      if (event.shiftKey && (isMac ? event.metaKey : event.ctrlKey) && key === 'l') {
        void copyLastOutput();
        return false;
      }
      if (event.key === 'Escape' && event.shiftKey) {
        instance.blur();
        document.getElementById(escapeTargetId)?.focus();
        return false;
      }
      if (event.key === 'Enter') lastSent = instance.registerMarker(0) ?? lastSent;
      return !(isMac && event.metaKey);
    });

    let cwd: string | undefined;
    const socket = openTerminalConnection({
      url: () => callbacks.current.url({ cols: instance.cols, rows: instance.rows }),
      askForGrant: askStepUp,
      onStatus: (status) => callbacks.current.onStatus(status, cwd),
      onFrame(frame) {
        if (frame.type === 'attached') {
          // A reconnect replays what the terminal printed, so what is on screen goes first.
          instance.reset();
          lastSent = undefined;
          cwd = frame.cwd;
          callbacks.current.onEnded(undefined);
          callbacks.current.onNotice(undefined);
          callbacks.current.onStatus({ state: 'live' }, cwd);
          if (!frame.running) callbacks.current.onEnded('The shell in this folder is over. Restart starts a new one.');
        } else if (frame.type === 'output') {
          instance.write(frame.data);
        } else if (frame.type === 'ended') {
          callbacks.current.onEnded(endedNotice(frame));
        } else if (frame.type === 'notice') {
          callbacks.current.onNotice(frame.text);
        } else {
          instance.reset();
          lastSent = undefined;
          callbacks.current.onEnded(undefined);
        }
      },
    });
    connection = socket;
    cleanups.push(() => instance.dispose());
    instance.onData((data) => socket.send({ type: 'input', data }));
    instance.onResize(({ cols, rows }) => socket.send({ type: 'resize', cols, rows }));
    const resizing = new ResizeObserver(() => fit.fit());
    resizing.observe(element);
    cleanups.push(() => resizing.disconnect());
    controls.current = {
      copy,
      copyLastOutput,
      paste,
      send: (data) => socket.send({ type: 'input', data }),
      reconnect: () => socket.reconnect(),
      focus: () => instance.focus(),
    };
    instance.focus();

    return () => {
      controls.current = undefined;
      for (const cleanup of cleanups) cleanup();
      connection?.close();
    };
  }, [identity, escapeTargetId, controls]);

  return <div ref={host} className="term-host" role="group" aria-label="Terminal" />;
}

/** A row of the keys a touch screen's keyboard lacks; it shows only where the pointer is coarse. */
export function TouchKeys({ controls }: { controls: { current: PaneControls | undefined } }) {
  return (
    <div className="tm-keys" aria-label="Extra keys">
      {TOUCH_KEYS.map((key) => (
        <button
          key={key.label}
          type="button"
          className="btn btn--secondary btn--sm"
          aria-label={key.name}
          onClick={() => {
            controls.current?.send(key.data);
            controls.current?.focus();
          }}
        >
          {key.label}
        </button>
      ))}
    </div>
  );
}
