import { useCallback, useId, useRef, useState } from 'react';
import { useSearch } from '@tanstack/react-router';
import { Icon } from '../../icons.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useAppNavigate } from '../../shell/navigation.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { fetchTiered } from '../../tiered.ts';
import { useFolderChoices } from '../git/folder-choices.ts';
import type { TerminalStatus } from './terminal-connection.ts';
import { showsPhoneNotice, terminalSocketUrl } from './terminal-model.ts';
import { isMac, TerminalPane, TouchKeys, type PaneControls } from './TerminalPane.tsx';
import './terminal.css';

/** Workspace › Terminal: a real shell on the Mac that runs Caduceus, in the folder you pick, behind a passkey confirmation. */
export function Terminal() {
  const search = useSearch({ strict: false }) as { folder?: unknown };
  const navigate = useAppNavigate();
  const { effective } = useProfileScope();
  const profile = effective?.name;
  const size = useSizeClass();
  const choices = useFolderChoices();
  const folder = typeof search.folder === 'string' && search.folder !== '' ? search.folder : '';
  const pickerId = useId();
  const [openAnyway, setOpenAnyway] = useState(false);
  const [status, setStatus] = useState<TerminalStatus>({ state: 'connecting' });
  const [cwd, setCwd] = useState<string>();
  const [ended, setEnded] = useState<string>();
  const controls = useRef<PaneControls>(undefined);
  const [busy, setBusy] = useState(false);

  const onStatus = useCallback((next: TerminalStatus, at: string | undefined) => {
    setStatus(next);
    setCwd(at);
  }, []);

  const restart = async () => {
    if (!cwd) return;
    setBusy(true);
    try {
      const result = await fetchTiered({
        method: 'POST',
        path: '/_caduceus/api/terminal/restart',
        body: { cwd },
        confirm: { title: 'Restart the shell?', text: `The shell in ${cwd} is stopped and a new one starts there. Anything running in it is stopped, and what it printed is cleared.`, object: cwd, confirmLabel: 'Restart', recoverability: { undoable: false, note: 'What was running in the shell is stopped.' } },
      });
      if (result.kind === 'refused') toast(result.refusal.message, { tone: 'danger' });
      else if (result.kind === 'sent' && !result.response.ok) toast('Caduceus could not restart the shell.', { tone: 'danger' });
      else controls.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      toast((await controls.current?.copy()) ? 'Copied the selection' : 'Select some text in the terminal first', { tone: 'info' });
    } catch {
      toast('The browser did not allow copying.', { tone: 'danger' });
    }
  };
  const copyLast = async () => {
    try {
      toast((await controls.current?.copyLastOutput()) ? 'Copied the last output' : 'There is no output after your last command yet', { tone: 'info' });
    } catch {
      toast('The browser did not allow copying.', { tone: 'danger' });
    }
  };
  const paste = async () => {
    try {
      await controls.current?.paste();
      controls.current?.focus();
    } catch {
      toast('The browser did not allow pasting. Use its paste shortcut in the terminal.', { tone: 'danger' });
    }
  };

  const options = [{ path: '', label: 'Home folder' }, ...(choices ?? []).filter((choice) => choice.path !== '')];
  const phone = showsPhoneNotice(size, openAnyway);
  const badge = status.state === 'live' && ended === undefined ? 'online' : status.state === 'reconnecting' || status.state === 'connecting' ? 'reconnecting' : 'offline';
  const badgeLabel = ended !== undefined ? 'Shell ended' : status.state === 'live' ? 'Connected' : status.state === 'closed' ? 'Not connected' : status.state === 'reconnecting' ? 'Reconnecting' : 'Connecting';

  return (
    <div className="tm">
      <PageHeader overline="Workspace" title="Terminal" subtitle={<>A real <Term id="terminal-shell">shell</Term> on the Mac that runs Caduceus, in the folder you pick.</>} />
      {phone ? (
        <div className="empty">
          <span className="empty__icon"><Icon name="terminal" /></span>
          <p>The terminal is not designed for small screens: a shell needs a wide window and a real keyboard. Use it on a tablet or a computer.</p>
          <p className="subtle">If you open it anyway, it still needs your passkey, and you get a row of extra keys (Esc, Tab, arrows, Ctrl-C).</p>
          <button type="button" className="btn btn--secondary" onClick={() => setOpenAnyway(true)}>Open anyway</button>
        </div>
      ) : (
        <>
          <div className="tm-bar">
            <div className="field tm-folder">
              <label className="field__label" htmlFor={pickerId}>Folder</label>
              <select id={pickerId} className="input" value={folder} onChange={(event) => void navigate(`/workspace/terminal${event.target.value ? `?folder=${encodeURIComponent(event.target.value)}` : ''}`, { replace: true })}>
                {!options.some((choice) => choice.path === folder) && <option value={folder}>{folder}</option>}
                {options.map((choice) => <option key={choice.path} value={choice.path}>{choice.label}</option>)}
              </select>
            </div>
            <div className="tm-actions">
              <StatusBadge state={badge} label={badgeLabel} />
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => void copy()}><Icon name="copy" />Copy selection</button>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => void copyLast()}><Icon name="copy" />Copy last output</button>
              <button type="button" className="btn btn--secondary btn--sm" onClick={() => void paste()}><Icon name="clip" />Paste</button>
              {status.state === 'closed' && <button type="button" className="btn btn--secondary btn--sm" onClick={() => controls.current?.reconnect()}><Icon name="refresh" />Reconnect</button>}
              <WriteButton type="button" className="btn btn--danger btn--sm" disabled={busy || cwd === undefined} onClick={() => void restart()}><Icon name="refresh" />Restart…</WriteButton>
            </div>
          </div>
          {cwd !== undefined && <p className="tm-cwd mono" aria-label="Folder of this shell">{cwd}</p>}
          {status.state === 'closed' && <div className="banner" data-tone="warning" role="alert"><Icon name="alert" /><span className="banner__content">{status.reason}</span></div>}
          {ended !== undefined && <div className="banner" data-tone="neutral" role="status"><Icon name="info" /><span className="banner__content">{ended}</span></div>}
          <TerminalPane identity={`${profile ?? ''}\0${folder}`} url={({ cols, rows }) => terminalSocketUrl({ origin: location.origin, cwd: folder, profile, cols, rows })} escapeTargetId="terminal-escape" onStatus={onStatus} onEnded={setEnded} onNotice={() => undefined} controls={controls} />
          <TouchKeys controls={controls} />
          <p id="terminal-escape" tabIndex={-1} className="subtle tm-hint">
            {isMac ? '⌘C and ⌘V copy and paste, ⇧⌘L copies the last output.' : 'Ctrl-Shift-C and Ctrl-Shift-V copy and paste, Ctrl-Shift-L copies the last output.'} The terminal keeps the keyboard while it is focused: press Shift-Esc to leave it and use Caduceus’s own shortcuts again.
          </p>
        </>
      )}
    </div>
  );
}
