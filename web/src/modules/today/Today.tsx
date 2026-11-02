// Today (M8 #03): what needs the owner, what is ready, the day's routines and what happened while they were away. Each block loads on its own and fails on its own
// (`TodayBlocks.tsx`). The decisions come from the Inbox's live stream and keep its tiers, undo and step-up; the rest from Hermes's cron, the activity feed, the
// crew and Caduceus's review state (`today-data.ts`).
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { CAUSE } from '../../failure-words.ts';
import { Icon } from '../../icons.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { RollingNumber } from '../../shell/RollingNumber.tsx';
import { deskNavigation } from '../../shell/nav-order.ts';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { useRegistry } from '../../shell/registry-context.tsx';
import { useNow } from '../../shell/use-now.ts';
import { feedBlock, mapBlock, useBlock, type Block } from '../../use-block.ts';
import { isReading } from '../../read-ladder.ts';
import { useReadLadder } from '../../use-read-ladder.ts';
import { usePainted, useSettled } from '../../use-settled.ts';
import { knowledge, isPending, type ReadyAnswer } from '../crew/knowledge.ts';
import { useCrew } from '../crew/use-crew.ts';
import { inboxFeed, useInbox } from '../inbox/inbox-feed.ts';
import { useJobs } from '../work/schedules-data.ts';
import type { Job } from '../work/schedules-model.ts';
import { readReady, recordVisit } from './today-data.ts';
import { markOpened } from './ready-feed.ts';
import { useVisibleDecisions } from './fold-store.ts';
import type { InboxItem } from '@caduceus/contracts/inbox';
import { awayView, decisionsFor, emptyTarget, readyRows, scheduleDay, type AwayView, type EmptyBlock } from './today-model.ts';
import { AwayBlock, CrewBlock, LookBlock, NeedsYouBlock, ReadyBlock, ScheduleBlock, TodayVoiceContext, TodayVoiceLine } from './TodayBlocks.tsx';
import { VoiceStore } from './today-voice.ts';
import './today.css';

/** The first-run card (the setup guide's offer, and installing the app) is below the first screen and Today paints without it: its code is fetched once the page has settled. */
const FirstRunCard = lazy(() => import('./FirstRunCard.tsx').then((m) => ({ default: m.FirstRunCard })));
/** So is the reminders calendar: it is last in its column, so its arrival moves nothing above it, and its code and its read wait for the page to settle. */
const RemindersBlock = lazy(() => import('./RemindersBlock.tsx').then((m) => ({ default: m.RemindersBlock })));

/** How often the times on the screen ("6 min ago", the Now marker) are read again. */
const CLOCK_MS = 30_000;

export function Today() {
  const feed = useInbox();
  const { hermes, unavailable, reload: reloadProfiles } = useProfileScope();
  const registry = useRegistry();
  const crew = useCrew();
  const now = useNow(true, CLOCK_MS);
  const settled = useSettled();
  const painted = usePainted();

  // What is ready is Hermes's finished work less what was opened: it is read again when Hermes says a run or a session moved, when the Inbox's stream says a run
  // finished or a decision went (an approved task is done), and when the tab comes back. No timer: Hermes has no event for a task that is done. It is asked for at once,
  // without waiting for the gateway to say Hermes is up: Caduceus answers for itself, and says so in the block if Hermes does not.
  const ready = useBlock(readReady, 'ready', true, ['sessions.changed']);
  // The visit is only recorded here (the away list below the first screen shows what it says): after the first paint, so that its request is not in front of it.
  const visit = useBlock(recordVisit, 'visit', painted);
  // The schedule and the away list read Hermes's cron, which keeps Hermes busy for most of a second on a first load (the blueprints). The first screen is waiting for the
  // review state above, and Hermes answers one thing at a time, so they are asked for once that has answered (or failed): the blocks hold their room meanwhile.
  const jobsAsked = ready.state.status !== 'loading';
  const jobs = useJobs(jobsAsked);
  // The stream's first answer (its items and its last finished run, arriving after the page asked) is not news: the read above already reflects it. Only a change after that is.
  const seen = useRef<{ finished: number | undefined; items: number }>(undefined);
  const finished = feed.activity[0]?.seq;
  useEffect(() => {
    if (feed.status !== 'live') return;
    const before = seen.current;
    seen.current = { finished, items: feed.items.length };
    if (before && (before.finished !== finished || before.items !== feed.items.length)) ready.reload();
  }, [feed.status, finished, feed.items.length, ready.reload]);
  useEffect(() => {
    const back = () => document.visibilityState === 'visible' && ready.reload();
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [ready.reload]);

  const decisions = useMemo(() => decisionsFor(feed.items), [feed.items]);
  const stream = feedBlock(feed, decisions, () => inboxFeed().retry());
  // "Nothing needs you right now" is true only once what it is made of has answered: the Inbox's stream (the decisions) and the review state above (a finished task waits on the owner
  // too). Until then Needs you is a skeleton, then "Still reading Hermes…", and when a read failed or was given up it says it cannot check (`crew/knowledge.ts`). A review state Hermes
  // does not offer will never answer: it is no reason to doubt the decisions, so it counts as answered.
  const readyAnswer: ReadyAnswer = ready.state.status === 'loading' ? 'waiting' : ready.state.status === 'error' && ready.state.next === undefined ? 'failed' : 'answered';
  const reading = feed.status === 'connecting' || readyAnswer === 'waiting';
  const stage = useReadLadder(isReading({ status: reading ? 'loading' : 'ready', asked: ready.asked }), false);
  const known = knowledge({ feed: feed.status, hermesUp: feed.hermesUp, ready: readyAnswer, stage });
  const quiet = stream.state.status === 'ready' && stream.state.data.length === 0;
  const needs: Block<InboxItem[]> = quiet && isPending(known) ? { ...stream, state: { status: 'loading' } } : stream;
  const readyBlock = mapBlock(ready, readyRows);
  // Why Needs you cannot check, and what asks again: the review state's failure, else the live stream (Caduceus lost it, or Hermes behind it is down).
  const blindness =
    known !== 'unread'
      ? undefined
      : ready.state.status === 'error' && ready.state.next === undefined
        ? { cause: ready.state.message, retry: () => void ready.reload() }
        : { cause: feed.status === 'offline' ? CAUSE.mac : CAUSE.hermesSilent, retry: () => inboxFeed().retry() };

  const jobsBlock: Block<Job[]> = {
    reload: () => jobs.reload(),
    // Held back until the review state above has answered (`useJobs` above): until then it is waiting, not reading, and must not be called slow.
    asked: jobsAsked,
    state: jobs.jobs ? { status: 'ready', data: jobs.jobs } : jobs.failed ? { status: 'error', message: CAUSE.hermesSilent } : { status: 'loading' },
  };
  const schedule = mapBlock(jobsBlock, (list) => scheduleDay(list, now));
  // Away needs the visit (when the owner was last here), the jobs (what ran) and the Inbox's stream (what finished): it waits for all three and fails if one does.
  const away: Block<AwayView> = {
    // It asks for the visit after the first paint and for the jobs after the review state: it has asked once both have.
    asked: jobsAsked && visit.asked !== false,
    reload: () => {
      visit.reload();
      void jobs.reload();
    },
    state:
      visit.state.status === 'error'
        ? visit.state
        : jobsBlock.state.status === 'error'
          ? jobsBlock.state
          : visit.state.status === 'ready' && jobsBlock.state.status === 'ready' && feed.status !== 'connecting'
            ? { status: 'ready', data: awayView({ since: visit.state.data.since, now, activity: feed.activity, jobs: jobsBlock.state.data }) }
            : { status: 'loading' },
  };
  const rows = useMemo(() => deskNavigation(registry, crew).crew, [registry, crew]);
  const crewBlock: Block<typeof rows> = { reload: reloadProfiles, state: hermes ? { status: 'ready', data: rows } : unavailable ? { status: 'error', message: CAUSE.hermesSilent } : { status: 'loading' } };
  // The page's one voice for its blocks: they report what they cannot show, in this order, and the page says it once when several say the same (`today-voice.ts`).
  const [voice] = useState(() => new VoiceStore(['need', 'ready', 'crew', 'day', 'away', 'reminders']));

  const to = (which: EmptyBlock) => emptyTarget(which, (module) => registry.module(module)?.path);
  // The pill counts what Needs you draws, so that it and the block's title agree while a card folds; the nav badge keeps the stream's count.
  const visible = useVisibleDecisions(needs);
  const waiting = visible.state.status === 'ready' ? visible.state.data.length : 0;

  return (
    <TodayVoiceContext.Provider value={voice}>
    <div className="today">
      <PageHeader
        title="Today"
        subtitle={new Date(now).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
        actions={
          waiting > 0 ? (
            <span className="today-pill" data-tone="warning" role="status">
              <Icon name="waiting" small />
              <span>
                <RollingNumber value={waiting} /> {waiting === 1 ? 'needs you' : 'need you'}
              </span>
            </span>
          ) : undefined
        }
      />
      <TodayVoiceLine health={registry.module('health')?.path} />
      <div className="today__grid">
        <div className="today__col">
          <NeedsYouBlock block={visible} now={now} to={to} unsure={blindness} stage={isPending(known) ? known : undefined} />
          {stream.state.status === 'ready' && <LookBlock items={feed.items} now={now} />}
          <ReadyBlock block={readyBlock} now={now} to={to} onOpen={(row) => void markOpened(row)} />
          <CrewBlock block={crewBlock} to={to} />
        </div>
        <aside className="today__col" aria-label="Schedule and what happened while you were away">
          <ScheduleBlock block={schedule} now={now} to={to} />
          <AwayBlock block={away} now={now} to={to} />
          {settled && (
            <Suspense fallback={null}>
              <RemindersBlock now={now} />
            </Suspense>
          )}
        </aside>
      </div>
      {/* After the blocks, so that their arrival moves nothing on the first screen: the setup offer is read from the server, and the browser says it can install the app, both after Today has painted. One card offers both, setup first. */}
      {settled && (
        <Suspense fallback={null}>
          <FirstRunCard />
        </Suspense>
      )}
    </div>
    </TodayVoiceContext.Provider>
  );
}
