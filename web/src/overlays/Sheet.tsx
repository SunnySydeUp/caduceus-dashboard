import { useId, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { Icon } from '../icons.tsx';
import { useSizeClass } from '../shell/use-size-class.ts';
import { Layer } from './Layer.tsx';

type Detent = 'auto' | 'half' | 'full';

export interface SheetProps {
  title: string;
  /** The heights a bottom sheet snaps between, the first being where it opens. */
  detents?: Detent[];
  footer?: ReactNode;
  /** Role `alertdialog` and no scrim or Escape dismissal for confirmations that must be answered. */
  role?: 'dialog' | 'alertdialog';
  dismissOnScrim?: boolean;
  escapable?: boolean;
  initialFocus?: string;
  /** More classes for the layer's root, so a screen can style its own sheet. */
  className?: string;
  onClose(): void;
  children: ReactNode;
}

/** A tap on the grab handle cycles the detents; a drag down further than this closes the sheet. */
const DISMISS_DRAG_PX = 90;
const EXPAND_DRAG_PX = 40;

/**
 * A titled sheet: a bottom sheet on compact windows (draggable, with detents) and a centred dialog elsewhere. Both
 * have a close button; the drag is only ever an enhancement.
 */
export function Sheet({ title, detents = ['auto'], footer, role, dismissOnScrim, escapable, initialFocus, className, onClose, children }: SheetProps) {
  const compact = useSizeClass() === 'compact';
  const titleId = useId();
  const [detent, setDetent] = useState<Detent>(detents[0]);
  const drag = useRef<{ startY: number; dy: number; moved: boolean }>(null);

  const panelOf = (event: PointerEvent) => event.currentTarget.closest<HTMLElement>('[data-panel]')!;
  const startDrag = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = { startY: event.clientY, dy: 0, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    panelOf(event).classList.add('is-dragging');
  };
  const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    if (!state) return;
    state.dy = event.clientY - state.startY;
    if (Math.abs(state.dy) > 4) state.moved = true;
    panelOf(event).style.transform = `translateY(${Math.max(0, state.dy)}px)`;
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    const state = drag.current;
    drag.current = null;
    if (!state) return;
    const panel = panelOf(event);
    panel.classList.remove('is-dragging');
    panel.style.transform = '';
    if (state.dy > DISMISS_DRAG_PX) onClose();
    else if (state.dy < -EXPAND_DRAG_PX && detents.includes('full')) setDetent('full');
    else if (!state.moved && detents.length > 1) setDetent(detents[(detents.indexOf(detent) + 1) % detents.length]);
  };

  return (
    <Layer
      kind={compact ? 'sheet' : 'dialog'}
      className={className}
      panelClassName={compact ? 'sheet' : 'dialog'}
      panelProps={compact ? { 'data-detent': detent } : undefined}
      role={role}
      labelledBy={titleId}
      dismissOnScrim={dismissOnScrim}
      escapable={escapable}
      initialFocus={initialFocus}
      onClose={onClose}
    >
      {compact && (
        <div className="sheet__grab-zone" aria-hidden="true" onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}>
          <span className="sheet__grab" />
        </div>
      )}
      <header className="overlay__head">
        <h2 id={titleId}>{title}</h2>
        <button type="button" className="btn btn--ghost btn--icon" aria-label="Close" onClick={onClose} data-close>
          <Icon name="x" />
        </button>
      </header>
      <div className="overlay__body" data-body>
        {children}
      </div>
      {footer && <footer className="overlay__foot">{footer}</footer>}
    </Layer>
  );
}
