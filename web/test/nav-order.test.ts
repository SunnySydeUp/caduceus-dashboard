import { describe, expect, test } from 'vitest';
import { createModuleRegistry, DESK_PLACEMENTS, type ModuleDefinition } from '../src/module-registry.ts';
import { createAppRegistry } from '../src/modules/index.ts';
import { inboxBadge } from '../src/modules/inbox/inbox-feed.ts';
import type { CrewMember } from '../src/modules/crew/crew-state.ts';
import { crewAge, deskModules, deskNavigation } from '../src/shell/nav-order.ts';

type Screen = string;

/** A module as a later ticket would write it: only its placement tells the shell where it goes. */
function testModule(id: string, desk: ModuleDefinition<Screen>['desk'], overrides: Partial<ModuleDefinition<Screen>> = {}): ModuleDefinition<Screen> {
  return {
    id,
    title: id.toUpperCase(),
    icon: 'stack',
    desk,
    ...(desk === 'control' ? { group: 'agents' as const } : {}),
    path: `/${id}`,
    summary: id,
    routes: [{ path: `/${id}`, screen: id }],
    ...overrides,
  };
}

function registryOf(...modules: ModuleDefinition<Screen>[]) {
  const registry = createModuleRegistry<Screen>();
  modules.forEach((module) => registry.register(module));
  return registry;
}

const member = (profile: string, state: CrewMember['state'], since?: number): CrewMember => ({ profile, state, line: `${profile} ${state}`, since });

describe('the Desk destinations', () => {
  test('are Today, Talk and Work in that order, each leading to the first module placed there', () => {
    // Registered in another order than they show, and Work led by its lowest `order`, not by registration.
    const registry = registryOf(
      testModule('tasks', 'work', { order: 2 }),
      testModule('chat', 'talk', { path: '/chat' }),
      testModule('board', 'work', { order: 1 }),
      testModule('home', 'today'),
      testModule('health', 'control'),
    );

    const { destinations } = deskNavigation(registry, []);
    expect(destinations.map(({ id, title, path }) => [id, title, path])).toEqual([
      ['today', 'Today', '/home'],
      ['talk', 'Talk', '/chat'],
      ['work', 'Work', '/board'],
    ]);
    // Work holds every module placed there, for the chips that reach the others.
    expect(destinations.find(({ id }) => id === 'work')?.modules.map((m) => m.id)).toEqual(['board', 'tasks']);
  });

  test('leave out a placement that holds no module', () => {
    const registry = registryOf(testModule('home', 'today'), testModule('board', 'work'));
    expect(deskNavigation(registry, []).destinations.map(({ id }) => id)).toEqual(['today', 'work']);
  });

  test('carry the count of the first module placed there that has one, and none otherwise', () => {
    const badge = { subscribe: () => () => {}, count: () => 3, label: (count: number) => `${count} need you` };
    const registry = registryOf(testModule('home', 'today', { badge }), testModule('chat', 'talk'));

    const [today, talk] = deskNavigation(registry, []).destinations;
    expect(today?.badge?.count()).toBe(3);
    expect(today?.badge?.label(3)).toBe('3 need you');
    expect(talk).not.toHaveProperty('badge');
  });
});

describe('the crew rows', () => {
  const registry = registryOf(testModule('chat', 'talk', { path: '/chat' }));
  const order = (crew: CrewMember[]) => deskNavigation(registry, crew).crew.map((row) => row.profile);

  test('list whoever needs the owner first: waiting, then blocked, working, finished and idle', () => {
    const crew = [member('idle-one', 'idle'), member('done-one', 'done', 5), member('working-one', 'working', 4), member('blocked-one', 'blocked', 3), member('waiting-one', 'waiting', 2)];
    expect(order(crew)).toEqual(['waiting-one', 'blocked-one', 'working-one', 'done-one', 'idle-one']);
  });

  test('put whoever has waited longest first among those waiting, the newest first among the rest, and keep the given order for idle agents', () => {
    expect(order([member('b', 'waiting', 200), member('a', 'waiting', 100), member('c', 'waiting', 300)])).toEqual(['a', 'b', 'c']);
    expect(order([member('old', 'working', 100), member('new', 'working', 300), member('mid', 'working', 200)])).toEqual(['new', 'mid', 'old']);
    expect(order([member('z', 'idle'), member('a', 'idle'), member('m', 'idle')])).toEqual(['z', 'a', 'm']);
  });

  test('give each row the sigil name, state, state words, live line and time, open that agent in Talk, and start a new chat with it, scoped to its profile', () => {
    const [row] = deskNavigation(registry, [{ profile: 'coder', state: 'waiting', line: 'Wants to push feat/x', since: 1_700_000_000_000 }]).crew;
    expect(row).toEqual({
      profile: 'coder',
      state: 'waiting',
      stateLabel: 'Waiting for you',
      line: 'Wants to push feat/x',
      since: 1_700_000_000_000,
      path: '/chat?profile=coder',
      newChat: '/chat/new?profile=coder',
    });
  });

  test('offer no new chat when no module is placed in Talk', () => {
    const [row] = deskNavigation(registryOf(testModule('home', 'today')), [member('coder', 'idle')]).crew;
    expect(row).not.toHaveProperty('newChat');
  });

  test('do not change the crew they were given', () => {
    const crew = [member('b', 'idle'), member('a', 'waiting', 1)];
    deskNavigation(registry, crew);
    expect(crew.map((m) => m.profile)).toEqual(['b', 'a']);
  });
});

describe('Control', () => {
  test('lists the modules that have no destination, grouped, in the order the old groups had', () => {
    const registry = registryOf(
      testModule('home', 'today'),
      testModule('settings', 'control', { group: 'settings' }),
      testModule('logs', 'control', { group: 'observe', order: 2 }),
      testModule('health', 'control', { group: 'observe', order: 1 }),
      testModule('skills', 'control', { group: 'agents' }),
      testModule('board', 'work'),
    );

    const { control } = deskNavigation(registry, []);
    expect(control.map(({ group, modules }) => [group.title, modules.map((m) => m.id)])).toEqual([
      ['Agents', ['skills']],
      ['Observe', ['health', 'logs']],
      ['Settings', ['settings']],
    ]);
  });
});

describe('every screen of the app', () => {
  const registry = createAppRegistry();
  const navigation = deskNavigation(registry, []);

  test('has a Desk placement the shell knows', () => {
    expect(registry.modules().filter((module) => !DESK_PLACEMENTS.includes(module.desk)).map((module) => module.id)).toEqual([]);
  });

  test('is reachable from the Desk navigation: each module is a destination, a Work chip or a Control row, exactly once', () => {
    const reachable = deskModules(navigation).map((module) => module.id);
    expect(reachable.toSorted()).toEqual(registry.modules().map((module) => module.id).toSorted());
    expect(reachable.filter((id, at) => reachable.indexOf(id) !== at)).toEqual([]);
  });

  test('is reached by a route of a module that is reachable, so no route is orphaned', () => {
    const reachable = new Set(deskModules(navigation).map((module) => module.id));
    expect(registry.routes().filter((route) => !reachable.has(route.moduleId)).map((route) => route.path)).toEqual([]);
  });

  test('has Today, Talk and Work to open, each leading to a registered route', () => {
    const paths = new Set(registry.routes().map((route) => route.path));
    expect(navigation.destinations.map(({ id }) => id)).toEqual(['today', 'talk', 'work']);
    expect(navigation.destinations.filter(({ path }) => !paths.has(path)).map(({ id }) => id)).toEqual([]);
  });

  test('shows on Today the count of what needs the owner, the very count the app badge holds, and on no other destination', () => {
    const [today, ...others] = navigation.destinations;
    expect(today?.badge).toBeDefined();
    expect(today?.badge).toBe(inboxBadge);
    expect(others.filter((destination) => destination.badge)).toEqual([]);
  });

  test('has its homes: Today is Today, Chat is Talk, and the Work screens are Work', () => {
    const idsAt = (id: string) => navigation.destinations.find((destination) => destination.id === id)?.modules.map((module) => module.id);
    expect(idsAt('today')).toEqual(['today']);
    expect(idsAt('talk')).toEqual(['chat']);
    expect(idsAt('work')).toEqual(['work-overview', 'work', 'tasks', 'schedules', 'playbooks', 'projects']);
  });
});

describe('the time on a crew row', () => {
  const now = 1_700_000_000_000;
  test('says "now" inside the first minute, then the span as a person says it, and never a negative one', () => {
    expect(crewAge(now - 20_000, now)).toBe('now');
    expect(crewAge(now - 5 * 60_000, now)).toBe('5 min');
    expect(crewAge(now - 3 * 3_600_000, now)).toBe('3 h');
    expect(crewAge(now + 60_000, now)).toBe('now');
  });

  test('is empty for an agent with nothing going on', () => {
    expect(crewAge(undefined, now)).toBe('');
  });
});
