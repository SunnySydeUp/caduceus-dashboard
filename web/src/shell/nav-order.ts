// The Desk's navigation, as plain data: what the sidebar, the rail, the phone's tab bar, Control and the palette list. Pure: no React and no DOM,
// so it runs under test. It reads only the module registry (each module's `desk` placement) and the crew's state; the shell draws what it returns.
import type { IconName } from '../icons.tsx';
import { crewStateLabel, type CrewMember, type CrewStateName } from '../modules/crew/crew-state.ts';
import type { DeskPlacement, ModuleDefinition, ModuleRegistry, NavBadge, NavGroup } from '../module-registry.ts';
import { withProfile } from '../profile-scope.ts';
import { plainDuration } from '../plain-duration.ts';

/** The placements that are destinations of their own; Control is reached through the sidebar's Control entry and a phone's More tab. */
export type DeskDestinationId = Exclude<DeskPlacement, 'control'>;

/** The destinations in the order the Desk shows them, with the words and the icon they carry. */
const DESTINATIONS: { id: DeskDestinationId; title: string; icon: IconName }[] = [
  { id: 'today', title: 'Today', icon: 'home' },
  { id: 'talk', title: 'Talk', icon: 'chat' },
  { id: 'work', title: 'Work', icon: 'work' },
];

/** One of Today, Talk and Work: where it leads, the count it carries, and every module placed there (Work's chips reach the ones it does not lead to). */
export interface DeskDestination<Screen> {
  id: DeskDestinationId;
  title: string;
  icon: IconName;
  /** The first module placed here: where the tab and the sidebar entry lead. */
  path: string;
  /** The badge of the first module placed here that has one. */
  badge?: NavBadge;
  modules: ModuleDefinition<Screen>[];
}

/** One agent of the crew as the sidebar lists it: its sigil's name, how it stands, what it is doing, since when, and where its thread opens. */
export interface CrewRow {
  profile: string;
  state: CrewStateName;
  /** What a screen says next to the sigil, so the state is never shown by colour alone. */
  stateLabel: string;
  line: string;
  /** Since when the state holds (ms since the epoch); `undefined` for an idle agent. */
  since: number | undefined;
  /** Talk, scoped to this agent's profile. */
  path: string;
  /** A new chat with this agent: Talk's new-chat screen, scoped to its profile. Absent when no module is placed in Talk. */
  newChat?: string;
}

export interface ControlSection<Screen> {
  group: NavGroup;
  modules: ModuleDefinition<Screen>[];
}

export interface DeskNavigation<Screen> {
  destinations: DeskDestination<Screen>[];
  crew: CrewRow[];
  control: ControlSection<Screen>[];
}

export type DeskSource<Screen> = Pick<ModuleRegistry<Screen>, 'inPlacement' | 'controlGroups'>;

/** Who needs the owner first. A decision comes before a failure, and both before work in progress, finished work and nothing. */
const CREW_PRIORITY: Record<CrewStateName, number> = { waiting: 0, blocked: 1, working: 2, done: 3, idle: 4 };

/**
 * The agent who has waited longest comes first among those waiting (that request is the oldest); among the others the newest news comes first.
 * Agents with the same state and time keep the order they were given (idle ones all have no time).
 */
function byNeed(a: CrewMember, b: CrewMember): number {
  if (a.state !== b.state) return CREW_PRIORITY[a.state] - CREW_PRIORITY[b.state];
  const [sinceA, sinceB] = [a.since ?? 0, b.since ?? 0];
  return a.state === 'waiting' ? sinceA - sinceB : sinceB - sinceA;
}

/** The Desk: Today, Talk and Work (each only when a module is placed there), the crew by who needs the owner first, and Control's groups. */
export function deskNavigation<Screen>(registry: DeskSource<Screen>, crew: readonly CrewMember[]): DeskNavigation<Screen> {
  const destinations = DESTINATIONS.flatMap(({ id, title, icon }): DeskDestination<Screen>[] => {
    const modules = registry.inPlacement(id);
    const [first] = modules;
    if (!first) return [];
    const badge = modules.find((module) => module.badge)?.badge;
    return [{ id, title, icon, path: first.path, ...(badge ? { badge } : {}), modules }];
  });
  const talk = destinations.find(({ id }) => id === 'talk');
  const rows = [...crew].sort(byNeed).map(
    ({ profile, state, line, since }): CrewRow => ({
      profile,
      state,
      stateLabel: crewStateLabel[state],
      line,
      since,
      path: withProfile(talk?.path ?? '/', profile),
      ...(talk ? { newChat: withProfile(`${talk.path}/new`, profile) } : {}),
    }),
  );
  return { destinations, crew: rows, control: registry.controlGroups() };
}

/** What the owner calls a module: the destination it opens on (Today, Talk, Work), else its own title. The Chat module is Talk, the Overview is Work. */
export function ownerName<Screen>({ destinations }: Pick<DeskNavigation<Screen>, 'destinations'>, module: { id: string; title: string }): string {
  return destinations.find((destination) => destination.modules[0]?.id === module.id)?.title ?? module.title;
}

/** Every module the navigation reaches, in the order it lists them: the destinations' modules, then Control's. */
export function deskModules<Screen>({ destinations, control }: Pick<DeskNavigation<Screen>, 'destinations' | 'control'>): ModuleDefinition<Screen>[] {
  return [...destinations.flatMap(({ modules }) => modules), ...control.flatMap(({ modules }) => modules)];
}

/**
 * The counts of the modules in Control as one badge, for the phone's More tab and the Control entry: the owner sees there is something to look at (a failed
 * run in Notices) without opening Control. `undefined` when no module in Control keeps a count. A count of one module is that module's own.
 */
export function controlBadge<Screen>({ control }: Pick<DeskNavigation<Screen>, 'control'>): NavBadge | undefined {
  const badges = control.flatMap(({ modules }) => modules.flatMap((module) => module.badge ?? []));
  if (badges.length === 0) return undefined;
  return {
    subscribe: (listener) => {
      const stops = badges.map((badge) => badge.subscribe(listener));
      return () => stops.forEach((stop) => stop());
    },
    count: () => badges.reduce((total, badge) => total + badge.count(), 0),
    label: (count) => `${count} ${count === 1 ? 'thing needs' : 'things need'} a look in Control`,
  };
}

/** How long ago a crew row's state began: "now" inside the first minute, then "5 min", "3 h". Empty when there is nothing going on. */
export function crewAge(since: number | undefined, now: number): string {
  if (since === undefined) return '';
  const seconds = Math.max(0, (now - since) / 1000);
  return seconds < 60 ? 'now' : plainDuration(seconds);
}
