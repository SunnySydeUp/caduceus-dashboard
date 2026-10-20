// Today (M8 #03): what needs the owner, what is ready, the day's routines and what happened while they were away. Each block loads on its own and fails on its own
// (`TodayBlocks.tsx`). The decisions come from the Inbox's live stream and keep its tiers, undo and step-up; the rest from Hermes's cron, the activity feed, the
// crew and Caduceus's review state (`today-data.ts`).
import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { Icon } from '../../icons.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { deskNavigation } from '../../shell/nav-order.ts';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { useRegistry } from '../../shell/registry-context.tsx';
import { useNow } from '../../shell/use-now.ts';
import { feedBlock, mapBlock, useBlock, type Block } from '../../use-block.ts';
import { usePainted, useSettled } from '../../use-settled.ts';
import { useCrew } from '../crew/use-crew.ts';
import { inboxFeed, useInbox } from '../inbox/inbox-feed.ts';
import { useJobs } from '../work/schedules-data.ts';
import type { Job } from '../work/schedules-model.ts';
import { InstallCard } from './InstallCard.tsx';
import { markOpened, readReady, recordVisit } from './today-data.ts';
import { awayView, decisionsFor, EMPTY, readyRows, scheduleDay, type EmptyBlock } from './today-model.ts';
import { AwayBlock, CrewBlock, NeedsYouBlock, ReadyBlock, ScheduleBlock } from './TodayBlocks.tsx';
import './today.css';

/** The setup guide's offer is below the first screen and Today paints without it: its code is fetched once the page has settled. */
const OnboardingCard = lazy(() => import('../onboarding/OnboardingCard.tsx').then((m) => ({ default: m.OnboardingCard })));
/** So is the reminders calendar: it is last in its column, so its arrival moves nothing above it, and its code and its read wait for the page to settle. */
const RemindersBlock = lazy(() => import('./RemindersBlock.tsx').then((m) => ({ default: m.RemindersBlock })));

/** How often the times on the screen ("6 min ago", the Now marker) are read again. */
const CLOCK_MS = 30_000;

export function Today() {
  const feed = useInbox();
  const { scope, hermes, unavailable, reload: reloadProfiles } = useProfileScope();
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
  const jobs = useJobs(ready.state.status !== 'loading');
  const firstLook = useRef(true);
  const finished = feed.activity[0]?.seq;
  useEffect(() => {
    if (firstLook.current) {
      firstLook.current = false;
      return;
    }
    ready.reload();
  }, [finished, feed.items.length, ready.reload]);
  useEffect(() => {
    const back = () => document.visibilityState === 'visible' && ready.reload();
    document.addEventListener('visibilitychange', back);
    return () => document.removeEventListener('visibilitychange', back);
  }, [ready.reload]);

  const decisions = useMemo(() => decisionsFor(feed.items, scope), [feed.items, scope]);
  const needs = feedBlock(feed, decisions, () => inboxFeed().retry());
  const readyBlock = mapBlock(ready, (items) => readyRows(items, scope));

  const jobsBlock: Block<Job[]> = {
    reload: () => void jobs.reload(),
    state: jobs.jobs ? { status: 'ready', data: jobs.jobs } : jobs.failed ? { status: 'error', message: 'Hermes did not answer for its schedules.' } : { status: 'loading' },
  };
  const schedule = mapBlock(jobsBlock, (list) => scheduleDay(list, now, scope));
  // Away needs the visit (when the owner was last here), the jobs (what ran) and the Inbox's stream (what finished): it waits for all three and fails if one does.
  const away: Block<ReturnType<typeof awayView>> = {
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
            ? { status: 'ready', data: awayView({ since: visit.state.data.since, now, activity: feed.activity, jobs: jobsBlock.state.data, scope }) }
            : { status: 'loading' },
  };
  const rows = useMemo(() => deskNavigation(registry, crew).crew, [registry, crew]);
  const crewBlock: Block<typeof rows> = { reload: reloadProfiles, state: hermes ? { status: 'ready', data: rows } : unavailable ? { status: 'error', message: 'Hermes did not answer for its profiles.' } : { status: 'loading' } };

  const to = (which: EmptyBlock) => registry.module(EMPTY[which].action.module)?.path ?? '/';
  const waiting = needs.state.status === 'ready' ? needs.state.data.length : 0;

  return (
    <div className="today">
      <PageHeader
        title="Today"
        subtitle={new Date(now).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}
        actions={
          waiting > 0 ? (
            <span className="today-pill" data-tone="warning" role="status">
              <Icon name="waiting" small />
              {waiting === 1 ? '1 needs you' : `${waiting} need you`}
            </span>
          ) : undefined
        }
      />
      <div className="today__grid">
        <div className="today__col">
          <NeedsYouBlock block={needs} now={now} to={to} />
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
      {/* After the blocks, so that their arrival moves nothing on the first screen: the browser says it can install the app, and the setup offer is read from the server, both after Today has painted. */}
      <InstallCard />
      {settled && (
        <Suspense fallback={null}>
          <OnboardingCard />
        </Suspense>
      )}
    </div>
  );
}
