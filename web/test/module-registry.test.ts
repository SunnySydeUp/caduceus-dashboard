import { describe, expect, test } from 'vitest';
import { createModuleRegistry, type ModuleDefinition } from '../src/module-registry.ts';

// The registry is generic over what a route renders, so these tests use plain strings as screens.
type Screen = string;

/** A module as a later ticket would write it: nothing here is known to the shell. */
function testModule(overrides: Partial<ModuleDefinition<Screen>> = {}): ModuleDefinition<Screen> {
  return {
    id: 'skills',
    title: 'Skills',
    icon: 'stack',
    desk: 'control',
    group: 'agents',
    path: '/agents/skills',
    summary: 'Installed skills',
    routes: [
      { path: '/agents/skills', screen: 'skills-list' },
      { path: '/agents/skills/:name', screen: 'skill-detail' },
    ],
    ...overrides,
  };
}

describe('module registry', () => {
  test('a registered module appears in Control under its group and contributes its routes, with no shell change', () => {
    const registry = createModuleRegistry<Screen>();
    registry.register(testModule());

    expect(registry.controlGroups().map(({ group, modules }) => [group.title, modules.map((m) => m.title)])).toEqual([['Agents', ['Skills']]]);
    expect(registry.routes()).toEqual([
      { moduleId: 'skills', path: '/agents/skills', screen: 'skills-list' },
      { moduleId: 'skills', path: '/agents/skills/:name', screen: 'skill-detail' },
    ]);
    expect(registry.module('skills')?.title).toBe('Skills');
    expect(registry.module('missing')).toBeUndefined();
  });

  test('a module declares its Desk placement, and each placement lists its modules by `order`, then in registration order', () => {
    const registry = createModuleRegistry<Screen>();
    const module = (id: string, desk: ModuleDefinition<Screen>['desk'], order?: number) =>
      testModule({ id, title: id.toUpperCase(), desk, group: desk === 'control' ? 'observe' : undefined, path: `/${id}`, order, routes: [{ path: `/${id}`, screen: id }] });
    registry.register(module('tasks', 'work', 2));
    registry.register(module('board', 'work', 1));
    registry.register(module('chat', 'talk'));
    registry.register(module('home', 'today'));
    registry.register(module('health', 'control'));
    registry.register(module('logs', 'control'));
    registry.register(module('plans', 'work'));

    expect(registry.inPlacement('today').map((m) => m.id)).toEqual(['home']);
    expect(registry.inPlacement('talk').map((m) => m.id)).toEqual(['chat']);
    expect(registry.inPlacement('work').map((m) => m.id)).toEqual(['board', 'tasks', 'plans']);
    expect(registry.inPlacement('control').map((m) => m.id)).toEqual(['health', 'logs']);
    // Only Control has groups: Health and Logs are listed there, and no other placement appears in it.
    expect(registry.controlGroups().map(({ modules }) => modules.map((m) => m.id))).toEqual([['health', 'logs']]);
  });

  test('a module in Control must say which group lists it, and one outside Control has no group', () => {
    const registry = createModuleRegistry<Screen>();
    expect(() => registry.register(testModule({ group: undefined }))).toThrow(/module "skills" is in Control, so it needs a group/);
    expect(() => registry.register(testModule({ desk: 'work' }))).toThrow(/module "skills" is not in Control, so it has no group/);
    expect(registry.module('skills')).toBeUndefined();
  });

  test('a module sits under its placement, and a settings page sits under Control whichever module owns the panel', () => {
    const registry = createModuleRegistry<Screen>();
    registry.register(testModule({ id: 'chat', desk: 'talk', group: undefined, path: '/chat', routes: [{ path: '/chat', screen: 'chat' }], settings: [{ id: 'chat', title: 'Chat', summary: 'Chat settings', icon: 'chat', screen: 'chat-settings', fields: [] }] }));
    registry.register(testModule({ id: 'board', desk: 'work', group: undefined, path: '/work/board', routes: [{ path: '/work/board', screen: 'board' }] }));
    registry.register(testModule({ id: 'home', desk: 'today', group: undefined, path: '/home', routes: [{ path: '/home', screen: 'home' }] }));
    registry.register(testModule({ id: 'health', desk: 'control', group: 'observe', path: '/health', routes: [{ path: '/health', screen: 'health' }] }));

    expect(['home', 'chat', 'board', 'health', 'not-registered'].map((id) => registry.destinationOf(id))).toEqual(['today', 'talk', 'work', 'control', 'control']);
    expect(registry.destinationOf('chat', '/chat')).toBe('talk');
    expect(registry.destinationOf('chat', '/settings/chat')).toBe('control');
    expect(registry.destinationOf('board', '/settings/chat')).toBe('control');
    expect(registry.destinationOf('board', '/work/board')).toBe('work');
  });

  test('a settings page owned by another module is shown under Settings in the breadcrumb', () => {
    const registry = createModuleRegistry<Screen>();
    registry.register(testModule({ id: 'chat', desk: 'talk', group: undefined, path: '/chat', routes: [{ path: '/chat', screen: 'chat' }], settings: [{ id: 'chat', title: 'Chat', summary: 'Chat settings', icon: 'chat', screen: 'chat-settings', fields: [] }] }));
    registry.register(testModule({ id: 'settings', group: 'settings', path: '/settings', routes: [{ path: '/settings', screen: 'settings' }] }));

    expect(registry.shellModuleOf('chat', '/chat')).toBe('chat');
    expect(registry.shellModuleOf('chat', '/settings/chat')).toBe('settings');
    expect(registry.shellModuleOf('settings', '/settings')).toBe('settings');
    expect(registry.shellModuleOf(undefined, '/nowhere')).toBeUndefined();
  });

  test('palette commands, settings panels and policy hooks reach the places that read them', () => {
    const registry = createModuleRegistry<Screen>();
    const ran: string[] = [];
    registry.register(
      testModule({
        paletteCommands: () => [{ id: 'skills.install', label: 'Install a skill…', icon: 'plus', tier: 'T3', run: () => ran.push('install') }],
        settings: [
          { id: 'skills', title: 'Skills', summary: 'Which skills load', icon: 'stack', screen: 'skills-settings', fields: [] },
          { id: 'audit', title: 'Skill audit', summary: 'Scan results', icon: 'shield', path: '/system/skill-audit', screen: 'audit', fields: [] },
        ],
        policy: { tierOf: (action) => (action === 'skills.uninstall' ? 'T1' : undefined) },
      }),
    );

    const [command] = registry.paletteCommands();
    expect([command.moduleId, command.id, command.label, command.tier]).toEqual(['skills', 'skills.install', 'Install a skill…', 'T3']);
    command.run();
    expect(ran).toEqual(['install']);

    // A panel without a path lives at /settings/<id>; each panel is also a route the shell mounts.
    expect(registry.settingsPanels().map(({ moduleId, id, path }) => [moduleId, id, path])).toEqual([
      ['skills', 'skills', '/settings/skills'],
      ['skills', 'audit', '/system/skill-audit'],
    ]);
    // They are titled after the panel, and "up" from one is the module's own screen.
    expect(registry.routes().slice(-2)).toEqual([
      { moduleId: 'skills', path: '/settings/skills', screen: 'skills-settings', title: 'Skills', parent: '/agents/skills' },
      { moduleId: 'skills', path: '/system/skill-audit', screen: 'audit', title: 'Skill audit', parent: '/agents/skills' },
    ]);

    expect(registry.tierOf('skills.uninstall')).toBe('T1');
    expect(registry.tierOf('skills.unknown')).toBeUndefined();
  });

  test('a settings panel that is a screen of its own can say that "back" leads to Settings instead of to the module', () => {
    const registry = createModuleRegistry<Screen>();
    registry.register(
      testModule({
        id: 'setup',
        group: 'settings',
        path: '/onboarding',
        routes: [],
        settings: [{ id: 'setup', title: 'Setup guide', summary: '', icon: 'flag', path: '/onboarding', parent: '/settings', screen: 'wizard', fields: [] }],
      }),
    );

    expect(registry.routes()).toEqual([{ moduleId: 'setup', path: '/onboarding', screen: 'wizard', title: 'Setup guide', parent: '/settings' }]);
    expect(registry.settingsPanels().map(({ path }) => path)).toEqual(['/onboarding']);
  });

  test('two modules cannot claim the same id or the same route, and a refused module leaves nothing behind', () => {
    const registry = createModuleRegistry<Screen>();
    registry.register(testModule());

    expect(() => registry.register(testModule({ routes: [{ path: '/elsewhere', screen: 'x' }] }))).toThrow(/module "skills" is already registered/);
    expect(() => registry.register(testModule({ id: 'other', routes: [{ path: '/agents/skills', screen: 'x' }] }))).toThrow(
      /route \/agents\/skills is already owned by module "skills"/,
    );
    // Settings panels claim routes too.
    expect(() =>
      registry.register(testModule({ id: 'panel', routes: [], settings: [{ id: 'p', title: 'P', summary: '', icon: 'x', path: '/agents/skills', screen: 'x', fields: [] }] })),
    ).toThrow(/route \/agents\/skills is already owned by module "skills"/);

    expect(registry.routes().map((route) => route.moduleId)).toEqual(['skills', 'skills']);
    expect(registry.controlGroups().flatMap(({ modules }) => modules.map((m) => m.id))).toEqual(['skills']);
  });

  test('the root and each placement and group base path redirect to the first module they hold, unless a module owns that path', () => {
    const registry = createModuleRegistry<Screen>();
    const module = (id: string, desk: ModuleDefinition<Screen>['desk'], path: string, order?: number, group?: ModuleDefinition<Screen>['group']) =>
      testModule({ id, desk, group, path, order, routes: [{ path, screen: id }] });
    registry.register(module('home', 'today', '/home'));
    registry.register(module('chat', 'talk', '/chat'));
    registry.register(module('tasks', 'work', '/work/tasks', 2));
    registry.register(module('board', 'work', '/work/board', 1));
    registry.register(module('health', 'control', '/observe/health', undefined, 'observe'));
    registry.register(module('settings', 'control', '/settings', undefined, 'settings'));

    expect(registry.redirects()).toEqual([
      { from: '/', to: '/home' },
      { from: '/today', to: '/home' },
      { from: '/talk', to: '/chat' },
      { from: '/work', to: '/work/board' },
      { from: '/observe', to: '/observe/health' },
    ]);
  });
});
