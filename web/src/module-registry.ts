// The module registry (information architecture §1, decision 7): every feature area declares itself here, and the
// shell reads only the registry. Adding a module is one `register` call; no shell code changes.
//
// The registry is generic over `Screen` (what a route renders), so it stays free of React and runs under test.

import type { GlossaryTerm, HelpPage, ModuleHelp } from './help.ts';
import type { IconName } from './icons.tsx';

/**
 * Where a module's screen sits in the Desk (information architecture, M8): one of the three destinations, or Control, which holds everything else.
 * The shell shows the destinations in this order; `control` is last because it is reached through the sidebar's Control entry and a phone's More tab.
 */
export type DeskPlacement = 'today' | 'talk' | 'work' | 'control';

export const DESK_PLACEMENTS: readonly DeskPlacement[] = ['today', 'talk', 'work', 'control'];

/** The groups of the Control screen, in display order. Only a module placed in Control has one. */
export type GroupId = 'main' | 'agents' | 'connect' | 'workspace' | 'observe' | 'system' | 'settings';

export interface NavGroup {
  id: GroupId;
  title: string;
  icon: IconName;
}

export const CONTROL_GROUPS: readonly NavGroup[] = [
  { id: 'main', title: 'Main', icon: 'inbox' },
  { id: 'agents', title: 'Agents', icon: 'agents' },
  { id: 'connect', title: 'Connect', icon: 'broadcast' },
  { id: 'workspace', title: 'Workspace', icon: 'folder' },
  { id: 'observe', title: 'Observe', icon: 'chart' },
  { id: 'system', title: 'System', icon: 'shield' },
  { id: 'settings', title: 'Settings', icon: 'settings' },
];

/** Risk tiers (architecture §5): T0 undo · T1 confirm · T2 passkey step-up · T3 step-up + typed confirmation. */
export type RiskTier = 'T0' | 'T1' | 'T2' | 'T3';

/** An action a module adds to the command palette (M0 #06 lists them; one that needs a tier goes through the tiered dialog). */
export interface PaletteCommand {
  id: string;
  label: string;
  icon?: IconName;
  /** A second line, e.g. what the action will do. */
  sub?: string;
  tier?: RiskTier;
  /** The key it is bound to unless the owner remaps it on this device: `mod+shift+o` (⌘ or Ctrl), `g i`, `?`. */
  shortcut?: string;
  run(): void;
}

/** One result of a module's search in the command palette (M1 #15): what it is, and the address that opens it. */
export interface PaletteHit {
  id: string;
  label: string;
  /** A second line: where it is from, and when. */
  sub?: string;
  /** The words around what the query matched, with the matched ones marked. */
  snippet?: { text: string; match: boolean }[];
  icon?: IconName;
  /** The palette group the hit is listed in; Sessions unless it says otherwise. */
  group?: 'Sessions' | 'Playbooks' | 'Settings';
  /** The address to open. */
  path: string;
}

/** What a module's palette search is given: the profile this tab works on, and a signal that fires when the query has moved on. */
export interface PaletteSearchContext {
  profile: string | undefined;
  signal: AbortSignal;
}

export type PaletteSearch = (query: string, context: PaletteSearchContext) => Promise<PaletteHit[]>;

/** A panel of the Settings screen. The module gets a route for it, `/settings/<id>` unless it names another `path`. */
export interface SettingsPanel<Screen> {
  id: string;
  title: string;
  summary: string;
  icon: IconName;
  path?: string;
  /** Where "back" leads from the panel's screen when that is not the module's own screen (a panel that is a screen of its own, such as the setup wizard, goes back to Settings). */
  parent?: string;
  screen: Screen;
  /** The settings on the panel, for Settings search and the palette. */
  fields: SettingField[];
}

/** One setting on a panel. Its input in the panel carries `data-setting-field="<panel id>/<field id>"`. */
export interface SettingField {
  id: string;
  label: string;
  description: string;
  keywords: string[];
}

/** What a module says about the risk of its own actions; the shared tiered dialog (M0 #08) asks for it by action id. */
export interface ModulePolicy {
  tierOf(action: string): RiskTier | undefined;
}

/**
 * A count a module shows on its nav entry (Today's badge, the count of what needs a decision): a store the shell subscribes to, so the shell never imports the module.
 * `label` is the text equivalent a screen reader gets (it says what the number counts).
 */
export interface NavBadge {
  subscribe(listener: () => void): () => void;
  count(): number;
  label(count: number): string;
}

export interface ModuleRoute<Screen> {
  /** A URL pattern from information architecture §7: `:name` matches one segment, `*name` the rest. */
  path: string;
  screen: Screen;
  /** The app bar's title for this screen when it is not the module's own. */
  title?: string;
  /** Where "back" leads on a phone (and the breadcrumb above this screen); by default the screen's parent URL. */
  parent?: string;
}

/** Help that is fetched when it is first wanted rather than carried in the first load. */
export type HelpLoader = () => Promise<ModuleHelp>;

export interface ModuleDefinition<Screen> {
  id: string;
  title: string;
  icon: IconName;
  /** Where the module sits in the Desk. The shell derives the sidebar, the phone's tab bar and Control from it; adding a module never edits the shell. */
  desk: DeskPlacement;
  /** The Control group that lists the module. Required when `desk` is `control`, and absent otherwise. */
  group?: GroupId;
  /** Where the module's nav entry leads. */
  path: string;
  /** The key after `g` that jumps to the module's entry (`g i`), unless the owner remaps it on this device. */
  key?: string;
  /** Position within its placement (or within its Control group), ascending; modules without one follow, in registration order. */
  order?: number;
  /** One line for Control and the palette. */
  summary: string;
  /** A count shown on the module's entry, and on its destination when the module sits in one; nothing shows while it is zero. */
  badge?: NavBadge;
  routes: ModuleRoute<Screen>[];
  /** Shows the "All profiles" scope and a profile filter by default (information architecture §6). */
  crossProfile?: boolean;
  /** Always shows every profile: the tab's profile never filters it, and the app bar's profile chip says All profiles and cannot be changed (information architecture §6). */
  allProfiles?: boolean;
  /** The page header shows which profile the screen is scoped to. */
  profileScoped?: boolean;
  paletteCommands?: () => PaletteCommand[];
  /**
   * Addresses this module used to answer on and now sends to the new ones (a bookmark or a link written down before a screen moved):
   * `from` and `to` are route patterns, and a `:name` in `from` goes along to `to` under the same name.
   */
  redirects?: { from: string; to: string }[];
  /** Finds things of the module's by what the owner typed in the palette (Hermes does the searching); the hits are listed under the module's own group. */
  paletteSearch?: PaletteSearch;
  settings?: SettingsPanel<Screen>[];
  policy?: ModulePolicy;
  /**
   * Help for each of the module's screens and the glossary terms it uses (M1 #02). `helpProblems` (help.ts) holds every module to
   * it. A loader (`() => import('./help.ts').then((m) => m.help)`) keeps the pages out of the first load of the app.
   */
  help?: ModuleHelp | HelpLoader;
}

/** A route as the shell mounts it, tagged with the module that owns it. */
export interface RegisteredRoute<Screen> extends ModuleRoute<Screen> {
  moduleId: string;
}

export interface RegisteredSettingsPanel extends Omit<SettingsPanel<unknown>, 'screen' | 'path' | 'parent'> {
  moduleId: string;
  path: string;
}

/** A help page as the registry lists it, tagged with whoever registered it: a module's id, or `shell` for the app's own. */
export interface RegisteredHelpPage extends HelpPage {
  moduleId: string;
}

export interface RegisteredTerm extends GlossaryTerm {
  moduleId: string;
}

export interface ModuleRegistry<Screen> {
  /** Adds a module. Throws, changing nothing, if its id or any of its routes (settings panels included) is taken. */
  register(module: ModuleDefinition<Screen>): void;
  module(id: string): ModuleDefinition<Screen> | undefined;
  /** Every registered module, in registration order. */
  modules(): ModuleDefinition<Screen>[];
  /** The modules placed at one Desk placement, ordered by `order` and then by registration. */
  inPlacement(placement: DeskPlacement): ModuleDefinition<Screen>[];
  /** What Control lists: each group that has modules, in `CONTROL_GROUPS` order, with its modules. */
  controlGroups(): { group: NavGroup; modules: ModuleDefinition<Screen>[] }[];
  /** Every route of every registered module (its settings panels' routes last), in registration order. */
  routes(): RegisteredRoute<Screen>[];
  paletteCommands(): (PaletteCommand & { moduleId: string })[];
  paletteSearches(): { moduleId: string; search: PaletteSearch }[];
  settingsPanels(): RegisteredSettingsPanel[];
  /** `/` leads to the first Today module; `/<placement>` and `/<group>` to the first module they hold, when no route owns that path; and each module's own moved addresses. */
  redirects(): { from: string; to: string }[];
  /** The risk tier a module declares for an action, if any does. */
  tierOf(action: string): RiskTier | undefined;
  /** The Desk placement a page sits under (the tab, rail item or sidebar entry to light). A settings page (`pathname`) is under Control whichever module owns the panel. */
  destinationOf(moduleId: string, pathname?: string): DeskPlacement;
  /** The module whose entry Control lights and whose title leads the breadcrumb: `settings` for any `/settings/…` page, whichever module owns its panel. */
  shellModuleOf(moduleId: string | undefined, pathname: string): string | undefined;
  /**
   * Registers help that belongs to no module: the sign-in screen, Control, how the shell works. A module's `help` goes through
   * `register`. Help given whole throws, changing nothing, if a page or term id is taken; a loader is checked by `loadHelp`.
   */
  addHelp(owner: string, help: ModuleHelp | HelpLoader): void;
  /** Every registered help page that has loaded, in registration order. */
  helpPages(): RegisteredHelpPage[];
  /** Every registered glossary term that has loaded, in registration order. */
  glossary(): RegisteredTerm[];
  /** Whether every help given as a loader has loaded. */
  helpLoaded(): boolean;
  /** Calls `listener` each time a `loadHelp` finishes; returns what stops it. */
  onHelpLoaded(listener: () => void): () => void;
  /**
   * Loads the help that was given as a loader (so the first load of the app need not carry every page): once, however many ask.
   * Anything that reads `helpPages` or `glossary` waits for it first. Rejects, registering nothing of it, if its ids are taken.
   */
  loadHelp(): Promise<void>;
}

const LAST = Number.MAX_SAFE_INTEGER;

/** Where a settings panel lives: `/settings/<id>` unless the panel names its own path. */
const settingsPath = ({ id, path }: { id: string; path?: string }) => path ?? `/settings/${id}`;

export function createModuleRegistry<Screen>(): ModuleRegistry<Screen> {
  const modules: ModuleDefinition<Screen>[] = [];
  const helpSets: { owner: string; help?: ModuleHelp; load?: HelpLoader }[] = [];
  const helpListeners = new Set<() => void>();
  let loading: Promise<void> | undefined;
  /** The modules for which `keep` holds, in display order (`Array.prototype.sort` is stable). */
  const ordered = (keep: (module: ModuleDefinition<Screen>) => boolean) => modules.filter(keep).sort((a, b) => (a.order ?? LAST) - (b.order ?? LAST));
  const inPlacement = (placement: DeskPlacement) => ordered((m) => m.desk === placement);
  const inGroup = (id: GroupId) => ordered((m) => m.desk === 'control' && m.group === id);
  const routes = () => [
    ...modules.flatMap((m) => m.routes.map((route) => ({ moduleId: m.id, ...route }))),
    ...modules.flatMap((m) =>
      (m.settings ?? []).map((panel) => ({ moduleId: m.id, path: settingsPath(panel), screen: panel.screen, title: panel.title, parent: panel.parent ?? m.path })),
    ),
  ];
  const helpPages = () => helpSets.flatMap(({ owner, help }) => (help?.pages ?? []).map((page) => ({ moduleId: owner, ...page })));
  const glossary = () => helpSets.flatMap(({ owner, help }) => (help?.glossary ?? []).map((term) => ({ moduleId: owner, ...term })));
  /** Refuses help whose page or term ids are already taken, or repeat within itself. */
  const checkHelp = (owner: string, help: ModuleHelp) => {
    const pages = new Set(helpPages().map((page) => page.id));
    for (const { id } of help.pages) {
      if (pages.has(id)) throw new Error(`help page "${id}" is already registered (registering "${owner}")`);
      pages.add(id);
    }
    const terms = new Set(glossary().map((term) => term.id));
    for (const { id } of help.glossary ?? []) {
      if (terms.has(id)) throw new Error(`glossary term "${id}" is already registered (registering "${owner}")`);
      terms.add(id);
    }
  };
  /** Help given whole is checked now; help given as a loader is checked when it loads. */
  const addHelpSet = (owner: string, help: ModuleHelp | HelpLoader) => {
    if (typeof help === 'function') {
      helpSets.push({ owner, load: help });
      return;
    }
    checkHelp(owner, help);
    helpSets.push({ owner, help });
  };
  return {
    register(module) {
      if (modules.some((m) => m.id === module.id)) throw new Error(`module "${module.id}" is already registered`);
      if (module.desk === 'control' && module.group === undefined) throw new Error(`module "${module.id}" is in Control, so it needs a group`);
      if (module.desk !== 'control' && module.group !== undefined) throw new Error(`module "${module.id}" is not in Control, so it has no group`);
      const claimed = (m: ModuleDefinition<Screen>) => [...m.routes.map((route) => route.path), ...(m.settings ?? []).map(settingsPath)];
      for (const path of claimed(module)) {
        const owner = modules.find((m) => claimed(m).includes(path));
        if (owner) throw new Error(`route ${path} is already owned by module "${owner.id}" (registering "${module.id}")`);
      }
      // Help given whole is checked first, so a refusal leaves nothing behind.
      if (module.help) addHelpSet(module.id, module.help);
      modules.push(module);
    },
    module: (id) => modules.find((m) => m.id === id),
    modules: () => [...modules],
    inPlacement,
    controlGroups: () => CONTROL_GROUPS.map((group) => ({ group, modules: inGroup(group.id) })).filter(({ modules: members }) => members.length > 0),
    routes,
    redirects() {
      const owned = new Set(routes().map((route) => route.path));
      const [home] = inPlacement('today');
      const leading = [
        ...DESK_PLACEMENTS.filter((placement) => placement !== 'control').map((placement) => ({ name: placement, first: inPlacement(placement)[0] })),
        ...CONTROL_GROUPS.map((group) => ({ name: group.id, first: inGroup(group.id)[0] })),
      ];
      return [
        ...(home ? [{ from: '/', to: home.path }] : []),
        ...leading.filter(({ name, first }) => first && !owned.has(`/${name}`)).map(({ name, first }) => ({ from: `/${name}`, to: first!.path })),
        ...modules.flatMap((m) => m.redirects ?? []),
      ];
    },
    paletteCommands: () => modules.flatMap((m) => (m.paletteCommands?.() ?? []).map((command) => ({ moduleId: m.id, ...command }))),
    paletteSearches: () => modules.flatMap((m) => (m.paletteSearch ? [{ moduleId: m.id, search: m.paletteSearch }] : [])),
    settingsPanels: () =>
      modules.flatMap((m) =>
        (m.settings ?? []).map((panel) => ({ moduleId: m.id, id: panel.id, title: panel.title, summary: panel.summary, icon: panel.icon, path: settingsPath(panel), fields: panel.fields })),
      ),
    tierOf: (action) => modules.map((m) => m.policy?.tierOf(action)).find((tier) => tier !== undefined),
    shellModuleOf: (moduleId, pathname) => (moduleId !== undefined && pathname.startsWith('/settings/') && modules.some((m) => (m.settings ?? []).some((panel) => settingsPath(panel) === pathname)) ? 'settings' : moduleId),
    destinationOf(moduleId, pathname) {
      if (pathname !== undefined && modules.some((m) => (m.settings ?? []).some((panel) => settingsPath(panel) === pathname))) return 'control';
      return modules.find((m) => m.id === moduleId)?.desk ?? 'control';
    },
    addHelp(owner, help) {
      addHelpSet(owner, help);
    },
    helpPages,
    glossary,
    helpLoaded: () => !helpSets.some((set) => set.load),
    onHelpLoaded(listener) {
      helpListeners.add(listener);
      return () => void helpListeners.delete(listener);
    },
    loadHelp() {
      // One load for everyone who asks while it runs, and after it. The sets are fetched together (one round trip, not one per
      // module) and registered in order.
      loading ??= (async () => {
        const pending = helpSets.filter((set) => set.load);
        const loaded = await Promise.all(pending.map((set) => set.load!()));
        pending.forEach((set, index) => {
          checkHelp(set.owner, loaded[index]);
          set.help = loaded[index];
          set.load = undefined;
        });
        for (const listener of helpListeners) listener();
      })();
      return loading;
    },
  };
}
