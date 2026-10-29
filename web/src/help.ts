import type { ModuleRegistry } from './module-registry.ts';

// In-app help (M1 #02), free of the DOM and of React: what a module registers (a page for each screen, the glossary terms it
// uses), how a path finds its page, and the contract every module must keep. Help is plain English, bundled with the app
// (so it works offline from the installed PWA) and written beside the module that owns the screen.

/** A defined word. The UI marks it (`<Term id>`); tapping or focusing it opens this definition with a "More" link to `page`. */
export interface GlossaryTerm {
  /** Unique across the app: `risk-tiers`. Help text and `<Term id>` name a term by it. */
  id: string;
  /** The word as it is written: "Risk tiers". */
  term: string;
  /** One or two plain sentences, no markup. */
  definition: string;
  /** The help page its "More" link opens. */
  page: string;
}

/**
 * One block of a help page. Text may mark a glossary term inline: `[[risk-tiers]]` shows the term as it is written, and
 * `[[risk-tiers|tier]]` shows `tier`. A heading (`h`) is plain: a term is marked in a sentence, and `helpProblems` fails one in a heading.
 */
export type HelpBlock = { h: string } | { p: string } | { ul: string[] } | { ol: string[] };

export interface HelpPage {
  /** Unique across the app: `settings-security`. */
  id: string;
  title: string;
  /** One line: what the page covers. The palette shows it under the title. */
  summary: string;
  /** The screen this is the help for, as the registry writes the route (`/settings/appearance`, `/chat/:id`). A page without one is a topic. */
  route?: string;
  /** Words the palette matches besides the title, the summary and the text. */
  keywords?: string;
  body: HelpBlock[];
  /** Ids of pages worth reading next. */
  related?: string[];
}

/** What a module registers: help for each of its screens, and the glossary terms it uses. */
export interface ModuleHelp {
  pages: HelpPage[];
  glossary?: GlossaryTerm[];
}

/** How one place of a route fits a path, best first: written out, a parameter, the route ending where the path does, a splat. */
const WRITTEN = 4;
const PARAMETER = 3;
const ENDS = 2;
const SPLAT = 1;

/**
 * How a route pattern fits a path, a rank for each place along it (`new` beats `:taskId`, which beats the end of the pattern,
 * which beats the `*rest` of a splat that matches nothing more), or `undefined` when it does not fit. Patterns are the
 * registry's: `:name` is one segment and `*name` is the rest, which may be nothing.
 */
function routeFit(pattern: string, path: string): number[] | undefined {
  const want = pattern.split('/').filter(Boolean);
  const have = path.split('/').filter(Boolean);
  const fit: number[] = [];
  for (const [index, part] of want.entries()) {
    if (part.startsWith('*')) return [...fit, SPLAT];
    if (part.startsWith(':')) fit.push(PARAMETER);
    else if (part === have[index]) fit.push(WRITTEN);
    else return undefined;
  }
  return have.length === want.length ? [...fit, ENDS] : undefined;
}

/**
 * The page that is the help for the screen at `path` (a pathname, no query), if there is one. Of the routes that fit, the one
 * that fits best at the first place two of them differ wins; routes that fit in the same way keep the page registered first.
 */
export function helpPageFor<Page extends HelpPage>(pages: readonly Page[], path: string): Page | undefined {
  let best: { page: Page; fit: number[] } | undefined;
  for (const page of pages) {
    const fit = page.route === undefined ? undefined : routeFit(page.route, path);
    if (!fit) continue;
    const rival = best?.fit;
    const differs = rival ? fit.findIndex((rank, index) => rank !== rival[index]) : 0;
    if (!rival || (differs !== -1 && fit[differs] > rival[differs])) best = { page, fit };
  }
  return best?.page;
}

/** A run of help text: plain, or a glossary term (shown as `text` when it has other words, else as the term is written). */
export type InlineSegment = { text: string } | { term: string; text?: string };

const TERM_MARKER = /\[\[([\w-]+)(?:\|([^\]]+))?\]\]/g;

/** Cuts help text at its `[[term]]` and `[[term|words]]` markers. */
export function parseInline(text: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let from = 0;
  for (const match of text.matchAll(TERM_MARKER)) {
    if (match.index > from) segments.push({ text: text.slice(from, match.index) });
    segments.push(match[2] === undefined ? { term: match[1] } : { term: match[1], text: match[2] });
    from = match.index + match[0].length;
  }
  if (from < text.length) segments.push({ text: text.slice(from) });
  return segments;
}

/** The strings of a block, which is where a glossary marker can be. */
export function blockTexts(block: HelpBlock): string[] {
  return 'h' in block ? [block.h] : 'p' in block ? [block.p] : 'ul' in block ? block.ul : block.ol;
}

/** A heading and what is under it, on a long help page. */
export interface HelpSection {
  heading: string;
  /** The blocks under the heading, up to the next one. */
  blocks: HelpBlock[];
}

/** A page with this many headings or more is long enough to fold: its sections open and close. */
export const FOLD_AT_HEADINGS = 3;

/**
 * A long page cut at its headings, so the screen can fold it: the text before the first heading (shown always) and a section for each heading. A page with
 * fewer than `FOLD_AT_HEADINGS` headings is short enough to read whole and is not cut (`sections` is empty).
 */
export function helpSections(body: readonly HelpBlock[]): { intro: HelpBlock[]; sections: HelpSection[] } {
  if (body.filter((block) => 'h' in block).length < FOLD_AT_HEADINGS) return { intro: [...body], sections: [] };
  const intro: HelpBlock[] = [];
  const sections: HelpSection[] = [];
  for (const block of body) {
    if ('h' in block) sections.push({ heading: block.h, blocks: [] });
    else (sections.at(-1)?.blocks ?? intro).push(block);
  }
  return { intro, sections };
}

/** The first block of a page that marks the glossary term `termId`, or -1: where "More" from the term's pop-up takes the reader. */
export function termBlockIndex(body: readonly HelpBlock[], termId: string): number {
  return body.findIndex((block) => blockTexts(block).some((text) => parseInline(text).some((segment) => 'term' in segment && segment.term === termId)));
}

/**
 * What is wrong with the help the registered modules declare: the contract a test holds every module to, so a screen cannot
 * ship without help and help cannot use a word nobody defined. Each message names the page or module at fault; an empty list
 * means the help is whole.
 */
export function helpProblems(registry: ModuleRegistry<unknown>): string[] {
  const pages = registry.helpPages();
  const routes = registry.routes();
  const terms = new Set(registry.glossary().map((term) => term.id));
  // A module's problems together, in registration order (its settings panels' routes come last in the registry's list).
  const uncovered = [...new Set(routes.map((route) => route.moduleId))].flatMap((moduleId) =>
    routes
      .filter((route) => route.moduleId === moduleId && !pages.some((page) => page.moduleId === moduleId && page.route === route.path))
      .map((route) => `module "${moduleId}" has no help page for ${route.path}`),
  );
  const unregistered = pages.flatMap((page) => {
    const used = new Set(page.body.flatMap(blockTexts).flatMap(parseInline).flatMap((segment) => ('term' in segment ? [segment.term] : [])));
    return [...used].filter((id) => !terms.has(id)).map((id) => `help page "${page.id}" uses glossary term "${id}", which no module registers`);
  });
  const ids = new Set(pages.map((page) => page.id));
  const marked = (text: string) => parseInline(text).some((segment) => 'term' in segment);
  const links = pages.flatMap((page) => [
    ...(page.related ?? []).filter((id) => !ids.has(id)).map((id) => `help page "${page.id}" lists "${id}" as related, but there is no such page`),
    ...([page.title, page.summary].some(marked) ? [`help page "${page.id}" has a glossary marker in its title or summary, which show as plain text`] : []),
    ...(page.body.some((block) => 'h' in block && marked(block.h)) ? [`help page "${page.id}" has a glossary marker in a heading, which shows as plain text`] : []),
  ]);
  const termPages = registry
    .glossary()
    .filter((term) => !ids.has(term.page))
    .map((term) => `glossary term "${term.id}" opens "${term.page}", but there is no such page`);
  return [...uncovered, ...unregistered, ...links, ...termPages];
}

/** What opens help: the screen being shown, one page, one glossary term, or the shortcuts. */
export type HelpTarget = { screen: string } | { page: string } | { term: string } | { shortcuts: true };

/** What the help panel shows: a tab, and on the help tab a page (none: the list of topics) with a glossary term to show above it. */
export interface HelpView {
  tab: 'help' | 'shortcuts';
  page?: string;
  term?: string;
}

/** Where the panel opens for a target. What has no page, or names a page or term nobody registered, opens the list of topics. */
export function resolveHelpTarget(registry: ModuleRegistry<unknown>, target: HelpTarget): HelpView {
  if ('shortcuts' in target) return { tab: 'shortcuts' };
  const pages = registry.helpPages();
  if ('screen' in target) return { tab: 'help', page: helpPageFor(pages, target.screen)?.id };
  if ('page' in target) return { tab: 'help', page: pages.find((page) => page.id === target.page)?.id };
  const term = registry.glossary().find((candidate) => candidate.id === target.term);
  return term ? { tab: 'help', page: term.page, term: term.id } : { tab: 'help' };
}

/** Help text as plain words, for searching: a marked term shows as the words it is marked with, or as the term is written. */
export function plainText(text: string, termLabel: (id: string) => string | undefined): string {
  return parseInline(text)
    .map((segment) => ('term' in segment ? (segment.text ?? termLabel(segment.term) ?? segment.term) : segment.text))
    .join('');
}
