// The decide-anywhere tray (M8 #05): above a Talk thread's composer, a pill says how many decisions wait on the owner outside the open session (in other agents' threads, and in the same agent's other sessions), with their sigils. Opening it
// lists them as the same decision cards Today lists (`DecisionCard`), so an answer given here goes through the Inbox's own code: its tiers, undo and step-up. The list is the
// Inbox's live stream; the tray keeps nothing, follows it as it changes, and goes when the last decision is answered.
import { useEffect, useId, useMemo, useRef, useState, type RefObject } from 'react';
import { Icon } from '../../icons.tsx';
import { useNow } from '../../shell/use-now.ts';
import { useInbox } from '../inbox/inbox-feed.ts';
import { DecisionCard, Mark } from '../today/DecisionCard.tsx';
import { trayView } from './decide-tray.ts';
import './decide-tray.css';

/** How often the "asked 5 min ago" on the open cards is read again. */
const CLOCK_MS = 30_000;

/** `composer` is where the keyboard goes back to when the last decision is answered from the tray and takes the focus with it. */
export function DecideTray({ storedId, composer }: { storedId: string | undefined; composer?: RefObject<HTMLElement | null> }) {
  const feed = useInbox();
  const view = useMemo(() => trayView({ items: feed.items, storedId }), [feed.items, storedId]);
  const [open, setOpen] = useState(false);
  const listId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const now = useNow(open && !view.hidden, CLOCK_MS);

  // The tray closes itself when nothing else waits, so that it comes back closed the next time something does.
  useEffect(() => {
    if (view.hidden) setOpen(false);
  }, [view.hidden]);

  // Opening the list brings it above the composer, which sits over the bottom of the page (the list's `scroll-margin` is the composer's height).
  useEffect(() => {
    if (open) list.current?.scrollIntoView({ block: 'nearest' });
  }, [open]);

  // An answer takes its card away, and the focus that was on the card with it: give it to the pill, or to the message box when no decision is left.
  const waiting = view.items.length;
  const before = useRef(waiting);
  useEffect(() => {
    const was = before.current;
    before.current = waiting;
    if (waiting >= was || document.activeElement !== document.body) return;
    if (waiting === 0) composer?.current?.querySelector<HTMLElement>('textarea')?.focus();
    else button.current?.focus();
  }, [waiting, composer]);

  if (view.hidden) return null;
  return (
    <div className="talk-tray" data-open={open ? '' : undefined}>
      <button ref={button} type="button" className="talk-tray__btn" aria-expanded={open} aria-controls={open ? listId : undefined} onClick={() => setOpen((was) => !was)}>
        <span className="talk-tray__faces">
          {view.faces.map((face) => (
            <Mark key={face ?? 'unassigned'} profile={face} size="xs" />
          ))}
        </span>
        <span className="talk-tray__label">{view.label}</span>
        <Icon name="chev-u" small className="talk-tray__chev" />
      </button>
      {open && (
        <div ref={list} id={listId} className="talk-tray__list" role="group" aria-label="Decisions waiting in other threads">
          <ul className="talk-tray__cards">
            {view.items.map((item) => (
              <DecisionCard key={item.id} item={item} now={now} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
