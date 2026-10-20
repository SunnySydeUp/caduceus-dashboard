// Talk's Details (M8 #04, M8 #09): what an agent is doing and has, opened from the header (a column from 1280 px, over the thread on a tablet, a sheet on a phone).
// Right now, the last command with a workspace preview that reuses the chat's own terminal, files and browser views, Work (its tasks, runs and routines), About,
// and the agent's plan and run. Only the sections that have something to say are drawn (`detailsSections`). The data is `talk-details.ts`'s.
import type { LiveRun } from '@caduceus/contracts/inbox';
import { Fragment, lazy, Suspense, useEffect, useId, useState, type ReactNode } from 'react';
import { Icon, type IconName } from '../../icons.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { Sigil } from '../../shell/Sigil.tsx';
import { confirmTier } from '../../shell/tier-confirmation.ts';
import { useNow } from '../../shell/use-now.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { crewStateLabel, type CrewMember } from '../crew/crew-state.ts';
import { useInbox } from '../inbox/inbox-feed.ts';
import { useLiveBoard } from '../work/board-data.ts';
import { useJobs } from '../work/schedules-data.ts';
import { ActivityGroup } from './ActivityCards.tsx';
import type { Chat as ChatEngine, ChatState } from './chat-session.ts';
import { readHermes } from './read-hermes.ts';
import { aboutOf, detailsSections, liveLine, planHasContent, rightNow, spendOf, workOf, workspaceOf, type DetailsSection, type WorkspaceView, type WorkEntry } from './talk-details.ts';
import { transcriptOf } from './chat-session.ts';
import { afterSheet } from './SessionOrganiser.tsx';
import './talk.css';

const ArtifactsTab = lazy(() => import('./ArtifactsTab.tsx').then((m) => ({ default: m.ArtifactsTab })));

/** How often the "Running for 5 min" times are read again. */
const CLOCK_MS = 30_000;

/** Today's spend of one profile, from Hermes's usage analytics: read again when a turn starts or ends. `undefined` until Hermes has answered, and when it cannot. */
function useSpendToday(profile: string, refresh: unknown): number | undefined {
  const [cost, setCost] = useState<number>();
  useEffect(() => {
    let current = true;
    readHermes(`/api/analytics/usage?days=32&profile=${encodeURIComponent(profile)}`).then(
      (answer) => current && setCost(spendOf([answer], new Date()).today.cost),
      () => current && setCost(undefined),
    );
    return () => {
      current = false;
    };
  }, [profile, refresh]);
  return cost;
}

const WORK_ICONS: Record<WorkEntry['kind'], IconName> = { task: 'tasks', run: 'chat', routine: 'calendar' };

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="td__section" aria-labelledby={id}>
      <div className="td__head">
        <h3 id={id}>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * Take over: Hermes's own terminal on this chat's session, which the agent shares. It is the terminal mode's tier (a T2: your passkey), asked for here before the screen
 * opens, so the owner meets the confirmation first and the terminal then opens without a second prompt.
 */
export function TakeOver({ profile, storedId, label = 'Take over' }: { profile: string; storedId: string | undefined; label?: string }) {
  const navigate = useAppNavigate();
  const take = async () => {
    if (storedId === undefined) return;
    const confirmed = await confirmTier({
      tier: 'T2',
      moduleId: 'chat',
      action: 'chat.take-over',
      label: `Take over ${profile}’s terminal?`,
      text: 'Hermes’s own terminal opens on this chat’s session, and you share it with the agent. What you type there runs on this Mac, as you. Opening it needs your passkey.',
      profile,
      confirmLabel: 'Take over',
    });
    if (confirmed) void navigate(`/chat/${encodeURIComponent(storedId)}?mode=terminal`);
  };
  return (
    <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={storedId === undefined} title={storedId === undefined ? 'Send a message first: the terminal opens on a chat that has a session.' : undefined} onClick={() => afterSheet(() => void take())}>
      <Icon name="terminal" small />
      {label}
    </WriteButton>
  );
}

function Preview({ view, onView, profile, state, chat }: { view: WorkspaceView; onView(view: WorkspaceView): void; profile: string; state: ChatState; chat: ChatEngine | undefined }) {
  const label = useId();
  const space = workspaceOf(transcriptOf(state));
  return (
    <div className="td__preview">
      <p id={label} className="sr-only">
        Workspace view
      </p>
      <RadioGroup<WorkspaceView>
        labelledBy={label}
        className="seg td__views"
        value={view}
        options={[
          { value: 'terminal', label: 'Terminal' },
          { value: 'files', label: space.files.length > 0 ? `Files · ${space.files.length}` : 'Files' },
          { value: 'browser', label: 'Browser' },
        ]}
        onChange={onView}
      />
      {view === 'terminal' &&
        (space.terminal ? <ActivityGroup items={[space.terminal]} mode="worklog" /> : <p className="subtle td__empty">{profile} has not run a command in this chat.</p>)}
      {view === 'browser' &&
        (space.browser ? <ActivityGroup items={[space.browser]} mode="worklog" /> : <p className="subtle td__empty">{profile} has not used a browser in this chat.</p>)}
      {view === 'files' && (
        <Suspense fallback={<p className="subtle td__empty" role="status">Loading…</p>}>
          <ArtifactsTab sessionId={state.storedId} profile={profile} title={state.title ?? 'Chat'} cwd={state.cwd} liveSession={() => chat?.liveSession()} turn={state.running} />
        </Suspense>
      )}
    </div>
  );
}

/** Work: what this agent has on, listed as the board, the live runs and the schedules know it. */
function WorkList({ profile, entries, more }: { profile: string; entries: readonly WorkEntry[]; more: number }) {
  return (
    <>
      <ul className="td__list">
        {entries.map((entry) => (
          <li key={`${entry.kind}:${entry.id}`}>
            <AppLink className="td__row" to={entry.to}>
              <Icon name={WORK_ICONS[entry.kind]} small />
              <span className="td__title">{entry.title}</span>
              <span className="td__pill" data-tone={entry.tone}>
                {entry.detail}
              </span>
            </AppLink>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <AppLink className="btn btn--ghost btn--sm td__more" to={`/work/board?assignee=${encodeURIComponent(profile)}`}>
          {more} more on the board
        </AppLink>
      )}
    </>
  );
}

export function TalkDetails({ profile, member, state, chat, plan, view, onView }: { profile: string; member: CrewMember | undefined; state: ChatState; chat: ChatEngine | undefined; /** The agent's plan and run: the todo list, goal, helpers and usage. */ plan: ReactNode; view: WorkspaceView | undefined; onView(view: WorkspaceView): void }) {
  const now = rightNow({ requests: state.requests, turn: state.turn, running: state.running, todos: state.todos, subagents: state.subagents });
  const { running } = useInbox();
  const board = useLiveBoard(undefined).state;
  const { jobs } = useJobs();
  const clock = useNow(true, CLOCK_MS);
  const work = workOf({ profile, session: state.storedId, tasks: board.board?.tasks, jobs, runs: running, now: clock });
  const spend = useSpendToday(profile, state.running);
  const about = aboutOf({ model: state.model, cwd: state.cwd, usage: state.usage, spendToday: spend });
  const sections = detailsSections({ now, workEntries: work.entries.length, plan: planHasContent({ todos: state.todos, subagents: state.subagents, goal: state.goal, usage: state.usage }) });
  const parts: Record<DetailsSection, ReactNode> = {
    now: (
      <Section title="Right now">
        <div className="td__now" data-tone={now.tone}>
          <strong>{now.headline}</strong>
          {now.step && <span className="subtle">{now.step}</span>}
          {now.progress !== undefined && <progress className="td__bar" max={1} value={now.progress} aria-label={now.step} />}
        </div>
      </Section>
    ),
    'last-command': (
      <Section title="Last command" aside={<TakeOver profile={profile} storedId={state.storedId} />}>
        <Preview view={view ?? 'terminal'} onView={onView} profile={profile} state={state} chat={chat} />
      </Section>
    ),
    work: (
      <Section title="Work">
        <WorkList profile={profile} entries={work.entries} more={work.more} />
      </Section>
    ),
    about: (
      <Section title="About">
        <dl className="td__about">
          {about.map((row) => (
            <div key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
      </Section>
    ),
    plan: <Section title="Plan and run">{plan}</Section>,
  };
  return (
    <div className="td">
      <div className="td__who">
        <Sigil name={profile} size="lg" state={member?.state} />
        <div>
          <h2>{profile}</h2>
          <p className="subtle">{liveLine(member) || (member ? crewStateLabel[member.state] : '')}</p>
        </div>
      </div>
      {sections.map((id) => (
        <Fragment key={id}>{parts[id]}</Fragment>
      ))}
    </div>
  );
}
