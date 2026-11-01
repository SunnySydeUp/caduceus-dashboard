// The blocks of Today (M8 #03). Each is its own section: it loads on its own and, when what it reads does not answer, says so inside itself with a Retry while the
// others carry on. An empty block says why and carries the action that fills it. The decisions are `DecisionCard`s, the Inbox's own answers, so they keep its tiers
// and step-up.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { InboxItem } from '@caduceus/contracts/inbox';
import { Icon } from '../../icons.tsx';
import { useLinkHealth, useOnline } from '../../shell/connection.ts';
import { asOfWords, cannotCheckWords } from '../../shell/link-memory.ts';
import { Sigil } from '../../shell/Sigil.tsx';
import { NetworkAction } from '../../shell/NetworkAction.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import type { CrewRow } from '../../shell/nav-order.ts';
import { isReading, STILL_READING_WORDS, type ReadStage } from '../../read-ladder.ts';
import type { Block } from '../../use-block.ts';
import { useReadLadder } from '../../use-read-ladder.ts';
import { CrewLine } from '../crew/CrewLine.tsx';
import { ageWords } from '../inbox/inbox-model.ts';
import { DecisionCard, Mark } from './DecisionCard.tsx';
import { fold } from './fold.ts';
import { foldAway, holdCard, releaseCard } from './fold-store.ts';
import { type AwayRow, type AwayView, type EmptyBlock, type ReadyRow, type ScheduleView, EMPTY, needsALook, scheduleEmptyText } from './today-model.ts';

/** Where an empty block's action leads: the address of the module it names, which the screen reads from the registry. */
export type EmptyTarget = (empty: EmptyBlock) => string;

/** While the link is down, what a block that shows data from before the drop says about it: "As of 10:38". Nothing while the link is good. */
function useAsOf(): string | undefined {
  const link = useLinkHealth();
  return link.healthy ? undefined : asOfWords(link.lastHealthyAt, Date.now());
}

/**
 * A block's title row: the title, the count beside it, and on the same line, so that nothing moves, one quiet note: when the block's data was last true while the link is down, or
 * that Hermes is still being read when a read is slow. It is the top of the block, where the eye already is, not under the room the answer will fill.
 */
export function BlockHead({ id, title, count, asOf, slow }: { id: string; title: string; count?: number; asOf?: string; slow?: boolean }) {
  return (
    <div className="today-block__head">
      <h2 className="today-block__title" id={id}>
        {title}
        {count !== undefined && count > 0 && <span className="muted today-block__count">{count}</span>}
      </h2>
      {asOf !== undefined && <span className="today-block__asof">{asOf}</span>}
      {slow && (
        <span className="today-block__slow" role="status">
          {STILL_READING_WORDS}
        </span>
      )}
    </div>
  );
}

function EmptyState({ which, to, note, unsure }: { which: EmptyBlock; to: EmptyTarget; note?: string; unsure?: boolean }) {
  const { text, action } = EMPTY[which];
  // While the link is down, or a read that bears on this block has failed, an empty block cannot tell "nothing is waiting" from "I cannot look": it says it cannot check (and, for
  // the link, since when).
  const link = useLinkHealth();
  const blind = !link.healthy || unsure;
  return (
    <div className="today-empty panel" data-stale={blind ? '' : undefined}>
      <p className="subtle">{link.healthy ? (unsure ? 'Can’t check right now.' : (note ?? text)) : cannotCheckWords(link.lastHealthyAt, Date.now())}</p>
      {/* Plain navigation: it stays live offline, because reading mode still lets the owner move around the app (only actions that need the network are switched off). */}
      <AppLink className="btn btn--secondary btn--sm" to={to(which)}>
        {action.label}
      </AppLink>
    </div>
  );
}

/**
 * What a block says while the device is offline and it has nothing from before to show: one quiet line, in the voice of the empty blocks ("Can’t check right now. Last checked at
 * 10:38."). The banner says why; the block does not say it again, and shows no failure.
 */
function CannotCheck({ retry }: { retry(): void }) {
  const link = useLinkHealth();
  return (
    <div className="today-empty panel" data-stale="">
      <p className="subtle">{cannotCheckWords(link.lastHealthyAt, Date.now())}</p>
      <NetworkAction className="btn btn--secondary btn--sm" label="Retry" onClick={retry}>
        <Icon name="refresh" small />
        Retry
      </NetworkAction>
    </div>
  );
}

interface BlockProps<T> {
  id: string;
  title: string;
  /** A number beside the title (how many things the block holds). */
  count?: number;
  block: Block<T>;
  /** Which empty state the block shows, when its data says it is empty. */
  empty: (data: T) => EmptyBlock | undefined;
  /** Words that stand in for the empty state's own when the data can say more (the next routine, when a day has none). */
  note?: (data: T) => string | undefined;
  /** The empty state whose room the block holds while it loads (its words are there, unseen), so that the usual quiet answer moves nothing below it; a block with its own usual shape gives `room` instead. */
  held?: EmptyBlock;
  /** The least height a block of its own usual shape holds while it loads (a CSS length). */
  room?: string;
  to: EmptyTarget;
  className?: string;
  /** A read beside this block failed, one its quiet answer depends on: an empty block says it cannot check, not that there is nothing. */
  unsure?: boolean;
  /** The block's rows each say when they were last true while the link is down (the crew's lines), so its title does not say it again. */
  ownLines?: boolean;
  /** The step of the read ladder to show while the block loads, when something other than the block's own wait decides it (Needs you waits for two reads). */
  stage?: ReadStage;
  children(data: T): ReactNode;
}

/** The words and the action of a block's usual quiet answer, which a block that has nothing to show holds the room of (they are never seen or read there). */
function HeldAnswer({ which }: { which: EmptyBlock }) {
  return (
    <>
      <p className="subtle" aria-hidden="true">
        {EMPTY[which].text}
      </p>
      <span className="btn btn--secondary btn--sm" aria-hidden="true">
        {EMPTY[which].action.label}
      </span>
    </>
  );
}

/** One block: a title, then its body, its error with a Retry, or its empty state with the action that fills it. While it loads, and when it could not load, it keeps the room its usual answer takes. */
export function TodayBlock<T>({ id, title, count, block, empty, note, held, room, to, className, ownLines, unsure, stage: given, children }: BlockProps<T>) {
  // While the device is offline a block is a reading mode: it keeps what it last showed (marked "As of"), or says it cannot check; it never shows a failure, because the banner is the
  // one voice. A read that failed only because the device had no network is read again as soon as the network is back.
  const online = useOnline();
  const last = useRef<{ data: T }>(undefined);
  if (block.state.status === 'ready') last.current = { data: block.state.data };
  const offline = !online;
  const kept = offline && block.state.status !== 'ready' ? last.current : undefined;
  const state: Block<T>['state'] = kept ? { status: 'ready', data: kept.data } : block.state;
  const silent = offline && state.status !== 'ready';
  const wasOnline = useRef(online);
  const { reload } = block;
  useEffect(() => {
    if (online && !wasOnline.current) void reload();
    wasOnline.current = online;
  }, [online, reload]);
  const which = state.status === 'ready' ? empty(state.data) : undefined;
  // What it shows (its rows, or its error) is from before the link dropped: it is marked, never hidden. A block still loading shows nothing of the kind, an empty one already says
  // it cannot check (`EmptyState`), and the crew says it on each of its own lines.
  const asOf = useAsOf();
  const stale = state.status !== 'loading' && !which && asOf !== undefined && !silent;
  // A read on its way climbs the one ladder (`read-ladder.ts`): a skeleton; "Still reading Hermes…" at the top of the block once the wait is long; and only once it has
  // passed the longer bound does the block say it could not be read, with a Retry. A read that really failed says so at once. A Retry that is on its way says so on the button,
  // so a press is never met with silence.
  const [retrying, setRetrying] = useState(false);
  const [tries, setTries] = useState(0);
  // The wait starts when the block has asked, not when it was drawn: a block below the first screen asks only after the first paint, and must not call that a slow read.
  const own = useReadLadder(isReading({ status: state.status, asked: block.asked }) && !silent, state.status === 'error', tries);
  const stage = given ?? own;
  const retry = () => {
    setRetrying(true);
    setTries((count) => count + 1);
    void Promise.resolve(block.reload()).finally(() => setRetrying(false));
  };
  const loading = state.status === 'loading' && !silent;
  const slow = loading && stage === 'still-reading';
  const failed = !silent && (state.status === 'error' || (state.status === 'loading' && stage === 'failed'));
  return (
    <section className={`today-block ${className ?? ''}`} aria-labelledby={`today-${id}`} data-block={id} aria-busy={loading} data-stale={stale ? '' : undefined}>
      <BlockHead id={`today-${id}`} title={title} count={count} asOf={stale && !ownLines ? asOf : undefined} slow={slow} />
      {silent && <CannotCheck retry={retry} />}
      {loading && !failed && (
        <div className="today-empty today-empty--pending panel" role="status" style={room ? ({ '--room': room } as CSSProperties) : undefined}>
          <span className="skel today-empty__shimmer" aria-hidden="true" />
          <span className="sr-only">Loading {title.toLowerCase()}…</span>
          {held && <HeldAnswer which={held} />}
        </div>
      )}
      {failed && (
        // A refresh that fails (Hermes restarting, a session that ended) must not move what is below the block: the error sits over the room of the usual answer.
        <div className="today-room" style={room ? ({ '--room': room } as CSSProperties) : undefined}>
          {held && (
            <div className="today-empty today-room__held panel" aria-hidden="true">
              <HeldAnswer which={held} />
            </div>
          )}
          {/* A failure asking again cannot help is not an alarm: it says the step in place of a Retry, in the quiet tone (Hermes has no answer for this read yet). */}
          {state.status === 'error' && state.next !== undefined ? (
            <div className="banner" data-tone="info" role="status">
              <Icon name="info" />
              <span className="banner__content">
                <span className="banner__title">{title} isn’t available</span>
                <span className="banner__body">
                  {state.message}. {state.next}
                </span>
                {state.detail !== undefined && (
                  <details className="today-block__details">
                    <summary>Details</summary>
                    <code>{state.detail}</code>
                  </details>
                )}
              </span>
            </div>
          ) : (
            <div className="banner" data-tone="danger" role="alert">
              <Icon name="failed" />
              <span className="banner__content">
                <span className="banner__title">{title} couldn’t be read</span>
                <span className="banner__body">{state.status === 'error' ? state.message : 'Hermes hasn’t answered yet.'}</span>
                {state.status === 'error' && state.detail !== undefined && (
                  <details className="today-block__details">
                    <summary>Details</summary>
                    <code>{state.detail}</code>
                  </details>
                )}
              </span>
              <button type="button" className="btn btn--secondary btn--sm" disabled={retrying} aria-busy={retrying} onClick={retry}>
                <Icon name="refresh" small />
                {retrying ? 'Retrying…' : 'Retry'}
              </button>
            </div>
          )}
        </div>
      )}
      {state.status === 'ready' && (which ? <EmptyState which={which} to={to} note={note?.(state.data)} unsure={unsure} /> : children(state.data))}
    </section>
  );
}

/**
 * Needs you. `block` is the decisions to draw (`useVisibleDecisions`: the stream's list with the cards that are answering kept in place and the folded ones left out), which Today
 * also counts in its pill. A card whose answer is on its way stays where it stands; once it has folded into its agent it stays gone. An answer cannot be undone, so a folded card has
 * nothing to come back for. `unsure`: a read that bears on what needs the owner has failed or been given up (what is ready for review), so an empty list says it cannot check rather than that nothing needs them. `stage` is the read ladder's step while that read is on its way: the block is then a skeleton, never an empty list (`crew/knowledge.ts`).
 */
export function NeedsYouBlock({ block, now, to, unsure, stage }: { block: Block<InboxItem[]>; now: number; to: EmptyTarget; unsure: boolean; stage?: ReadStage }) {
  const answered = async (item: InboxItem, card: HTMLElement | null) => {
    // A card that left the page while its answer was on its way has nothing to fold.
    if (card) await fold(card, item.profile, () => foldAway(item.id));
    else foldAway(item.id);
  };
  return (
    <TodayBlock id="need" title="Needs you" count={block.state.status === 'ready' ? block.state.data.length : undefined} block={block} empty={(items) => (items.length === 0 ? 'needs' : undefined)} held="needs" to={to} unsure={unsure} stage={stage}>
      {(items) => (
        <ul className="today-cards">
          {items.map((item, at) => (
            <DecisionCard key={item.id} item={item} now={now} onSending={(on) => (on ? holdCard(item, at) : releaseCard(item.id))} onAnswered={(card) => answered(item, card)} />
          ))}
        </ul>
      )}
    </TodayBlock>
  );
}

/** Failed work and jobs (a task that gave up, a routine that failed, something Health flagged): a short list, each row leading to where it is dealt with. Nothing failed, nothing shown. */
export function LookBlock({ items, now }: { items: readonly InboxItem[]; now: number }) {
  const { rows, more } = needsALook(items);
  const asOf = useAsOf();
  if (rows.length === 0) return null;
  return (
    <section className="today-block" aria-labelledby="today-look" data-block="look" data-stale={asOf === undefined ? undefined : ''}>
      <BlockHead id="today-look" title="Needs a look" count={rows.length + more} asOf={asOf} />
      <ul className="today-ready panel">
        {rows.map((row) => (
          <li key={row.id} className="today-row" data-failed>
            <Mark profile={row.profile} size="sm" state="blocked" />
            <span className="today-row__text">
              <b>{row.title}</b>
              <small>{row.line ? `${row.line} · ${ageWords(row.at, now)}` : ageWords(row.at, now)}</small>
            </span>
            <AppLink className="btn btn--secondary btn--sm" to={row.to} aria-label={`Open ${row.title}`}>
              Open
            </AppLink>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <p className="subtle today-more">
          <AppLink to="/notices">{more === 1 ? '1 more in Notices' : `${more} more in Notices`}</AppLink>
        </p>
      )}
    </section>
  );
}

export function ReadyBlock({ block, now, to, onOpen }: { block: Block<ReadyRow[]>; now: number; to: EmptyTarget; onOpen(row: ReadyRow): void }) {
  return (
    <TodayBlock id="ready" title="Ready for review" count={block.state.status === 'ready' ? block.state.data.length : undefined} block={block} empty={(rows) => (rows.length === 0 ? 'ready' : undefined)} held="ready" to={to}>
      {(rows) => (
        <ul className="today-ready panel">
          {rows.map((row) => (
            <li key={row.id} className="today-row">
              <Mark profile={row.profile} size="sm" state="done" />
              <span className="today-row__text">
                <b>{row.title}</b>
                <small>
                  {row.line} · {ageWords(row.at, now)}
                </small>
              </span>
              <AppLink className="btn btn--secondary btn--sm" to={row.to} aria-label={`Review ${row.title}`} onClick={() => onOpen(row)}>
                Review
              </AppLink>
            </li>
          ))}
        </ul>
      )}
    </TodayBlock>
  );
}

/** The crew as a swipeable row of tiles, for a phone: each opens that agent's thread. A wider screen has the crew in its sidebar and rail. While it loads it holds the height of one row of tiles (a tile and the strip's padding under it, 9.375 rem), so that the schedule below does not move when the crew arrives. */
export function CrewBlock({ block, to }: { block: Block<CrewRow[]>; to: EmptyTarget }) {
  const staleLine = useAsOf();
  return (
    <TodayBlock id="crew" title="Crew" className="today-crew" ownLines block={block} empty={(rows) => (rows.length === 0 ? 'crew' : undefined)} room="9.375rem" to={to}>
      {(rows) => (
        <ul className="today-tiles" aria-label="Crew">
          {rows.map((row) => (
            <li key={row.profile}>
              <AppLink className="today-tile" to={row.path} data-stale={staleLine === undefined ? undefined : ''}>
                <Mark profile={row.profile} size="md" state={row.state} />
                <span className="today-tile__text">
                  <b>{row.profile}</b>
                  <span className="sr-only">: {row.stateLabel}. </span>
                  <CrewLine row={row} text={staleLine} />
                </span>
              </AppLink>
            </li>
          ))}
        </ul>
      )}
    </TodayBlock>
  );
}

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** The time of a row: the clock for today, the weekday and the clock for another day. */
function when(at: number, now: number): string {
  const sameDay = new Date(at).toDateString() === new Date(now).toDateString();
  return sameDay ? clock(at) : `${new Date(at).toLocaleDateString([], { weekday: 'short' })} ${clock(at)}`;
}

const HOURS = ['12 am', '6 am', '12 pm', '6 pm', '12 am'];

function Ribbon({ view, now }: { view: ScheduleView; now: number }) {
  const label = `Today from midnight to midnight; now is ${clock(now)}. ${view.markers.length === 0 ? 'No runs are marked.' : `${view.markers.length} runs are marked, listed below.`}`;
  return (
    <>
      <div className="today-ribbon" style={{ '--now': view.now } as CSSProperties} role="img" aria-label={label}>
        {view.markers.map((marker) => (
          <i key={marker.id} className="today-ribbon__m" data-kind={marker.kind} style={{ '--t': marker.at, '--h': `var(--cd-sigil-${marker.hue})` } as CSSProperties} />
        ))}
        <span className="today-ribbon__now">
          <span>Now</span>
        </span>
      </div>
      <div className="today-hours" aria-hidden="true">
        {HOURS.map((hour, at) => (
          <span key={at}>{hour}</span>
        ))}
      </div>
    </>
  );
}

const KIND_WORD: Record<ScheduleView['rows'][number]['kind'], string> = { next: 'Next', ran: 'Ran', failed: 'Failed' };

export function ScheduleBlock({ block, now, to }: { block: Block<ScheduleView>; now: number; to: EmptyTarget }) {
  return (
    <TodayBlock id="day" title="Today’s schedule" block={block} empty={(view) => (view.rows.length === 0 ? 'schedule' : undefined)} note={(view) => scheduleEmptyText(view, now)} held="schedule" to={to}>
      {(view) => (
        <div className="panel panel--pad">
          <Ribbon view={view} now={now} />
          <ul className="today-when">
            {view.rows.map((row) => (
              <li key={row.id} data-kind={row.kind}>
                <time dateTime={new Date(row.when).toISOString()}>{clock(row.when)}</time>
                <Sigil name={row.profile} size="xs" />
                <span className="today-when__t">
                  {row.name}
                  <small>
                    <span className="sr-only">{KIND_WORD[row.kind]}. </span>
                    {row.line}
                  </small>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </TodayBlock>
  );
}

function AwayRowItem({ row, now }: { row: AwayRow; now: number }) {
  const text = (
    <span className="today-when__t">
      {row.title}
      <small>{row.line}</small>
    </span>
  );
  return (
    <li data-kind={row.kind} data-failed={row.failed || undefined}>
      <time dateTime={new Date(row.at).toISOString()}>{when(row.at, now)}</time>
      <Mark profile={row.profile} size="xs" />
      {row.to ? (
        <AppLink className="today-when__link" to={row.to}>
          {text}
        </AppLink>
      ) : (
        text
      )}
    </li>
  );
}

export function AwayBlock({ block, now, to }: { block: Block<AwayView>; now: number; to: EmptyTarget }) {
  return (
    <TodayBlock id="away" title="While you were away" block={block} empty={(view) => (view.kind === 'first-visit' ? 'away-first' : view.kind === 'quiet' ? 'away-quiet' : undefined)} held="away-first" to={to}>
      {(view) =>
        view.kind === 'rows' && (
          <>
            <ul className="today-when today-when--away">
              {view.rows.map((row) => (
                <AwayRowItem key={row.id} row={row} now={now} />
              ))}
            </ul>
            {view.more > 0 && <p className="subtle today-more">{view.more === 1 ? '1 more since you were last here' : `${view.more} more since you were last here`}</p>}
          </>
        )
      }
    </TodayBlock>
  );
}
