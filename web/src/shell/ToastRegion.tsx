import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from '../icons.tsx';
import { dismissToast, useToasts, type Toast } from './toasts.ts';

const GLYPH: Record<NonNullable<Toast['tone']> | 'accent', IconName> = { success: 'succeeded', danger: 'failed', info: 'info', warning: 'alert', accent: 'refresh' };

const UNDO_MS = 6_000;
const DEFAULT_MS = 5_000;

function ToastCard({ toast }: { toast: Toast }) {
  const tone = toast.undo ? 'accent' : (toast.tone ?? 'success');
  const [paused, setPaused] = useState(false);
  const timeout = toast.timeout ?? (toast.tone === 'danger' ? 0 : toast.undo ? UNDO_MS : DEFAULT_MS);

  useEffect(() => {
    if (!timeout || paused) return;
    const timer = setTimeout(() => dismissToast(toast.id), timeout);
    return () => clearTimeout(timer);
  }, [timeout, paused, toast.id]);

  return (
    <div
      className="toast"
      data-tone={tone}
      role={toast.tone === 'danger' ? 'alert' : undefined}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <Icon name={GLYPH[tone]} />
      <div className="toast__text">
        <span>{toast.message}</span>
        {toast.detail && <small className="mono">{toast.detail}</small>}
      </div>
      <div className="toast__actions">
        {toast.undo && (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => {
              dismissToast(toast.id);
              toast.undo?.();
            }}
          >
            Undo
          </button>
        )}
        {toast.action && (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => {
              dismissToast(toast.id);
              toast.action?.onClick();
            }}
          >
            {toast.action.label}
          </button>
        )}
        <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label="Dismiss notification" onClick={() => dismissToast(toast.id)}>
          <Icon name="x" small />
        </button>
      </div>
    </div>
  );
}

/** The toasts, in the page's one polite live region (`#toasts`, which exists before any toast so it announces them). */
export function ToastRegion() {
  const toasts = useToasts();
  return createPortal(
    toasts.map((t) => <ToastCard key={t.id} toast={t} />),
    document.getElementById('toasts')!,
  );
}
