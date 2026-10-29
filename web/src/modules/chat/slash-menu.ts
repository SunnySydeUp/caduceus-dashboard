// The slash menu of the composer (M1 #09), free of the DOM and of React: which commands Hermes's catalogue offers, how they filter as the owner types,
// which ones the policy proxy would refuse (they are listed, switched off, with its reason: never left out and never sent), and how a choice goes
// into the text. The commands, their descriptions and their argument lists are Hermes's (`commands.catalog`, `complete.slash`); nothing here invents one.
import type { CommandsCatalogResult } from '@caduceus/contracts/hermes/gateway';
import { slashPolicy } from '@caduceus/contracts/policy/gateway';
import { isRecord } from '@caduceus/contracts/policy/guards';
import { DENIED_MESSAGES } from '@caduceus/contracts/policy/tiers';

export interface SlashEntry {
  /** What is typed: `/personality`. */
  command: string;
  /** The same without the slash, lower case. */
  name: string;
  description: string;
  /** The heading Hermes lists it under (`Session`, `Configuration`, `User commands`…), or `Skills`. */
  group: string;
  kind: 'command' | 'skill';
  /** The other names Hermes answers to (`reset` for `/new`), without the slash. */
  aliases: string[];
  /** Hermes takes something after the command (a name, a level, free text). */
  takesArgument: boolean;
  /** How much the skill has been used, for the order of the skills. */
  usage: number;
  /** Why it cannot be run from here; the entry is shown switched off with these words. */
  disabled?: string;
  /** What the owner should know before choosing it. */
  note?: string;
}

/** The names (lower case) of the exec-type quick commands in a profile's config (`GET /api/config`): Hermes runs those as shell commands, which the proxy never lets through. */
export function execQuickCommandNames(config: unknown): Set<string> {
  const names = new Set<string>();
  const quick = isRecord(config) && isRecord(config.quick_commands) ? config.quick_commands : {};
  for (const [name, command] of Object.entries(quick)) if (isRecord(command) && command.type === 'exec') names.add(name.toLowerCase());
  return names;
}

const SKILLS = 'Skills';

/**
 * The commands people reach for most, in this order, listed first under their own heading. Hermes's own order starts with `/new`, `/clear` and `/redraw`, which are rarely
 * what someone typing a slash wants. Only commands the catalogue has are shown, under the group they were found in otherwise.
 */
const COMMON_GROUP = 'Common';
const COMMON = ['status', 'compress', 'undo', 'retry', 'stop', 'title', 'help', 'usage'];

/** `(usage: /title [name])` or a `[level]` after the command in the description: Hermes's own way of saying it takes an argument. */
const USAGE_ARGUMENT = /\(usage: \/\S+\s+[[<]/;

/** The entries of a catalogue: the common commands, then Hermes's groups in the order it lists them, then the skills, the most used first. */
export function slashEntries(catalog: CommandsCatalogResult, exec: ReadonlySet<string>): SlashEntry[] {
  const groups = new Map<string, string>();
  for (const category of catalog.categories ?? []) for (const [command] of category.pairs ?? []) if (command !== undefined) groups.set(command, category.name);
  const aliases = new Map<string, string[]>();
  for (const [alias, canonical] of Object.entries(catalog.canon ?? {})) {
    if (alias.toLowerCase() === canonical.toLowerCase()) continue;
    aliases.set(canonical, [...(aliases.get(canonical) ?? []), alias.replace(/^\//, '').toLowerCase()]);
  }
  const entries: SlashEntry[] = [];
  const seen = new Set<string>();
  for (const [command, description = ''] of catalog.pairs ?? []) {
    if (command === undefined || seen.has(command)) continue;
    seen.add(command);
    const meta = catalog.commands?.[command];
    // What Hermes's own desktop reaches from its chrome (the model picker); the owner can still type it.
    if (meta?.desktop === 'hidden') continue;
    const skill = catalog.skills?.[command];
    const name = command.replace(/^\//, '').toLowerCase();
    const tier = slashPolicy({ name, arg: '' });
    const disabled = tier === 'denied' ? DENIED_MESSAGES['slash-admin'] : exec.has(name) ? DENIED_MESSAGES['exec-quick-command'] : undefined;
    entries.push({
      command,
      name,
      description,
      group: skill ? SKILLS : COMMON.includes(name) && disabled === undefined ? COMMON_GROUP : (groups.get(command) ?? 'Commands'),
      kind: skill ? 'skill' : 'command',
      aliases: aliases.get(command) ?? [],
      takesArgument: (meta?.argument_mode ?? null) !== null || USAGE_ARGUMENT.test(description) || skill !== undefined,
      usage: skill?.usage ?? 0,
      ...(disabled === undefined ? {} : { disabled }),
      ...(disabled === undefined && tier === 'T2' ? { note: 'Asks for your passkey' } : {}),
    });
  }
  const order = [...new Set(groups.values())];
  const rank = (entry: SlashEntry) => (entry.group === COMMON_GROUP ? -1 : entry.kind === 'skill' ? order.length + 1 : order.indexOf(entry.group) < 0 ? order.length : order.indexOf(entry.group));
  const position = new Map(entries.map((entry, index) => [entry, index]));
  const within = (a: SlashEntry, b: SlashEntry) => (a.kind === 'skill' ? b.usage - a.usage || a.name.localeCompare(b.name) : a.group === COMMON_GROUP ? COMMON.indexOf(a.name) - COMMON.indexOf(b.name) : position.get(a)! - position.get(b)!);
  return entries.sort((a, b) => rank(a) - rank(b) || within(a, b));
}

/** How well an entry answers a query (lower is better), or undefined when it does not: its name, an alias, a name that contains it, then its description. */
function matchRank(entry: SlashEntry, query: string): number | undefined {
  if (entry.name === query || entry.aliases.includes(query)) return 0;
  if (entry.name.startsWith(query)) return 1;
  if (entry.aliases.some((alias) => alias.startsWith(query))) return 2;
  if (entry.name.includes(query)) return 3;
  return entry.description.toLowerCase().includes(query) ? 4 : undefined;
}

/** The entries that answer what has been typed after the slash. An empty query is the whole list as it stands. */
export function filterEntries(entries: readonly SlashEntry[], typed: string): SlashEntry[] {
  const query = typed.replace(/^\//, '').trim().toLowerCase();
  if (query === '') return [...entries];
  const ranked: { entry: SlashEntry; rank: number; index: number }[] = [];
  entries.forEach((entry, index) => {
    const rank = matchRank(entry, query);
    if (rank !== undefined) ranked.push({ entry, rank, index });
  });
  return ranked.sort((a, b) => a.rank - b.rank || a.index - b.index).map(({ entry }) => entry);
}

export type SlashStage = { stage: 'command'; query: string } | { stage: 'argument'; command: string; text: string };

/**
 * Where the caret is in a command. The slash has to be the very first character (a path, or a slash in the middle of a sentence, is prose), and a second slash
 * in the first word makes it a path (`/usr/local`). Within the first word it is the command stage; after a space, the argument stage, with the text Hermes completes.
 */
export function slashStage(text: string, caret: number): SlashStage | undefined {
  const first = /^\/([^\s/]*)(\s|$)/.exec(text);
  if (!first) return undefined;
  const wordEnd = 1 + first[1]!.length;
  if (caret <= wordEnd) return { stage: 'command', query: text.slice(1, caret) };
  // The argument stage is one line: a newline after the command is the owner writing the rest.
  const before = text.slice(0, caret);
  if (before.includes('\n')) return undefined;
  return { stage: 'argument', command: first[1]!.toLowerCase(), text: before };
}

export interface Edit {
  text: string;
  caret: number;
}

/** The text after choosing a command: the command with a space after it, in place of the word typed; the rest of the text stays. */
export function applyCommand(text: string, entry: SlashEntry): Edit {
  const wordEnd = /^\/[^\s]*/.exec(text)![0].length;
  const rest = text.slice(wordEnd).replace(/^ /, '');
  const head = `${entry.command} `;
  return { text: head + rest, caret: head.length };
}

/** The text after choosing an argument Hermes offered: it replaces the word at the caret. */
export function applyArgument(text: string, caret: number, argument: string): Edit {
  const start = text.lastIndexOf(' ', caret - 1) + 1;
  const after = text.slice(caret);
  return { text: text.slice(0, start) + argument + after, caret: start + argument.length };
}
