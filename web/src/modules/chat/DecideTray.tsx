// The decide-anywhere tray (M8 #05): above a Talk thread's composer, a pill says how many decisions wait on the owner outside the open session (in other agents' threads, and in the same agent's other sessions), with their sigils. Opening it
// shows one of them in a sheet, as the same decision card Today lists (`DecisionCard`), with "Next (n)" for the others: all of a decision's buttons are in view at once, over the transcript and the composer
// instead of a scroll area inside the page's. An answer given here goes through the Inbox's own code: its tiers, undo and step-up. The list is the Inbox's live stream; the tray keeps nothing,
// follows it as it changes, and goes when the last decision is answered.
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { useNow } from '../../shell/use-now.ts';
import { useInbox } from '../inbox/inbox-feed.ts';
import { DecisionCard, Mark } from '../today/DecisionCard.tsx';
import { trayStep, trayView } from './decide-tray.ts';
import './decide-tray.css';

/** How often the "asked 5 min ago" on the open card is read again. */
const CLOCK_MS = 30_000;

/** `composer` is where the keyboard goes back to when the last decision is answered from the tray and takes the focus with it. */
export function DecideTray({ storedId, composer }: { storedId: string | undefined; composer?: RefObject<HTMLElement | null> }) {
  const feed = useInbox();
  const view = useMemo(() => trayView({ items: feed.items, storedId }), [feed.items, storedId]);
  const [open, setOpen] = useState(false);
  /** The decision the owner is on; it stays while the list changes around it. */
  const [currentId, setCurrentId] = useState<string>();
  const sheetId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLDivElement>(null);
  const now = useNow(open && !view.hidden, CLOCK_MS);
  const step = trayStep(view.items, currentId);

  // The sheet closes itself when nothing else waits, so that the tray comes back closed the next time something does.
  useEffect(() => {
    if (view.hidden) setOpen(false);
  }, [view.hidden]);

  // An answer takes its card away, and the focus that was on the card with it: while the sheet is open the next decision takes the focus; with it closed, the pill does, or the message box when no decision is left.
  const waiting = view.items.length;
  const before = useRef(waiting);
  useEffect(() => {
    const was = before.current;
    before.current = waiting;
    if (waiting >= was || document.activeElement !== document.body) return;
    if (waiting === 0) composer?.current?.querySelector<HTMLElement>('textarea')?.focus();
    else if (open) card.current?.focus();
    else button.current?.focus();
  }, [waiting, composer, open]);

  if (view.hidden) return null;
  return (
    <div className="talk-tray">
      <button ref={button} type="button" className="talk-tray__btn" aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? sheetId : undefined} onClick={() => setOpen(true)}>
        <span className="talk-tray__faces">
          {view.faces.map((face) => (
            <Mark key={face ?? 'unassigned'} profile={face} size="xs" />
          ))}
        </span>
        <span className="talk-tray__label">{view.label}</span>
        <Icon name="chev-u" small className="talk-tray__chev" />
      </button>
      {open && step.shown && (
        <Sheet
          title={step.total === 1 ? 'Waiting for you' : `Waiting for you · ${step.position} of ${step.total}`}
          className="talk-tray__sheet"
          detents={['auto', 'full']}
          onClose={() => {
            setOpen(false);
            button.current?.focus();
          }}
          footer={
            step.nextId !== undefined && (
              <button type="button" className="btn btn--secondary" onClick={() => setCurrentId(step.nextId)}>
                {step.nextLabel}
              </button>
            )
          }
        >
          <div ref={card} id={sheetId} className="talk-tray__card" tabIndex={-1}>
            <ul className="talk-tray__cards">
              <DecisionCard key={step.shown.id} item={step.shown} now={now} />
            </ul>
          </div>
        </Sheet>
      )}
    </div>
  );
}
