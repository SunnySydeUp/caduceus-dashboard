import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { closeLayer, openLayer } from './layers.ts';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';

/** The controls inside `panel` that can take focus now. */
function focusables(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
}

/** Tab wraps inside the layer instead of reaching the browser's own controls. */
function trapTab(event: KeyboardEvent, panel: HTMLElement) {
  if (event.key !== 'Tab') return;
  const controls = focusables(panel);
  if (controls.length === 0) {
    event.preventDefault();
    return;
  }
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export interface LayerProps {
  /** `sheet` rises from the bottom (compact), `dialog` is centred, `drawer` slides in from the start edge. */
  kind: 'sheet' | 'dialog' | 'drawer' | 'palette';
  /** More classes for the layer's root. */
  className?: string;
  /** The panel's classes, e.g. `sheet`, `dialog`, `drawer drawer--start`. */
  panelClassName: string;
  role?: 'dialog' | 'alertdialog';
  /** The panel's accessible name: `labelledBy` (an element id) or `label`. */
  labelledBy?: string;
  label?: string;
  /** A tap on the scrim closes the layer, except for confirmations that must be answered (T2/T3). */
  dismissOnScrim?: boolean;
  /** Escape closes the layer, except for confirmations that must be answered. */
  escapable?: boolean;
  /** A selector inside the panel for the control that takes focus first. */
  initialFocus?: string;
  /** The user asked to close the layer (Escape, back, the scrim); the owner stops rendering it. */
  onClose(): void;
  /** Extra props for the panel element (drag handlers, `data-detent`). */
  panelProps?: Record<string, string | undefined>;
  children: ReactNode;
}

/**
 * A modal layer over the shell: a sheet, dialog or drawer. While it is open the page behind is inert, focus stays
 * inside it (and returns to the invoker on close), and Escape or back closes it (see `layers.ts`). Render it only
 * while it is open.
 */
export function Layer({ kind, className, panelClassName, role = 'dialog', labelledBy, label, dismissOnScrim = true, escapable = true, initialFocus, onClose, panelProps, children }: LayerProps) {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const requestClose = useRef(onClose);
  requestClose.current = onClose;

  useEffect(() => {
    const layer = openLayer({
      kind,
      requestClose: () => requestClose.current(),
      escapable,
      el: root.current ?? undefined,
      panel: panel.current ?? undefined,
      invoker: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    });
    const frame = requestAnimationFrame(() => {
      const target =
        (initialFocus ? panel.current?.querySelector<HTMLElement>(initialFocus) : null) ??
        (panel.current ? focusables(panel.current).find((el) => el.closest('[data-body]')) : undefined) ??
        panel.current?.querySelector<HTMLElement>('[data-close]') ??
        panel.current;
      target?.focus({ preventScroll: true });
    });
    return () => {
      cancelAnimationFrame(frame);
      closeLayer(layer);
    };
    // A layer's focus target and escape rule are fixed for as long as it is open, so this runs once per mount.
  }, []);

  return createPortal(
    <div ref={root} className={`layer layer--${kind}${className ? ` ${className}` : ''}`} onKeyDown={(event) => panel.current && trapTab(event, panel.current)}>
      <div className="layer__scrim" onClick={dismissOnScrim ? onClose : undefined} />
      <section ref={panel} data-panel className={panelClassName} role={role} aria-modal="true" aria-labelledby={labelledBy} aria-label={label} tabIndex={-1} {...panelProps}>
        {children}
      </section>
    </div>,
    document.getElementById('overlays')!,
  );
}
