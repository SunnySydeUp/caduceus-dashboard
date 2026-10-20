// System › Maintenance › Console (M5 #13): Hermes's restricted `hermes>` console. Opening it is a Tier 2 action (a passkey), Hermes's own engine decides what a
// command does and what it refuses (it runs no shell, and asks before a command that changes something), and Caduceus audits the session and every command.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from '../../icons.tsx';
import { askStepUp, stepUpLive } from '../../passkeys.ts';
import { toast } from '../../shell/toasts.ts';
import { Term } from '../../shell/Term.tsx';
import { cancelFrame, commandFrame, commandSent, confirmFrame, foldConsole, startConsole, type ConsoleState } from './console-model.ts';
import { MaintenanceFrame } from './MaintenanceFrame.tsx';
import './maintenance.css';

/** What the page tells the owner when the connection ends, by how it ended. */
function closedReason(code: number, opened: boolean): string {
  if (!opened) return 'Caduceus did not open the console. It needs a fresh passkey confirmation, and it is not offered in read-only mode.';
  if (code === 1012) return 'Hermes restarted, so the console ended. Open it again.';
  if (code === 1001) return 'Caduceus is restarting, so the console ended. Open it again once it is back.';
  if (code === 4401) return 'Your session ended. Sign in again.';
  return 'The console ended.';
}

export function Console() {
  const [state, setState] = useState<ConsoleState>(startConsole);
  const [connected, setConnected] = useState(false);
  const [ended, setEnded] = useState<string>();
  const [line, setLine] = useState('');
  const socket = useRef<WebSocket>(null);
  const transcript = useRef<HTMLPreElement>(null);

  // The newest output stays in view.
  useEffect(() => {
    const element = transcript.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [state.entries]);
  // Leaving the screen ends the session.
  useEffect(() => () => socket.current?.close(), []);

  const open = async () => {
    if (!stepUpLive() && !(await askStepUp())) return;
    setEnded(undefined);
    setState(startConsole());
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/console`);
    socket.current = ws;
    let opened = false;
    ws.onopen = () => {
      opened = true;
      setConnected(true);
    };
    ws.onmessage = (message) => {
      if (typeof message.data !== 'string') return;
      try {
        setState((before) => foldConsole(before, JSON.parse(message.data)));
      } catch {
        // A frame that is not JSON is not the console's.
      }
    };
    ws.onclose = (event) => {
      if (socket.current !== ws) return;
      socket.current = null;
      setConnected(false);
      setEnded(closedReason(event.code, opened));
    };
  };

  const send = (frame: unknown) => socket.current?.send(JSON.stringify(frame));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = line.trim();
    if (!text || state.busy || state.pending || !connected) return;
    setLine('');
    setState((before) => commandSent(before, text));
    send(commandFrame(text));
  };

  return (
    <MaintenanceFrame tab="console" subtitle="Hermes’s restricted console">
      <p className="help-text">
        The <Term id="hermes-console">console</Term> runs Hermes’s own commands, never a shell, and asks before one that changes something. Opening it is a <Term id="risk-tiers">Tier 2</Term> action and every command is audited. Type <code className="mt-code">help</code> for the commands.
      </p>
      {!connected ? (
        <div className="mt-card">
          {ended && (
            <p className="mt-note" role="status">
              {ended}
            </p>
          )}
          <div className="mt-card__actions">
            <button type="button" className="btn btn--primary btn--sm" onClick={() => void open()}>
              <Icon name="terminal" small />
              Open console
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-console">
          <pre ref={transcript} className="mt-log mt-console__log" role="log" aria-label="Console output" tabIndex={0}>
            {state.entries.map((entry, index) => (
              <span key={index} className={entry.kind === 'error' ? 'mt-error' : undefined} data-kind={entry.kind}>
                {entry.text}
                {'\n'}
              </span>
            ))}
          </pre>
          {state.pending && (
            <div className="banner" data-tone="warning" role="alert">
              <Icon name="alert" />
              <span className="banner__content">{state.pending.message}</span>
              <button type="button" className="btn btn--primary btn--sm" onClick={() => send(confirmFrame(state.pending!.command))}>
                Confirm
              </button>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => send(cancelFrame())}>
                Cancel
              </button>
            </div>
          )}
          <form className="mt-console__form" onSubmit={submit}>
            <label className="mt-console__prompt" htmlFor="mt-console-line">
              {state.prompt}
            </label>
            <input id="mt-console-line" className="input" value={line} onChange={(event) => setLine(event.target.value)} autoCapitalize="off" autoComplete="off" autoCorrect="off" spellCheck={false} disabled={state.status === 'closed'} aria-label="Console command" />
            <button type="submit" className="btn btn--primary btn--sm" disabled={!line.trim() || state.busy || state.pending !== undefined || state.status === 'closed'}>
              Run
            </button>
            {state.busy && (
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => send(cancelFrame())}>
                Stop
              </button>
            )}
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              onClick={() => {
                socket.current?.close();
                toast('Console closed');
              }}
            >
              Close console
            </button>
          </form>
        </div>
      )}
    </MaintenanceFrame>
  );
}
