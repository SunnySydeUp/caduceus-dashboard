import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useSearch } from '@tanstack/react-router';
import type { SavedFilter } from '@caduceus/contracts/task-filters';
import { Icon } from '../../icons.tsx';
import { Sheet } from '../../overlays/Sheet.tsx';
import { AppLink, useAppNavigate } from '../../shell/navigation.tsx';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { useProfileScope } from '../../shell/profile-context.tsx';
import { StatusBadge } from '../../shell/StatusBadge.tsx';
import { Term } from '../../shell/Term.tsx';
import { toast } from '../../shell/toasts.ts';
import { WriteButton } from '../../shell/WriteButton.tsx';
import { loadBoardOnce, useLiveBoard, useProjectNames } from './board-data.ts';
import type { BoardTask } from './board-model.ts';
import { SearchBox } from './Board.tsx';
import { NewTaskLink } from './NewTaskLink.tsx';
import { usePlaybookNames } from './playbook-run-data.ts';
import { playbookLabel, playbookOptions, type PlaybookNames } from './task-playbook.ts';
import { useSavedFilters } from './saved-filters-data.ts';
import { COLUMNS, TaskTable } from './TaskTable.tsx';
import {
  definitionOf,
  describeDefinition,
  hasFailed,
  hermesQuery,
  nextSort,
  readTasksView,
  selectTasks,
  sortTasks,
  tasksSearch,
  waitsForOwner,
  type ActiveFilter,
  type SortColumn,
  type TasksView,
} from './tasks-model.ts';
import './work.css';

/** One value a picker offers, and how many tasks have it. */
interface Choice {
  value: string;
  label: string;
  count: number;
}

type Picker = 'playbook' | 'project';

/** The playbooks and projects the tasks of the board have, read from the whole board even while a filter has narrowed the live one. */
function useChoices(open: boolean, slug: string | undefined, projects: Readonly<Record<string, string>>, playbooks: PlaybookNames): { playbook: Choice[]; project: Choice[] } | undefined {
  const [tasks, setTasks] = useState<BoardTask[]>();
  useEffect(() => {
    if (!open) return;
    let current = true;
    loadBoardOnce(slug).then(
      (board) => current && setTasks(board.tasks),
      () => current && setTasks([]),
    );
    return () => {
      current = false;
    };
  }, [open, slug]);
  return useMemo(() => {
    if (!tasks) return undefined;
    const tally = (pick: (task: BoardTask) => string | null, name: (value: string) => string): Choice[] => {
      const counts = new Map<string, number>();
      for (const task of tasks) {
        const value = pick(task);
        if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      return [...counts].map(([value, count]) => ({ value, count, label: name(value) })).sort((a, b) => a.label.localeCompare(b.label));
    };
    return { playbook: playbookOptions(tasks, playbooks), project: tally((task) => task.projectId, (value) => projects[value] ?? value) };
  }, [tasks, projects, playbooks]);
}

function ChoiceSheet({ title, empty, choices, current, onPick, onClose }: { title: string; empty: string; choices: Choice[] | undefined; current: string | undefined; onPick(value: string): void; onClose(): void }) {
  // A value the address holds may match nothing now: it stays listed, so it can be seen and changed.
  const listed = choices && current !== undefined && !choices.some((choice) => choice.value === current) ? [...choices, { value: current, label: current, count: 0 }] : choices;
  return (
    <Sheet title={title} detents={listed && listed.length > 6 ? ['half', 'full'] : ['auto']} initialFocus='[aria-checked="true"]' onClose={onClose}>
      {listed === undefined && <p role="status">Asking Hermes…</p>}
      {listed?.length === 0 && <p className="subtle">{empty}</p>}
      {listed && listed.length > 0 && (
        <div className="plist" role="radiogroup" aria-label={title}>
          {listed.map((choice) => (
            <button key={choice.value} type="button" role="radio" aria-checked={choice.value === current} className="plist__row" onClick={() => onPick(choice.value)}>
              <span />
              <span className="plist__main">
                <span className="plist__name">{choice.label}</span>
              </span>
              <span className="mono subtle">{choice.count}</span>
              <span className="plist__check">{choice.value === current && <Icon name="check" />}</span>
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
}

/** A sheet that asks for a name: to save the filter that is on, or to rename a saved one. */
function NameSheet({ title, intro, initial, submit, onSubmit, onClose }: { title: string; intro?: ReactNode; initial: string; submit: string; onSubmit(name: string): Promise<void>; onClose(): void }) {
  const id = useId();
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const name = value.trim();
    if (name === '') return setProblem('Give the filter a name.');
    if (name.length > 60) return setProblem('Use 60 characters or fewer.');
    setBusy(true);
    try {
      await onSubmit(name);
      onClose();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Caduceus did not save the filter.');
      setBusy(false);
    }
  };
  return (
    <Sheet title={title} initialFocus="input" onClose={onClose}>
      <form className="stack" onSubmit={(event) => void send(event)} noValidate>
        {intro}
        <div className="field">
          <label className="field__label" htmlFor={id}>
            Name
          </label>
          <input id={id} className="input" value={value} maxLength={60} autoComplete="off" aria-invalid={problem ? true : undefined} aria-describedby={`${id}-error`} onChange={(event) => setValue(event.target.value)} />
          <p className="field__error" id={`${id}-error`} role="alert">
            {problem && (
              <>
                <Icon name="alert" small />
                {problem}
              </>
            )}
          </p>
        </div>
        <div className="row">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <WriteButton type="submit" className="btn btn--primary" disabled={busy} aria-busy={busy}>
            {submit}
          </WriteButton>
        </div>
      </form>
    </Sheet>
  );
}

function RepairNotice({ stale, onRetry }: { stale: boolean; onRetry(): void }) {
  return (
    <div className="banner wb-repair" data-tone="danger" role="alert">
      <Icon name="alert" />
      <div className="banner__content">
        <strong>{stale ? 'Hermes did not answer, so this list may be out of date' : 'Hermes’s Kanban did not answer, so there are no tasks to show'}</strong>
        <p>
          Caduceus reads the tasks from Hermes each time, and keeps no copy. {stale ? 'These rows are from a moment ago.' : ''} Check <AppLink to="/observe/health">Health</AppLink> to see whether the Hermes backend and the <Term id="dispatcher">dispatcher</Term> are running. Caduceus tries again by itself.
        </p>
      </div>
      <button type="button" className="btn btn--secondary btn--sm" onClick={onRetry}>
        <Icon name="refresh" />
        Try again
      </button>
    </div>
  );
}

const BUILT_IN: { kind: 'mine' | 'waiting' | 'failed'; label: string; icon: 'user' | 'waiting' | 'failed' }[] = [
  { kind: 'mine', label: 'Mine', icon: 'user' },
  { kind: 'waiting', label: 'Waiting for me', icon: 'waiting' },
  { kind: 'failed', label: 'Failed', icon: 'failed' },
];

export function Tasks() {
  const search = useSearch({ strict: false }) as Record<string, unknown>;
  const view = readTasksView(search);
  const board = typeof search.board === 'string' ? search.board : undefined;
  const navigate = useAppNavigate();
  const { effective } = useProfileScope();
  const profile = effective?.name ?? 'default';
  const saved = useSavedFilters();
  const projects = useProjectNames();
  const playbooks = usePlaybookNames();
  const [picking, setPicking] = useState<Picker>();
  const [naming, setNaming] = useState<'save' | 'rename'>();

  const savedId = view.filter?.kind === 'saved' ? view.filter.id : undefined;
  const savedFilter = savedId === undefined ? undefined : saved.filters.find((candidate) => candidate.id === savedId);
  const missing = savedId !== undefined && saved.loaded && savedFilter === undefined;
  const definition = definitionOf(view, { profile, saved: saved.filters });
  // What Hermes can answer itself it is asked for; the rest is applied to its answer (`tasks-model.ts`).
  const hermesFilter = definition ? hermesQuery(definition) : '';
  const { state, retry } = useLiveBoard(board, hermesFilter);
  const choices = useChoices(picking !== undefined, board, projects, playbooks);

  const go = (next: TasksView, replace: boolean) => {
    const query = new URLSearchParams({ ...(board === undefined ? {} : { board }), ...tasksSearch(next) }).toString();
    void navigate(`/work/tasks${query ? `?${query}` : ''}`, { replace });
  };
  /** A new filter or sort is a step the Back button undoes; typing in the search box is not. */
  const setFilter = (filter: ActiveFilter | undefined) => go({ ...view, filter }, false);
  const sortBy = (column: SortColumn) => go({ ...view, sort: nextSort(view.sort, column) }, false);

  const tasks = state.board?.tasks;
  const shown = useMemo(() => (tasks && definition ? sortTasks(selectTasks(tasks, definition), view.sort, projects) : []), [tasks, definition, view.sort, projects]);
  // The numbers on the chips are of the whole board, so they show only while Hermes has not narrowed it.
  const counts = useMemo(
    () => (tasks && hermesFilter === '' ? { all: tasks.length, mine: selectTasks(tasks, { assignee: profile }).length, waiting: tasks.filter(waitsForOwner).length, failed: tasks.filter(hasFailed).length } : undefined),
    [tasks, hermesFilter, profile],
  );
  const conditions = definition ? describeDefinition(definition, projects) : [];
  const narrowed = view.filter !== undefined || view.text !== '';
  const phase = state.phase;
  const loading = phase === 'loading' || (view.filter?.kind === 'saved' && !saved.loaded && !saved.error);

  const clear = () => go({ ...view, filter: undefined, text: '' }, false);
  const chip = (key: string, label: ReactNode, pressed: boolean, onClick: () => void, popup = false) => (
    <button key={key} type="button" className="chip" aria-pressed={pressed} aria-haspopup={popup ? 'dialog' : undefined} onClick={onClick}>
      {label}
    </button>
  );

  return (
    <div className="bpage tlist">
      <PageHeader
        overline="Work"
        title="Tasks"
        subtitle={tasks ? `${shown.length} ${shown.length === 1 ? 'task' : 'tasks'}${narrowed ? ' match' : ''}` : 'Hermes Kanban'}
        actions={
          state.board ? (
            <>
              <StatusBadge state={state.live ? 'online' : 'reconnecting'} label={state.live ? 'Live' : 'Reconnecting'} />
              {state.board.tasks.length > 0 && <NewTaskLink board={board} />}
            </>
          ) : undefined
        }
      />
      <p className="help-text">
        Every <Term id="task">task</Term> on the board, in one list. A <Term id="saved-filter">saved filter</Term> is a view you can come back to; <Term id="waiting-for-me">Waiting for me</Term> lists what needs your answer.
      </p>

      {phase === 'failed' && <RepairNotice stale={tasks !== undefined} onRetry={retry} />}
      {loading && <p role="status">Loading the tasks…</p>}

      <div className="tlist__tools" role="search" aria-label="Filter tasks">
        <SearchBox text={view.text} scope="tasks" onChange={(text) => go({ ...view, text }, true)} />
        <div className="chips-scroll" role="group" aria-label="Saved filters">
          {chip('all', <>All{counts && <span className="mono subtle">{counts.all}</span>}</>, view.filter === undefined, () => setFilter(undefined))}
          {BUILT_IN.map(({ kind, label, icon }) =>
            chip(
              kind,
              <>
                <Icon name={icon} />
                {label}
                {counts && <span className="mono subtle">{counts[kind]}</span>}
              </>,
              view.filter?.kind === kind,
              () => setFilter({ kind }),
            ),
          )}
          {chip(
            'playbook',
            <>
              <Icon name="playbook" />
              By playbook
              {view.filter?.kind === 'playbook' && <strong className="chip__val">: {playbookLabel(view.filter.id, playbooks)}</strong>}
              <Icon name="chev-d" small />
            </>,
            view.filter?.kind === 'playbook',
            () => setPicking('playbook'),
            true,
          )}
          {chip(
            'project',
            <>
              <Icon name="briefcase" />
              By project
              {view.filter?.kind === 'project' && <strong className="chip__val">: {projects[view.filter.id] ?? view.filter.id}</strong>}
              <Icon name="chev-d" small />
            </>,
            view.filter?.kind === 'project',
            () => setPicking('project'),
            true,
          )}
          {saved.filters.map((filter) => chip(filter.id, <>{filter.name}</>, view.filter?.kind === 'saved' && view.filter.id === filter.id, () => setFilter({ kind: 'saved', id: filter.id })))}
          {definition && conditions.length > 0 && (savedFilter === undefined || view.text !== '') && (
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setNaming('save')}>
              <Icon name="plus" />
              Save filter
            </button>
          )}
        </div>
        <div className="tlist__sort">
          <label className="sr-only" htmlFor="tasks-sort">
            Sort by
          </label>
          <select id="tasks-sort" className="input" value={view.sort.column} onChange={(event) => go({ ...view, sort: { ...view.sort, column: event.target.value as SortColumn } }, false)}>
            {COLUMNS.map(({ column, label }) => (
              <option key={column} value={column}>
                Sort: {label}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn--secondary btn--icon" aria-label={view.sort.direction === 'asc' ? 'Ascending: press for descending' : 'Descending: press for ascending'} onClick={() => go({ ...view, sort: { ...view.sort, direction: view.sort.direction === 'asc' ? 'desc' : 'asc' } }, false)}>
            <Icon name={view.sort.direction === 'asc' ? 'chev-u' : 'chev-d'} />
          </button>
        </div>
      </div>

      {savedFilter && (
        <div className="tlist__saved">
          <p>
            <strong>{savedFilter.name}</strong>
            <span className="subtle"> · {describeDefinition(savedFilter.definition, projects).join(' · ')}</span>
          </p>
          <div className="row">
            <button type="button" className="btn btn--secondary btn--sm" onClick={() => setNaming('rename')}>
              Rename
            </button>
            <WriteButton
              type="button"
              className="btn btn--secondary btn--sm"
              onClick={() => {
                const gone = savedFilter;
                void saved.remove(gone.id).then(
                  () => {
                    go({ ...view, filter: undefined }, true);
                    toast(`Deleted “${gone.name}”`, { undo: () => void saved.save(gone.name, gone.definition) });
                  },
                  (error: unknown) => toast(error instanceof Error ? error.message : 'Caduceus did not delete the filter.', { tone: 'danger' }),
                );
              }}
            >
              <Icon name="trash" />
              Delete
            </WriteButton>
          </div>
        </div>
      )}
      {saved.error && (
        <p className="subtle" role="status">
          Your saved filters could not be read: {saved.error}
        </p>
      )}

      <p className="sr-only" role="status">
        {tasks ? `${shown.length} ${shown.length === 1 ? 'task' : 'tasks'}` : ''}
      </p>

      {missing && (
        <div className="empty">
          <Icon name="filter" />
          <h2>This saved filter is gone</h2>
          <p>It was deleted, perhaps on another device. Show every task instead.</p>
          <button type="button" className="btn btn--primary" onClick={clear}>
            Clear filter
          </button>
        </div>
      )}
      {tasks && !missing && shown.length === 0 && phase !== 'failed' && (
        <div className="empty">
          <Icon name={narrowed ? 'filter' : 'work'} />
          {narrowed ? (
            <>
              <h2>{view.filter?.kind === 'waiting' && view.text === '' ? 'Nothing is waiting for you' : 'No tasks match'}</h2>
              <p>{conditions.length > 0 ? `Nothing is ${conditions.join(' and ')}.` : 'Nothing matches.'} Clear the filter to see every task.</p>
              <button type="button" className="btn btn--primary" onClick={clear}>
                Clear filter
              </button>
            </>
          ) : (
            <>
              <h2>There are no tasks yet</h2>
              <p>Tasks appear here as Hermes receives them: from the command line, from schedules, or from workers that split a task up.</p>
              <NewTaskLink board={board} />
            </>
          )}
        </div>
      )}
      {tasks && !missing && shown.length > 0 && <TaskTable tasks={shown} sort={view.sort} onSort={sortBy} projects={projects} playbooks={playbooks} board={board} caption={`Tasks, sorted by ${COLUMNS.find((c) => c.column === view.sort.column)?.label.toLowerCase()}`} />}

      {picking === 'playbook' && (
        <ChoiceSheet
          title="Tasks of a playbook"
          empty="No task on this board came from a playbook yet."
          choices={choices?.playbook}
          current={view.filter?.kind === 'playbook' ? view.filter.id : undefined}
          onClose={() => setPicking(undefined)}
          onPick={(id) => {
            setPicking(undefined);
            setFilter({ kind: 'playbook', id });
          }}
        />
      )}
      {picking === 'project' && (
        <ChoiceSheet
          title="Tasks of a project"
          empty="No task on this board belongs to a project."
          choices={choices?.project}
          current={view.filter?.kind === 'project' ? view.filter.id : undefined}
          onClose={() => setPicking(undefined)}
          onPick={(id) => {
            setPicking(undefined);
            setFilter({ kind: 'project', id });
          }}
        />
      )}
      {naming === 'save' && definition && (
        <NameSheet
          title="Save this filter"
          intro={<p className="subtle">It keeps only the conditions, not the tasks: {conditions.join(' · ')}.</p>}
          initial=""
          submit="Save filter"
          onClose={() => setNaming(undefined)}
          onSubmit={async (name) => {
            const created: SavedFilter = await saved.save(name, definition);
            go({ ...view, filter: { kind: 'saved', id: created.id }, text: '' }, false);
          }}
        />
      )}
      {naming === 'rename' && savedFilter && <NameSheet title="Rename filter" initial={savedFilter.name} submit="Rename" onClose={() => setNaming(undefined)} onSubmit={(name) => saved.rename(savedFilter.id, name)} />}
    </div>
  );
}
