// A small anchored popover for the Desk (M8 #09): a trigger button and a panel of controls that opens beside it. The trigger carries `aria-expanded` and
// `aria-controls`; Escape closes the panel and gives the focus back to the trigger (it asks before any sheet under it does, see `openDismissible`);
// a press outside closes it; so does Tab leaving it. The panel is always in the page, hidden while closed, so `aria-controls` always names something.
// The trigger is the caller's own button: spread `triggerProps` on it. `onOpenChange` tells the screen whether the panel is open, which is how a
// screen makes the list behind a menu inert while it is.
import { useCallback, useEffect, useId, useRef, useState, type FocusEvent, type ReactNode, type Ref } from 'react';
import { openDismissible } from '../overlays/layers.ts';
import './popover-menu.css';

export interface PopoverTriggerProps {
  ref: Ref<HTMLButtonElement>;
  type: 'button';
  'aria-expanded': boolean;
  'aria-controls': string;
  onClick(): void;
}

export interface PopoverMenuProps {
  /** What the panel is called to a screen reader. */
  label: string;
  /** Draws the trigger. Spread `props` on the button. */
  trigger(props: PopoverTriggerProps, state: { open: boolean }): ReactNode;
  /** The panel's controls. `close` closes the panel; `restoreFocus` puts the focus back on the trigger as well. */
  children(api: { close(restoreFocus?: boolean): void }): ReactNode;
  /** Opens below the trigger (the default) or above it. */
  placement?: 'bottom' | 'top';
  /** `start` and `end` line the panel's edge up with the trigger's; `fill` spans the whole positioned parent (the anchor is then the parent, not the trigger). */
  align?: 'start' | 'end' | 'fill';
  /** More classes for the panel. */
  className?: string;
  onOpenChange?(open: boolean): void;
}

/**
 * Makes the rest of the page inert while the popover is open, as a modal menu does: every sibling along the way from the panel (and its trigger) up to the
 * document's body is inert, except what is already inert. Nothing behind the panel can take focus or be reached, and assistive technology and the target-size
 * check no longer see the controls the panel covers. Returns what undoes it.
 */
function isolate(panel: HTMLElement, trigger: HTMLElement): () => void {
  const keep = new Set<Node>();
  for (const start of [panel, trigger]) for (let node: Node | null = start; node && node !== document.body; node = node.parentNode) keep.add(node);
  const changed: HTMLElement[] = [];
  for (const node of keep) {
    for (const sibling of node.parentNode?.children ?? []) {
      if (keep.has(sibling) || !(sibling instanceof HTMLElement) || sibling.inert) continue;
      sibling.inert = true;
      changed.push(sibling);
    }
  }
  return () => {
    for (const element of changed) element.inert = false;
  };
}

/** The least height a downward panel is held to (a short menu still shows two rows), and the air kept below it. */
const FIT_LEAST_PX = 128;
const FIT_MARGIN_PX = 8;

export function PopoverMenu({ label, trigger, children, placement = 'bottom', align = 'start', className, onOpenChange }: PopoverMenuProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const report = useRef(onOpenChange);
  report.current = onOpenChange;

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) button.current?.focus();
  }, []);

  useEffect(() => {
    report.current?.(open);
    if (!open || !panel.current || !button.current) return;
    const release = isolate(panel.current, button.current);
    panel.current.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex="0"]')?.focus();
    if (placement === 'bottom') {
      // A panel that opens downward never runs under the tab bar or off the window: it takes the room it has and scrolls inside it. Measured once the focus has moved (it can scroll the page).
      const bar = parseFloat(getComputedStyle(document.querySelector('.app__body') ?? document.body).paddingBlockEnd) || 0;
      const floor = window.innerHeight - bar;
      panel.current.style.setProperty('--pop-fit', `${Math.max(FIT_LEAST_PX, Math.floor(floor - panel.current.getBoundingClientRect().top - FIT_MARGIN_PX))}px`);
    }
    const forget = openDismissible(() => close(true));
    const outside = (event: PointerEvent) => {
      const target = event.target instanceof Node ? event.target : null;
      if (target && (panel.current?.contains(target) || button.current?.contains(target))) return;
      close();
    };
    document.addEventListener('pointerdown', outside, true);
    return () => {
      forget();
      release();
      document.removeEventListener('pointerdown', outside, true);
    };
  }, [open, close, placement]);

  const leaving = (event: FocusEvent) => {
    const next = event.relatedTarget;
    if (next instanceof Node && !panel.current?.contains(next) && !button.current?.contains(next)) close();
  };

  const props: PopoverTriggerProps = { ref: button, type: 'button', 'aria-expanded': open, 'aria-controls': id, onClick: () => setOpen((was) => !was) };
  return (
    <span className="pop" data-align={align}>
      {trigger(props, { open })}
      <div ref={panel} id={id} role="group" aria-label={label} className={`pop__panel${className ? ` ${className}` : ''}`} data-placement={placement} data-align={align} hidden={!open} onBlur={leaving}>
        {children({ close })}
      </div>
    </span>
  );
}
