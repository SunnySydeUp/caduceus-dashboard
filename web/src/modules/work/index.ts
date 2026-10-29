import { lazy } from 'react';
import type { AppModule } from '../../app-registry.ts';

const NewTask = lazy(() => import('./BriefEditor.tsx').then((m) => ({ default: m.NewTask })));
const EditTask = lazy(() => import('./BriefEditor.tsx').then((m) => ({ default: m.EditTask })));
const Board = lazy(() => import('./Board.tsx').then((m) => ({ default: m.Board })));
const Task = lazy(() => import('./Task.tsx').then((m) => ({ default: m.Task })));
const RunView = lazy(() => import('./RunView.tsx').then((m) => ({ default: m.RunView })));
const Tasks = lazy(() => import('./Tasks.tsx').then((m) => ({ default: m.Tasks })));
const Schedules = lazy(() => import('./Schedules.tsx').then((m) => ({ default: m.Schedules })));
const Schedule = lazy(() => import('./Schedule.tsx').then((m) => ({ default: m.Schedule })));
const ScheduleBuilder = lazy(() => import('./ScheduleBuilder.tsx').then((m) => ({ default: m.ScheduleBuilder })));
const ScheduleEdit = lazy(() => import('./ScheduleBuilder.tsx').then((m) => ({ default: m.ScheduleEdit })));
const Playbooks = lazy(() => import('./Playbooks.tsx').then((m) => ({ default: m.Playbooks })));
const RunPage = lazy(() => import('./RunPage.tsx').then((m) => ({ default: m.RunPage })));
const PlaybookDetail = lazy(() => import('./PlaybookDetail.tsx').then((m) => ({ default: m.PlaybookDetail })));
const TemplateEditor = lazy(() => import('./TemplateEditor.tsx').then((m) => ({ default: m.TemplateEditor })));
const Projects = lazy(() => import('./Projects.tsx').then((m) => ({ default: m.Projects })));
const Project = lazy(() => import('./Project.tsx').then((m) => ({ default: m.Project })));
const Blueprints = lazy(() => import('./Blueprints.tsx').then((m) => ({ default: m.Blueprints })));
const WorkDesk = lazy(() => import('./WorkDesk.tsx').then((m) => ({ default: m.WorkDesk })));

/** Opens Work's landing view, keeping the tab's `?profile=`. */
function openWork(): void {
  const profile = new URLSearchParams(location.search).get('profile');
  history.pushState(null, '', profile ? `/work?profile=${encodeURIComponent(profile)}` : '/work');
}

/**
 * Work › Overview: the Work destination's landing view. Every task, run and schedule by state (waiting on you, running, ready for review, scheduled), with
 * an agent filter. The Board, Tasks, Playbooks, Schedules and Projects are the other modules placed in Work, one chip each above it.
 */
export const workDeskModule: AppModule = {
  id: 'work-overview',
  title: 'Overview',
  icon: 'stack',
  desk: 'work',
  path: '/work',
  key: 'w',
  order: 0,
  summary: 'Everything in flight by state: waiting on you, running, ready for review, scheduled',
  // Boards and schedules are every profile's: the agent filter is the view's own.
  crossProfile: true,
  routes: [{ path: '/work', screen: WorkDesk }],
  paletteCommands: () => [{ id: 'open-work', label: 'Open Work', icon: 'work', sub: 'Everything in flight, by state', run: openWork }],
  help: () => import('./work-desk-help.ts').then((m) => m.workDeskHelp),
};

/** Opens the board: the address of the current board, which keeps the tab's `?profile=`. */
function openBoard(): void {
  const profile = new URLSearchParams(location.search).get('profile');
  // TanStack Router's browser history notices `pushState` from outside, so the route changes without a page load.
  history.pushState(null, '', profile ? `/work/board?profile=${encodeURIComponent(profile)}` : '/work/board');
}

/** Opens the task list at `query` (`filter=waiting`), keeping the tab's `?profile=`. */
function openTasks(query = ''): () => void {
  return () => {
    const search = new URLSearchParams(query);
    const profile = new URLSearchParams(location.search).get('profile');
    if (profile) search.set('profile', profile);
    const text = search.toString();
    history.pushState(null, '', `/work/tasks${text ? `?${text}` : ''}`);
  };
}

/** Opens the Brief editor for a new task, keeping the tab's `?profile=`. */
function openNewTask(): void {
  const profile = new URLSearchParams(location.search).get('profile');
  history.pushState(null, '', profile ? `/work/tasks/new?profile=${encodeURIComponent(profile)}` : '/work/tasks/new');
}

/** Opens the schedule list at `query` (`status=failed`), keeping the tab's `?profile=`. */
function openSchedules(query = ''): () => void {
  return () => {
    const search = new URLSearchParams(query);
    const profile = new URLSearchParams(location.search).get('profile');
    if (profile) search.set('profile', profile);
    const text = search.toString();
    history.pushState(null, '', `/work/schedules${text ? `?${text}` : ''}`);
  };
}

/** Opens one of the schedule pages (`new`, `blueprints`), keeping the tab's `?profile=`. */
function openSchedulePage(page: string): () => void {
  return () => {
    const profile = new URLSearchParams(location.search).get('profile');
    history.pushState(null, '', `/work/schedules/${page}${profile ? `?profile=${encodeURIComponent(profile)}` : ''}`);
  };
}

/** Work › Board: Hermes's Kanban, live. Tasks, schedules, projects and runs are modules of their own, in the same Work group. */
export const workModule: AppModule = {
  id: 'work',
  title: 'Board',
  icon: 'work',
  desk: 'work',
  path: '/work/board',
  key: 'b',
  order: 1,
  summary: 'Hermes Kanban: every task by status or profile, live',
  // Kanban is shared by every profile (`kanban.db`), so the board is not scoped to the tab's profile.
  crossProfile: true,
  routes: [
    { path: '/work/board', screen: Board },
    { path: '/work/board/:board', screen: Board, title: 'Board', parent: '/work/board' },
    { path: '/work/tasks/:taskId', screen: Task, title: 'Task', parent: '/work/board' },
    { path: '/work/tasks/:taskId/edit', screen: EditTask, title: 'Edit task', parent: '/work/board' },
    { path: '/work/tasks/:taskId/:tab', screen: Task, title: 'Task', parent: '/work/board' },
    { path: '/work/runs/:runId', screen: RunView, title: 'Run', parent: '/work/board' },
  ],
  paletteCommands: () => [{ id: 'open-board', label: 'Open board', icon: 'work', sub: 'Hermes Kanban, live', run: openBoard }],
  help: () => import('./help.ts').then((m) => m.workHelp),
};

/** Work › Tasks: the board as a dense list with saved filters. */
export const tasksModule: AppModule = {
  id: 'tasks',
  title: 'Tasks',
  icon: 'tasks',
  desk: 'work',
  path: '/work/tasks',
  key: 't',
  order: 2,
  summary: 'Every task as a sortable list, with saved filters',
  crossProfile: true,
  routes: [
    { path: '/work/tasks', screen: Tasks },
    { path: '/work/tasks/new', screen: NewTask, title: 'New task', parent: '/work/tasks' },
  ],
  paletteCommands: () => [
    { id: 'tasks-new', label: 'New task', icon: 'plus', sub: 'Write a brief and queue it, run it, save it or schedule it', run: openNewTask },
    { id: 'open-tasks', label: 'Open tasks', icon: 'tasks', sub: 'Every task, with saved filters', run: openTasks() },
    { id: 'tasks-waiting', label: 'Show tasks waiting for me', icon: 'waiting', sub: 'Reviews and questions', run: openTasks('filter=waiting') },
  ],
  paletteSearch: async (query, { signal }) => {
    try {
      const { loadBoardOnce } = await import('./board-data.ts');
      const { taskHits } = await import('./board-model.ts');
      const board = await loadBoardOnce(undefined);
      if (signal.aborted) return [];
      return taskHits(board, query).map((hit) => ({ ...hit, icon: 'tasks' as const, group: 'Tasks' as const }));
    } catch {
      return [];
    }
  },
  help: () => import('./tasks-help.ts').then((m) => m.tasksHelp),
};

/** Work › Schedules: every Hermes cron job of every profile, and one job's settings and run history. */
export const schedulesModule: AppModule = {
  id: 'schedules',
  title: 'Schedules',
  icon: 'calendar',
  desk: 'work',
  path: '/work/schedules',
  key: 's',
  order: 3,
  summary: 'Hermes cron jobs of every profile: next run, last result, history',
  // Hermes lists the jobs of every profile at once, so the list is not scoped to the tab's profile.
  crossProfile: true,
  routes: [
    { path: '/work/schedules', screen: Schedules },
    { path: '/work/schedules/new', screen: ScheduleBuilder, title: 'New schedule', parent: '/work/schedules' },
    { path: '/work/schedules/blueprints', screen: Blueprints, title: 'Blueprints', parent: '/work/schedules' },
    { path: '/work/schedules/:jobId', screen: Schedule, title: 'Schedule', parent: '/work/schedules' },
    { path: '/work/schedules/:jobId/edit', screen: ScheduleEdit, title: 'Edit schedule', parent: '/work/schedules' },
  ],
  paletteCommands: () => [
    { id: 'open-schedules', label: 'Open schedules', icon: 'calendar', sub: 'Hermes cron jobs, next run and history', run: openSchedules() },
    { id: 'schedules-failed', label: 'Show schedules whose last run failed', icon: 'failed', sub: 'Jobs that need a look', run: openSchedules('status=failed') },
    { id: 'schedules-new', label: 'New schedule', icon: 'plus', sub: 'An agent prompt, a task or a blueprint, on a timer', run: openSchedulePage('new') },
    { id: 'schedules-blueprints', label: 'Browse blueprints', icon: 'package', sub: 'Hermes’s ready-made automations', run: openSchedulePage('blueprints') },
  ],
  help: () => import('./schedules-help.ts').then((m) => m.schedulesHelp),
};

/** Opens the playbook library, or one of its pages (`new`), keeping the tab's `?profile=`. */
function openPlaybooks(page = ''): () => void {
  return () => {
    const profile = new URLSearchParams(location.search).get('profile');
    history.pushState(null, '', `/work/playbooks${page ? `/${page}` : ''}${profile ? `?profile=${encodeURIComponent(profile)}` : ''}`);
  };
}

/**
 * Work › Playbooks: the library of one-stage templates and multi-stage playbooks (and the seeds), the categories that group them, a definition's
 * detail with its YAML and versions, and the template editor. Caduceus's own files and store.
 */
export const playbooksModule: AppModule = {
  id: 'playbooks',
  title: 'Playbooks',
  icon: 'playbook',
  desk: 'work',
  path: '/work/playbooks',
  order: 4,
  summary: 'Templates and multi-stage playbooks, in categories',
  // Playbooks belong to Caduceus, not to a profile.
  crossProfile: true,
  routes: [
    { path: '/work/playbooks', screen: Playbooks },
    { path: '/work/playbooks/new', screen: TemplateEditor, title: 'New template', parent: '/work/playbooks' },
    { path: '/work/playbooks/:playbookId', screen: PlaybookDetail, title: 'Playbook', parent: '/work/playbooks' },
    { path: '/work/playbooks/:playbookId/edit', screen: TemplateEditor, title: 'Edit template', parent: '/work/playbooks' },
    { path: '/work/playbooks/:playbookId/runs/:rootTaskId', screen: RunPage, title: 'Playbook run', parent: '/work/playbooks' },
  ],
  // Work › Templates became Work › Playbooks (M6 #01): an old link or bookmark still lands on the right screen.
  redirects: [
    { from: '/work/templates', to: '/work/playbooks' },
    { from: '/work/templates/new', to: '/work/playbooks/new' },
    { from: '/work/templates/:playbookId', to: '/work/playbooks/:playbookId/edit' },
  ],
  paletteCommands: () => [
    { id: 'open-playbooks', label: 'Open playbooks', icon: 'playbook', sub: 'Templates and multi-stage playbooks, in categories', run: openPlaybooks() },
    { id: 'templates-new', label: 'New template', icon: 'plus', sub: 'A brief with blanks to start tasks from', run: openPlaybooks('new') },
  ],
  // The library is asked when a query is typed, and its code loads then, not with the first page.
  paletteSearch: async (query, { signal }) => (await import('./template-data.ts')).searchLibrary(query, signal),
  help: () => import('./playbooks-help.ts').then((m) => m.playbooksHelp),
};

/** Opens the projects page, keeping the tab's `?profile=`. */
function openProjects(): void {
  const profile = new URLSearchParams(location.search).get('profile');
  history.pushState(null, '', profile ? `/work/projects?profile=${encodeURIComponent(profile)}` : '/work/projects');
}

/** Work › Projects: Hermes's projects across profiles, a project's overview, and the workspace registry (Caduceus's own list of folders). */
export const projectsModule: AppModule = {
  id: 'projects',
  title: 'Projects',
  icon: 'folder',
  desk: 'work',
  path: '/work/projects',
  order: 5,
  summary: 'Hermes projects, their repositories, and your workspaces',
  // The tree is every profile's; creating and renaming act on the profile in use.
  crossProfile: true,
  routes: [
    { path: '/work/projects', screen: Projects },
    { path: '/work/projects/:projectId', screen: Project, title: 'Project', parent: '/work/projects' },
  ],
  paletteCommands: () => [{ id: 'open-projects', label: 'Open projects', icon: 'folder', sub: 'Hermes projects and your workspaces', run: openProjects }],
  help: () => import('./projects-help.ts').then((m) => m.projectsHelp),
};
