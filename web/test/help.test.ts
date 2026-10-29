import { describe, expect, test } from 'vitest';
import { FOLD_AT_HEADINGS, helpPageFor, helpProblems, helpSections, parseInline, plainText, resolveHelpTarget, termBlockIndex, type GlossaryTerm, type HelpPage, type ModuleHelp } from '../src/help.ts';
import { createModuleRegistry, type ModuleDefinition } from '../src/module-registry.ts';

// The registry is generic over what a route renders, so these tests use plain strings as screens.
type Screen = string;

/** A module as a later ticket would write it: its help is declared beside its routes and nothing here is known to the shell. */
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
    help: {
      pages: [{ id: 'skills', title: 'Skills', summary: 'What a skill is and how to turn one off.', route: '/agents/skills', body: [{ p: 'A skill is a folder of instructions Hermes can load.' }] }],
      glossary: [{ id: 'skill', term: 'Skill', definition: 'A folder of instructions Hermes can load when a task needs it.', page: 'skills' }],
    },
    ...overrides,
  };
}

describe('help registration', () => {
  test('a module registers its help pages and glossary terms with the module registry, and the registry tags each with its module', () => {
    const registry = createModuleRegistry<Screen>();
    registry.register(testModule());

    expect(registry.helpPages().map(({ moduleId, id, title }) => [moduleId, id, title])).toEqual([['skills', 'skills', 'Skills']]);
    expect(registry.glossary().map(({ moduleId, id, term }) => [moduleId, id, term])).toEqual([['skills', 'skill', 'Skill']]);
  });

  test('two registrations cannot share a page id or a term id, and a refused one leaves nothing behind', () => {
    const registry = createModuleRegistry<Screen>();
    registry.register(testModule());

    const samePage = testModule({ id: 'tools', path: '/agents/tools', routes: [{ path: '/agents/tools', screen: 'tools' }], help: { pages: [{ id: 'skills', title: 'Tools', summary: 'Tools.', body: [] }] } });
    expect(() => registry.register(samePage)).toThrow('help page "skills" is already registered');
    const sameTerm = testModule({
      id: 'tools',
      path: '/agents/tools',
      routes: [{ path: '/agents/tools', screen: 'tools' }],
      help: { pages: [{ id: 'tools', title: 'Tools', summary: 'Tools.', body: [] }], glossary: [{ id: 'skill', term: 'Skill', definition: 'Again.', page: 'tools' }] },
    });
    expect(() => registry.register(sameTerm)).toThrow('glossary term "skill" is already registered');
    expect(() => registry.addHelp('shell', { pages: [{ id: 'skills', title: 'Again', summary: 'Again.', body: [] }] })).toThrow('help page "skills" is already registered');

    // Nothing of the refused ones stayed: not the module, not its page, not its term.
    expect(registry.module('tools')).toBeUndefined();
    expect(registry.helpPages().map(({ id }) => id)).toEqual(['skills']);
    expect(registry.glossary().map(({ id }) => id)).toEqual(['skill']);

    registry.addHelp('shell', { pages: [{ id: 'sign-in', title: 'Signing in', summary: 'How to sign in.', route: '/sign-in', body: [] }] });
    expect(registry.helpPages().map(({ moduleId, id }) => [moduleId, id])).toEqual([['skills', 'skills'], ['shell', 'sign-in']]);
  });

  test('a module cannot repeat a page id or a term id within its own help either', () => {
    const page = { id: 'skills', title: 'Skills', summary: 'Skills.', route: '/agents/skills', body: [] };
    const term = { id: 'skill', term: 'Skill', definition: 'A folder.', page: 'skills' };

    expect(() => createModuleRegistry<Screen>().register(testModule({ help: { pages: [page, page] } }))).toThrow('help page "skills" is already registered');
    expect(() => createModuleRegistry<Screen>().register(testModule({ help: { pages: [page], glossary: [term, term] } }))).toThrow('glossary term "skill" is already registered');
  });
});

describe('help given as a loader', () => {
  const skills = testModule().help!;
  const lazily = (loads: { count: number }) => async () => {
    loads.count++;
    return skills as ModuleHelp;
  };

  test('a module may give its help as a loader, so the first load of the app need not carry it: it is there once `loadHelp` has run, loaded once, and listeners hear of it', async () => {
    const registry = createModuleRegistry<Screen>();
    const loads = { count: 0 };
    const heard: boolean[] = [];
    registry.onHelpLoaded(() => heard.push(registry.helpLoaded()));
    // A listener that has stopped hears nothing.
    registry.onHelpLoaded(() => heard.push(false))();
    registry.register(testModule({ help: lazily(loads) }));
    registry.addHelp('shell', async () => ({ pages: [{ id: 'sign-in', title: 'Signing in', summary: 'How.', route: '/sign-in', body: [] }] }));

    expect([registry.helpLoaded(), registry.helpPages(), registry.glossary()]).toEqual([false, [], []]);
    await Promise.all([registry.loadHelp(), registry.loadHelp()]);
    await registry.loadHelp();

    expect(loads.count).toBe(1);
    expect(registry.helpLoaded()).toBe(true);
    expect(registry.helpPages().map(({ moduleId, id }) => [moduleId, id])).toEqual([['skills', 'skills'], ['shell', 'sign-in']]);
    expect(registry.glossary().map(({ moduleId, id }) => [moduleId, id])).toEqual([['skills', 'skill']]);
    expect(heard).toEqual([true]);
  });

  test('every help loader is started at once (one round trip, not one per module), and the pages are still listed in registration order whichever answers first', async () => {
    const registry = createModuleRegistry<Screen>();
    const started: string[] = [];
    const slow = Promise.withResolvers<ModuleHelp>();
    registry.addHelp('first', () => {
      started.push('first');
      return slow.promise;
    });
    registry.addHelp('second', async () => {
      started.push('second');
      return { pages: [{ id: 'second-page', title: 'Second', summary: 'Second.', body: [] }] };
    });

    const loading = registry.loadHelp();
    // The first has not answered, and the second was asked all the same.
    expect(started).toEqual(['first', 'second']);
    slow.resolve({ pages: [{ id: 'first-page', title: 'First', summary: 'First.', body: [] }] });
    await loading;

    expect(registry.helpPages().map(({ moduleId }) => moduleId)).toEqual(['first', 'second']);
  });

  test('help that is loaded must keep the same rules: a page id already taken fails the load, and its pages are not registered', async () => {
    const registry = createModuleRegistry<Screen>();
    registry.register(testModule());
    registry.addHelp('shell', async () => ({ pages: [{ id: 'skills', title: 'Again', summary: 'Again.', body: [] }] }));

    await expect(registry.loadHelp()).rejects.toThrow('help page "skills" is already registered');
    expect(registry.helpPages().map(({ moduleId }) => moduleId)).toEqual(['skills']);
  });
});

describe('the help contract', () => {
  test('a module without a help page for each of its routes fails, its settings panels’ routes and module-less modules included', () => {
    const registry = createModuleRegistry<Screen>();
    registry.register(
      testModule({
        routes: [
          { path: '/agents/skills', screen: 'skills' },
          { path: '/agents/skills/:name', screen: 'skill' },
        ],
        settings: [{ id: 'skill-sources', title: 'Skill sources', summary: 'Where skills come from', icon: 'stack', screen: 'sources', fields: [] }],
      }),
    );
    registry.register(testModule({ id: 'tools', path: '/agents/tools', routes: [{ path: '/agents/tools', screen: 'tools' }], help: undefined }));

    expect(helpProblems(registry)).toEqual([
      'module "skills" has no help page for /agents/skills/:name',
      'module "skills" has no help page for /settings/skill-sources',
      'module "tools" has no help page for /agents/tools',
    ]);
  });

  test('a module whose pages cover every route has no problem, and a page of another module does not stand in for one', () => {
    const registry = createModuleRegistry<Screen>();
    registry.register(testModule());
    registry.register(testModule({ id: 'tools', path: '/agents/tools', routes: [{ path: '/agents/tools', screen: 'tools' }], help: { pages: [{ id: 'tools', title: 'Tools', summary: 'Tools.', body: [] }] } }));
    registry.addHelp('shell', { pages: [{ id: 'tools-again', title: 'Tools', summary: 'Tools.', route: '/agents/tools', body: [] }] });

    expect(helpProblems(registry)).toEqual(['module "tools" has no help page for /agents/tools']);
  });
});

describe('the help contract: glossary and links', () => {
  const withPages = (pages: HelpPage[], glossary: GlossaryTerm[] = []) => {
    const registry = createModuleRegistry<Screen>();
    registry.register(testModule({ help: { pages: [{ id: 'skills', title: 'Skills', summary: 'Skills.', route: '/agents/skills', body: [] }, ...pages], glossary } }));
    return registry;
  };

  test('a page that marks a glossary term no module registered fails, wherever in its text the marker is', () => {
    const registry = withPages(
      [
        { id: 'a', title: 'A', summary: 'A.', body: [{ h: 'About [[ghost]]' }, { p: 'Known: [[skill]]. Unknown: [[spirit|a spirit]]. [[ghost]] is named twice here, and [[ghost]] again.' }, { ul: ['plain', 'with [[phantom]]'] }, { ol: ['[[skill]]', '[[wraith]] first'] }] },
      ],
      [{ id: 'skill', term: 'Skill', definition: 'A folder of instructions.', page: 'skills' }],
    );

    // Each unregistered term is reported once for the page, however often it is marked. The marker in the heading is a problem of its own too.
    expect(helpProblems(registry)).toEqual([
      'help page "a" uses glossary term "ghost", which no module registers',
      'help page "a" uses glossary term "spirit", which no module registers',
      'help page "a" uses glossary term "phantom", which no module registers',
      'help page "a" uses glossary term "wraith", which no module registers',
      'help page "a" has a glossary marker in a heading, which shows as plain text',
    ]);
  });

  test('a term from another module’s glossary is fine, because the glossary is the app’s', () => {
    const registry = createModuleRegistry<Screen>();
    registry.register(testModule());
    registry.register(
      testModule({
        id: 'tools',
        path: '/agents/tools',
        routes: [{ path: '/agents/tools', screen: 'tools' }],
        help: { pages: [{ id: 'tools', title: 'Tools', summary: 'Tools.', route: '/agents/tools', body: [{ p: 'Tools sit beside a [[skill]].' }] }] },
      }),
    );

    expect(helpProblems(registry)).toEqual([]);
  });

  test('a related page or a term’s page that does not exist fails, and so does a marker in a title or summary, which show as plain text', () => {
    const registry = withPages(
      [
        { id: 'a', title: 'About [[skill]]', summary: 'Plain.', related: ['skills', 'ghost'], body: [] },
        { id: 'b', title: 'B', summary: 'See [[skill]].', body: [] },
      ],
      [
        { id: 'skill', term: 'Skill', definition: 'A folder of instructions.', page: 'skills' },
        { id: 'lost', term: 'Lost', definition: 'Points nowhere.', page: 'nowhere' },
      ],
    );

    expect(helpProblems(registry)).toEqual([
      'help page "a" lists "ghost" as related, but there is no such page',
      'help page "a" has a glossary marker in its title or summary, which show as plain text',
      'help page "b" has a glossary marker in its title or summary, which show as plain text',
      'glossary term "lost" opens "nowhere", but there is no such page',
    ]);
  });

  test('a marker in a heading of a page fails: a heading is not a sentence, and a term in one is a tap target too small to hit', () => {
    const registry = withPages(
      [{ id: 'a', title: 'A', summary: 'A.', body: [{ h: 'A plain heading' }, { p: 'A [[skill]] in a paragraph is fine.' }, { h: 'Using a [[skill]]' }, { h: 'Another [[skill|one]]' }] }],
      [{ id: 'skill', term: 'Skill', definition: 'A folder of instructions.', page: 'skills' }],
    );

    expect(helpProblems(registry)).toEqual(['help page "a" has a glossary marker in a heading, which shows as plain text']);
  });
});

describe('glossary markers in help text', () => {
  test('`[[id]]` marks a term as written, `[[id|words]]` marks it with other words, and everything else is plain text', () => {
    expect(parseInline('Hermes asks for a [[passkey]] at [[risk-tiers|tier 2]] and above.')).toEqual([
      { text: 'Hermes asks for a ' },
      { term: 'passkey' },
      { text: ' at ' },
      { term: 'risk-tiers', text: 'tier 2' },
      { text: ' and above.' },
    ]);
    expect(parseInline('Nothing marked here.')).toEqual([{ text: 'Nothing marked here.' }]);
    expect(parseInline('')).toEqual([]);
    // A bracket that closes nothing is just text.
    expect(parseInline('Lists look like [[this and [that].')).toEqual([{ text: 'Lists look like [[this and [that].' }]);
    expect(parseInline('[[a]][[b]]')).toEqual([{ term: 'a' }, { term: 'b' }]);
    // Each marker's words end at its own closing brackets, not a later marker's.
    expect(parseInline('[[a|one]] and [[b|two]]')).toEqual([{ term: 'a', text: 'one' }, { text: ' and ' }, { term: 'b', text: 'two' }]);
  });

  test('for searching, a marker reads as the words it is marked with, or else the term as the glossary writes it, or else its id', () => {
    const label = (id: string) => (id === 'passkey' ? 'Passkey' : undefined);

    expect(plainText('Use a [[passkey]] or [[risk-tiers|tier 2]] and [[ghost]] to sign in.', label)).toBe('Use a Passkey or tier 2 and ghost to sign in.');
    expect(plainText('No markers.', label)).toBe('No markers.');
    expect(plainText('[[passkey]][[passkey|key]]', label)).toBe('Passkeykey');
    expect(plainText('', label)).toBe('');
  });
});

describe('the help for a screen', () => {
  const page = (id: string, route?: string): HelpPage => ({ id, title: id, summary: id, route, body: [] });
  const pages = [page('tasks', '/work/tasks'), page('task', '/work/tasks/:taskId'), page('new-task', '/work/tasks/new'), page('files', '/workspace/files/*path'), page('topic')];

  test('a path finds the page whose route it matches, and the most specific route wins', () => {
    expect(helpPageFor(pages, '/work/tasks')?.id).toBe('tasks');
    expect(helpPageFor(pages, '/work/tasks/')?.id).toBe('tasks');
    expect(helpPageFor(pages, '/work/tasks/t-81')?.id).toBe('task');
    // `new` is written out in one route and is a parameter's value in the other.
    expect(helpPageFor(pages, '/work/tasks/new')?.id).toBe('new-task');
    expect(helpPageFor(pages, '/workspace/files')?.id).toBe('files');
    expect(helpPageFor(pages, '/workspace/files/src/main.ts')?.id).toBe('files');
  });

  test('a path no page claims, and a page that is a topic and not a screen, find nothing', () => {
    expect(helpPageFor(pages, '/work')).toBeUndefined();
    expect(helpPageFor(pages, '/work/tasks/t-81/runs')).toBeUndefined();
    expect(helpPageFor(pages, '/topic')).toBeUndefined();
  });

  test('a more specific route wins over a looser one that also fits, in whatever order the pages were registered: a route written out, then a parameter, then a splat, and a route that ends where the path does over a splat that matches nothing', () => {
    const specific = [page('exact', '/docs'), page('new', '/docs/new'), page('one', '/docs/:slug'), page('rest', '/docs/*rest')];
    for (const registered of [specific, [...specific].reverse()]) {
      expect(helpPageFor(registered, '/docs')?.id).toBe('exact');
      expect(helpPageFor(registered, '/docs/new')?.id).toBe('new');
      expect(helpPageFor(registered, '/docs/intro')?.id).toBe('one');
      expect(helpPageFor(registered, '/docs/intro/part-2')?.id).toBe('rest');
    }
  });

  test('routes are compared segment by segment from the start: the first place they differ decides, however the rest of them fit', () => {
    const pages = [page('params', '/a/:x/:y'), page('literal-then-rest', '/a/b/*rest'), page('param-then-literal', '/:w/b/c')];

    // `b` written out beats a parameter in the second place, though `/a/:x/:y` has more parameters to show for it.
    expect(helpPageFor(pages, '/a/b/c')?.id).toBe('literal-then-rest');
    expect(helpPageFor(pages, '/a/z/c')?.id).toBe('params');
    expect(helpPageFor(pages, '/q/b/c')?.id).toBe('param-then-literal');
    // The longer of two splats has more written out.
    expect(helpPageFor([page('short', '/a/*rest'), page('long', '/a/b/*rest')], '/a/b/c')?.id).toBe('long');
  });

  test('two routes that fit a path in exactly the same way: the page registered first wins', () => {
    const tied = [page('first', '/a/:x'), page('second', '/a/:y')];

    expect(helpPageFor(tied, '/a/b')?.id).toBe('first');
    expect(helpPageFor(tied.toReversed(), '/a/b')?.id).toBe('second');
  });

  test('a topic page, which has no route, is never the page for a screen, not even the root', () => {
    expect(helpPageFor(pages, '/')).toBeUndefined();
  });
});

describe('what the help panel opens on', () => {
  const registry = createModuleRegistry<Screen>();
  registry.register(
    testModule({
      routes: [
        { path: '/agents/skills', screen: 'skills' },
        { path: '/agents/skills/:name', screen: 'skill' },
      ],
      help: {
        pages: [
          { id: 'skills', title: 'Skills', summary: 'Skills.', route: '/agents/skills', body: [] },
          { id: 'skill-detail', title: 'A skill', summary: 'A skill.', route: '/agents/skills/:name', body: [] },
          { id: 'writing', title: 'Writing a skill', summary: 'Writing.', body: [] },
        ],
        glossary: [{ id: 'skill', term: 'Skill', definition: 'A folder of instructions.', page: 'writing' }],
      },
    }),
  );

  test('the screen being shown opens its page; a screen with no page, an unknown page or term, opens the list of topics', () => {
    expect(resolveHelpTarget(registry, { screen: '/agents/skills/git' })).toEqual({ tab: 'help', page: 'skill-detail' });
    expect(resolveHelpTarget(registry, { screen: '/control' })).toEqual({ tab: 'help' });
    expect(resolveHelpTarget(registry, { page: 'writing' })).toEqual({ tab: 'help', page: 'writing' });
    expect(resolveHelpTarget(registry, { page: 'ghost' })).toEqual({ tab: 'help' });
    expect(resolveHelpTarget(registry, { term: 'ghost' })).toEqual({ tab: 'help' });
  });

  test('a glossary term opens the page it points at, with the term to show above it, and the shortcuts open their own tab', () => {
    expect(resolveHelpTarget(registry, { term: 'skill' })).toEqual({ tab: 'help', page: 'writing', term: 'skill' });
    expect(resolveHelpTarget(registry, { shortcuts: true })).toEqual({ tab: 'shortcuts' });
  });
});

describe('long help pages', () => {
  const long = [{ p: 'Intro.' }, { h: 'One' }, { p: 'First.' }, { ul: ['a', 'b'] }, { h: 'Two' }, { p: 'Second, with a [[skill]].' }, { h: 'Three' }, { p: 'Third.' }];

  test('are cut at their headings so the screen can fold them: the text before the first stays out of every section', () => {
    expect(helpSections(long)).toEqual({
      intro: [{ p: 'Intro.' }],
      sections: [
        { heading: 'One', blocks: [{ p: 'First.' }, { ul: ['a', 'b'] }] },
        { heading: 'Two', blocks: [{ p: 'Second, with a [[skill]].' }] },
        { heading: 'Three', blocks: [{ p: 'Third.' }] },
      ],
    });
  });

  test(`are left whole below ${FOLD_AT_HEADINGS} headings`, () => {
    const short = [{ p: 'Intro.' }, { h: 'One' }, { p: 'First.' }, { h: 'Two' }, { p: 'Second.' }];
    expect(helpSections(short)).toEqual({ intro: short, sections: [] });
    expect(helpSections([])).toEqual({ intro: [], sections: [] });
  });

  test('a glossary term’s “More” finds the first passage that uses the term, so the page can open that section and mark it', () => {
    expect(termBlockIndex(long, 'skill')).toBe(5);
    expect(termBlockIndex(long, 'unknown')).toBe(-1);
  });
});
