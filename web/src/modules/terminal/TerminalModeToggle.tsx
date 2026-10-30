import { createPortal } from 'react-dom';
import { Icon } from '../../icons.tsx';
import { useAppNavigate } from '../../shell/navigation.tsx';

/**
 * The chat's toggle between the native conversation and terminal mode (Hermes's TUI on the same session). On a phone it is an icon button in the app bar's slot
 * (`#appbar-slot`). From 600 px there is no app bar, so the caller places it `inline`, in the page header's actions, as a labelled button. The caller shows it only where
 * terminal mode is offered or already open.
 */
export function TerminalModeToggle({ session, pressed, inline = false }: { session: string; pressed: boolean; inline?: boolean }) {
  const navigate = useAppNavigate();
  const slot = typeof document === 'undefined' ? null : document.getElementById('appbar-slot');
  const button = (
    <button
      type="button"
      className={inline ? 'btn btn--secondary btn--sm' : 'btn btn--ghost btn--icon'}
      aria-label={inline ? undefined : 'Terminal mode'}
      aria-pressed={pressed}
      title={pressed ? 'Back to the chat view' : 'Open this chat in Hermes’s terminal'}
      onClick={() => void navigate(pressed ? `/chat/${encodeURIComponent(session)}` : `/chat/${encodeURIComponent(session)}?mode=terminal`)}
    >
      <Icon name="terminal" small={inline} />
      {inline && 'Terminal mode'}
    </button>
  );
  if (inline) return button;
  return slot ? createPortal(button, slot) : null;
}
