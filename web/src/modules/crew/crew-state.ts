// What each agent of the crew is doing, for the Desk's sigils and lists. Pure: it reads what Hermes and Caduceus already say (the Inbox's items and its live runs,
// and what is ready for review) and stores nothing.
import type { LiveRun, InboxApproval, InboxClarify, InboxItem } from '@caduceus/contracts/inbox';
import type { ReadyItem } from '@caduceus/contracts/today';
import { STILL_READING_WORDS } from '../../read-ladder.ts';
import { isPending, type Knowledge } from './knowledge.ts';

/** How an agent stands: a person is needed, it is working, it finished something not yet looked at, something failed, or nothing is going on. */
export type CrewStateName = 'waiting' | 'working' | 'done' | 'blocked' | 'idle';

/** The words for each state: what a screen says next to a sigil, so the state is never shown by colour alone. */
export const crewStateLabel: Record<CrewStateName, string> = {
  waiting: 'Waiting for you',
  working: 'Working',
  done: 'Finished',
  blocked: 'Blocked',
  idle: 'Idle',
};

/** What a screen says in place of "Nothing going on" when a read the crew is made of has failed: the agent may well be busy, and nothing here can tell. */
export const CANNOT_CHECK = 'Can’t check';

/** One agent of the crew: how it stands, one short sentence of what it is doing or asking, and since when (ms since the epoch; `undefined` when idle). */
export interface CrewMember {
  profile: string;
  state: CrewStateName;
  line: string;
  since: number | undefined;
  /** Nothing is known of this agent because a read the crew is made of failed: it is drawn at rest, but neither its words nor its line claim that it is. */
  blind?: true;
  /** A read the crew is made of is still on its way, so nothing is known of this agent yet: drawn at rest, with no line (a skeleton) and then "Still reading Hermes…", and never "Idle" or "Nothing going on". */
  pending?: 'reading' | 'still-reading';
}

/** The words that stand beside a member's sigil: its state's, or that its state is not known yet (still being read) or cannot be checked (its line says why). */
export function crewStateWords({ state, blind, pending }: Pick<CrewMember, 'state' | 'blind' | 'pending'>): string {
  if (pending) return pending === 'still-reading' ? STILL_READING_WORDS : 'Reading…';
  return blind ? 'State unknown' : crewStateLabel[state];
}

/** What the crew is read from. All of it is already on the page (the Inbox's feed and the ready list); none of it is kept here. */
export interface CrewInput {
  /** The agents, in the order they are listed. The result has one member for each. */
  profiles: readonly string[];
  /** The Inbox's items: approvals and questions (waiting), and failures (blocked). One that names no profile, or a profile not listed, is nobody's. */
  items: readonly InboxItem[];
  /** The live runs, as `session.active_list` reports them. */
  running: readonly LiveRun[];
  /** What is ready for review (finished and not opened since), newest first: Today's list. Opening an item anywhere takes it off, and with it the agent's Finished state. */
  ready: readonly ReadyItem[];
  /** What is known of the reads the lists above come from (`knowledge.ts`); `known` when omitted. Not `known`: what they hold may be missing or out of date, so an agent they say nothing about is neither idle nor claimed to be. */
  knowledge?: Knowledge;
}

/** A line is one short sentence: longer text is cut with an ellipsis. */
const LINE_MAX = 64;
const shorten = (text: string): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= LINE_MAX ? flat : `${flat.slice(0, LINE_MAX - 1).trimEnd()}…`;
};

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

/** What one item that needs a decision says: what the tool wants to run, or the question. */
function askedBy(item: InboxApproval | InboxClarify): string {
  if (item.kind === 'approval') return shorten(`Wants to run ${item.command || item.description || 'a tool'}`);
  const [first, ...rest] = item.questions;
  const question = shorten(first?.question ?? 'A question');
  return rest.length === 0 ? question : `${question} (and ${plural(rest.length, 'more question', 'more questions')})`;
}

type Waiting = { at: number; line: string };

/** `line` and the count of the others: "Working on “Docs” · 2 more running". */
const withOthers = (line: string, others: number, word: string): string => (others === 0 ? line : `${line} · ${others} more ${word}`);

/**
 * One member for each profile. Precedence, when more than one is true of a profile: waiting, working, blocked, done, idle.
 * Waiting and working report what has gone on longest (the oldest request, the oldest run); blocked and done report the newest failure and the newest finished work. When
 * the lists are not `known` an agent they say nothing about is not idle: `pending` while a read is on its way, `blind` when one failed. What is known (a request, a run) stays true, and nothing is claimed beyond it.
 */
export function deriveCrew({ profiles, items, running, ready, knowledge = 'known' }: CrewInput): CrewMember[] {
  return profiles.map((profile): CrewMember => {
    const mine = items.filter((item) => item.profile === profile);
    const waits: Waiting[] = [
      ...mine.flatMap((item) => (item.kind === 'approval' || item.kind === 'clarify' ? [{ at: item.at, line: askedBy(item) }] : [])),
      ...running.filter((live) => live.profile === profile && live.status === 'waiting').map((live) => ({ at: live.since, line: shorten(`Waiting for you in “${live.title}”`) })),
    ].sort((a, b) => a.at - b.at);
    if (waits[0]) return { profile, state: 'waiting', line: withOthers(waits[0].line, waits.length - 1, 'waiting'), since: waits[0].at };

    const going = running.filter((live) => live.profile === profile).sort((a, b) => a.since - b.since);
    if (going[0]) return { profile, state: 'working', line: withOthers(going[0].title ? shorten(`Working on “${going[0].title}”`) : 'Working', going.length - 1, 'running'), since: going[0].since };

    const failed = mine.filter((item) => item.group === 'failed').sort((a, b) => b.at - a.at);
    const [newestFailure] = failed;
    if (newestFailure) return { profile, state: 'blocked', line: withOthers(newestFailure.kind === 'notice' ? shorten(newestFailure.title) : 'Something failed', failed.length - 1, 'failed'), since: newestFailure.at };

    const finished = ready.filter((item) => item.profile === profile);
    const [newest] = finished;
    if (newest) return { profile, state: 'done', line: withOthers(shorten(`Finished “${newest.title}”`), finished.length - 1, 'finished'), since: newest.at };

    // An agent the lists say nothing about is idle only if the lists have answered: until then it is being read, and if they could not be read nothing is known of it.
    if (isPending(knowledge)) return { profile, state: 'idle', line: knowledge === 'still-reading' ? STILL_READING_WORDS : '', since: undefined, pending: knowledge };
    return knowledge === 'unread' ? { profile, state: 'idle', line: CANNOT_CHECK, since: undefined, blind: true } : { profile, state: 'idle', line: 'Nothing going on', since: undefined };
  });
}
