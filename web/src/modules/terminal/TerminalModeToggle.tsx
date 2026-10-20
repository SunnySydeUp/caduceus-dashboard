import { createPortal } from 'react-dom';
import { Icon } from '../../icons.tsx';
import { useAppNavigate } from '../../shell/navigation.tsx';

/**
 * The chat's app bar toggle between the native conversation and terminal mode (Hermes's TUI on the same session): a button in the app bar's slot. The
 * caller shows it only where terminal mode is offered (a tablet or a computer, `terminalModeOffered`).
 */
export function TerminalModeToggle({ session, pressed }: { session: string; pressed: boolean }) {
  const navigate = useAppNavigate();
  const slot = typeof document === 'undefined' ? null : document.getElementById('appbar-slot');
  if (!slot) return null;
  return createPortal(
    <button
      type="button"
      className="btn btn--ghost btn--icon"
      aria-label="Terminal mode"
      aria-pressed={pressed}
      title={pressed ? 'Back to the chat view' : 'Open this chat in Hermes’s terminal'}
      onClick={() => void navigate(pressed ? `/chat/${encodeURIComponent(session)}` : `/chat/${encodeURIComponent(session)}?mode=terminal`)}
    >
      <Icon name="terminal" />
    </button>,
    slot,
  );
}
