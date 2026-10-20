import { describe, expect, test } from 'vitest';
import { createAppRegistry } from '../src/modules/index.ts';
import { deskNavigation } from '../src/shell/nav-order.ts';

describe('the Work module in the app registry', () => {
  test('registers the board: a nav entry, its routes, the palette command “Open board”, and its help terms', async () => {
    const registry = createAppRegistry();
    await registry.loadHelp();

    expect(deskNavigation(registry, []).destinations).toContainEqual(expect.objectContaining({ id: 'work', title: 'Work', path: '/work' }));
    expect(registry.routes().filter((route) => route.moduleId === 'work').map((route) => route.path)).toEqual(['/work/board', '/work/board/:board', '/work/tasks/:taskId', '/work/tasks/:taskId/edit', '/work/tasks/:taskId/:tab', '/work/runs/:runId']);
    expect(registry.paletteCommands()).toContainEqual(expect.objectContaining({ moduleId: 'work', label: 'Open board' }));
    // Work leads to its overview now (`/work` is a route of its own), and the board is the module after it.
    expect(registry.redirects().some((redirect) => redirect.from === '/work')).toBe(false);
    expect(registry.inPlacement('work').map((module) => module.id)).toEqual(['work-overview', 'work', 'tasks', 'schedules', 'playbooks', 'projects']);
    expect(registry.glossary().filter((term) => term.moduleId === 'work').map((term) => term.id)).toEqual(expect.arrayContaining(['task', 'board', 'dispatcher', 'block-kinds', 'dry-run', 'reclaim', 'orchestration-settings', 'kanban-run', 'run-step', 'worker-log']));
    expect(registry.helpPages().find((page) => page.route === '/work/runs/:runId')).toMatchObject({ moduleId: 'work', title: 'Run' });
    expect(registry.glossary().filter((term) => term.moduleId === 'work' && ['kanban-run', 'run-step', 'worker-log'].includes(term.id)).map((term) => term.term)).toEqual(['Run', 'Step', 'Worker log']);
  });
});

describe('the Work overview in the app registry', () => {
  test('is the first entry of the Work group and owns /work: its route, its palette command “Open Work”, and a help page with the terms Waiting on you, Ready for review and Scheduled', async () => {
    const registry = createAppRegistry();
    await registry.loadHelp();

    expect(registry.routes().filter((route) => route.moduleId === 'work-overview').map((route) => route.path)).toEqual(['/work']);
    expect(registry.module('work-overview')).toMatchObject({ desk: 'work', path: '/work', crossProfile: true });
    expect(registry.paletteCommands().filter((command) => command.moduleId === 'work-overview').map((command) => command.label)).toEqual(['Open Work']);
    expect(registry.helpPages().filter((page) => page.moduleId === 'work-overview').map((page) => page.route)).toEqual(['/work']);
    expect(registry.glossary().filter((term) => term.moduleId === 'work-overview').map((term) => term.term)).toEqual(['Waiting on you', 'Ready for review', 'Scheduled']);
  });
});

describe('the Tasks module in the app registry', () => {
  test('is a second entry of the Work group: its route, its palette commands, and a help page with the terms Saved filter and Waiting for me', async () => {
    const registry = createAppRegistry();
    await registry.loadHelp();

    expect(registry.routes().filter((route) => route.moduleId === 'tasks').map((route) => route.path)).toEqual(['/work/tasks', '/work/tasks/new']);
    expect(registry.module('tasks')).toMatchObject({ desk: 'work', path: '/work/tasks', crossProfile: true });
    expect(registry.paletteCommands().filter((command) => command.moduleId === 'tasks').map((command) => command.label)).toEqual(['New task', 'Open tasks', 'Show tasks waiting for me']);
    expect(registry.helpPages().filter((page) => page.moduleId === 'tasks').map((page) => page.route)).toEqual(['/work/tasks', '/work/tasks/new']);
    expect(registry.glossary().filter((term) => term.moduleId === 'tasks').map((term) => term.term)).toEqual(['Saved filter', 'Waiting for me', 'Brief', 'Dispatch mode', 'Goal mode', 'Completion contract']);
  });
});

describe('the Schedules module in the app registry', () => {
  test('is a third entry of the Work group: its routes (the list, the builder, the blueprints, one job and its edit), its palette commands, and a help page for each route with the terms Schedule, Job types, Stale scheduler, Blueprint, Create-task job and Cron expression', async () => {
    const registry = createAppRegistry();
    await registry.loadHelp();

    expect(registry.routes().filter((route) => route.moduleId === 'schedules').map((route) => route.path)).toEqual([
      '/work/schedules',
      '/work/schedules/new',
      '/work/schedules/blueprints',
      '/work/schedules/:jobId',
      '/work/schedules/:jobId/edit',
    ]);
    expect(registry.module('schedules')).toMatchObject({ desk: 'work', path: '/work/schedules', crossProfile: true });
    expect(registry.paletteCommands().filter((command) => command.moduleId === 'schedules').map((command) => command.label)).toEqual(['Open schedules', 'Show schedules whose last run failed', 'New schedule', 'Browse blueprints']);
    expect(registry.helpPages().filter((page) => page.moduleId === 'schedules').map((page) => page.route)).toEqual([
      '/work/schedules',
      '/work/schedules/:jobId',
      '/work/schedules/new',
      '/work/schedules/blueprints',
      '/work/schedules/:jobId/edit',
    ]);
    expect(registry.glossary().filter((term) => term.moduleId === 'schedules').map((term) => term.term)).toEqual(['Schedule', 'Job types', 'Stale scheduler', 'Blueprint', 'Create-task job', 'Script job', 'Monitor', 'context_from', 'Cron expression']);
  });
});

describe('the Playbooks module in the app registry', () => {
  test('is a fourth entry of the Work group: its five routes, its palette commands and search, the redirects from Templates, and a help page for each route with the terms Playbook, Template, Stage, Gate, Category, Playbook run and Playbook engine', async () => {
    const registry = createAppRegistry();
    await registry.loadHelp();

    expect(registry.routes().filter((route) => route.moduleId === 'playbooks').map((route) => route.path)).toEqual(['/work/playbooks', '/work/playbooks/new', '/work/playbooks/:playbookId', '/work/playbooks/:playbookId/edit', '/work/playbooks/:playbookId/runs/:rootTaskId']);
    expect(registry.module('playbooks')).toMatchObject({ title: 'Playbooks', desk: 'work', path: '/work/playbooks', crossProfile: true });
    expect(registry.module('templates')).toBeUndefined();
    expect(registry.paletteCommands().filter((command) => command.moduleId === 'playbooks').map((command) => command.label)).toEqual(['Open playbooks', 'New template']);
    expect(registry.paletteSearches().map((search) => search.moduleId)).toContain('playbooks');
    expect(registry.redirects()).toEqual(
      expect.arrayContaining([
        { from: '/work/templates', to: '/work/playbooks' },
        { from: '/work/templates/new', to: '/work/playbooks/new' },
        { from: '/work/templates/:playbookId', to: '/work/playbooks/:playbookId/edit' },
      ]),
    );
    expect(registry.helpPages().filter((page) => page.moduleId === 'playbooks').map((page) => page.route)).toEqual(['/work/playbooks', '/work/playbooks/:playbookId', '/work/playbooks/new', '/work/playbooks/:playbookId/edit', '/work/playbooks/:playbookId/runs/:rootTaskId']);
    expect(registry.glossary().filter((term) => term.moduleId === 'playbooks').map((term) => term.term)).toEqual(['Playbook', 'Template', 'Stage', 'Gate', 'Category', 'Playbook run', 'Playbook engine', 'Attempt', 'Verdict', 'Parallel group']);
  });
});

describe('the Projects module in the app registry', () => {
  test('is a fifth entry of the Work group: its two routes, its palette command, and a help page for each route with the terms Project and Workspace', async () => {
    const registry = createAppRegistry();
    await registry.loadHelp();

    expect(registry.routes().filter((route) => route.moduleId === 'projects').map((route) => route.path)).toEqual(['/work/projects', '/work/projects/:projectId']);
    expect(registry.module('projects')).toMatchObject({ desk: 'work', path: '/work/projects', crossProfile: true });
    expect(registry.paletteCommands().filter((command) => command.moduleId === 'projects').map((command) => command.label)).toEqual(['Open projects']);
    expect(registry.helpPages().filter((page) => page.moduleId === 'projects').map((page) => page.route)).toEqual(['/work/projects', '/work/projects/:projectId']);
    expect(registry.glossary().filter((term) => term.moduleId === 'projects').map((term) => term.term)).toEqual(['Project', 'Workspace']);
  });
});
