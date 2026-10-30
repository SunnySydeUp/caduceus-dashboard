// The one decision component (M8 #03, #05): a waiting decision as a card, in Today's Needs you and in the Talk tray. The answers are the Inbox's own (`InboxDecision`), so
// every place that lists a decision keeps its tiers and step-up. An answer cannot be undone (Hermes has it), so there is no Undo: the card confirms in place, and a list that
// wants it gone (Needs you) folds it into the agent (`fold.ts`).
import { lazy, Suspense, useRef } from 'react';
import type { InboxItem } from '@caduceus/contracts/inbox';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import type { CrewStateName } from '../crew/crew-state.ts';
import { ageWords } from '../inbox/inbox-model.ts';
import { askedBy } from './today-model.ts';
import './decision-card.css';

/** The answers on a decision are only needed once there is one: a first load of a screen with nothing waiting carries none of their code or styles. */
const InboxDecision = lazy(() => import('../inbox/InboxDecision.tsx').then((m) => ({ default: m.InboxDecision })));

/** A profile's mark, or the empty mark for work that names no profile. */
export function Mark({ profile, size, state }: { profile: string | undefined; size: 'xs' | 'sm' | 'md'; state?: CrewStateName }) {
  return profile === undefined ? <UnassignedSigil size={size} /> : <Sigil name={profile} size={size} state={state} />;
}

/**
 * One decision as a card: who asks and what for, how long ago, then the Inbox's own answers. It is a list item: put it in a `ul`. A list that takes a card away itself
 * says so in `onAnswered`: it is called once the card has confirmed its answer in place, with the card's element (`null` when the card has left the page meanwhile), and the
 * list's change (and the animation it makes) is waited for. `onSending` says when an answer is on its way and when it came back without going, so that the list can keep the
 * card where it is meanwhile. A list that gives neither leaves the card on screen until the Inbox's stream drops it.
 */
export function DecisionCard({ item, now, onSending, onAnswered }: { item: InboxItem; now: number; onSending?(sending: boolean): void; onAnswered?(card: HTMLElement | null): Promise<void> }) {
  const card = useRef<HTMLLIElement>(null);
  const { who, what } = askedBy(item);
  const answered = async (outcome: 'resolved' | 'already-answered') => {
    if (!onAnswered) return;
    // The element is read before the wait: a screen left meanwhile has taken it off the page, and the list then only forgets the card.
    const element = card.current;
    // Hermes may have been answered elsewhere: there is nothing to confirm then, and the card goes at once. The confirmation is the transitions it started (the border settling,
    // the button's words swapping), which have no time at all under reduced motion, and so no wait.
    if (outcome === 'resolved' && element) await Promise.allSettled(element.getAnimations({ subtree: true }).filter((animation) => animation instanceof CSSTransition).map((animation) => animation.finished));
    await onAnswered(element?.isConnected ? element : null);
  };
  return (
    <li ref={card} className="today-card" data-kind={item.kind}>
      <div className="today-card__who">
        <Mark profile={item.profile} size="sm" state="waiting" />
        <span className="today-card__ask">
          <b>{who}</b> {what}
        </span>
        <span className="subtle today-card__age">{ageWords(item.at, now)}</span>
      </div>
      {item.kind === 'notice' && <h3 className="today-card__q">{item.title}</h3>}
      {item.kind !== 'notice' && item.storedSessionId && (
        <p className="subtle today-card__where">
          In <AppLink to={`/chat/${encodeURIComponent(item.storedSessionId)}${item.profile === undefined ? '' : `?${new URLSearchParams({ profile: item.profile })}`}`}>{item.sessionTitle}</AppLink>
        </p>
      )}
      <Suspense fallback={<div className="today-card__pending" aria-hidden="true" />}>
        <InboxDecision item={item} embedded onSending={onSending} onDone={answered} />
      </Suspense>
    </li>
  );
}
