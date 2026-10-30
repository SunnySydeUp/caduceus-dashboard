import { useCallback, useRef, useState } from 'react';
import { Icon } from '../../icons.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import type { TerminalStatus } from './terminal-connection.ts';
import { ptySocketUrl } from './terminal-model.ts';
import { isMac, TerminalPane, TouchKeys, type PaneControls } from './TerminalPane.tsx';
import { TerminalModeToggle } from './TerminalModeToggle.tsx';
import { useSizeClass } from '../../shell/use-size-class.ts';
import './terminal.css';

/**
 * The chat's terminal mode (M1 #19): Hermes's own TUI, the same program as `hermes --tui`, on the session the chat is showing, in an xterm pane over Hermes's PTY
 * relayed by Caduceus. The session is Hermes's, so a message sent here is in the native view after a refresh, and the other way round.
 */
export function TerminalMode({ profile, storedId }: { profile: string; storedId: string }) {
  const [status, setStatus] = useState<TerminalStatus>({ state: 'connecting' });
  const [ended, setEnded] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const controls = useRef<PaneControls>(undefined);
  const compact = useSizeClass() === 'compact';

  const onStatus = useCallback((next: TerminalStatus) => setStatus(next), []);
  const act = async (run: () => Promise<boolean | undefined>, done: string, nothing: string) => {
    try {
      toast((await run()) ? done : nothing, { tone: 'info' });
    } catch {
      toast('The browser did not allow that. Use its own copy and paste keys in the terminal.', { tone: 'danger' });
    }
  };

  const badge = status.state === 'live' && ended === undefined ? 'online' : status.state === 'closed' || ended !== undefined ? 'offline' : 'reconnecting';
  const badgeLabel = ended !== undefined || (status.state === 'closed' && status.reason === 'The terminal ended.') ? 'Terminal ended' : status.state === 'live' ? 'Connected' : status.state === 'closed' ? 'Not connected' : status.state === 'reconnecting' ? 'Reconnecting' : 'Connecting';

  return (
    <section className="chat__conversation tm" aria-label="Conversation in terminal mode">
      <PageHeader
        overline="Chat"
        title="Terminal"
        subtitle={<>Hermes’s own <Term id="terminal-mode">terminal</Term> on this chat’s session.</>}
        actions={
          compact ? (
            <AppLink className="btn btn--secondary btn--sm" to={`/chat/${encodeURIComponent(storedId)}`}>
              <Icon name="chat" small />
              Back to chat view
            </AppLink>
          ) : (
            <TerminalModeToggle session={storedId} pressed inline />
          )
        }
      />
      {compact && <TerminalModeToggle session={storedId} pressed />}
      <div className="tm-bar tm-bar--mode">
        <div className="tm-actions">
          <StatusBadge state={badge} label={badgeLabel} />
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void act(() => controls.current?.copy() ?? Promise.resolve(false), 'Copied the selection', 'Select some text in the terminal first')}><Icon name="copy" />Copy selection</button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void act(() => controls.current?.copyLastOutput() ?? Promise.resolve(false), 'Copied the last output', 'There is no output after your last message yet')}><Icon name="copy" />Copy last output</button>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void controls.current?.paste().then(() => controls.current?.focus(), () => toast('The browser did not allow pasting. Use its paste shortcut in the terminal.', { tone: 'danger' }))}><Icon name="clip" />Paste</button>
          {status.state === 'closed' && <button type="button" className="btn btn--secondary btn--sm" onClick={() => controls.current?.reconnect()}><Icon name="refresh" />Reconnect</button>}
        </div>
      </div>
      {status.state === 'closed' && <div className="banner" data-tone="warning" role="alert"><Icon name="alert" /><span className="banner__content">{status.reason}</span></div>}
      {notice !== undefined && <div className="banner" data-tone="info" role="status"><Icon name="info" /><span className="banner__content">{notice}</span></div>}
      {ended !== undefined && <div className="banner" data-tone="neutral" role="status"><Icon name="info" /><span className="banner__content">{ended}</span></div>}
      <TerminalPane
        identity={`${profile}\0${storedId}`}
        url={({ cols, rows }) => ptySocketUrl({ origin: location.origin, session: storedId, profile, cols, rows })}
        escapeTargetId="terminal-mode-escape"
        onStatus={onStatus}
        onEnded={setEnded}
        onNotice={setNotice}
        controls={controls}
      />
      <TouchKeys controls={controls} />
      <p id="terminal-mode-escape" tabIndex={-1} className="subtle tm-hint">
        {isMac ? '⌘C and ⌘V copy and paste, ⇧⌘L copies the last output.' : 'Ctrl-Shift-C and Ctrl-Shift-V copy and paste, Ctrl-Shift-L copies the last output.'} The terminal keeps the keyboard while it is focused: press Shift-Esc to leave it and use Caduceus’s own shortcuts again. Opening it needed your passkey; a message sent here is in the chat view after a refresh.
      </p>
    </section>
  );
}
