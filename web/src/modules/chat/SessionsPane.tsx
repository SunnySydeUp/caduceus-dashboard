// The Chat module's sessions pane (M1 #13): every session Hermes lists, grouped by date with the pinned ones on top, filtered by tab, source,
// failed-only and API noise (all four in the address), across one profile or all of them, live on `sessions.changed`. Only the rows near the
// screen are in the page, so a profile with thousands of sessions costs no more than one with twenty. Everything shown is Hermes's, read on
// this load: the pane keeps no session of its own (D1).
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject, type TouchEvent } from 'react';
import { useSearch } from '@tanstack/react-router';
import { gatewayConnection, useGatewayStatus } from '../../gateway.ts';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { fetchTiered } from '../../tiered.ts';
import { AppLink, useAddressReplace, useAppNavigate } from '../../shell/navigation.tsx';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { RadioGroup } from '../../shell/RadioGroup.tsx';
import { PopoverMenu } from '../../shell/PopoverMenu.tsx';
import { Term } from '../../shell/Term.tsx';
import {
  afterSheet,
  ChangeButton,
  CleanUpSheet,
  MoveSheet,
  NewProjectSheet,
  ProjectSheet,
  RenameSheet,
  report,
  RowMenu,
  useSessionActions,
} from './SessionOrganiser.tsx';
import { ForeignSessions } from './ForeignSessions.tsx';
import { ExportSheet, ImportSheet } from './ExportImport.tsx';
import { ShareSheet } from '../shares/ShareSheet.tsx';
import { NewWorktreeSheet, useLinkedWorktrees, useWorktreeActions } from './Worktree.tsx';
import type { ForeignSession } from './foreign-sessions.ts';
import { BULK_DELETE_MAX, nameOf, type Outcome, type SessionActions } from './sessions-actions.ts';
import { EMPTY_SELECTION, keepPresent, selectAll, selectRange, toggle, type Selection } from './sessions-gestures.ts';
import { createSessionList, type SessionList, type SessionListState } from './sessions-list.ts';
import { groupByProject, type Project } from './sessions-projects.ts';
import { useRowGestures, type SwipeKind } from './use-row-gestures.ts';
import { useDensity, setDensity } from './sessions-prefs.ts';
import { useDraftIndexLoaded, useHasDraft } from './draft-index.ts';
import {
  activityLabel,
  AUTOMATION_SOURCES,
  flattenGroups,
  groupSessions,
  isInTab,
  moveSelection,
  PULL_THRESHOLD,
  pull,
  readSessionsView,
  sessionsSearch,
  sourceIcon,
  sourceLabel,
  withTab,
  type ListEntry,
  type ListScope,
  type SessionItem,
  type SessionsTab,
  type SessionsView,
} from './sessions-model.ts';
import { readHermes } from './read-hermes.ts';
import { filterCount, filterItems, footerLine, KIND_OPTIONS, MORE_ITEMS, setFilter, stateWord, type MoreId, type SwitchFilterId } from './sessions-rail.ts';
import { SearchField, SearchResults, useSessionSearch } from './SessionSearch.tsx';
import { useStore } from './use-store.ts';
import { captureAnchor, layoutOf, restoreAnchor, visibleWindow, type Anchor } from './virtual-list.ts';
import './sessions.css';
import { pinRefusal, useChatBehaviour } from './chat-behaviour.ts';

/** The sheet that is open over the list, if one is. */
type Sheeted =
  | { kind: 'menu'; item: SessionItem }
  | { kind: 'rename'; item: SessionItem }
  | { kind: 'move'; items: readonly SessionItem[] }
  | { kind: 'new-project'; moveItems?: readonly SessionItem[] }
  | { kind: 'project'; project: Project }
  | { kind: 'cleanup' }
  | { kind: 'foreign'; initial?: ForeignSession }
  | { kind: 'export'; item: SessionItem }
  | { kind: 'share'; item: SessionItem }
  | { kind: 'import' }
  | { kind: 'new-worktree'; item: SessionItem };

const INITIAL: SessionListState = {
  items: [],
  total: 0,
  hasMore: false,
  loaded: false,
  loadingMore: false,
  refreshing: false,
  error: undefined,
  live: {},
  stats: undefined,
  profileTotals: undefined,
  unreadableProfiles: [],
  projects: [],
  projectOf: {},
};

/** The keys of the list's own filters in the address; whatever else the address carries (`?message=`, `?profile=`) is left alone. */
const LIST_KEYS = ['tab', 'source', 'failed', 'quiet', 'all', 'archived', 'group'];

/** The search in the address (`?q=`): the words the list is searched for, in place of the sessions. */
const queryOf = (search: Record<string, unknown>): string => (typeof search.q === 'string' ? search.q : '');

/** The estimated heights before the first header and row have been measured. */
const ESTIMATE = { header: 36, row: 48 };
const OVERSCAN = 8;
/** Rows from the end at which the next page is read. */
const READ_AHEAD = 20;

interface Place {
  /** How far the top of the list is above the top of what can be seen of it (px). */
  top: number;
  viewport: number;
}

/** What scrolls the list: the pane's list area, between its search and its footer (a column beside the conversation, and the sheet on a phone). */
function scrollerOf(element: HTMLElement | null): HTMLElement | undefined {
  const list = element?.closest<HTMLElement>('.sl__body');
  return list && getComputedStyle(list).overflowY === 'auto' ? list : undefined;
}

/** The list is scrolled to its top, so that a pull down is a pull to refresh and not the page scrolling back. */
const atTopOf = (element: HTMLElement | null): boolean => (scrollerOf(element)?.scrollTop ?? window.scrollY) <= 0;

/** Where the list is on screen, following the scroll of whatever scrolls it. `scrollBy` moves that scroller. */
function useScrollPlace(body: RefObject<HTMLElement | null>): { place: Place; scrollBy(delta: number): void } {
  const [place, setPlace] = useState<Place>({ top: 0, viewport: 800 });

  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    const scroller = scrollerOf(element);
    let frame = 0;
    const measure = () => {
      frame = 0;
      const viewTop = scroller ? scroller.getBoundingClientRect().top : 0;
      const viewport = scroller ? scroller.clientHeight : window.innerHeight;
      const top = Math.max(0, viewTop - element.getBoundingClientRect().top);
      setPlace((previous) => (previous.top === top && previous.viewport === viewport ? previous : { top, viewport }));
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    scroller?.addEventListener('scroll', schedule, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      scroller?.removeEventListener('scroll', schedule);
    };
  }, [body]);

  return { place, scrollBy: (delta) => (scrollerOf(body.current) ?? window).scrollBy(0, delta) };
}

/** What the rows need to organise sessions: the selection, and what each gesture and menu entry does. */
interface Organise {
  selecting: boolean;
  selected: ReadonlySet<string>;
  /** A click on a row while selecting, or a shift-click on any row. */
  onPick(item: SessionItem, shift: boolean): void;
  onMenu(item: SessionItem): void;
  onSwipe(item: SessionItem, action: SwipeKind): void;
  onEditProject(project: Project): void;
  archivedView: boolean;
}

interface RowsProps {
  entries: ListEntry[];
  view: SessionsView;
  scope: ListScope;
  activeId: string | undefined;
  live: SessionListState['live'];
  hasMore: boolean;
  loadingMore: boolean;
  onMore(): void;
  /** The tab's profile, so that a session of another one can be told apart. */
  profile: string;
  organise: Organise;
}

/** The link that opens a session: it keeps the list's filters, and a session of another profile scopes the tab to that profile while the list stays across every profile. */
function openHref(item: SessionItem, view: SessionsView, scope: ListScope): string {
  const query = new URLSearchParams(sessionsSearch(view, scope));
  if (view.all && item.profile !== undefined) query.set('profile', item.profile);
  const text = query.toString();
  return `/chat/${encodeURIComponent(item.id)}${text ? `?${text}` : ''}`;
}

interface RowProps {
  item: SessionItem;
  index: number;
  total: number;
  view: SessionsView;
  scope: ListScope;
  profile: string;
  open: boolean;
  tabbable: boolean;
  focused: boolean;
  live: 'running' | 'waiting' | undefined;
  now: number;
  organise: Organise;
  onFocusRow(): void;
}

/** One session: its title and time, with one word more when it needs the owner. The ⋮ menu button shows on hover and focus (and on the open session), and on a touch screen the swipe that reveals archive and pin beneath the row is the way. */
function SessionRow({ item, index, total, view, scope, profile, open, tabbable, focused, live, now, organise, onFocusRow }: RowProps) {
  const { selecting, selected } = organise;
  const gesture = useRowGestures({ enabled: !selecting, onSwipe: (action) => organise.onSwipe(item, action), onLongPress: () => organise.onMenu(item) });
  const checked = selected.has(item.id);
  const name = nameOf(item);
  const drafted = useHasDraft(item.profile ?? profile, item.id);
  const word = stateWord({ item, live, drafted });
  const restoring = item.archived || organise.archivedView;
  return (
    <li
      className="sl__item"
      data-sl="row"
      data-checked={checked ? '' : undefined}
      data-swiping={gesture.offset === 0 ? undefined : ''}
      data-swipe={gesture.action}
      style={{ '--swipe': `${gesture.offset}px` } as CSSProperties}
      aria-setsize={total}
      aria-posinset={index + 1}
      {...gesture.handlers}
    >
      <span className="sl__swipe" aria-hidden="true">
        <span className="sl__swipe-side" data-side="archive">
          <Icon name="archive" />
          {restoring ? 'Restore' : 'Archive'}
        </span>
        <span className="sl__swipe-side" data-side="pin">
          <Icon name="pin" />
          {item.pinned ? 'Unpin' : 'Pin'}
        </span>
      </span>
      {selecting && (
        <input
          type="checkbox"
          className="sl__check"
          aria-label={`Select ${name}`}
          checked={checked}
          onChange={() => undefined}
          onClick={(event) => organise.onPick(item, event.shiftKey)}
        />
      )}
      <AppLink
        className="sl__row"
        to={openHref(item, view, scope)}
        data-session-id={item.id}
        data-selected={focused ? '' : undefined}
        tabIndex={tabbable ? 0 : -1}
        aria-current={open ? 'page' : undefined}
        onFocus={onFocusRow}
        onClick={(event) => {
          if (gesture.swallowsClick()) event.preventDefault();
          else if (selecting || event.shiftKey) {
            event.preventDefault();
            organise.onPick(item, event.shiftKey);
          }
        }}
      >
        <span className="sl__title" data-unread={item.unread ? '' : undefined}>
          {item.pinned && (
            <>
              <Icon name="pin" small />
              <span className="sr-only">Pinned: </span>
            </>
          )}
          {AUTOMATION_SOURCES.includes(item.source) && (
            <>
              <Icon name={sourceIcon(item.source)} small />
              <span className="sr-only">{sourceLabel(item.source)}: </span>
            </>
          )}
          {item.unread && <span className="sr-only">Unread: </span>}
          {name}
        </span>
        {view.all && item.profile !== undefined && item.profile !== profile && <span className="sl__who">{item.profile}</span>}
        {word && (
          <span className="sl__state" data-state={word}>
            {word}
          </span>
        )}
        <time className="sl__time" dateTime={new Date(item.lastActive * 1000).toISOString()}>
          {activityLabel(item.lastActive, { now })}
        </time>
      </AppLink>
      <button type="button" className="btn btn--ghost btn--icon sl__kebab" aria-label={`Actions for ${name}`} aria-haspopup="dialog" onClick={() => organise.onMenu(item)}>
        <Icon name="dots-v" />
      </button>
    </li>
  );
}

function SessionRows({ entries, scope, view, activeId, live, hasMore, loadingMore, onMore, profile, organise }: RowsProps) {
  const body = useRef<HTMLUListElement>(null);
  const density = useDensity();
  const { place, scrollBy } = useScrollPlace(body);
  const [selected, setSelected] = useState<string>();
  const pendingFocus = useRef<string | undefined>(undefined);
  const anchor = useRef<Anchor | undefined>(undefined);
  const [measured, setMeasured] = useState(ESTIMATE);
  const now = Date.now() / 1000;

  // A header and a row each have one height (the stylesheet fixes them by density): the first of each, as it is, is every one's.
  useLayoutEffect(() => {
    const size = (kind: 'header' | 'row') => body.current?.querySelector<HTMLElement>(`[data-sl="${kind}"]`)?.getBoundingClientRect().height;
    const header = size('header') ?? measured.header;
    const row = size('row') ?? measured.row;
    if (Math.abs(header - measured.header) > 0.5 || Math.abs(row - measured.row) > 0.5) setMeasured({ header, row });
  });

  const keys = useMemo(() => entries.map((entry) => entry.key), [entries]);
  const layout = useMemo(
    () =>
      layoutOf(
        entries.map((entry) => (entry.kind === 'header' ? measured.header : measured.row)),
        measured.row,
        0,
      ),
    [entries, measured],
  );
  const shown = visibleWindow({ layout, scrollTop: place.top, viewport: place.viewport, overscan: OVERSCAN });
  const rowIds = useMemo(() => entries.flatMap((entry) => (entry.kind === 'row' ? [entry.item.id] : [])), [entries]);
  const tabbable = selected !== undefined && rowIds.includes(selected) ? selected : activeId !== undefined && rowIds.includes(activeId) ? activeId : rowIds[0];

  // The reader's place in the list is the session at the top of the screen: when the list changes under them (a session was made, one finished) it stays there.
  useLayoutEffect(() => {
    const kept = anchor.current;
    if (!kept || place.top <= 1) return;
    const target = restoreAnchor(kept, keys, layout);
    if (target !== undefined && Math.abs(target - place.top) > 1) scrollBy(target - place.top);
  }, [keys, layout]);
  // Declared after the effect above, so that it records the place the reader is at for the next change to keep.
  useLayoutEffect(() => {
    anchor.current = captureAnchor({ keys, layout, scrollTop: place.top });
  });

  // Near the end, the next page is read.
  useEffect(() => {
    if (hasMore && !loadingMore && shown.end >= entries.length - READ_AHEAD) onMore();
  }, [hasMore, loadingMore, shown.end, entries.length]);

  // A row the keyboard moved to gets focus as soon as it is in the page (scrolling it into view is what puts it there).
  useLayoutEffect(() => {
    const id = pendingFocus.current;
    if (id === undefined) return;
    const row = [...(body.current?.querySelectorAll<HTMLElement>('[data-session-id]') ?? [])].find((element) => element.dataset.sessionId === id);
    if (!row) return;
    pendingFocus.current = undefined;
    row.focus({ preventScroll: true });
  });

  const select = (id: string) => {
    setSelected(id);
    pendingFocus.current = id;
    const at = keys.indexOf(id);
    const top = layout.offsets[at]!;
    const bottom = layout.offsets[at + 1]!;
    if (top < place.top) scrollBy(top - place.top);
    else if (bottom > place.top + place.viewport) scrollBy(bottom - place.top - place.viewport);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLUListElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const focused = (event.target as HTMLElement).closest<HTMLElement>('[data-session-id]');
    if (!focused) return;
    const next = moveSelection(rowIds, focused.dataset.sessionId, event.key);
    if (next === undefined || !['j', 'k', 'ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    select(next);
  };

  return (
    <>
      {/* The keys work where the focus is in the list (not as shortcuts anywhere on the page), so they are not among the single-key shortcuts WCAG 2.1.4 lets the owner turn off. */}
      <ul ref={body} className="sl__rows" data-density={density} data-grouping={view.group === 'project' && !view.all ? 'project' : 'date'} aria-label="Sessions" onKeyDown={onKeyDown}>
        {shown.before > 0 && <li aria-hidden="true" className="sl__spacer" style={{ blockSize: shown.before }} />}
        {entries.slice(shown.start, shown.end).map((entry, offset) => {
          const index = shown.start + offset;
          if (entry.kind === 'header') {
            const { project } = entry;
            return (
              <li key={entry.key} className="sl__header" data-sl="header" aria-setsize={entries.length} aria-posinset={index + 1}>
                {project && <span className="sl-dot" data-tone={project.tone ?? 'neutral'} aria-hidden="true" />}
                <h3>{entry.label}</h3>
                {project && <span className="sl__count">{entry.count}</span>}
                {project && (
                  <button type="button" className="btn btn--ghost btn--icon sl__kebab" aria-label={`Edit project ${project.name}`} aria-haspopup="dialog" onClick={() => organise.onEditProject(project)}>
                    <Icon name="dots-v" small />
                  </button>
                )}
              </li>
            );
          }
          const { item } = entry;
          return (
            <SessionRow
              key={entry.key}
              scope={scope}
              item={item}
              index={index}
              total={entries.length}
              view={view}
              profile={profile}
              open={item.id === activeId}
              tabbable={item.id === tabbable}
              focused={item.id === selected}
              live={live[item.id]}
              now={now}
              organise={organise}
              onFocusRow={() => setSelected(item.id)}
            />
          );
        })}
        {shown.after > 0 && <li aria-hidden="true" className="sl__spacer" style={{ blockSize: shown.after }} />}
      </ul>
      {hasMore && (
        <button type="button" className="btn btn--secondary sl__more" disabled={loadingMore} aria-busy={loadingMore} onClick={onMore}>
          {loadingMore ? 'Loading more…' : 'Load more sessions'}
        </button>
      )}
    </>
  );
}

/** Choosing the source: the sources Hermes has in this tab, with their counts. */
function SourceSheet({
  choices,
  current,
  onPick,
  onClose,
}: {
  choices: { value: string; count: number | undefined }[];
  current: string | undefined;
  onPick(source: string | undefined): void;
  onClose(): void;
}) {
  const listed = current !== undefined && !choices.some((choice) => choice.value === current) ? [...choices, { value: current, count: 0 }] : choices;
  return (
    <Sheet title="Source" detents={listed.length > 6 ? ['half', 'full'] : ['auto']} initialFocus='[aria-checked="true"]' onClose={onClose}>
      <div className="plist" role="radiogroup" aria-label="Source">
        {[{ value: undefined, count: undefined }, ...listed].map((choice) => (
          <button key={choice.value ?? 'any'} type="button" role="radio" aria-checked={choice.value === current} className="plist__row" onClick={() => onPick(choice.value)}>
            <Icon name={choice.value === undefined ? 'filter' : sourceIcon(choice.value)} small />
            <span className="plist__main">
              <span className="plist__name">{choice.value === undefined ? 'Any source' : sourceLabel(choice.value)}</span>
            </span>
            {choice.count !== undefined && <span className="mono subtle">{choice.count}</span>}
            <span className="plist__check">{choice.value === current && <Icon name="check" />}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** Pulling the list down from its top refreshes it; the Refresh button is the way for everyone who does not pull. */
interface PullToRefresh {
  /** How far the list is pulled down now (px). */
  distance: number;
  armed: boolean;
  handlers: { onTouchStart(event: TouchEvent): void; onTouchMove(event: TouchEvent): void; onTouchEnd(): void };
}

function usePullToRefresh(atTop: () => boolean, refresh: () => void): PullToRefresh {
  const [state, setState] = useState({ distance: 0, armed: false });
  const start = useRef<number | undefined>(undefined);
  return {
    ...state,
    handlers: {
      onTouchStart: (event) => {
        start.current = event.touches.length === 1 && atTop() ? event.touches[0]!.clientY : undefined;
      },
      onTouchMove: (event) => {
        if (start.current === undefined) return;
        setState(pull({ startY: start.current, y: event.touches[0]!.clientY, atTop: atTop() }));
      },
      onTouchEnd: () => {
        if (state.armed) refresh();
        start.current = undefined;
        setState({ distance: 0, armed: false });
      },
    },
  };
}

/** The sessions of Hermes, as the Chat module's list pane. */
export function SessionsPane({ profile, activeId, scope = 'everyone' }: { profile: string; activeId: string | undefined; /** Whose sessions the list shows when the address does not say: every profile's (the default) or the tab's agent's own (Talk). */ scope?: ListScope }) {
  // The rows that have an unsent draft say so; which ones is read from Caduceus now and whenever the page is looked at again.
  useDraftIndexLoaded();
  const status = useGatewayStatus();
  const navigate = useAppNavigate();
  const replaceAddress = useAddressReplace();
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const view = useMemo(() => readSessionsView(search, scope), [scope, search.tab, search.source, search.failed, search.quiet, search.all, search.archived, search.group]);
  const query = queryOf(search);
  const found = useSessionSearch(profile, query);
  const searching = query.trim() !== '';
  /** Puts the words searched for in the address (replacing the entry: typing is not a place to go back to); the list's filters and everything else in it stay. */
  const searchFor = useCallback(
    (next: string) => {
      const kept = Object.entries(search).filter(([key, value]) => key !== 'q' && key !== 'profile' && typeof value === 'string');
      const text = new URLSearchParams([...kept.map(([key, value]) => [key, String(value)] as [string, string]), ...(next.trim() === '' ? [] : [['q', next] as [string, string]])]).toString();
      replaceAddress(`${location.pathname}${text ? `?${text}` : ''}`);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [replaceAddress, JSON.stringify(search)],
  );
  const [list, setList] = useState<SessionList>();
  const [choosing, setChoosing] = useState(false);
  // On a phone the list is a sheet from the header's button; its header is then the sheet's own.
  const compact = useSizeClass() === 'compact';
  const kindLabel = useId();
  const [sheet, setSheet] = useState<Sheeted>();
  const [selecting, setSelecting] = useState(false);
  const [selection, setSelection] = useState<Selection>(EMPTY_SELECTION);
  const sessionActions = useSessionActions(profile);
  const refreshList = useCallback(() => void list?.refresh(), [list]);
  const worktreeActions = useWorktreeActions(profile, refreshList);
  const density = useDensity();
  const body = useRef<HTMLDivElement>(null);
  const marked = useRef(new Set<string>());

  useEffect(() => {
    const made = createSessionList({ connection: gatewayConnection(), rest: readHermes, profile, view });
    setList(made);
    return () => made.dispose();
  }, [profile]);
  useEffect(() => list?.setView(view), [list, view]);

  const state = useStore(list, INITIAL);
  const { items, loaded, error, refreshing } = state;
  // The pin limit (Settings › Chat) is held here, where the pinned sessions are known: a pin that would pass it is refused with the limit named.
  const pinLimit = useChatBehaviour().account.pinLimit;
  const actions = useMemo<SessionActions>(() => {
    const pinned = items.filter((item) => item.pinned).length;
    const refusal = (adding: number): Outcome | undefined => {
      const message = pinRefusal({ pinned, adding, limit: pinLimit });
      return message === undefined ? undefined : { kind: 'failed', message };
    };
    return {
      ...sessionActions,
      setPinned: async (item, pin) => (pin && !item.pinned ? refusal(1) : undefined) ?? sessionActions.setPinned(item, pin),
      pinMany: async (chosen, pin) => (pin ? refusal(chosen.filter((item) => !item.pinned).length) : undefined) ?? sessionActions.pinMany(chosen, pin),
    };
  }, [sessionActions, items, pinLimit]);
  const linkedWorktree = useLinkedWorktrees(items.map((item) => item.cwd));
  const byProject = view.group === 'project' && !view.all;
  const entries = useMemo(
    () => flattenGroups(byProject ? groupByProject(items, state.projects, state.projectOf) : groupSessions(items, { now: Date.now() / 1000 })),
    [items, byProject, state.projects, state.projectOf],
  );
  const order = useMemo(() => entries.flatMap((entry) => (entry.kind === 'row' ? [entry.item.id] : [])), [entries]);
  const chosen = useMemo(() => new Set(selection.ids), [selection]);
  const chosenItems = useMemo(() => items.filter((item) => chosen.has(item.id)), [items, chosen]);
  const projectById = useMemo(() => new Map(state.projects.map((project) => [project.id, project])), [state.projects]);
  const pulling = usePullToRefresh(
    () => atTopOf(body.current),
    () => void list?.refresh(),
  );

  // Rows the list no longer has (deleted, filtered away) are not selected any more.
  useEffect(() => setSelection((now) => keepPresent(now, order)), [order]);
  // Opening a session again after marking it unread reads it again.
  useEffect(() => marked.current.clear(), [activeId]);

  // A session that is opened is read: Hermes is told, and the dot goes at once. A refusal (read-only mode, Hermes away) only leaves the dot.
  useEffect(() => {
    const item = activeId === undefined ? undefined : items.find((candidate) => candidate.id === activeId);
    if (!item?.unread || marked.current.has(item.id)) return;
    marked.current.add(item.id);
    list?.markRead(item.id);
    void fetchTiered({ method: 'PATCH', path: `/api/sessions/${encodeURIComponent(item.id)}`, body: { unread: false, profile: item.profile ?? profile } }).catch(() => undefined);
  }, [items, activeId, list, profile]);

  /** Puts a view in the address (replacing the entry: a filter is not a place to go back to). */
  const show = (next: SessionsView) => {
    const kept = Object.entries(search).filter(([key, value]) => !LIST_KEYS.includes(key) && key !== 'profile' && typeof value === 'string');
    const query = new URLSearchParams([...kept.map(([key, value]) => [key, String(value)] as [string, string]), ...Object.entries(sessionsSearch(next, scope))]).toString();
    replaceAddress(`${location.pathname}${query ? `?${query}` : ''}`);
  };

  /** Runs an action, says how it ended, and reads Hermes's list again. */
  const run = async (action: Promise<Outcome>): Promise<Outcome> => {
    const outcome = await action;
    report(outcome, () => void list?.refresh());
    return outcome;
  };
  const leave = () => {
    setSelecting(false);
    setSelection(EMPTY_SELECTION);
  };
  const toggleSelecting = () => (selecting ? leave() : setSelecting(true));
  const organise: Organise = {
    selecting,
    selected: chosen,
    archivedView: view.archived === true,
    onPick: (item, shift) => {
      setSelecting(true);
      setSelection((now) => (shift ? selectRange(now, order, item.id) : toggle(now, item.id)));
    },
    onMenu: (item) => setSheet({ kind: 'menu', item }),
    onSwipe: (item, action) => void run(action === 'archive' ? actions.setArchived(item, !(item.archived || view.archived)) : actions.setPinned(item, !item.pinned)),
    onEditProject: (project) => setSheet({ kind: 'project', project }),
  };

  /** Closes the sheet and then asks Hermes: a confirmation dialog never opens over a sheet. */
  const doing = (action: () => Promise<unknown>) => {
    setSheet(undefined);
    afterSheet(() => void action());
  };
  const deleted = (item: SessionItem) => async () => {
    const outcome = await run(actions.remove(item));
    // The chat that was open is gone: Back must not return to it, so its entry is replaced.
    if (outcome.kind === 'done' && item.id === activeId) void navigate('/chat', { replace: true });
  };
  const moveProfile = (targets: readonly SessionItem[]) => targets[0]?.profile ?? profile;
  const profilesOf = [...new Set(chosenItems.map((item) => item.profile ?? profile))];
  const bulkBlock = profilesOf.length > 1 ? 'Delete and move work on one profile at a time: this selection has sessions of several.' : undefined;
  const deleteBlock = bulkBlock ?? (chosenItems.length > BULK_DELETE_MAX ? `Hermes deletes at most ${BULK_DELETE_MAX} sessions at once.` : undefined);
  const allPinned = chosenItems.length > 0 && chosenItems.every((item) => item.pinned);

  const sourceChoices = useMemo(() => {
    const counts = state.stats?.bySource ?? Object.fromEntries([...new Set(items.map((item) => item.source))].map((source) => [source, undefined as number | undefined]));
    return Object.entries(counts)
      .filter(([source]) => isInTab(source, view.tab))
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => (b.count ?? 0) - (a.count ?? 0) || a.value.localeCompare(b.value));
  }, [state.stats, items, view.tab]);

  const narrowed = view.source !== undefined || view.failed || view.quiet;
  const everyone = view.all ? Object.keys(state.profileTotals ?? {}).length : 0;
  const strip = footerLine({ view, stats: state.stats, total: state.total, loaded, profiles: everyone });
  const narrowing = filterCount(view, scope);
  /** What each entry of the More menu does; the menu closes first, so a sheet it opens gives the focus back to the button that opened it. */
  const moreActions: Record<MoreId, () => void> = {
    refresh: () => void list?.refresh(),
    compact: () => setDensity(density === 'compact' ? 'comfortable' : 'compact'),
    select: toggleSelecting,
    import: () => setSheet({ kind: 'import' }),
    foreign: () => setSheet({ kind: 'foreign' }),
    cleanup: () => setSheet({ kind: 'cleanup' }),
  };
  return (
    <section className="chat__list sl" aria-label={`Sessions of ${profile}`} data-density={density} {...pulling.handlers}>
      <div className="sl__top">
        <h2 className={compact ? 'sr-only' : 'sl__title-text'}>Sessions</h2>
        <AppLink className="btn btn--ghost btn--icon sl__new" to="/chat/new" aria-label="New chat">
          <Icon name="plus" />
        </AppLink>
      </div>
      <SearchField query={query} onQuery={searchFor} onDown={() => document.querySelector<HTMLElement>('.sl__hits a')?.focus()} />
      <div className="sl__bar">
        <PopoverMenu
          label="Filters"
          align="fill"
          trigger={(props) => (
            <button {...props} className="btn btn--ghost btn--sm sl__tool" hidden={searching} aria-label={narrowing > 0 ? `Filters, ${narrowing} on` : 'Filters'}>
              <Icon name="filter" small />
              Filters
              {narrowing > 0 && <span className="count count--accent">{narrowing}</span>}
            </button>
          )}
        >
          {({ close }) => (
            <>
              <p id={kindLabel} className="sr-only">
                Kind of session
              </p>
              <RadioGroup<SessionsTab> labelledBy={kindLabel} className="seg" value={view.tab} options={KIND_OPTIONS} onChange={(tab) => show(withTab(view, tab))} />
              {filterItems(view, scope).map((entry) =>
                entry.id === 'source' ? (
                  <button
                    key={entry.id}
                    type="button"
                    className="pop__item"
                    aria-haspopup="dialog"
                    onClick={() => {
                      close(true);
                      setChoosing(true);
                    }}
                  >
                    {entry.label}
                    <span className="pop__value">{entry.value}</span>
                  </button>
                ) : entry.id === 'new-project' ? (
                  <ChangeButton
                    key={entry.id}
                    type="button"
                    className="pop__item"
                    aria-haspopup="dialog"
                    onClick={() => {
                      close(true);
                      setSheet({ kind: 'new-project' });
                    }}
                  >
                    <Icon name={entry.icon} small />
                    {entry.label}
                  </ChangeButton>
                ) : (
                  <button
                    key={entry.id}
                    type="button"
                    role="switch"
                    aria-checked={entry.on}
                    className="pop__item"
                    disabled={entry.disabled !== undefined}
                    title={entry.disabled}
                    onClick={() => show(setFilter(view, entry.id as SwitchFilterId))}
                  >
                    {entry.label}
                    <span className="pop__tick" aria-hidden="true">
                      <Icon name="check" small />
                    </span>
                  </button>
                ),
              )}
            </>
          )}
        </PopoverMenu>
        <PopoverMenu
          label="Session actions"
          align="fill"
          trigger={(props) => (
            <button {...props} className="btn btn--ghost btn--icon sl__tool sl__more-menu" aria-label="More session actions">
              <Icon name="dots-v" />
            </button>
          )}
        >
          {({ close }) =>
            MORE_ITEMS.map((entry) => {
              const Button = entry.changesHermes ? ChangeButton : 'button';
              const on = entry.id === 'compact' ? density === 'compact' : entry.id === 'select' ? selecting : undefined;
              return (
                <Button
                  key={entry.id}
                  type="button"
                  className="pop__item"
                  {...(entry.toggle ? { role: 'switch', 'aria-checked': on } : {})}
                  {...(entry.id === 'import' || entry.id === 'cleanup' || entry.id === 'foreign' ? { 'aria-haspopup': 'dialog' as const } : {})}
                  disabled={!list && entry.id !== 'compact'}
                  aria-busy={entry.id === 'refresh' ? refreshing : undefined}
                  onClick={() => {
                    close(true);
                    moreActions[entry.id]();
                  }}
                >
                  <Icon name={entry.icon} small className={entry.id === 'refresh' && refreshing ? 'spin' : undefined} />
                  {entry.label}
                  {entry.toggle && (
                    <span className="pop__tick" aria-hidden="true">
                      <Icon name="check" small />
                    </span>
                  )}
                </Button>
              );
            })
          }
        </PopoverMenu>
      </div>
      {searching && (
        <div className="sl__found">
          <SearchResults state={found} query={query} profile={profile} now={Date.now() / 1000} />
        </div>
      )}
      {choosing && (
        <SourceSheet
          choices={sourceChoices}
          current={view.source}
          onPick={(source) => {
            setChoosing(false);
            show({ ...view, ...(source === undefined ? { source: undefined } : { source }) });
          }}
          onClose={() => setChoosing(false)}
        />
      )}
      {sheet?.kind === 'menu' && (
        <RowMenu
          item={sheet.item}
          project={byProject ? projectById.get(state.projectOf[sheet.item.id] ?? '') : undefined}
          worktree={linkedWorktree(sheet.item.cwd)}
          archivedView={view.archived === true}
          onClose={() => setSheet(undefined)}
          onPin={() => doing(() => run(actions.setPinned(sheet.item, !sheet.item.pinned)))}
          onArchive={() => doing(() => run(actions.setArchived(sheet.item, !(sheet.item.archived || view.archived))))}
          onUnread={() => doing(() => run(actions.setUnread(sheet.item, !sheet.item.unread)))}
          onRename={() => setSheet({ kind: 'rename', item: sheet.item })}
          onRegenerateTitle={() => doing(() => run(actions.regenerateTitle(sheet.item)))}
          onMove={() => setSheet({ kind: 'move', items: [sheet.item] })}
          onMoveOut={() => doing(() => run(actions.moveOut([sheet.item])))}
          onDuplicate={() => doing(() => worktreeActions.duplicate(sheet.item))}
          onNewWorktree={() => setSheet({ kind: 'new-worktree', item: sheet.item })}
          onRemoveWorktree={() => doing(() => worktreeActions.removeWorktree(sheet.item))}
          onExport={() => setSheet({ kind: 'export', item: sheet.item })}
          onShare={() => setSheet({ kind: 'share', item: sheet.item })}
          onSelect={() => {
            setSheet(undefined);
            organise.onPick(sheet.item, false);
          }}
          onDelete={() => doing(deleted(sheet.item))}
        />
      )}
      {sheet?.kind === 'rename' && <RenameSheet item={sheet.item} onSave={(title) => doing(() => run(actions.rename(sheet.item, title)))} onClose={() => setSheet(undefined)} />}
      {sheet?.kind === 'move' && (
        <MoveSheet
          items={sheet.items}
          actions={actions}
          profile={moveProfile(sheet.items)}
          onPick={(project) => doing(async () => {
            const outcome = await run(actions.moveToProject(sheet.items, project));
            if (outcome.kind === 'done') leave();
            return outcome;
          })}
          onMoveOut={() => doing(async () => {
            const outcome = await run(actions.moveOut(sheet.items));
            if (outcome.kind === 'done') leave();
            return outcome;
          })}
          onNewProject={() => setSheet({ kind: 'new-project', moveItems: sheet.items })}
          onClose={() => setSheet(undefined)}
        />
      )}
      {sheet?.kind === 'new-project' && (
        <NewProjectSheet
          onClose={() => setSheet(undefined)}
          onCreate={(made) => {
            const back = sheet.moveItems;
            setSheet(undefined);
            afterSheet(() =>
              void actions.createProject(moveProfile(back ?? []), made).then((outcome) => {
                if (outcome.kind === 'created') {
                  report({ kind: 'done', message: `Created the project ${outcome.project.name}` }, () => void list?.refresh());
                  if (back) setSheet({ kind: 'move', items: back });
                } else {
                  report(outcome, () => undefined);
                }
              }),
            );
          }}
        />
      )}
      {sheet?.kind === 'project' && (
        <ProjectSheet
          project={sheet.project}
          onClose={() => setSheet(undefined)}
          onRename={(name) => doing(() => run(actions.renameProject(profile, sheet.project, name)))}
          onRecolour={(tone) => doing(() => run(actions.recolourProject(profile, sheet.project, tone)))}
        />
      )}
      {sheet?.kind === 'cleanup' && (
        <CleanUpSheet
          actions={actions}
          profile={profile}
          onClose={() => setSheet(undefined)}
          onEmpty={() => doing(() => run(actions.removeEmpty(profile)))}
          onPrune={(days) => doing(() => run(actions.prune(profile, { olderThanDays: days })))}
        />
      )}
      {sheet?.kind === 'foreign' && (
        <ForeignSessions
          profile={profile}
          initial={sheet.initial}
          onClose={() => setSheet(undefined)}
          onImported={() => void list?.refresh()}
          onReopen={(initial) => setSheet({ kind: 'foreign', initial })}
        />
      )}
      {sheet?.kind === 'export' && <ExportSheet item={sheet.item} profile={profile} onClose={() => setSheet(undefined)} />}
      {sheet?.kind === 'share' && <ShareSheet item={sheet.item} profile={profile} onClose={() => setSheet(undefined)} />}
      {sheet?.kind === 'import' && <ImportSheet profile={profile} onClose={() => setSheet(undefined)} onImported={() => void list?.refresh()} />}
      {sheet?.kind === 'new-worktree' && (
        <NewWorktreeSheet
          item={sheet.item}
          onClose={() => setSheet(undefined)}
          onCreate={(input) => doing(() => worktreeActions.startSession(sheet.item, input))}
        />
      )}
      {error && (
        <div className="banner" data-tone="danger" role="alert">
          <Icon name="alert" />
          <div className="banner__content">
            <strong>{loaded ? 'Hermes did not answer, so this list may be out of date' : 'Hermes did not give the sessions'}</strong>
            <p>{error}</p>
          </div>
          <button type="button" className="btn btn--secondary btn--sm" onClick={() => void list?.refresh()}>
            <Icon name="refresh" small />
            Try again
          </button>
        </div>
      )}
      {state.unreadableProfiles.length > 0 && (
        <p className="banner" data-tone="warning" role="status">
          <Icon name="alert" />
          <span className="banner__content">Hermes could not read every profile: {state.unreadableProfiles.join(' · ')}</span>
        </p>
      )}
      <div ref={body} className="sl__body" hidden={searching}>
        <div className="sl__pull" aria-hidden={pulling.distance === 0} style={{ blockSize: pulling.distance }} data-armed={pulling.armed ? '' : undefined}>
          {pulling.distance > 0 && (
            <>
              <Icon name="refresh" small />
              <span>{pulling.distance >= PULL_THRESHOLD ? 'Release to refresh' : 'Pull to refresh'}</span>
            </>
          )}
        </div>
        {!loaded && !error && <p className="subtle sl__status">{status.state === 'connected' ? 'Loading sessions…' : 'Waiting for the connection…'}</p>}
        {loaded && items.length === 0 && (
          <div className="empty">
            <span className="empty__icon">
              <Icon name={narrowed ? 'filter' : view.tab === 'automation' ? 'clock' : 'chat'} />
            </span>
            {narrowed || view.archived || view.tab === 'automation' || view.all ? (
              <>
                <h3>No sessions here</h3>
                <p>
                  {narrowed ? (
                    'No session passes the filters that are on.'
                  ) : view.archived ? (
                    'Nothing is archived. A session you archive leaves the list and waits here.'
                  ) : view.tab === 'automation' ? (
                    <>
                      Hermes has no <Term id="automation-sessions">automation sessions</Term> yet.
                    </>
                  ) : (
                    'No profile has a chat yet.'
                  )}
                </p>
                {narrowed && (
                  <button type="button" className="btn btn--secondary" onClick={() => show({ ...view, source: undefined, failed: false, quiet: false })}>
                    Clear filters
                  </button>
                )}
              </>
            ) : (
              <>
                <h3>No chats yet</h3>
                <p>Start a conversation with Hermes in this profile.</p>
              </>
            )}
            <AppLink className="btn btn--primary" to="/chat/new">
              <Icon name="plus" />
              New chat
            </AppLink>
          </div>
        )}
        {entries.length > 0 && (
          <SessionRows
            entries={entries}
            scope={scope}
            view={view}
            activeId={activeId}
            live={state.live}
            hasMore={state.hasMore}
            loadingMore={state.loadingMore}
            onMore={() => void list?.loadMore()}
            profile={profile}
            organise={organise}
          />
        )}
      </div>
      {selecting && (
        <div className="sl__bulk" role="region" aria-label="Selected sessions">
          <div className="sl__bulk-head">
            <p className="sl__bulk-count" aria-live="polite">
              {selection.ids.length === 0 ? 'Select sessions' : `${selection.ids.length} selected`}
            </p>
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setSelection(selectAll(order))}>
              Select all{order.length > 0 ? ` (${order.length})` : ''}
            </button>
            <button type="button" className="btn btn--secondary btn--sm" onClick={leave}>
              Done
            </button>
          </div>
          <div className="sl__bulk-actions">
            <ChangeButton
              type="button"
              className="btn btn--secondary btn--sm"
              data-act="bulk-pin"
              disabled={chosenItems.length === 0}
              onClick={() => void run(actions.pinMany(chosenItems, !allPinned)).then((outcome) => outcome.kind === 'done' && leave())}
            >
              <Icon name="pin" small />
              {allPinned ? 'Unpin' : 'Pin'}
            </ChangeButton>
            <ChangeButton
              type="button"
              className="btn btn--secondary btn--sm"
              data-act="bulk-archive"
              disabled={chosenItems.length === 0}
              onClick={() => void run(actions.archiveMany(chosenItems, view.archived !== true)).then((outcome) => outcome.kind === 'done' && leave())}
            >
              <Icon name="archive" small />
              {view.archived ? 'Restore' : 'Archive'}
            </ChangeButton>
            <ChangeButton
              type="button"
              className="btn btn--secondary btn--sm"
              data-act="bulk-move"
              aria-haspopup="dialog"
              disabled={chosenItems.length === 0 || bulkBlock !== undefined}
              title={bulkBlock}
              onClick={() => setSheet({ kind: 'move', items: chosenItems })}
            >
              <Icon name="folder" small />
              Move…
            </ChangeButton>
            <ChangeButton
              type="button"
              className="btn btn--danger-quiet btn--sm"
              data-act="bulk-delete"
              aria-haspopup="dialog"
              disabled={chosenItems.length === 0 || deleteBlock !== undefined}
              title={deleteBlock}
              onClick={() => void run(actions.removeMany(chosenItems)).then((outcome) => outcome.kind === 'done' && leave())}
            >
              <Icon name="trash" small />
              Delete…
            </ChangeButton>
          </div>
          {(bulkBlock ?? deleteBlock) && <p className="sl__bulk-note subtle">{bulkBlock ?? deleteBlock}</p>}
        </div>
      )}
      {strip && !searching && <p className="sl__foot">{strip}</p>}
    </section>
  );
}
