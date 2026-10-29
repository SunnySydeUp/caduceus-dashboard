import { useEffect, useRef, useState } from 'react';
import { useParams, useSearch } from '@tanstack/react-router';
import { Icon, type IconName } from '../../icons.tsx';
import { closeAllLayers } from '../../overlays/layers.ts';
import { Sheet } from '../../overlays/Sheet.tsx';
import { useReadOnly } from '../../policy-state.ts';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { Sigil, UnassignedSigil } from '../../shell/Sigil.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { useSizeClass } from '../../shell/use-size-class.ts';
import { changeCard, changeMany, reclaimTask } from './board-actions.ts';
import { useLiveBoard, useProjectNames } from './board-data.ts';
import { dropChange, type BulkResult, type CardChange, type MenuEntry } from './board-ops.ts';
import { useAssignees, useBoardList, useBoardSide, useDispatcher } from './board-ops-data.ts';
import { BoardSidePanel } from './BoardSide.tsx';
import { BoardsSheet, ExportedSheet } from './BoardsSheet.tsx';
import { AssignSheet, BulkReportSheet, CardMenuSheet, MoveSheet, PrioritySheet } from './CardSheets.tsx';
import { DispatcherBar } from './Dispatcher.tsx';
import { NewTaskLink } from './NewTaskLink.tsx';
import {
  blockReason,
  STATUS_META,
  UNASSIGNED,
  currentLane,
  filterTasks,
  lanesFor,
  phoneLanes,
  priorityLabel,
  readView,
  viewSearch,
  type BoardData,
  type BoardFilters,
  type BoardStatus,
  type BoardTask,
  type BoardView,
  type Lane,
} from './board-model.ts';
import { setPhoneLayout, usePhoneLayout } from './board-prefs.ts';
import { usePlaybookNames } from './playbook-run-data.ts';
import { playbookLabel, playbookOptions, playbookTagText, type PlaybookNames } from './task-playbook.ts';
import { TaskPeekPanel } from './TaskPeek.tsx';
import { useCardGestures, useWide, type CardBinding } from './use-card-gestures.ts';
import './board-ops.css';
import './work.css';

const STATUS_ICON: Record<BoardStatus, IconName> = {
  triage: 'draft',
  todo: 'queued',
  scheduled: 'clock',
  ready: 'play',
  running: 'running',
  blocked: 'blocked',
  review: 'flag',
  done: 'succeeded',
};

/** A card needs the owner's eyes when its worker is waiting on them: a review, or a question. */
const needsOwner = (task: BoardTask) => task.status === 'review' || (task.status === 'blocked' && task.blockKind === 'needs_input');

/** What a card needs besides its task: its menu, the selection and the gestures. */
interface CardControls {
  selecting: boolean;
  selected: boolean;
  /** The card is being carried by a drag. */
  lifted: boolean;
  bind: CardBinding;
  onMenu(): void;
  onToggle(): void;
}

function TaskCard({ task, showStatus, onOpen, controls }: { task: BoardTask; showStatus: boolean; onOpen(): void; controls: CardControls }) {
  const priority = priorityLabel(task.priority);
  const reason = blockReason(task);
  const playbookTag = playbookTagText(task);
  const { selecting, selected, lifted, bind } = controls;
  return (
    <li>
      <article className={`kcard${needsOwner(task) ? ' is-attn' : ''}${selected ? ' is-selected' : ''}${lifted ? ' is-lifted' : ''}`} aria-labelledby={`kt-${task.id}`} data-task={task.id} {...bind}>
        <div className="kcard__top">
          {selecting && (
            <button type="button" role="checkbox" aria-checked={selected} aria-label={`Select ${task.title}`} className="kcard__check" data-nodrag onClick={controls.onToggle}>
              {selected && <Icon name="check" small />}
            </button>
          )}
          {priority && (
            <span className="tag prio" data-tone={task.priority > 0 ? 'warning' : 'neutral'}>
              {priority}
            </span>
          )}
          <span className="mono kcard__id">{task.id}</span>
          {task.status === 'running' && (
            <span className="kcard__live" data-tone="running">
              <span className="dot pulse" aria-hidden="true" />
              Running
            </span>
          )}
          {!selecting && (
            <button type="button" className="btn btn--ghost btn--icon btn--sm kcard__more" aria-label={`Actions for ${task.title}`} aria-haspopup="dialog" data-nodrag onClick={controls.onMenu}>
              <Icon name="dots-v" />
            </button>
          )}
        </div>
        <h3 className="kcard__title" id={`kt-${task.id}`}>
          <button type="button" className="kcard__link" aria-haspopup={selecting ? undefined : 'dialog'} aria-pressed={selecting ? selected : undefined} onClick={selecting ? controls.onToggle : onOpen}>
            {task.title}
          </button>
        </h3>
        {showStatus && (
          <div className="kcard__status">
            <span className="tag">{STATUS_META[task.status].label}</span>
          </div>
        )}
        {reason && (
          <p className="kcard__reason" data-tone={reason.tone}>
            <Icon name={reason.icon} small />
            <span>{reason.label}</span>
          </p>
        )}
        <div className="kcard__meta">
          {task.assignee ? (
            <span className="ptag">
              <Sigil name={task.assignee} size="xs" />
              <span className="ptag__name">{task.assignee}</span>
            </span>
          ) : (
            <span className="ptag">
              <UnassignedSigil size="xs" />
              <span className="ptag__name subtle">Unassigned</span>
            </span>
          )}
          {playbookTag && <span className="tag kcard__pb">{playbookTag}</span>}
          {task.commentCount > 0 && (
            <span>
              <Icon name="chat" small />
              {task.commentCount}
              <span className="sr-only"> comments</span>
            </span>
          )}
        </div>
      </article>
    </li>
  );
}

function LaneColumn({ lane, grouping, filtered, onOpen, controlsFor, over }: { lane: Lane; grouping: BoardView['lanes']; filtered: boolean; onOpen(id: string): void; controlsFor(task: BoardTask): CardControls; over: boolean }) {
  const headingId = `lane-${lane.key}`;
  return (
    <section className={`lane${over ? ' is-over' : ''}`} aria-labelledby={headingId} data-lane={lane.key}>
      <header className="lane__head">
        <h2 className="overline lane__title" id={headingId}>
          {lane.status ? <Icon name={STATUS_ICON[lane.status]} small /> : lane.key === UNASSIGNED ? <UnassignedSigil size="xs" /> : <Sigil name={lane.key} size="xs" />}
          {lane.label}
        </h2>
        <span className="lane__n mono" role="img" aria-label={`${lane.tasks.length} ${lane.tasks.length === 1 ? 'task' : 'tasks'}`}>
          {lane.tasks.length}
        </span>
      </header>
      {lane.tasks.length > 0 ? (
        <ul className="kcards">
          {lane.tasks.map((task) => (
            <TaskCard key={task.id} task={task} showStatus={grouping === 'profile'} onOpen={() => onOpen(task.id)} controls={controlsFor(task)} />
          ))}
        </ul>
      ) : (
        <p className="lane__empty">{lane.status && !filtered ? STATUS_META[lane.status].hint : 'No tasks'}</p>
      )}
    </section>
  );
}

interface FilterOption {
  value: string;
  label: string;
  count: number;
}

type FilterKey = 'assignee' | 'priority' | 'project' | 'playbook' | 'tenant';

const FILTER_META: Record<FilterKey, { label: string; icon: IconName; any: string }> = {
  assignee: { label: 'Assignee', icon: 'user', any: 'Any assignee' },
  priority: { label: 'Priority', icon: 'flag', any: 'Any priority' },
  project: { label: 'Project', icon: 'folder', any: 'Any project' },
  playbook: { label: 'Playbook', icon: 'playbook', any: 'Any playbook' },
  tenant: { label: 'Tenant', icon: 'briefcase', any: 'Any tenant' },
};

/** The names the filters show their values by: a project's name for its id, a playbook's name for its id. */
interface FilterNames {
  projects: Readonly<Record<string, string>>;
  playbooks: PlaybookNames;
}

/** The values a filter can take on this board, with how many tasks have each. */
function optionsFor(key: FilterKey, tasks: readonly BoardTask[], names: FilterNames): FilterOption[] {
  if (key === 'playbook') return playbookOptions(tasks, names.playbooks);
  const tally = new Map<string, number>();
  const add = (value: string | null) => tally.set(value ?? '', (tally.get(value ?? '') ?? 0) + 1);
  for (const task of tasks) add(key === 'assignee' ? (task.assignee ?? UNASSIGNED) : key === 'priority' ? String(task.priority) : key === 'project' ? task.projectId : task.tenant);
  const options = [...tally].filter(([value]) => value !== '').map(([value, count]): FilterOption => ({ value, count, label: labelFor(key, value, names) }));
  return key === 'priority' ? options.sort((a, b) => Number(b.value) - Number(a.value)) : options.sort((a, b) => a.label.localeCompare(b.label));
}

function labelFor(key: FilterKey, value: string, names: FilterNames): string {
  if (key === 'assignee') return value === UNASSIGNED ? 'Unassigned' : value;
  if (key === 'priority') return priorityLabel(Number(value)) ?? 'Normal priority';
  if (key === 'project') return names.projects[value] ?? value;
  if (key === 'playbook') return playbookLabel(value, names.playbooks);
  return value;
}

const valueOf = (filters: BoardFilters, key: FilterKey): string | undefined => (filters[key] === undefined ? undefined : String(filters[key]));

function FilterSheet({ filter, options, current, names, onPick, onClose }: { filter: FilterKey; options: FilterOption[]; current: string | undefined; names: FilterNames; onPick(value: string | undefined): void; onClose(): void }) {
  const meta = FILTER_META[filter];
  // A filter the URL holds may match nothing on this board now: it stays listed, so it can be seen and changed.
  const listed = current !== undefined && !options.some((option) => option.value === current) ? [...options, { value: current, label: labelFor(filter, current, names), count: 0 }] : options;
  return (
    <Sheet title={`Filter by ${meta.label.toLowerCase()}`} detents={listed.length > 6 ? ['half', 'full'] : ['auto']} initialFocus='[aria-checked="true"]' onClose={onClose}>
      <div className="plist" role="radiogroup" aria-label={meta.label}>
        {[{ value: undefined, label: meta.any, count: undefined }, ...listed].map((option) => (
          <button key={option.value ?? 'any'} type="button" role="radio" aria-checked={option.value === current} className="plist__row" onClick={() => onPick(option.value)}>
            <span />
            <span className="plist__main">
              <span className="plist__name">{option.label}</span>
            </span>
            <span className="mono subtle">{option.count}</span>
            <span className="plist__check">{option.value === current && <Icon name="check" />}</span>
          </button>
        ))}
      </div>
    </Sheet>
  );
}

export function SearchBox({ text, onChange, scope = 'this board' }: { text: string; onChange(text: string): void; scope?: string }) {
  const [draft, setDraft] = useState(text);
  // The URL changed under it (Clear, back): follow it, unless it is only the draft with its spaces cut.
  useEffect(() => setDraft((current) => (current.trim() === text ? current : text)), [text]);
  return (
    <div className="input-wrap btools__search">
      <Icon name="search" />
      <input
        className="input"
        type="search"
        value={draft}
        placeholder={`Search ${scope}`}
        aria-label={`Search tasks on ${scope}`}
        enterKeyHint="search"
        onChange={(event) => {
          setDraft(event.target.value);
          onChange(event.target.value.trim());
        }}
      />
    </div>
  );
}

function Segmented<T extends string>({ label, value, options, onChange, scroll }: { label: string; value: T; options: { value: T; label: string; count?: number }[]; onChange(value: T): void; scroll?: boolean }) {
  const group = useRef<HTMLDivElement>(null);
  // A row that scrolls keeps the chosen segment in view (a phone's row of statuses is wider than the screen).
  useEffect(() => {
    const row = group.current;
    const chosen = row?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (scroll && row && chosen) row.scrollLeft = chosen.offsetLeft - (row.clientWidth - chosen.offsetWidth) / 2;
  }, [scroll, value]);
  return (
    <div ref={group} className={`seg${scroll ? ' bseg' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" role="radio" aria-checked={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
          {option.count !== undefined && <span className="bseg__n mono">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}

function RepairNotice({ stale, onRetry }: { stale: boolean; onRetry(): void }) {
  return (
    <div className="banner wb-repair" data-tone="danger" role="alert">
      <Icon name="alert" />
      <div className="banner__content">
        <strong>{stale ? 'Hermes did not answer, so this board may be out of date' : 'Hermes’s Kanban did not answer, so there is no board to show'}</strong>
        <p>
          Caduceus reads the board from Hermes each time, and keeps no copy. {stale ? 'These cards are from a moment ago.' : ''} Check <AppLink to="/observe/health">Health</AppLink> to see whether the Hermes backend and the <Term id="dispatcher">dispatcher</Term> are running. Caduceus tries again by itself.
        </p>
      </div>
      <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry}>
        <Icon name="refresh" />
        Try again
      </button>
    </div>
  );
}

function EmptyBoard({ slug }: { slug: string | undefined }) {
  return (
    <div className="empty">
      <Icon name="work" />
      <h2>This board is empty</h2>
      <p>Write a task here, or wait for Hermes to receive them: from the command line, from schedules, or from workers that split a task up.</p>
      <NewTaskLink board={slug} />
    </div>
  );
}

function BoardBody({ board, view, setView, onOpen, controlsFor, overLane }: { board: BoardData; view: BoardView; setView(view: BoardView): void; onOpen(id: string): void; controlsFor(task: BoardTask): CardControls; overLane: string | undefined }) {
  const compact = useSizeClass() === 'compact';
  const phoneLayout = usePhoneLayout();
  const visible = filterTasks(board.tasks, view.filters);
  const lanes = lanesFor(visible, view.lanes);
  const filtered = Object.keys(view.filters).length > 0;

  if (compact && phoneLayout === 'list') {
    const segments = phoneLanes(lanes);
    const current = currentLane(segments, view.lane);
    return (
      <>
        <Segmented label={view.lanes === 'status' ? 'Status' : 'Assignee'} value={current.key} scroll onChange={(lane) => setView({ ...view, lane })} options={segments.map((lane) => ({ value: lane.key, label: lane.label, count: lane.tasks.length }))} />
        <section className="blist" aria-labelledby="blist-h">
          <h2 className="sr-only" id="blist-h">
            {current.label}: {current.tasks.length} {current.tasks.length === 1 ? 'task' : 'tasks'}
          </h2>
          {current.status && !filtered && <p className="blist__hint subtle">{STATUS_META[current.status].hint}</p>}
          {current.tasks.length > 0 ? (
            <ul className="kcards">
              {current.tasks.map((task) => (
                <TaskCard key={task.id} task={task} showStatus={view.lanes === 'profile'} onOpen={() => onOpen(task.id)} controls={controlsFor(task)} />
              ))}
            </ul>
          ) : (
            <p className="lane__empty">{filtered ? 'No tasks match the filters here.' : `Nothing in ${current.label}.`}</p>
          )}
        </section>
      </>
    );
  }
  return (
    // An empty lane stays (it is where a card is dropped) but takes little room, so that Review and Done are in view at 1440 px.
    <div className={`bboard${compact ? ' bboard--snap' : ''}`} style={compact ? undefined : { gridTemplateColumns: lanes.map((lane) => (lane.tasks.length === 0 ? 'minmax(8rem, 10rem)' : 'minmax(15.5rem, 1fr)')).join(' ') }} tabIndex={0} role="region" aria-label="Board lanes, scroll sideways">
      {lanes.map((lane) => (
        <LaneColumn key={lane.key} lane={lane} grouping={view.lanes} filtered={filtered} onOpen={onOpen} controlsFor={controlsFor} over={overLane === lane.key} />
      ))}
    </div>
  );
}

/** What a sheet is about: one card's menu, or the card(s) a Move to…, Assign… or Priority… will change. */
type Chosen = { kind: 'menu'; id: string } | { kind: 'move' | 'assign' | 'priority'; ids: string[] };

export function Board() {
  const { board: slug } = useParams({ strict: false }) as { board?: string };
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const view = readView(search);
  const navigate = useAppNavigate();
  const compact = useSizeClass() === 'compact';
  const phoneLayout = usePhoneLayout();
  const wide = useWide();
  const readOnly = useReadOnly();
  const { state, retry } = useLiveBoard(slug);
  const projects = useProjectNames();
  const playbooks = usePlaybookNames();
  const names: FilterNames = { projects, playbooks };
  const { boards, reload: reloadBoards } = useBoardList();
  const side = useBoardSide(slug, state.board);
  const dispatcher = useDispatcher();
  const assignees = useAssignees(slug);
  const [peeking, setPeeking] = useState<string>();
  const [picking, setPicking] = useState<FilterKey>();
  const [chosen, setChosen] = useState<Chosen>();
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [boardsOpen, setBoardsOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [exported, setExported] = useState<{ file: string; name: string }>();
  const [bulkReport, setBulkReport] = useState<{ results: BulkResult[]; titles: Record<string, string> }>();

  const here = `/work/board${slug ? `/${encodeURIComponent(slug)}` : ''}`;
  const go = (path: string, next: BoardView) => {
    const query = new URLSearchParams(viewSearch(next)).toString();
    void navigate(`${path}${query ? `?${query}` : ''}`, { replace: true });
  };
  const setView = (next: BoardView) => go(here, next);
  /** Opens a board by its address (nothing: the one that is current), with no filters, since they belong to the board they were set on. */
  const openBoard = (address: string) => go(address ? `/work/board/${encodeURIComponent(address)}` : '/work/board', { lanes: view.lanes, filters: {} });

  const named = boards.find((candidate) => (slug ? candidate.slug === slug : candidate.isCurrent));
  const title = named?.name ?? (slug ? slug : 'Board');
  const board = state.board;
  const shown = board ? filterTasks(board.tasks, view.filters) : [];
  const active = Object.keys(view.filters).length;
  const running = board?.tasks.filter((task) => task.status === 'running').length ?? 0;
  const waiting = board?.tasks.filter(needsOwner).length ?? 0;
  const tasksById = new Map((board?.tasks ?? []).map((task) => [task.id, task]));
  const chosenTasks = chosen && chosen.kind !== 'menu' ? chosen.ids.flatMap((id) => tasksById.get(id) ?? []) : [];

  // A card that is gone (moved to another board, deleted) leaves the selection.
  useEffect(() => {
    if (board) setSelected((current) => (current.every((id) => tasksById.has(id)) ? current : current.filter((id) => tasksById.has(id))));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `tasksById` is rebuilt from `board` on every render.
  }, [board]);

  const canDrag = wide && !selecting && !(compact && phoneLayout === 'list');
  const gestures = useCardGestures({
    canDrag,
    onMenu: (id) => setChosen({ kind: 'menu', id }),
    onDrop: (id, lane) => {
      const task = tasksById.get(id);
      if (!task) return;
      const change = dropChange(task, view.lanes, lane);
      if (change === undefined) {
        // Dropped where it already is: nothing to say. Anywhere else Hermes would not take it.
        const same = view.lanes === 'status' ? lane === task.status : lane === (task.assignee ?? UNASSIGNED);
        if (!same) toast(task.status === 'running' ? 'A worker has this task. Reclaim it from its menu first.' : 'Hermes does not take that move. Move to… in the card’s menu lists what it does.');
        return;
      }
      void changeCard(task, change, slug);
    },
  });
  const toggle = (id: string) => setSelected((current) => (current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]));
  const controlsFor = (task: BoardTask): CardControls => ({
    selecting,
    selected: selected.includes(task.id),
    lifted: gestures.dragging?.taskId === task.id,
    bind: gestures.bind(task.id),
    onMenu: () => setChosen({ kind: 'menu', id: task.id }),
    onToggle: () => toggle(task.id),
  });

  const choose = (id: MenuEntry['id'], task: BoardTask) => {
    if (id === 'move' || id === 'assign' || id === 'priority') setChosen({ kind: id, ids: [task.id] });
    else {
      setChosen(undefined);
      if (id === 'reclaim') void closeAllLayers().then(() => reclaimTask(task, slug));
      else if (id === 'select') {
        setSelecting(true);
        setSelected([task.id]);
      } else setPeeking(task.id);
    }
  };

  /** What the owner picked in a sheet: one card changes at once (a T0 with an undo), a selection after a passkey. */
  const apply = (change: CardChange) => {
    if (chosen === undefined || chosen.kind === 'menu') return;
    const tasks = chosenTasks;
    setChosen(undefined);
    if (tasks.length === 1 && !selecting) {
      void changeCard(tasks[0], change, slug);
      return;
    }
    void closeAllLayers().then(async () => {
      const outcome = await changeMany(tasks, change, slug);
      if (outcome.kind === 'cancelled') return;
      if (outcome.kind === 'failed') {
        toast(outcome.message, { tone: 'danger' });
        return;
      }
      const failed = outcome.results.filter((result) => !result.ok);
      if (failed.length === 0) {
        toast(`Changed ${outcome.results.length} ${outcome.results.length === 1 ? 'task' : 'tasks'}.`);
        setSelecting(false);
        setSelected([]);
      } else {
        setSelected(failed.map((result) => result.id));
        setBulkReport({ results: outcome.results, titles: Object.fromEntries(tasks.map((task) => [task.id, task.title])) });
      }
    });
  };

  const sheetTitle = chosenTasks.length === 1 ? chosenTasks[0].title : `${chosenTasks.length} selected tasks`;
  const single = chosenTasks.length === 1 ? chosenTasks[0] : undefined;
  const menuTask = chosen?.kind === 'menu' ? tasksById.get(chosen.id) : undefined;
  const dragged = gestures.dragging ? tasksById.get(gestures.dragging.taskId) : undefined;

  return (
    <div className="bpage">
      <PageHeader
        overline="Work"
        title={title}
        subtitle={
          board ? (
            <>
              {board.tasks.length} {board.tasks.length === 1 ? 'task' : 'tasks'} · {running} running · {waiting} {waiting === 1 ? 'needs' : 'need'} you{active > 0 ? ` · showing ${shown.length}` : ''}
            </>
          ) : (
            'Hermes Kanban'
          )
        }
        actions={
          <>
            <button type="button" className="btn btn--secondary btn--sm" aria-haspopup="dialog" onClick={() => setBoardsOpen(true)}>
              <Icon name="stack" />
              Boards
            </button>
            {board && <StatusBadge state={state.live ? 'online' : 'reconnecting'} label={state.live ? 'Live' : 'Reconnecting'} />}
            {board && board.tasks.length > 0 && <NewTaskLink board={slug} />}
          </>
        }
      />
      <p className="help-text">
        The <Term id="board">board</Term> is Hermes’s Kanban: each card is a <Term id="task">task</Term>, and the <Term id="dispatcher">dispatcher</Term> starts workers on the ready ones.
      </p>

      <DispatcherBar dispatcher={dispatcher} tasks={board?.tasks ?? []} profiles={assignees.map((entry) => entry.name)} slug={slug} />

      {state.phase === 'failed' && <RepairNotice stale={board !== undefined} onRetry={retry} />}
      {state.phase === 'loading' && <p role="status">Loading the board…</p>}

      {board && board.tasks.length === 0 && state.phase !== 'failed' && <EmptyBoard slug={slug} />}
      {board && board.tasks.length > 0 && (
        <>
          <div className="btools" role="search" aria-label="Filter tasks">
            <SearchBox text={view.filters.text ?? ''} onChange={(text) => setView({ ...view, filters: { ...view.filters, text: text === '' ? undefined : text } })} />
            <div className="chips-scroll btools__chips">
              {(Object.keys(FILTER_META) as FilterKey[])
                // A filter with nothing to choose from (no task has a project) is not offered, unless the URL already holds one.
                .filter((key) => valueOf(view.filters, key) !== undefined || optionsFor(key, board.tasks, names).length > 0)
                .map((key) => {
                  const value = valueOf(view.filters, key);
                  return (
                    <button key={key} type="button" className="chip" aria-haspopup="dialog" aria-pressed={value !== undefined} onClick={() => setPicking(key)}>
                      <Icon name={FILTER_META[key].icon} />
                      {FILTER_META[key].label}
                      {value !== undefined && <>: <strong className="chip__val">{labelFor(key, value, names)}</strong></>}
                      <Icon name="chev-d" small />
                    </button>
                  );
                })}
              {active > 0 && (
                <button type="button" className="btn btn--ghost btn--sm" onClick={() => setView({ ...view, filters: {} })}>
                  <Icon name="x" />
                  Clear
                </button>
              )}
            </div>
            <div className="btools__view">
              <button type="button" className="btn btn--secondary btn--sm" aria-pressed={selecting} onClick={() => { setSelecting(!selecting); setSelected([]); }}>
                <Icon name="check" />
                {selecting ? 'Done selecting' : 'Select'}
              </button>
              <button type="button" className="btn btn--secondary btn--sm" aria-haspopup="dialog" onClick={() => setSideOpen(true)}>
                <Icon name="chart" />
                Details
                {side.side && side.side.problemCount > 0 && (
                  <span className="tag" data-tone="warning">
                    {side.side.problemCount}
                    <span className="sr-only"> problems</span>
                  </span>
                )}
              </button>
              <Segmented
                label="Lanes by"
                value={view.lanes}
                onChange={(lanes) => setView({ lanes, filters: view.filters })}
                options={[
                  { value: 'status', label: 'Status' },
                  { value: 'profile', label: 'Profile' },
                ]}
              />
              {compact && (
                <Segmented
                  label="Phone layout"
                  value={phoneLayout}
                  onChange={setPhoneLayout}
                  options={[
                    { value: 'list', label: 'List' },
                    { value: 'columns', label: 'Columns' },
                  ]}
                />
              )}
            </div>
          </div>
          {shown.length === 0 && active > 0 && (
            <div className="empty">
              <Icon name="filter" />
              <h2>No tasks match these filters</h2>
              <p>Clear a filter, or search for something else.</p>
              <button type="button" className="btn btn--secondary" onClick={() => setView({ ...view, filters: {} })}>
                Clear filters
              </button>
            </div>
          )}
          {(shown.length > 0 || active === 0) && <BoardBody board={board} view={view} setView={setView} onOpen={setPeeking} controlsFor={controlsFor} overLane={gestures.overLane} />}
        </>
      )}

      {selecting && (
        <div className="bo-bulk" role="region" aria-label="Selected tasks">
          <p className="bo-bulk__count" role="status">
            {selected.length === 0 ? 'Choose tasks' : `${selected.length} selected`}
          </p>
          <div className="bo-bulk__acts">
            <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={selected.length === 0} onClick={() => setChosen({ kind: 'move', ids: selected })}>
              Move to…
            </WriteButton>
            <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={selected.length === 0} onClick={() => setChosen({ kind: 'assign', ids: selected })}>
              Assign…
            </WriteButton>
            <WriteButton type="button" className="btn btn--secondary btn--sm" disabled={selected.length === 0} onClick={() => setChosen({ kind: 'priority', ids: selected })}>
              Priority…
            </WriteButton>
            <WriteButton
              type="button"
              className="btn btn--danger-quiet btn--sm"
              disabled={selected.length === 0}
              onClick={() => {
                const tasks = selected.flatMap((id) => tasksById.get(id) ?? []);
                void closeAllLayers().then(() => changeMany(tasks, { kind: 'move', to: 'archived' }, slug)).then((outcome) => {
                  if (outcome.kind === 'failed') toast(outcome.message, { tone: 'danger' });
                  if (outcome.kind !== 'done') return;
                  const failed = outcome.results.filter((result) => !result.ok);
                  if (failed.length === 0) {
                    toast(`Archived ${outcome.results.length} ${outcome.results.length === 1 ? 'task' : 'tasks'}.`);
                    setSelecting(false);
                    setSelected([]);
                  } else {
                    setSelected(failed.map((result) => result.id));
                    setBulkReport({ results: outcome.results, titles: Object.fromEntries(tasks.map((task) => [task.id, task.title])) });
                  }
                });
              }}
            >
              Archive
            </WriteButton>
          </div>
          {readOnly && <p className="subtle bo-fine">Read-only mode is on, so nothing can be changed.</p>}
        </div>
      )}

      {picking && board && (
        <FilterSheet
          filter={picking}
          options={optionsFor(picking, board.tasks, names)}
          current={valueOf(view.filters, picking)}
          names={names}
          onClose={() => setPicking(undefined)}
          onPick={(value) => {
            const filters = { ...view.filters };
            delete filters[picking];
            if (value !== undefined) Object.assign(filters, { [picking]: picking === 'priority' ? Number(value) : value });
            setPicking(undefined);
            setView({ ...view, lane: undefined, filters });
          }}
        />
      )}
      {peeking && <TaskPeekPanel taskId={peeking} slug={slug} onClose={() => setPeeking(undefined)} />}

      {menuTask && <CardMenuSheet task={menuTask} readOnly={readOnly} onChoose={(id) => choose(id, menuTask)} onClose={() => setChosen(undefined)} />}
      {chosen?.kind === 'move' && chosenTasks.length > 0 && <MoveSheet title={sheetTitle} task={single} onPick={apply} onClose={() => setChosen(undefined)} />}
      {chosen?.kind === 'assign' && chosenTasks.length > 0 && <AssignSheet title={sheetTitle} names={assignees} current={single ? single.assignee : undefined} onPick={apply} onClose={() => setChosen(undefined)} />}
      {chosen?.kind === 'priority' && chosenTasks.length > 0 && <PrioritySheet title={sheetTitle} current={single?.priority} onPick={apply} onClose={() => setChosen(undefined)} />}
      {bulkReport && <BulkReportSheet results={bulkReport.results} titles={bulkReport.titles} onClose={() => setBulkReport(undefined)} />}

      {boardsOpen && (
        <BoardsSheet
          boards={boards}
          shown={named}
          onOpen={openBoard}
          onChanged={reloadBoards}
          onExported={(file, name) => setExported({ file, name })}
          onClose={() => setBoardsOpen(false)}
        />
      )}
      {exported && <ExportedSheet file={exported.file} name={exported.name} onClose={() => setExported(undefined)} />}
      {sideOpen && <BoardSidePanel state={side} slug={slug} now={Math.floor(Date.now() / 1000)} onClose={() => setSideOpen(false)} />}

      {gestures.dragging && dragged && (
        <div className="kcard-ghost" aria-hidden="true" style={{ insetInlineStart: gestures.dragging.x, insetBlockStart: gestures.dragging.y }}>
          {dragged.title}
        </div>
      )}
    </div>
  );
}
