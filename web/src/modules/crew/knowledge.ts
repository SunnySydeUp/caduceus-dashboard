// When a screen may say "nothing" (an idle crew line, "Nothing needs you right now") and when it may not. A quiet answer is only true once what it is made of has answered: the Inbox's
// stream (which carries the decisions and the live runs) and the ready list. Before that the screen is still reading; after the read ladder gives up, or when a read failed, it cannot
// check. Pure: the screens keep the clock (`use-read-ladder.ts`) and pass the ladder's step in.
import type { ReadStage } from '../../read-ladder.ts';

/** The Inbox stream's state (`inbox-feed.ts`). */
export type FeedStatus = 'connecting' | 'live' | 'offline';

/** The ready list: not answered yet, answered, or the last read failed. */
export type ReadyAnswer = 'waiting' | 'answered' | 'failed';

/**
 * What is known of what the crew and Needs you are made of: `known` (every read has answered, so a quiet answer is true), `reading` and `still-reading` (a read is on its way: no
 * claim of any kind, a skeleton, then "Still reading Hermes…"), or `unread` (a read failed or the ladder gave up: it cannot be checked).
 */
export type Knowledge = 'known' | 'reading' | 'still-reading' | 'unread';

export interface KnowledgeInput {
  feed: FeedStatus;
  /** Caduceus can reach Hermes, as the Inbox's stream says once it is live. */
  hermesUp: boolean;
  ready: ReadyAnswer;
  /** The step the wait for the reads has reached on the read ladder. */
  stage: ReadStage;
}

export function knowledge({ feed, hermesUp, ready, stage }: KnowledgeInput): Knowledge {
  if (feed === 'offline' || ready === 'failed') return 'unread';
  if (feed === 'live' && !hermesUp) return 'unread';
  if (feed === 'connecting' || ready === 'waiting') return stage === 'failed' ? 'unread' : stage;
  return 'known';
}

/** A read is still on its way: nothing may be claimed yet, not even that nothing is going on. */
export function isPending(known: Knowledge): known is 'reading' | 'still-reading' {
  return known === 'reading' || known === 'still-reading';
}
