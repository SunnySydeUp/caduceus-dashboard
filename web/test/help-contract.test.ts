import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { helpPageFor, helpProblems } from '../src/help.ts';
import { createAppRegistry } from '../src/modules/index.ts';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

/** Every `.tsx` file below `dir`. */
function screensBelow(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? screensBelow(file) : entry.name.endsWith('.tsx') ? [file] : [];
  });
}

describe('the help the app ships with', () => {
  // The app loads its help after the first paint; the registry gives it up to whoever awaits it.
  const loadedRegistry = async () => {
    const registry = createAppRegistry();
    await registry.loadHelp();
    return registry;
  };

  test('every module has a help page for each of its routes, and every term, link and page it names exists', async () => {
    expect(helpProblems(await loadedRegistry())).toEqual([]);
  });

  test('every M0 screen and concept has its page: sign-in, Control, Home, Health and Repairs, Settings with its four panels, tiers, read-only mode, profile scope and step-up', async () => {
    const registry = await loadedRegistry();
    const pages = registry.helpPages();
    const titleAt = (route: string) => helpPageFor(pages, route)?.title;

    expect(titleAt('/sign-in')).toBeDefined();
    expect(titleAt('/control')).toBeDefined();
    for (const { path: route } of registry.routes()) expect(titleAt(route), route).toBeDefined();

    // The concepts the glossary links to are pages of their own.
    expect(registry.glossary().map((term) => term.id)).toEqual(expect.arrayContaining(['hermes', 'profile-scope', 'risk-tiers', 'step-up', 'read-only-mode', 'repairs']));
    expect(pages.map((page) => page.id)).toEqual(expect.arrayContaining(['risk-tiers', 'read-only-mode', 'profile-scope', 'step-up']));
  });

  test('every `<Term>` in the screens is written `<Term id="…">` with a registered glossary term', async () => {
    const terms = new Set((await loadedRegistry()).glossary().map((term) => term.id));
    // The help panel makes a `Term` of every `[[marker]]` in help text, by a variable: `helpProblems` checks those markers (above).
    const screens = screensBelow(SRC).filter((file) => path.basename(file) !== 'HelpPanel.tsx');
    const used = screens.flatMap((file) => {
      const source = fs.readFileSync(file, 'utf8');
      // Every opening, whatever follows it: one that is not `<Term id="…">` (a variable, single quotes, another attribute first, no id) cannot be checked.
      return [...source.matchAll(/<Term\b/g)].map((open) => ({ file: path.relative(SRC, file), id: /^<Term\s+id="([^"]*)"/.exec(source.slice(open.index))?.[1] }));
    });

    expect(used.filter(({ id }) => id === undefined)).toEqual([]);
    expect(used.filter(({ id }) => id !== undefined && !terms.has(id))).toEqual([]);
    expect(used.length).toBeGreaterThan(0);
  });
});
