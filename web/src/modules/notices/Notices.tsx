// Notices (M2 #01, M8 #08): what the Inbox kept that is not a decision, in Control: the notices (a job that failed, a gateway that is down, a Hermes update) and the activity feed of
// runs that finished. Decisions are answered on Today and in the Talk tray. A phone shows cards with the one or two things to do at once and opens a notice as a bottom sheet; a wider
// screen shows the list beside the notice. `/notices/:itemId` opens straight to one, which is where a notification lands. The list is a view over what Hermes and Caduceus say, kept live by the server.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { useParams, useSearch } from '@tanstack/react-router';
import { INBOX_CATEGORIES, type ActivityEvent, type InboxAction, type InboxCategory, type InboxItem, type InboxNotice, type InboxSnoozed } from '@caduceus/contracts/inbox';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { useRowGestures, type SwipeKind } from '../chat/use-row-gestures.ts';
import { hideItem, markActivitySeen, unhideItem } from '../inbox/inbox-actions.ts';
import { InboxDecision } from '../inbox/InboxDecision.tsx';
import { useInbox } from '../inbox/inbox-feed.ts';
import { ageWords, previewOf } from '../inbox/inbox-model.ts';
import { useNoticeActions } from '../inbox/NoticeActions.tsx';
import { groupItems, inCategory, initialSelection, noticesIn, noticesSearch, readNoticesView, SNOOZES, snoozeUntil, stepSelection, type NoticesView, type SnoozeKind } from './notices-model.ts';
import './notices.css';

/** The page's clock in ms, ticking each minute: ages are in minutes. */
function useMinute(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(tick);
  }, []);
  return now;
}

const kindWords = (item: InboxNotice) => (item.group === 'failed' ? 'Failed' : 'FYI');
/** What a snoozed item is called in the list below: a snoozed question or approval is listed too, so that it can be brought back. */
const titleOf = (item: InboxItem) => (item.kind === 'approval' ? (item.tool ?? 'Run a command') : item.kind === 'clarify' ? item.sessionTitle : item.title);

/** The phone's alternatives to the swipes, and everything else that can be done to a notice: a sheet. */
function ItemMenu({ item, onAction, onClose }: { item: InboxNotice; onAction(action: InboxAction): void; onClose(): void }) {
  const [custom, setCustom] = useState('');
  const put = async (until: number | undefined, said: string) => {
    onClose();
    try {
      await hideItem(item, until);
      toast(said, { undo: () => void unhideItem(item.ref).catch(() => undefined) });
    } catch (failure) {
      toast(failure instanceof Error ? failure.message : 'Caduceus could not put it aside.', { tone: 'danger' });
    }
  };
  return (
    <Sheet title={item.title} onClose={onClose}>
      <ul className="nt-menu">
        {item.actions.map((action) => (
          <li key={action.id}>
            <WriteButton
              type="button"
              className="nt-menu__item"
              onClick={() => {
                onClose();
                onAction(action);
              }}
            >
              {action.label}…
            </WriteButton>
          </li>
        ))}
        {item.link && (
          <li>
            <AppLink className="nt-menu__item" to={item.link.to} onClick={onClose}>
              {item.link.label}
            </AppLink>
          </li>
        )}
        {SNOOZES.map(({ kind, label }) => (
          <li key={kind}>
            <button type="button" className="nt-menu__item" onClick={() => void put(snoozeUntil(kind as SnoozeKind, new Date()), `Snoozed: ${label.toLowerCase()}`)}>
              Snooze · {label}
            </button>
          </li>
        ))}
        <li className="nt-menu__custom">
          <label htmlFor="nt-custom-snooze">Snooze until</label>
          <input id="nt-custom-snooze" className="input" type="datetime-local" value={custom} onChange={(event) => setCustom(event.target.value)} />
          <button type="button" className="btn btn--secondary btn--sm" disabled={custom === '' || Number.isNaN(Date.parse(custom)) || Date.parse(custom) <= Date.now()} onClick={() => void put(Date.parse(custom), 'Snoozed')}>
            Snooze
          </button>
        </li>
        <li>
          <button type="button" className="nt-menu__item" onClick={() => void put(undefined, 'Dismissed: it comes back if it happens again')}>
            Dismiss
          </button>
        </li>
      </ul>
    </Sheet>
  );
}

function ItemCard({ item, selected, wide, now, onOpen }: { item: InboxNotice; selected: boolean; wide: boolean; now: number; onOpen(): void }) {
  const [menu, setMenu] = useState(false);
  const notices = useNoticeActions();
  const lead = item.actions[0];
  // A swipe right puts a notice away for good (until it happens again); a swipe left snoozes it an hour. Both are in the menu too.
  const swipe = (action: SwipeKind) => {
    const until = action === 'pin' ? snoozeUntil('1h', new Date()) : undefined;
    hideItem(item, until).then(
      () => toast(action === 'pin' ? 'Snoozed for an hour' : 'Dismissed', { undo: () => void unhideItem(item.ref).catch(() => undefined) }),
      (failure: unknown) => toast(failure instanceof Error ? failure.message : 'Caduceus could not put it aside.', { tone: 'danger' }),
    );
  };
  const gesture = useRowGestures({ enabled: !wide, onSwipe: swipe, onLongPress: () => setMenu(true) });
  return (
    <li className="nt-card" data-kind={item.kind} data-group={item.group} data-selected={selected ? '' : undefined} data-swiping={gesture.offset === 0 ? undefined : ''} data-swipe={gesture.action} style={{ '--swipe': `${gesture.offset}px` } as CSSProperties} {...gesture.handlers}>
      <span className="nt-swipe" aria-hidden="true">
        <span className="nt-swipe__side" data-side="archive">
          Dismiss
        </span>
        <span className="nt-swipe__side" data-side="pin">
          Snooze
        </span>
      </span>
      <button type="button" className="nt-card__main" data-item-id={item.id} aria-current={selected ? 'true' : undefined} onClick={() => !gesture.swallowsClick() && onOpen()}>
        <span className="nt-card__top">
          <span className="nt-card__kind">
            <Icon name={item.group === 'failed' ? 'failed' : 'info'} small />
            {kindWords(item)}
          </span>
          <span className="nt-card__age subtle">{ageWords(item.at, now)}</span>
        </span>
        <span className="nt-card__title">{item.title}</span>
        {previewOf(item) !== item.title && <span className="nt-card__preview mono">{previewOf(item)}</span>}
        <span className="nt-card__meta subtle">{item.profile ?? 'all profiles'}</span>
      </button>
      <div className="nt-card__acts">
        {lead && (
          <WriteButton type="button" className="btn btn--primary btn--sm" disabled={notices.busy !== undefined} aria-label={`${lead.label}: ${item.title}`} onClick={() => notices.run(lead)}>
            {lead.label}…
          </WriteButton>
        )}
        <button type="button" className="btn btn--secondary btn--sm" onClick={onOpen}>
          Details
        </button>
        <button type="button" className="btn btn--ghost btn--icon nt-card__more" aria-label={`More for ${item.title}`} aria-haspopup="dialog" onClick={() => setMenu(true)}>
          <Icon name="dots-v" />
        </button>
      </div>
      {menu && <ItemMenu item={item} onAction={notices.run} onClose={() => setMenu(false)} />}
      {notices.sheet}
    </li>
  );
}

/** What a notice that is gone says: whatever it was about is over, or it was put aside. */
function Closed() {
  return (
    <div className="nt-closed" role="status">
      <span className="empty__icon">
        <Icon name="check" />
      </span>
      <h2>This notice is gone</h2>
      <p>What it was about is over, or you put it aside. A notice goes by itself when the thing it says has changed.</p>
      <AppLink className="btn btn--secondary" to="/notices">
        Back to Notices
      </AppLink>
    </div>
  );
}

/** The category chips: all, then each category that has a notice (or is the one chosen), kept in the address. */
function Categories({ items, view }: { items: readonly InboxItem[]; view: NoticesView }) {
  const navigate = useAppNavigate();
  const present = (Object.keys(INBOX_CATEGORIES) as InboxCategory[]).filter((category) => category === view.category || items.some((item) => item.category === category));
  const go = (category: InboxCategory | undefined) => {
    const query = new URLSearchParams(noticesSearch({ ...view, category })).toString();
    void navigate(`/notices${query ? `?${query}` : ''}`, { replace: true });
  };
  if (present.length < 2 && view.category === undefined) return null;
  return (
    <div className="nt-filter" role="group" aria-label="Filter by category">
      <button type="button" className="chip" aria-pressed={view.category === undefined} onClick={() => go(undefined)}>
        All
      </button>
      {present.map((category) => (
        <button key={category} type="button" className="chip" aria-pressed={view.category === category} onClick={() => go(view.category === category ? undefined : category)}>
          {INBOX_CATEGORIES[category]}
        </button>
      ))}
    </div>
  );
}

function Snoozed({ snoozed }: { snoozed: readonly InboxSnoozed[] }) {
  if (snoozed.length === 0) return null;
  return (
    <details className="nt-snoozed">
      <summary>Snoozed on this device ({snoozed.length})</summary>
      <ul>
        {snoozed.map(({ item, until }) => (
          <li key={item.id}>
            <span>
              {titleOf(item)} <span className="subtle">· back {new Date(until).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
            </span>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => void unhideItem(item.ref).catch(() => toast('Caduceus could not bring it back.', { tone: 'danger' }))}>
              Bring back
            </button>
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The activity feed: runs that finished, newest first. Looking at it is seeing it. */
function Activity({ events, unseen, now }: { events: readonly ActivityEvent[]; unseen: number; now: number }) {
  const newest = events[0]?.seq;
  useEffect(() => {
    if (newest !== undefined && unseen > 0) void markActivitySeen(newest);
  }, [newest, unseen]);
  if (events.length === 0) {
    return (
      <div className="empty">
        <span className="empty__icon">
          <Icon name="history" />
        </span>
        <p>No run has finished while Caduceus was watching.</p>
        <p>When a chat run you started finishes, it is listed here, and you get a toast if you are looking.</p>
        <AppLink className="btn btn--secondary" to="/chat">
          <Icon name="chat" />
          Open Talk
        </AppLink>
      </div>
    );
  }
  return (
    <ul className="nt-activity" aria-label="Finished runs">
      {events.map((event) => (
        <li key={event.seq}>
          <Icon name="succeeded" small />
          <span className="nt-activity__main">
            {event.storedSessionId ? <AppLink to={`/chat/${encodeURIComponent(event.storedSessionId)}${event.profile ? `?profile=${encodeURIComponent(event.profile)}` : ''}`}>{event.title}</AppLink> : event.title}
            <span className="subtle"> · {event.profile ?? 'unknown profile'}</span>
          </span>
          <span className="subtle">{ageWords(event.at, now)}</span>
        </li>
      ))}
    </ul>
  );
}

export function Notices() {
  const feed = useInbox();
  const { scope } = useProfileScope();
  const { itemId } = useParams({ strict: false }) as { itemId?: string };
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const view = readNoticesView(search);
  const navigate = useAppNavigate();
  const wide = useSizeClass() !== 'compact';
  const now = useMinute();
  const list = useRef<HTMLDivElement>(null);
  const [chosen, setChosen] = useState<string | undefined>(itemId);
  const [sheetFor, setSheetFor] = useState<string | undefined>(itemId);

  // A link to another notice (a notification, while the page is open) moves the selection to it.
  useEffect(() => {
    setChosen(itemId);
    setSheetFor(itemId);
  }, [itemId]);

  // A link to a notice shows it whatever the profile chip and the category say, so that a notification never lands on nothing.
  const everyone = useMemo(() => noticesIn(feed.items, 'all'), [feed.items]);
  const shown = useMemo(() => {
    const scoped = inCategory(noticesIn(feed.items, scope), view.category);
    const linked = everyone.find((item) => item.id === itemId);
    return linked && !scoped.includes(linked) ? [linked, ...scoped] : scoped;
  }, [feed.items, everyone, scope, view.category, itemId]);
  const groups = useMemo(() => groupItems(shown), [shown]);
  const ids = useMemo(() => groups.flatMap((group) => group.items.map((item) => item.id)), [groups]);
  const selectedId = wide ? initialSelection(ids, chosen) : undefined;
  const settled = feed.status !== 'connecting';
  const linkedGone = settled && itemId !== undefined && !everyone.some((item) => item.id === itemId);
  const selectedItem = shown.find((item) => item.id === selectedId);
  const sheetItem = everyone.find((item) => item.id === sheetFor);

  const open = (id: string) => {
    setChosen(id);
    if (!wide) setSheetFor(id);
  };
  const closeSheet = () => {
    setSheetFor(undefined);
    if (itemId !== undefined) void navigate('/notices', { replace: true });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const focused = (event.target as HTMLElement).closest<HTMLElement>('[data-item-id]');
    if (!focused) return;
    const delta = event.key === 'j' || event.key === 'ArrowDown' ? 1 : event.key === 'k' || event.key === 'ArrowUp' ? -1 : undefined;
    if (delta === undefined) return;
    const next = stepSelection(ids, focused.dataset.itemId, delta);
    if (next === undefined) return;
    event.preventDefault();
    // The keys move through the list; on a phone nothing opens until a tap or Enter.
    if (wide) setChosen(next);
    [...(list.current?.querySelectorAll<HTMLElement>('[data-item-id]') ?? [])].find((element) => element.dataset.itemId === next)?.focus();
  };

  const goTo = (next: NoticesView['view']) => {
    const query = new URLSearchParams(noticesSearch({ ...view, view: next })).toString();
    void navigate(`/notices${query ? `?${query}` : ''}`, { replace: true });
  };
  const EMPTY_GROUP: Record<string, { text: string; to: string; label: string }> = {
    failed: { text: 'Nothing has failed.', to: '/work/schedules', label: 'Open Schedules' },
    fyi: { text: 'Nothing to know about.', to: '/observe/health', label: 'Open Health' },
  };
  const nothing = settled && ids.length === 0 && !linkedGone;
  const waiting = feed.needsDecision;
  return (
    <div className="nt">
      <PageHeader overline="Control" title="Notices" subtitle={settled ? (ids.length === 0 ? 'Nothing to look at' : `${ids.length} ${ids.length === 1 ? 'notice' : 'notices'}`) : undefined} />
      <p className="help-text">
        What Hermes and Caduceus say that is not a question for you: a job that failed, a gateway that is down, an update that is waiting. A <Term id="notice">notice</Term> is worked out from what they report, so it goes by itself when that is over. Runs that finish are listed in the <Term id="activity-feed">Activity feed</Term>.{' '}
        {waiting > 0 ? (
          <>
            <AppLink to="/today">{waiting === 1 ? '1 item needs a decision' : `${waiting} items need a decision`}</AppLink> on Today.
          </>
        ) : (
          <>What needs a decision is on <AppLink to="/today">Today</AppLink>.</>
        )}
      </p>
      <div className="nt-views" role="group" aria-label="View">
        <button type="button" className="chip" aria-pressed={view.view === 'notices'} onClick={() => goTo('notices')}>
          Notices
        </button>
        <button type="button" className="chip" aria-pressed={view.view === 'activity'} onClick={() => goTo('activity')}>
          Activity
          {feed.unseen > 0 && (
            <>
              <span className="count count--accent" aria-hidden="true">
                {feed.unseen}
              </span>
              <span className="sr-only">{feed.unseen === 1 ? '1 finished run you have not seen' : `${feed.unseen} finished runs you have not seen`}</span>
            </>
          )}
        </button>
      </div>
      {feed.status === 'offline' && (
        <div className="banner" data-tone="warning" role="status">
          <Icon name="wifi-off" />
          <span className="banner__content">Caduceus cannot be reached. This is the list from a moment ago; it updates by itself when the connection is back.</span>
        </div>
      )}
      {feed.status === 'live' && !feed.hermesUp && (
        <div className="banner" data-tone="warning" role="status">
          <Icon name="alert" />
          <span className="banner__content">Caduceus cannot reach Hermes right now, so this list may be out of date. It updates by itself when Hermes is back.</span>
        </div>
      )}
      {!settled && <p role="status">Loading the notices…</p>}
      {view.view === 'activity' && settled && <Activity events={feed.activity} unseen={feed.unseen} now={now} />}
      {view.view === 'notices' && (
        <>
          {linkedGone && !sheetItem && <Closed />}
          {settled && <Categories items={noticesIn(feed.items, scope)} view={view} />}
          {nothing && view.category === undefined && (
            <div className="empty">
              <span className="empty__icon">
                <Icon name="inbox" />
              </span>
              <p>Nothing to look at.</p>
              <p>When a job fails, a gateway goes down or Hermes has an update, it shows up here, from any profile.</p>
              <AppLink className="btn btn--secondary" to="/today">
                <Icon name="home" />
                Open Today
              </AppLink>
            </div>
          )}
          {settled && (ids.length > 0 || view.category !== undefined) && (
            <div className="nt-panes" data-wide={wide ? '' : undefined}>
              <div className="nt-groups" ref={list} onKeyDown={onKeyDown}>
                {groups.map((group) => (
                  <section key={group.id} className="nt-list" aria-labelledby={`nt-${group.id}`}>
                    <h2 id={`nt-${group.id}`} className="nt-list__title">
                      {group.title} <span className="nt-count-pill">{group.items.length}</span>
                    </h2>
                    {group.items.length === 0 ? (
                      <p className="nt-empty subtle">
                        {EMPTY_GROUP[group.id]!.text}{' '}
                        <AppLink to={EMPTY_GROUP[group.id]!.to}>{EMPTY_GROUP[group.id]!.label}</AppLink>
                      </p>
                    ) : (
                      <ul className="nt-cards" aria-label={group.title}>
                        {group.items.map((item) => (
                          <ItemCard key={item.id} item={item} selected={item.id === selectedId} wide={wide} now={now} onOpen={() => open(item.id)} />
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
              </div>
              {wide && ids.length > 0 && (
                <section className="nt-detail" aria-label="Notice">
                  {selectedItem ? <InboxDecision item={selectedItem} /> : <Closed />}
                </section>
              )}
            </div>
          )}
          <Snoozed snoozed={feed.snoozed} />
        </>
      )}
      {!wide && sheetFor !== undefined && settled && (
        <Sheet title={sheetItem ? kindWords(sheetItem) : 'Notice gone'} detents={['auto', 'full']} onClose={closeSheet}>
          {sheetItem ? <InboxDecision item={sheetItem} onDone={closeSheet} /> : <Closed />}
        </Sheet>
      )}
    </div>
  );
}
