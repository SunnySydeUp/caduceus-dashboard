// The command palette's data and logic (information architecture §8), free of React: what the palette lists, how a
// query ranks it, and how the list is driven from the keyboard. The shell reads only the module registry, so a module
// that registers shows up here with no change.

import { fuzzyRank } from '@caduceus/contracts/hermes/shared/fuzzy';
import { blockTexts, plainText, type HelpTarget } from './help.ts';
import type { IconName } from './icons.tsx';
import type { ModuleRegistry, PaletteCommand, PaletteHit, RiskTier } from './module-registry.ts';
import type { Recoverability } from './tier-flow.ts';
import { commandAction, goAction, HELP_OPEN, SHORTCUTS_OPEN, type Keymap } from './shortcuts.ts';
import { deskModules, deskNavigation } from './shell/nav-order.ts';

export type PaletteGroup = 'This screen' | 'Actions' | 'Sessions' | 'Playbooks' | 'Settings' | 'Navigate' | 'Help';

/** The order the palette lists its groups in, with or without a query. */
const GROUP_ORDER: PaletteGroup[] = ['This screen', 'Actions', 'Sessions', 'Playbooks', 'Settings', 'Navigate', 'Help'];

export interface PaletteEntry {
  group: PaletteGroup;
  label: string;
  /** A second line: what the entry opens or does. */
  sub?: string;
  icon: IconName;
  tier?: RiskTier;
  /** The shortcut action the entry answers to (`go:<module>`, `cmd:<module>:<command>`), for a key press to find it. */
  action?: string;
  /** The binding it answers to now, if it has one that is switched on. */
  shortcut?: string;
  /** Extra words a query can match when the label does not (the group, the address). */
  keywords: string;
  /** A help page's whole text, lower case: found only as the phrase a query types (`rankEntries`). */
  body?: string;
  /** For a search hit: the words around what matched, the matched ones marked. */
  snippet?: { text: string; match: boolean }[];
  target: { kind: 'route'; path: string } | { kind: 'command'; moduleId: string; command: PaletteCommand } | { kind: 'shell'; action: string } | { kind: 'help'; target: HelpTarget };
}

/** A route with a parameter (`:name`, `*rest`) has no address to jump to. */
const hasParameter = (path: string) => /[:*]/.test(path);

/**
 * Everything the palette can offer, in the order it lists them with no query: the current module's actions, the other
 * modules' actions (and the shell's own), every route that can be opened, in navigation order, then every help page and
 * glossary term (which `rankEntries` shows only for a query). Each entry carries the key it is bound to now.
 */
export function paletteEntries(registry: ModuleRegistry<unknown>, currentModuleId: string | undefined, keymap: Keymap): PaletteEntry[] {
  const navigation = deskNavigation(registry, []);
  const modules = deskModules(navigation);
  // Where a module sits, in the owner's words: its destination (Today, Talk, Work) or its Control group.
  const placeOf: Record<string, string> = Object.fromEntries([
    ...navigation.destinations.flatMap(({ title, modules: members }) => members.map((m) => [m.id, title])),
    ...navigation.control.flatMap(({ group, modules: members }) => members.map((m) => [m.id, group.title])),
  ]);
  const groupTitleOf = (moduleId: string) => placeOf[moduleId] ?? '';
  const panels = registry.settingsPanels();
  const routes = registry.routes();
  const commands = registry.paletteCommands();

  const navigate = modules.flatMap((module) => {
    const where = groupTitleOf(module.id);
    const landing: PaletteEntry = {
      group: 'Navigate',
      label: module.title,
      sub: module.summary,
      icon: module.icon,
      keywords: `${where} ${module.path} ${module.summary}`,
      action: goAction(module.id),
      shortcut: keymap.bindingOf(goAction(module.id)),
      target: { kind: 'route', path: module.path },
    };
    const others = routes
      .filter((route) => route.moduleId === module.id && route.path !== module.path && !hasParameter(route.path))
      .map((route) => ({ route, panel: panels.find((p) => p.moduleId === module.id && p.path === route.path) }))
      // A page the module also offers as a command ("New task") is listed once, as the command.
      .filter(({ route, panel }) => !commands.some((command) => command.moduleId === module.id && command.label === (panel?.title ?? route.title)))
      .map(({ route, panel }): PaletteEntry => {
        return {
          group: 'Navigate',
          label: panel?.title ?? route.title ?? module.title,
          sub: panel ? `${module.title} · ${panel.summary}` : module.title,
          icon: panel?.icon ?? module.icon,
          keywords: `${module.title} ${where} ${route.path}`,
          target: { kind: 'route', path: route.path },
        };
      });
    return [landing, ...others];
  });

  const actions = commands.map(({ moduleId, ...command }): PaletteEntry => {
    const module = registry.module(moduleId);
    return {
      group: moduleId === currentModuleId ? 'This screen' : 'Actions',
      label: command.label,
      sub: command.sub ?? (moduleId === currentModuleId ? undefined : module?.title),
      icon: command.icon ?? 'bolt',
      tier: registry.tierOf(command.id) ?? command.tier,
      keywords: `${module?.title ?? ''} ${command.sub ?? ''}`,
      target: { kind: 'command', moduleId, command },
      action: commandAction(moduleId, command.id),
      shortcut: keymap.bindingOf(commandAction(moduleId, command.id)),
    };
  });
  const helpAction: PaletteEntry = {
    group: 'Actions',
    label: 'Help',
    sub: 'About this screen',
    icon: 'question',
    keywords: 'explain guide glossary',
    action: HELP_OPEN,
    shortcut: keymap.bindingOf(HELP_OPEN),
    target: { kind: 'shell', action: HELP_OPEN },
  };
  const shortcuts: PaletteEntry = {
    group: 'Actions',
    label: 'Keyboard shortcuts',
    sub: 'Every shortcut, and the switch for single-key ones',
    icon: 'keyboard',
    keywords: 'keys hotkeys remap',
    target: { kind: 'shell', action: SHORTCUTS_OPEN },
  };

  // Help is searched by its words too: a page's keywords include its whole text, with a marked term as the words it stands for.
  const terms = registry.glossary();
  const termLabel = (id: string) => terms.find((term) => term.id === id)?.term;
  const help = [
    ...registry.helpPages().map(
      (page): PaletteEntry => ({
        group: 'Help',
        label: page.title,
        sub: page.summary,
        icon: 'book',
        keywords: `help ${page.keywords ?? ''}`,
        body: page.body.flatMap(blockTexts).map((text) => plainText(text, termLabel)).join(' ').toLowerCase(),
        target: { kind: 'help', target: { page: page.id } },
      }),
    ),
    ...terms.map(
      (term): PaletteEntry => ({
        group: 'Help',
        label: term.term,
        sub: `Glossary · ${term.definition}`,
        icon: 'info',
        keywords: '',
        target: { kind: 'help', target: { term: term.id } },
      }),
    ),
  ];

  return GROUP_ORDER.flatMap((group) => [...actions, helpAction, shortcuts, ...navigate, ...help].filter((entry) => entry.group === group));
}

export interface RankedEntry {
  entry: PaletteEntry;
  /** The indices of the label's characters the query matched, for highlighting. */
  positions: number[];
}

/**
 * The entries a query matches. The groups keep their order (this screen, actions, navigate, help); within a group the
 * label matches come first, best first, then the entries whose other words match. Labels match with Hermes's shared
 * fuzzy helper, so a query ranks here as it does in Hermes's own pickers; the other words (the group, the address, the
 * summary, a help page's keywords) must contain each word of the query as written, which keeps a loose subsequence from
 * matching everything. A help page's text is searched last, for the whole query as one phrase and from three letters on: its words are
 * everywhere, so each of them alone would match nearly every page. Help lists at most `HELP_LIMIT` entries.
 * With no query, every entry in its listed order, except help pages and glossary terms: those are for searching, and would bury the commands.
 */
/** The most help pages and glossary terms one query lists. */
const HELP_LIMIT = 6;

export function rankEntries(entries: PaletteEntry[], query: string): RankedEntry[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return GROUP_ORDER.flatMap((group) => {
    if (group === 'Help' && words.length === 0) return [];
    const members = entries.filter((entry) => entry.group === group);
    const byLabel = fuzzyRank(members, query, (entry) => entry.label);
    if (words.length === 0) return byLabel.map(({ item }) => ({ entry: item, positions: [] }));
    const matched = new Set(byLabel.map(({ item }) => item));
    const byWords = members.filter((entry) => !matched.has(entry) && words.every((word) => `${entry.sub ?? ''} ${entry.keywords}`.toLowerCase().includes(word)));
    const phrase = words.join(' ');
    const byText = group === 'Help' && phrase.length >= 3 ? members.filter((entry) => !matched.has(entry) && !byWords.includes(entry) && entry.body?.includes(phrase)) : [];
    const ranked = [...byLabel.map(({ item, positions }) => ({ entry: item, positions })), ...[...byWords, ...byText].map((entry) => ({ entry, positions: [] }))];
    return group === 'Help' ? ranked.slice(0, HELP_LIMIT) : ranked;
  });
}

/** A module's search hits as entries of the Sessions group: each opens its address. */
export function hitEntries(hits: readonly PaletteHit[], moduleId: string): PaletteEntry[] {
  return hits.map((hit) => ({
    group: hit.group ?? 'Sessions',
    label: hit.label,
    ...(hit.sub === undefined ? {} : { sub: hit.sub }),
    icon: hit.icon ?? 'chat',
    keywords: moduleId,
    ...(hit.snippet === undefined ? {} : { snippet: hit.snippet }),
    target: { kind: 'route', path: hit.path },
  }));
}

/** The ranked entries with the search hits in their own group, after the actions and before the pages. The hits are what a search found: the query does not rank them. */
export function withHits(ranked: RankedEntry[], hits: PaletteEntry[]): RankedEntry[] {
  if (hits.length === 0) return ranked;
  const at = ranked.findLastIndex(({ entry }) => entry.group === 'This screen' || entry.group === 'Actions') + 1;
  return [...ranked.slice(0, at), ...hits.map((entry) => ({ entry, positions: [] })), ...ranked.slice(at)];
}

/**
 * What the shared tiered confirmation dialog (M0 #08) is asked: the tier, and which action of which module, with what
 * the dialog names. A palette command gives the first four; an action that knows its object adds the rest.
 */
export interface ConfirmRequest {
  tier: Exclude<RiskTier, 'T0'>;
  moduleId: string;
  /** The command's id, which is the action id the module's policy classifies. */
  action: string;
  /** The dialog's title: what is about to happen. */
  label: string;
  /** A sentence about it, e.g. "Live runs pause for about 20 seconds." */
  text?: string;
  /** The name of what it changes: shown in the dialog, and what a T3 asks to be typed (the title when absent). */
  object?: string;
  /** The Hermes profile it works on, shown as a chip. */
  profile?: string;
  /** The confirm button's words; "Confirm" when absent. */
  confirmLabel?: string;
  /** A T3 says whether it can be undone; "cannot be undone" when absent. */
  recoverability?: Recoverability;
}

export interface RunDeps {
  navigate(path: string): Promise<void>;
  /** Carries out one of the shell's own actions (opening the help for this screen, or the shortcuts). */
  shell(action: string): void;
  /** Opens the help panel on a page or a glossary term. */
  help(target: HelpTarget): void;
  /**
   * Resolves once the palette and any confirmation have closed and the history is back where it was. A command that opens an address waits for it
   * (the layers pop their history entries as they close, and an entry pushed before that is popped with them); left out where no layer can be open.
   */
  settled?: () => Promise<void>;
  /** Asks the owner to confirm a tiered action; `undefined` while no confirmation dialog is mounted. */
  confirm: ((request: ConfirmRequest) => Promise<boolean>) | undefined;
}

/**
 * Runs an entry: a route is opened; a command runs straight away unless it needs a tier, in which case it goes through
 * the shared confirmation, the same as every other tiered action. With no dialog to ask, a tiered command does not run.
 */
export async function runEntry(entry: PaletteEntry, { navigate, shell, help, confirm, settled }: RunDeps): Promise<'ran' | 'declined' | 'unconfirmable'> {
  const { target, tier } = entry;
  if (target.kind === 'route') {
    await navigate(target.path);
    return 'ran';
  }
  if (target.kind === 'shell') {
    shell(target.action);
    return 'ran';
  }
  if (target.kind === 'help') {
    help(target.target);
    return 'ran';
  }
  if (tier && tier !== 'T0') {
    if (!confirm) return 'unconfirmable';
    const confirmed = await confirm({ tier, moduleId: target.moduleId, action: target.command.id, label: entry.label });
    if (!confirmed) return 'declined';
  }
  await settled?.();
  target.command.run();
  return 'ran';
}

/** A label cut into runs, each either all matched by the query or not matched at all. */
export function highlightSegments(text: string, positions: number[]): { text: string; match: boolean }[] {
  const matched = new Set(positions);
  const segments: { text: string; match: boolean }[] = [];
  for (let index = 0; index < text.length; index++) {
    const match = matched.has(index);
    const last = segments.at(-1);
    if (last?.match === match) last.text += text[index];
    else segments.push({ text: text[index], match });
  }
  return segments;
}

export interface PaletteState {
  query: string;
  /** The index, in the listed results, of the one ↵ would run. */
  active: number;
}

export type PaletteInput = { type: 'query'; query: string } | { type: 'key'; key: string };

/**
 * The palette's keyboard, with focus staying in the search field: ↓ and ↑ move the active result (wrapping) and ↵ asks
 * to run it. Typing a new query starts again from the best match. Esc is the layer stack's (it closes the top layer)
 * and every other key is the text field's. `count` is how many results are listed.
 */
export function paletteStep(state: PaletteState, input: PaletteInput, count: number): { state: PaletteState; outcome?: 'run' } {
  if (input.type === 'query') return { state: { query: input.query, active: 0 } };
  switch (input.key) {
    case 'ArrowDown':
      return { state: { ...state, active: count === 0 ? 0 : (state.active + 1) % count } };
    case 'ArrowUp':
      return { state: { ...state, active: count === 0 ? 0 : (state.active + count - 1) % count } };
    case 'Enter':
      return count === 0 ? { state } : { state, outcome: 'run' };
    default:
      return { state };
  }
}

/** What a screen reader hears when the list changes. */
export function resultsAnnouncement(count: number): string {
  return count === 0 ? 'No results' : `${count} ${count === 1 ? 'result' : 'results'}`;
}
