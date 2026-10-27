// The one decision component (M8 #03, #05): a waiting decision as a card, in Today's Needs you and in the Talk tray. The answers are the Inbox's own (`InboxDecision`), so
// every place that lists a decision keeps its tiers, undo and step-up.
import { lazy, Suspense } from 'react';
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

/** One decision as a card: who asks and what for, how long ago, then the Inbox's own answers. It is a list item: put it in a `ul`. */
export function DecisionCard({ item, now }: { item: InboxItem; now: number }) {
  const { who, what } = askedBy(item);
  return (
    <li className="today-card" data-kind={item.kind}>
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
        <InboxDecision item={item} embedded />
      </Suspense>
    </li>
  );
}
