// The blocks of Today (M8 #03). Each is its own section: it loads on its own and, when what it reads does not answer, says so inside itself with a Retry while the
// others carry on. An empty block says why and carries the action that fills it. The decisions are `DecisionCard`s, the Inbox's own answers, so they keep its tiers,
// undo and step-up.
import { useState, type CSSProperties, type ReactNode } from 'react';
import type { InboxItem } from '@caduceus/contracts/inbox';
import { Icon } from '../../icons.tsx';
import { useTakingLonger } from '../../shell/Loading.tsx';
import { Sigil } from '../../shell/Sigil.tsx';
import { AppLink } from '../../shell/navigation.tsx';
import type { CrewRow } from '../../shell/nav-order.ts';
import type { Block } from '../../use-block.ts';
import { ageWords } from '../inbox/inbox-model.ts';
import { DecisionCard, Mark } from './DecisionCard.tsx';
import { type AwayRow, type AwayView, type EmptyBlock, type ReadyRow, type ScheduleView, EMPTY, needsALook, scheduleEmptyText } from './today-model.ts';

/** Where an empty block's action leads: the address of the module it names, which the screen reads from the registry. */
export type EmptyTarget = (empty: EmptyBlock) => string;

function EmptyState({ which, to, note }: { which: EmptyBlock; to: EmptyTarget; note?: string }) {
  const { text, action } = EMPTY[which];
  return (
    <div className="today-empty panel">
      <p className="subtle">{note ?? text}</p>
      <AppLink className="btn btn--secondary btn--sm" to={to(which)}>
        {action.label}
      </AppLink>
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
export function TodayBlock<T>({ id, title, count, block, empty, note, held, room, to, className, children }: BlockProps<T>) {
  const { state } = block;
  const which = state.status === 'ready' ? empty(state.data) : undefined;
  // A wait that goes on says so, with the way out; and a Retry that is on its way says so on the button, so a press is never met with silence.
  const late = useTakingLonger(state.status === 'loading');
  const [retrying, setRetrying] = useState(false);
  const retry = () => {
    setRetrying(true);
    void Promise.resolve(block.reload()).finally(() => setRetrying(false));
  };
  return (
    <section className={`today-block ${className ?? ''}`} aria-labelledby={`today-${id}`} data-block={id} aria-busy={state.status === 'loading'}>
      <h2 className="today-block__title" id={`today-${id}`}>
        {title}
        {count !== undefined && count > 0 && <span className="muted today-block__count">{count}</span>}
      </h2>
      {state.status === 'loading' && (
        <div className="today-empty today-empty--pending panel" role="status" style={room ? ({ '--room': room } as CSSProperties) : undefined}>
          <span className="skel today-empty__shimmer" aria-hidden="true" />
          <span className="sr-only">{late ? `Loading ${title.toLowerCase()} is taking longer than usual.` : `Loading ${title.toLowerCase()}…`}</span>
          {held && <HeldAnswer which={held} />}
          {late && (
            <p className="today-empty__late">
              <span className="muted">Taking longer than usual.</span>
              <button type="button" className="btn btn--secondary btn--sm" disabled={retrying} aria-busy={retrying} onClick={retry}>
                <Icon name="refresh" small />
                {retrying ? 'Retrying…' : 'Retry'}
              </button>
            </p>
          )}
        </div>
      )}
      {state.status === 'error' && (
        // A refresh that fails (Hermes restarting, a session that ended) must not move what is below the block: the error sits over the room of the usual answer.
        <div className="today-room" style={room ? ({ '--room': room } as CSSProperties) : undefined}>
          {held && (
            <div className="today-empty today-room__held panel" aria-hidden="true">
              <HeldAnswer which={held} />
            </div>
          )}
          <p className="banner" data-tone="danger" role="alert">
            <Icon name="failed" />
            <span className="banner__content">
              <span className="banner__title">{title} could not be loaded</span>
              <span className="banner__body">{state.message}</span>
            </span>
            <button type="button" className="btn btn--secondary btn--sm" disabled={retrying} aria-busy={retrying} onClick={retry}>
              <Icon name="refresh" small />
              {retrying ? 'Retrying…' : 'Retry'}
            </button>
          </p>
        </div>
      )}
      {state.status === 'ready' && (which ? <EmptyState which={which} to={to} note={note?.(state.data)} /> : children(state.data))}
    </section>
  );
}

export function NeedsYouBlock({ block, now, to }: { block: Block<InboxItem[]>; now: number; to: EmptyTarget }) {
  return (
    <TodayBlock id="need" title="Needs you" count={block.state.status === 'ready' ? block.state.data.length : undefined} block={block} empty={(items) => (items.length === 0 ? 'needs' : undefined)} held="needs" to={to}>
      {(items) => (
        <ul className="today-cards">
          {items.map((item) => (
            <DecisionCard key={item.id} item={item} now={now} />
          ))}
        </ul>
      )}
    </TodayBlock>
  );
}

/** Failed work and jobs (a task that gave up, a routine that failed, something Health flagged): a short list, each row leading to where it is dealt with. Nothing failed, nothing shown. */
export function LookBlock({ items, now }: { items: readonly InboxItem[]; now: number }) {
  const { rows, more } = needsALook(items);
  if (rows.length === 0) return null;
  return (
    <section className="today-block" aria-labelledby="today-look" data-block="look">
      <h2 className="today-block__title" id="today-look">
        Needs a look
        <span className="muted today-block__count">{rows.length + more}</span>
      </h2>
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
  return (
    <TodayBlock id="crew" title="Crew" className="today-crew" block={block} empty={(rows) => (rows.length === 0 ? 'crew' : undefined)} room="9.375rem" to={to}>
      {(rows) => (
        <ul className="today-tiles" aria-label="Crew">
          {rows.map((row) => (
            <li key={row.profile}>
              <AppLink className="today-tile" to={row.path}>
                <Mark profile={row.profile} size="md" state={row.state} />
                <span className="today-tile__text">
                  <b>{row.profile}</b>
                  <span className="sr-only">: {row.stateLabel}. </span>
                  <small>{row.line}</small>
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
