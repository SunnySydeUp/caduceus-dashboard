import { describe, expect, test } from 'vitest';
import { createModuleRegistry, type ModuleDefinition, type ModuleRegistry } from '../src/module-registry.ts';
import { buildKeymap, DEFAULT_KEYBOARD_SETTINGS, shortcutDefs, type KeyboardSettings } from '../src/shortcuts.ts';
import { highlightSegments, hitEntries, mergeProfileHits, paletteEntries, paletteStep, rankEntries, resultsAnnouncement, runEntry, searchProfiles, searchScopeText, withHits, type ConfirmRequest, type PaletteState } from '../src/palette.ts';
import type { HelpTarget } from '../src/help.ts';

// The registry is generic over what a route renders, so these tests use plain strings as screens.
type Screen = string;

/** A module as a later ticket would write it: nothing here is known to the shell. */
function testModule(overrides: Partial<ModuleDefinition<Screen>> = {}): ModuleDefinition<Screen> {
  const desk = overrides.desk ?? 'control';
  return {
    id: 'skills',
    title: 'Skills',
    icon: 'stack',
    desk,
    ...(desk === 'control' ? { group: 'agents' as const } : {}),
    path: '/agents/skills',
    summary: 'Installed skills',
    routes: [{ path: '/agents/skills', screen: 'skills' }],
    ...overrides,
  };
}

/** The shell's own three modules' shape, plus a Work module with a detail route and commands. */
function registryWith(...modules: ModuleDefinition<Screen>[]) {
  const registry = createModuleRegistry<Screen>();
  modules.forEach((module) => registry.register(module));
  return registry;
}

/** What the palette lists for a registry whose shortcuts all have their defaults. */
const listed = (registry: ModuleRegistry<Screen>, currentModuleId: string | undefined) =>
  paletteEntries(registry, currentModuleId, buildKeymap(shortcutDefs(registry), DEFAULT_KEYBOARD_SETTINGS));

describe('palette entries', () => {
  test('lists every registered route you can open and every module action, the current module’s actions first', () => {
    const registry = registryWith(
      testModule({
        id: 'home',
        title: 'Home',
        desk: 'today',
        path: '/home',
        summary: 'Hermes at a glance',
        routes: [{ path: '/home', screen: 'home' }],
      }),
      testModule({
        id: 'tasks',
        title: 'Tasks',
        desk: 'work',
        path: '/work/tasks',
        summary: 'Saved-filter task list',
        routes: [
          { path: '/work/tasks', screen: 'tasks' },
          { path: '/work/tasks/new', screen: 'new-task', title: 'New task' },
          // A route with a parameter has no address to jump to.
          { path: '/work/tasks/:taskId', screen: 'task' },
        ],
        paletteCommands: () => [
          { id: 'retry', label: 'Retry the task', run: () => {} },
          { id: 'archive', label: 'Archive finished tasks', run: () => {} },
        ],
      }),
      testModule({
        id: 'schedules',
        title: 'Schedules',
        desk: 'work',
        path: '/work/schedules',
        summary: 'Hermes cron',
        routes: [{ path: '/work/schedules', screen: 'schedules' }],
        paletteCommands: () => [{ id: 'run-now', label: 'Run a job now', icon: 'clock', sub: 'Outside its schedule', run: () => {} }],
      }),
    );

    const entries = listed(registry, 'schedules');

    expect(entries.map((entry) => [entry.group, entry.label])).toEqual([
      ['This screen', 'Run a job now'],
      // The places the owner goes most come next, under their product names: Today, Work (the module Work opens on), and Control.
      ['Go to', 'Today'],
      ['Go to', 'Work'],
      ['Go to', 'Control'],
      ['Actions', 'Retry the task'],
      ['Actions', 'Archive finished tasks'],
      ['Actions', 'Help'],
      ['Actions', 'Keyboard shortcuts'],
      ['Actions', 'Sign out'],
      ['Navigate', 'New task'],
      ['Navigate', 'Schedules'],
    ]);
    expect(entries.find((entry) => entry.label === 'New task')?.target).toEqual({ kind: 'route', path: '/work/tasks/new' });
  });

  test('a page a module also offers as a command is listed once, as the command', () => {
    const registry = registryWith(
      testModule({
        id: 'tasks',
        title: 'Tasks',
        desk: 'work',
        path: '/work/tasks',
        routes: [
          { path: '/work/tasks', screen: 'tasks' },
          { path: '/work/tasks/new', screen: 'new-task', title: 'New task' },
          { path: '/work/tasks/templates', screen: 'templates', title: 'Templates' },
        ],
        paletteCommands: () => [{ id: 'tasks-new', label: 'New task', run: () => {} }],
      }),
    );

    expect(listed(registry, undefined).map((entry) => [entry.group, entry.label])).toEqual([
      ['Go to', 'Work'],
      ['Go to', 'Control'],
      ['Actions', 'New task'],
      ['Actions', 'Help'],
      ['Actions', 'Keyboard shortcuts'],
      ['Actions', 'Sign out'],
      ['Navigate', 'Templates'],
    ]);
  });

  test('each entry shows the key it is bound to now: `g` then a key for a destination, a command’s own shortcut, `?` for this screen’s help', () => {
    const registry = registryWith(
      testModule({ id: 'home', title: 'Home', desk: 'today', path: '/home', key: 'h', routes: [{ path: '/home', screen: 'home' }] }),
      testModule({
        id: 'tasks',
        title: 'Tasks',
        desk: 'today',
        path: '/tasks',
        routes: [{ path: '/tasks', screen: 'tasks' }],
        paletteCommands: () => [{ id: 'retry', label: 'Retry the task', shortcut: 'mod+shift+r', run: () => {} }],
      }),
    );
    const shown = (settings: KeyboardSettings) =>
      paletteEntries(registry, undefined, buildKeymap(shortcutDefs(registry), settings)).map((entry) => [entry.label, entry.shortcut]);

    expect(shown(DEFAULT_KEYBOARD_SETTINGS)).toEqual([
      ['Today', 'g h'],
      ['Control', undefined],
      ['Retry the task', 'mod+shift+r'],
      ['Help', '?'],
      ['Keyboard shortcuts', undefined],
      ['Sign out', undefined],
      ['Tasks', undefined],
    ]);
    // A shortcut that is switched off is not shown as if it worked, and a remap shows its new keys.
    expect(shown({ singleKey: false, remaps: { 'cmd:tasks:retry': 'mod+j' } })).toEqual([
      ['Today', undefined],
      ['Control', undefined],
      ['Retry the task', 'mod+j'],
      ['Help', undefined],
      ['Keyboard shortcuts', undefined],
      ['Sign out', undefined],
      ['Tasks', undefined],
    ]);
  });

  test('an entry names the shortcut action it answers to, so a key press can run it the way a click does', () => {
    const registry = registryWith(
      testModule({ id: 'home', title: 'Home', desk: 'today', path: '/home', key: 'h', routes: [{ path: '/home', screen: 'home' }, { path: '/home/tour', screen: 'tour', title: 'Tour' }] }),
      testModule({ id: 'tasks', title: 'Tasks', desk: 'today', path: '/tasks', routes: [{ path: '/tasks', screen: 'tasks' }], paletteCommands: () => [{ id: 'retry', label: 'Retry', run: () => {} }] }),
    );

    expect(listed(registry, undefined).map((entry) => [entry.label, entry.action])).toEqual([
      ['Today', 'go:home'],
      ['Control', undefined],
      ['Retry', 'cmd:tasks:retry'],
      ['Help', 'help.open'],
      ['Keyboard shortcuts', undefined],
      ['Sign out', undefined],
      ['Tour', undefined],
      ['Tasks', 'go:tasks'],
    ]);
  });
});

/** Four Control modules whose names overlap the way real ones do. */
function destinations() {
  const module = (id: string, title: string, summary: string) => testModule({ id, title, summary, path: `/${id}`, routes: [{ path: `/${id}`, screen: id }] });
  return registryWith(module('health', 'Health', 'Is Hermes up'), module('home', 'Home', 'Hermes at a glance'), module('schedules', 'Schedules', 'Hermes cron'), module('security', 'Security', 'Passkeys and devices'));
}

describe('palette ranking', () => {
  test('a query keeps only the fuzzy matches, best first, with the label letters that matched', () => {
    const entries = listed(destinations(), undefined);

    expect(rankEntries(entries, 'hlth').map(({ entry, positions }) => [entry.label, positions])).toEqual([['Health', [0, 3, 4, 5]]]);
    // `se` is a prefix of Security but only scattered through Schedules, which was registered first.
    expect(rankEntries(entries, 'se').filter(({ entry }) => entry.group === 'Navigate').map(({ entry }) => entry.label)).toEqual(['Security', 'Schedules']);
    expect(rankEntries(entries, 'zzz')).toEqual([]);
  });

  test('the current module’s actions stay first, then the other actions, then the routes, however well each matches', () => {
    const registry = registryWith(
      testModule({ id: 'tasks', title: 'Tasks', path: '/tasks', routes: [{ path: '/tasks', screen: 'tasks' }], paletteCommands: () => [{ id: 'run-now', label: 'Run the task now', run: () => {} }] }),
      testModule({ id: 'cron', title: 'Cron', path: '/cron', routes: [{ path: '/cron', screen: 'cron' }], paletteCommands: () => [{ id: 'run', label: 'Run', run: () => {} }] }),
      testModule({ id: 'running', title: 'Running', path: '/running', routes: [{ path: '/running', screen: 'running' }] }),
    );

    const ranked = rankEntries(listed(registry, 'tasks'), 'run');

    // `Run` is an exact match and `Running` a prefix match, yet both come after the current module's longer label.
    expect(ranked.map(({ entry }) => [entry.group, entry.label])).toEqual([
      ['This screen', 'Run the task now'],
      ['Actions', 'Run'],
      ['Navigate', 'Running'],
    ]);
  });

  test('words outside the label (the group, the address, the summary) match whole, after the label matches', () => {
    const module = (id: string, title: string, summary: string) => testModule({ id, title, summary, group: 'connect', path: `/connect/${id}`, routes: [{ path: `/connect/${id}`, screen: id }] });
    const registry = registryWith(module('gateway', 'Gateway', 'Start, stop or restart'), module('restarts', 'Restarts', 'What came back up'));
    const entries = listed(registry, undefined);

    expect(rankEntries(entries, 'restart').map(({ entry, positions }) => [entry.label, positions])).toEqual([
      ['Restarts', [0, 1, 2, 3, 4, 5, 6]],
      ['Gateway', []],
    ]);
    // The group's name finds the whole group; a query with a word that is nowhere finds nothing.
    expect(rankEntries(entries, 'connect').map(({ entry }) => entry.label)).toEqual(['Gateway', 'Restarts']);
    expect(rankEntries(entries, 'restart nowhere')).toEqual([]);
    // An address typed as one is read as its words: "/connect/gateway" finds the screen at that address.
    expect(rankEntries(entries, '/connect/gateway').map(({ entry }) => entry.label)).toEqual(['Gateway']);
  });
});

describe('running a palette entry', () => {
  /** A gateway module that declares its own risk tiers, the way the tiered dialog (M0 #08) reads them. */
  function gateway() {
    return registryWith(
      testModule({
        id: 'gateway',
        title: 'Gateway',
        path: '/connect/gateway',
        routes: [{ path: '/connect/gateway', screen: 'gateway' }],
        policy: { tierOf: (action) => (action === 'restart' ? 'T2' : undefined) },
        paletteCommands: () => [
          { id: 'restart', label: 'Restart gateway', run: () => ran.push('restart') },
          { id: 'prune', label: 'Prune checkpoints', tier: 'T3', run: () => ran.push('prune') },
          { id: 'status', label: 'Show gateway status', run: () => ran.push('status') },
          // T0 is undoable, so it needs no confirmation.
          { id: 'pause', label: 'Pause the dispatcher', tier: 'T0', run: () => ran.push('pause') },
        ],
      }),
    );
  }
  const ran: string[] = [];
  const entryNamed = (label: string) => listed(gateway(), undefined).find((entry) => entry.label === label)!;

  test('an action with a tier runs only after the shared confirmation says yes; one without a tier runs straight away', async () => {
    ran.length = 0;
    const asked: ConfirmRequest[] = [];
    const answer = { yes: true };
    const deps = { navigate: async () => {}, shell: () => {}, help: () => {}, confirm: async (request: ConfirmRequest) => (asked.push(request), answer.yes) };

    // The tier is the module policy's, else the one the command declares for itself.
    expect(['Restart gateway', 'Prune checkpoints', 'Show gateway status'].map((label) => entryNamed(label).tier)).toEqual(['T2', 'T3', undefined]);

    expect(await runEntry(entryNamed('Show gateway status'), deps)).toBe('ran');
    expect(await runEntry(entryNamed('Pause the dispatcher'), deps)).toBe('ran');
    expect(asked).toEqual([]);

    expect(await runEntry(entryNamed('Restart gateway'), deps)).toBe('ran');
    expect(asked).toEqual([{ tier: 'T2', moduleId: 'gateway', action: 'restart', label: 'Restart gateway' }]);

    answer.yes = false;
    expect(await runEntry(entryNamed('Prune checkpoints'), deps)).toBe('declined');
    expect(ran).toEqual(['status', 'pause', 'restart']);
  });

  test('with no confirmation dialog to ask, a tiered action does not run at all', async () => {
    ran.length = 0;
    expect(await runEntry(entryNamed('Restart gateway'), { navigate: async () => {}, shell: () => {}, help: () => {}, confirm: undefined })).toBe('unconfirmable');
    expect(ran).toEqual([]);
  });

  test('a route entry navigates to its address', async () => {
    const visited: string[] = [];
    const entry = listed(gateway(), undefined).find((candidate) => candidate.group === 'Navigate')!;
    expect(await runEntry(entry, { navigate: async (path) => void visited.push(path), shell: () => {}, help: () => {}, confirm: undefined })).toBe('ran');
    expect(visited).toEqual(['/connect/gateway']);
  });

  test('a command runs only once the palette and any confirmation have closed, so an address it opens is not popped with them', async () => {
    ran.length = 0;
    const deps = { navigate: async () => {}, shell: () => {}, help: () => {}, confirm: async () => true, settled: async () => void ran.push('layers closed') };
    expect(await runEntry(entryNamed('Show gateway status'), deps)).toBe('ran');
    expect(await runEntry(entryNamed('Restart gateway'), deps)).toBe('ran');
    expect(ran).toEqual(['layers closed', 'status', 'layers closed', 'restart']);
  });

  test('the shell’s own entries hand their action to the shell', async () => {
    const done: string[] = [];
    for (const label of ['Help', 'Keyboard shortcuts']) {
      const entry = listed(gateway(), undefined).find((candidate) => candidate.label === label)!;
      expect(await runEntry(entry, { navigate: async () => {}, shell: (action) => void done.push(action), help: () => {}, confirm: undefined })).toBe('ran');
    }
    expect(done).toEqual(['help.open', 'shortcuts.open']);
  });
});

describe('highlighting', () => {
  test('splits a label into runs, marking the characters the query matched', () => {
    expect(highlightSegments('Health', [0, 3, 4, 5])).toEqual([
      { text: 'H', match: true },
      { text: 'ea', match: false },
      { text: 'lth', match: true },
    ]);
    expect(highlightSegments('Home', [])).toEqual([{ text: 'Home', match: false }]);
  });
});

describe('palette keyboard flow', () => {
  const start: PaletteState = { query: '', active: 0 };

  test('↓ and ↑ move through the results and wrap, typing starts again from the best match, and ↵ runs the active one', () => {
    const step = (state: PaletteState, key: string, count = 3) => paletteStep(state, { type: 'key', key }, count);

    const down = step(start, 'ArrowDown');
    expect(down.state.active).toBe(1);
    expect(step(step(down.state, 'ArrowDown').state, 'ArrowDown').state.active).toBe(0);
    expect(step(start, 'ArrowUp').state.active).toBe(2);

    const typed = paletteStep(down.state, { type: 'query', query: 'he' }, 3);
    expect(typed.state).toEqual({ query: 'he', active: 0 });

    expect(step(down.state, 'Enter')).toEqual({ state: down.state, outcome: 'run' });
    // Esc closes the top layer in the layer stack (overlays/layers.ts), before the field sees it.
    expect(step(down.state, 'Escape')).toEqual({ state: down.state });

    // Nothing to run or move through when the query matched nothing.
    expect(step(start, 'Enter', 0).outcome).toBeUndefined();
    expect(step(start, 'ArrowDown', 0).state.active).toBe(0);
    // Other keys are the text field's.
    expect(step(start, 'a')).toEqual({ state: start });
  });

  test('the number of results is announced in words for a screen reader', () => {
    expect([0, 1, 7].map(resultsAnnouncement)).toEqual(['No results', '1 result', '7 results']);
  });
});

/** A Tasks module whose help has a screen page, a topic and a glossary term, beside one command, as a later module would declare them. */
function tasksWithHelp() {
  return registryWith(
    testModule({
      id: 'tasks',
      title: 'Tasks',
      desk: 'work',
      path: '/work/tasks',
      routes: [{ path: '/work/tasks', screen: 'tasks' }],
      paletteCommands: () => [{ id: 'retry', label: 'Retry the task', run: () => {} }],
      help: {
        pages: [
          { id: 'tasks', title: 'Tasks', summary: 'Your list of tasks.', route: '/work/tasks', keywords: 'todo', body: [{ h: 'Saved filters' }, { p: 'Keep a filter you use often. A [[playbook]] adds its own tasks here.' }, { p: 'Pin a [[saved-view]] to come back to it.' }] },
          { id: 'retries', title: 'Retrying a task', summary: 'When Hermes tries again by itself.', body: [{ ul: ['Three attempts', 'Then it asks you'] }] },
        ],
        glossary: [
          { id: 'playbook', term: 'Playbook', definition: 'A reusable recipe of stages that creates tasks.', page: 'tasks' },
          { id: 'saved-view', term: 'Smart list', definition: 'Results you pinned for later.', page: 'tasks' },
        ],
      },
    }),
  );
}

describe('help in the palette', () => {
  test('help pages and glossary terms are listed last, after the routes: pages first, each with what it is, and they open help rather than a route', () => {
    const entries = listed(tasksWithHelp(), undefined).filter((entry) => entry.group === 'Help');

    expect(entries.map((entry) => [entry.label, entry.sub, entry.icon, entry.target])).toEqual([
      ['Tasks', 'Your list of tasks.', 'book', { kind: 'help', target: { page: 'tasks' } }],
      ['Retrying a task', 'When Hermes tries again by itself.', 'book', { kind: 'help', target: { page: 'retries' } }],
      ['Playbook', 'Glossary · A reusable recipe of stages that creates tasks.', 'info', { kind: 'help', target: { term: 'playbook' } }],
      ['Smart list', 'Glossary · Results you pinned for later.', 'info', { kind: 'help', target: { term: 'saved-view' } }],
    ]);
    expect(listed(tasksWithHelp(), undefined).at(-1)?.group).toBe('Help');
  });

  test('with no query the palette lists no help, so the commands and routes are what it opens on', () => {
    const groups = (query: string) => rankEntries(listed(tasksWithHelp(), 'tasks'), query).map(({ entry }) => entry.group);

    expect(groups('')).toEqual(['This screen', 'Go to', 'Go to', 'Actions', 'Actions', 'Actions']);
    // A query of spaces is no query.
    expect(groups('   ')).toEqual(['This screen', 'Go to', 'Go to', 'Actions', 'Actions', 'Actions']);
  });

  test('the Help action opens the help for the screen being shown, and says so', () => {
    const entry = listed(tasksWithHelp(), 'tasks').find((candidate) => candidate.label === 'Help')!;

    expect([entry.group, entry.sub, entry.icon, entry.target]).toEqual(['Actions', 'About this screen', 'question', { kind: 'shell', action: 'help.open' }]);
  });

  test('a query finds help next to the commands it also matches: by title first, then by the words of the text, the keywords or the definition', () => {
    const entries = listed(tasksWithHelp(), 'tasks');
    const found = (query: string) => rankEntries(entries, query).map(({ entry }) => [entry.group, entry.label]);

    // A title matches like a label does, after the commands and routes that match.
    expect(found('retry')).toEqual([
      ['This screen', 'Retry the task'],
      ['Help', 'Retrying a task'],
    ]);
    // The words of a page's text, including a heading, a list item and the words a glossary marker stands for: the term's own entry
    // matches by its title, so it comes before the page that only mentions it.
    expect(found('saved filters')).toEqual([['Help', 'Tasks']]);
    expect(found('attempts')).toEqual([['Help', 'Retrying a task']]);
    expect(found('playbook')).toEqual([
      ['Help', 'Playbook'],
      ['Help', 'Tasks'],
    ]);
    // A marker reads as the glossary's own word for the term, not the id it is marked by.
    expect(found('smart')).toEqual([
      ['Help', 'Smart list'],
      ['Help', 'Tasks'],
    ]);
    // Words of one block never run into the next: a query is not found across the end of a heading and the start of a paragraph.
    expect(found('filterskeep')).toEqual([]);
    // Words a page lists as its own, and a definition's words, find their entry; `help` finds the Help action and every page, `glossary`
    // the Help action and every term.
    expect(found('todo')).toEqual([['Help', 'Tasks']]);
    expect(found('recipe')).toEqual([['Help', 'Playbook']]);
    expect(found('glossary')).toEqual([
      ['Actions', 'Help'],
      ['Help', 'Playbook'],
      ['Help', 'Smart list'],
    ]);
    for (const word of ['explain', 'guide']) expect(found(word)).toEqual([['Actions', 'Help']]);
    expect(found('help')).toEqual([
      ['Actions', 'Help'],
      ['Help', 'Tasks'],
      ['Help', 'Retrying a task'],
    ]);
    expect(found('nowhere')).toEqual([]);
  });

  test('the words of a page’s text count only as the phrase typed, and only from three letters on, so a short query does not match every page that mentions it', () => {
    const page = (id: string, title: string, text: string) => ({ id, title, summary: `About ${id}.`, body: [{ p: text }] });
    const registry = registryWith(
      testModule({
        id: 'work',
        title: 'Work',
        desk: 'work',
        path: '/work',
        routes: [{ path: '/work', screen: 'work' }],
        help: {
          pages: [
            page('board', 'Board', 'Every new card is a task. Drag it to a column.'),
            page('briefs', 'Briefs', 'Press New task, write the goal and queue it.'),
            page('runs', 'Runs', 'A run is one try at a task.'),
          ],
          glossary: [],
        },
      }),
    );
    const found = (query: string) => rankEntries(listed(registry, 'work'), query).filter(({ entry }) => entry.group === 'Help').map(({ entry }) => entry.label);

    // Both words are in the Board page, but not together; the Briefs page says it.
    expect(found('new task')).toEqual(['Briefs']);
    expect(found('ne')).toEqual([]);
    expect(found('goal')).toEqual(['Briefs']);
  });

  test('a query lists at most six help entries, so the commands and pages it also matches stay in view', () => {
    const pages = Array.from({ length: 9 }, (_, index) => ({ id: `p${index}`, title: `Topic ${index}`, summary: 'Notes.', body: [{ p: 'Text.' }] }));
    const registry = registryWith(testModule({ id: 'work', title: 'Work', desk: 'work', path: '/work', routes: [{ path: '/work', screen: 'work' }], help: { pages, glossary: [] } }));

    const help = rankEntries(listed(registry, 'work'), 'topic').filter(({ entry }) => entry.group === 'Help');

    expect(help.map(({ entry }) => entry.label)).toEqual(['Topic 0', 'Topic 1', 'Topic 2', 'Topic 3', 'Topic 4', 'Topic 5']);
  });

  test('choosing a help page or a glossary term opens it in the help panel and navigates nowhere', async () => {
    const opened: HelpTarget[] = [];
    const deps = {
      navigate: async () => {
        throw new Error('help is not a route');
      },
      shell: () => {},
      help: (target: HelpTarget) => void opened.push(target),
      confirm: undefined,
    };

    for (const entry of listed(tasksWithHelp(), undefined).filter((candidate) => candidate.group === 'Help')) expect(await runEntry(entry, deps)).toBe('ran');

    expect(opened).toEqual([{ page: 'tasks' }, { page: 'retries' }, { term: 'playbook' }, { term: 'saved-view' }]);
  });
});

describe('search hits from a module', () => {
  const hit = { id: 'deploy-notes', label: 'Deploy post-mortem', sub: 'default · Telegram', snippet: [{ text: 'The ', match: false }, { text: 'migration', match: true }], path: '/chat/deploy-notes?find=migrat' };

  test('a module that can search says so, and the registry lists its search', () => {
    const search = async () => [hit];
    const registry = registryWith(testModule({ id: 'chat', title: 'Chat', desk: 'today', path: '/chat', routes: [{ path: '/chat', screen: 'chat' }], paletteSearch: search }), testModule());
    expect(registry.paletteSearches()).toEqual([{ moduleId: 'chat', search, eachProfile: false }]);
  });

  test('hits are a group of their own, after the actions and before the pages; the query that found them does not rank them away; each opens its address', async () => {
    const registry = registryWith(testModule({ id: 'chat', title: 'Chat', desk: 'today', path: '/chat', routes: [{ path: '/chat', screen: 'chat' }], paletteCommands: () => [{ id: 'new-chat', label: 'Migrate a chat', run: () => {} }] }));
    const ranked = withHits(rankEntries(listed(registry, undefined), 'migrat'), hitEntries([hit], 'chat'));
    expect(ranked.map(({ entry }) => `${entry.group}: ${entry.label}`)).toEqual(['Actions: Migrate a chat', 'Sessions: Deploy post-mortem']);
    const found = ranked.at(-1)!.entry;
    expect(found).toMatchObject({ sub: 'default · Telegram', icon: 'chat', snippet: hit.snippet, target: { kind: 'route', path: '/chat/deploy-notes?find=migrat' } });
    const navigated: string[] = [];
    await runEntry(found, { navigate: async (path) => void navigated.push(path), shell: () => {}, help: () => {}, confirm: undefined });
    expect(navigated).toEqual(['/chat/deploy-notes?find=migrat']);
  });

  test('with no hits the list is as it was', () => {
    const ranked = rankEntries(listed(registryWith(testModule()), undefined), '');
    expect(withHits(ranked, [])).toBe(ranked);
  });
});

describe('what the palette searches', () => {
  const profiles = ['default', 'research', 'ops'];

  test('a screen that shows every profile (Today) searches every profile, and says so in the footer', () => {
    expect(searchProfiles({ scope: 'all', effective: 'research', profiles })).toEqual(profiles);
    expect(searchScopeText('all')).toBe('Searching all profiles');
  });

  test('any other screen searches the profile it shows, and says which', () => {
    expect(searchProfiles({ scope: 'research', effective: 'default', profiles })).toEqual(['research']);
    expect(searchScopeText('research')).toBe('Searching profile research only');
  });

  test('before Hermes has listed its profiles only the profile this tab works on is known, and while even that is not known the scope says nothing', () => {
    expect(searchProfiles({ scope: 'all', effective: 'research', profiles: undefined })).toEqual(['research']);
    expect(searchProfiles({ scope: undefined, effective: undefined, profiles: undefined })).toEqual([undefined]);
    expect(searchScopeText(undefined)).toBe('');
  });

  test('the hits of several profiles are one list: the profiles take turns, a hit that opens the same address is listed once, and the list is capped', () => {
    const hit = (path: string) => ({ id: path, label: path, path });
    const merged = mergeProfileHits([[hit('/a1'), hit('/a2'), hit('/a3')], [hit('/b1'), hit('/a2')], [hit('/c1')]], 4);

    expect(merged.map((entry) => entry.path)).toEqual(['/a1', '/b1', '/c1', '/a2']);
    expect(mergeProfileHits([], 8)).toEqual([]);
  });

  test('a module asks once for each profile only when it says its answer depends on the profile', () => {
    const search = async () => [];
    const registry = registryWith(testModule({ id: 'chat', desk: 'today', path: '/chat', routes: [{ path: '/chat', screen: 'chat' }], paletteSearch: search, paletteSearchEachProfile: true }));
    expect(registry.paletteSearches()).toEqual([{ moduleId: 'chat', search, eachProfile: true }]);
  });
});

describe('palette order and names', () => {
  /** The Desk as the product has it: Today, Talk (the module is called Chat), Work (its first module is called Overview) and a Control module. */
  function desk() {
    return registryWith(
      testModule({ id: 'today', title: 'Today', desk: 'today', path: '/today', summary: 'What needs you', routes: [{ path: '/today', screen: 'today' }] }),
      testModule({ id: 'chat', title: 'Chat', desk: 'talk', path: '/chat', summary: 'Talk to Hermes', routes: [{ path: '/chat', screen: 'chat' }] }),
      testModule({ id: 'work-overview', title: 'Overview', desk: 'work', path: '/work', summary: 'Everything in flight', routes: [{ path: '/work', screen: 'work' }] }),
      testModule({ id: 'tasks', title: 'Tasks', desk: 'work', path: '/work/tasks', summary: 'Every task', routes: [{ path: '/work/tasks', screen: 'tasks' }] }),
      testModule({ id: 'channels', title: 'Channels', path: '/connect/channels', group: 'connect', summary: 'Where Hermes listens', keywords: ['telegram', 'discord'], routes: [{ path: '/connect/channels', screen: 'channels' }] }),
    );
  }

  test('with no query the primary places come first, as Today, Talk, Work and Control, before any action', () => {
    const ranked = rankEntries(listed(desk(), undefined), '');

    expect(ranked.slice(0, 4).map(({ entry }) => [entry.group, entry.label])).toEqual([
      ['Go to', 'Today'],
      ['Go to', 'Talk'],
      ['Go to', 'Work'],
      ['Go to', 'Control'],
    ]);
  });

  test('a destination is called Talk or Work, not by the title of the module it opens on, and the module title still finds it', () => {
    const entries = listed(desk(), undefined);

    expect(entries.map((entry) => entry.label)).not.toContain('Chat');
    expect(entries.map((entry) => entry.label)).not.toContain('Overview');
    expect(rankEntries(entries, 'chat').map(({ entry }) => entry.label)).toContain('Talk');
    expect(rankEntries(entries, 'overview').map(({ entry }) => entry.label)).toContain('Work');
  });

  test('the words a module names for itself find it: telegram finds Channels', () => {
    expect(rankEntries(listed(desk(), undefined), 'telegram').map(({ entry }) => entry.label)).toEqual(['Channels']);
  });

  test('a loose scatter of letters is not a match: hello does not find Shell hooks, log does not find a word that only holds the letters', () => {
    const registry = registryWith(
      testModule({ id: 'hooks', title: 'Shell hooks', path: '/agents/hooks', routes: [{ path: '/agents/hooks', screen: 'hooks' }] }),
      testModule({ id: 'maint', title: 'Maintenance sweep', path: '/system/maintenance', routes: [{ path: '/system/maintenance', screen: 'maint' }] }),
      testModule({ id: 'hello', title: 'Hello world', path: '/agents/hello', routes: [{ path: '/agents/hello', screen: 'hello' }] }),
    );
    const entries = listed(registry, undefined);

    expect(rankEntries(entries, 'hello').map(({ entry }) => entry.label)).toEqual(['Hello world']);
    expect(rankEntries(entries, 'log out').map(({ entry }) => entry.label)).toEqual(['Sign out']);
  });

  test('Sign out is an action of the shell, with words a person looks for', () => {
    const entry = listed(desk(), undefined).find((candidate) => candidate.label === 'Sign out');

    expect(entry).toMatchObject({ group: 'Actions', target: { kind: 'shell', action: 'shell.sign-out' } });
    for (const query of ['sign out', 'log out', 'logout']) expect(rankEntries(listed(desk(), undefined), query).map(({ entry }) => entry.label)).toContain('Sign out');
  });
});
