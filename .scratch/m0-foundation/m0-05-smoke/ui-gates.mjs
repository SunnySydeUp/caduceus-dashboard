// The M0 #05 quality gates, as a repeatable throwaway browser check (AGENTS.md: no Playwright tests; UI is verified by a
// smoke check). Not part of `npm test`. Every later ticket re-runs it for its new screens.
//
// Usage, from the eval tool's `browser` (Chromium via Puppeteer), with Caduceus running in front of a real Hermes in a
// temp HERMES_HOME and the tab signed in:
//
//   const { checkRoute, WIDTHS } = await import('/…/.scratch/m0-foundation/m0-05-smoke/ui-gates.mjs');
//   const result = await tab.run(({ page }, args) => import(args.gates).then((g) => g.checkRoute(page, args)),
//     { args: { gates, url, route: '/home', width: 390, shots: dir } });
//
// Per route and width it checks: no horizontal overflow and nothing laid out outside the viewport; no console errors;
// axe (WCAG 2.2 AA + best practice) has no serious or critical violations; interactive targets are at least 44 px on
// coarse pointers and 24 px on fine ones; and saves a screenshot.
//
// M0 #07: `skin`, `density` and `textSize` (and `scheme`, now an explicit theme) set this device's appearance before the page
// loads, the way a stored choice would, while the operating system is emulated at the opposite scheme: so the explicit theme
// is what shows, and the run fails if the page does not carry the appearance it was given. Run every skin, light and dark.
import fs from 'node:fs';
import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);
export const AXE_SOURCE = fs.readFileSync(nodeRequire.resolve('axe-core/axe.min.js'), 'utf8');

/** The four projects of the ticket: phone (touch), small phone (touch), tablet (touch), desktop (mouse). */
export const WIDTHS = [
  { name: 'phone', width: 390, height: 844, touch: true },
  { name: 'small-phone', width: 320, height: 568, touch: true },
  { name: 'tablet', width: 820, height: 1180, touch: true },
  { name: 'desktop', width: 1440, height: 900, touch: false },
];

/** Runs inside the page: the layout and target checks. */
export function measure({ coarse }) {
  const minTarget = coarse ? 44 : 24;
  const visible = (el) => {
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    // Skip elements clipped away on purpose (screen-reader-only text, the skip link before focus).
    return !el.closest('[hidden], [inert]');
  };
  const doc = document.documentElement;
  const overflowX = doc.scrollWidth - doc.clientWidth;

  const outside = [];
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || el.closest('.sr-only, .skip-link, .sheet__grab, [aria-hidden="true"] .skel')) continue;
    // Elements that scroll their own overflow (chips rows, code blocks) are allowed to extend.
    const rect = el.getBoundingClientRect();
    if (rect.right > doc.clientWidth + 1 || rect.left < -1) {
      let scrolled = false;
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const o = getComputedStyle(p).overflowX;
        if (o === 'auto' || o === 'scroll' || o === 'hidden') scrolled = true;
      }
      if (!scrolled && getComputedStyle(el).position !== 'fixed') outside.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} [${Math.round(rect.left)}, ${Math.round(rect.right)}]`);
    }
  }

  const targets = [];
  const selector = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="radio"], [role="tab"], [role="option"], [role="switch"], [role="checkbox"]';
  for (const el of document.querySelectorAll(selector)) {
    if (!visible(el) || el.closest('.sr-only') || el.matches('.skip-link:not(:focus)')) continue;
    // WCAG 2.5.8: a link, or a glossary term (text that opens a definition, M1 #02), inside a sentence is exempt. A heading is not a sentence: no term is marked in one.
    const inline = el.matches('a, .term') && getComputedStyle(el).display === 'inline' && el.closest('p, li, dd');
    if (inline) continue;
    // A control the label wraps, or a native checkbox restyled to a smaller box inside a larger label, uses the label's box.
    const rect = el.getBoundingClientRect();
    let { width, height } = rect;
    // A checkbox or radio inside a label is switched by the whole label: the label's box is its target.
    const label = el.matches('input[type="checkbox"], input[type="radio"]') ? el.closest('label') : null;
    if (label) {
      const box = label.getBoundingClientRect();
      width = Math.max(width, box.width);
      height = Math.max(height, box.height);
    }
    const after = getComputedStyle(el, '::after');
    // `.hit` / chip pseudo-element hit-area expansion.
    if (after.content !== 'none' && after.position === 'absolute') {
      const insetBlock = parseFloat(after.top) || 0;
      const insetInline = parseFloat(after.left) || 0;
      height = Math.max(height, parseFloat(after.height) || height - 2 * Math.min(0, insetBlock));
      width = Math.max(width, parseFloat(after.width) || width - 2 * Math.min(0, insetInline));
    }
    if (width < minTarget - 0.5 || height < minTarget - 0.5) {
      targets.push(`${el.tagName.toLowerCase()}${el.className ? '.' + String(el.className).split(' ')[0] : ''} "${(el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 30)}" ${Math.round(width)}×${Math.round(height)}`);
    }
  }
  return { overflowX, outside: outside.slice(0, 8), targets: targets.slice(0, 12), coarse: matchMedia('(pointer: coarse)').matches, h1: document.querySelector('h1')?.textContent ?? null, landmarks: [...document.querySelectorAll('main, nav, header, [role="banner"]')].length };
}

/** Waits for `selector` to show and for every finite animation (sheet slide-in, fades) to end, so measurements are final. */
async function settled(page, selector) {
  // In the shared headless browser a page can stop producing frames until it is brought to the front, and the waits below poll on frames.
  await page.bringToFront();
  await page.waitForSelector(selector, { visible: true });
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().iterations ?? 1))
      .every((animation) => animation.playState !== 'running'),
  );
}

/** `?` outside a field, which is where it opens help: the sign-in screen starts with focus in its password field. */
async function pressHelpKey(page) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('?');
}

/**
 * Layers the shell can open from any page; `open: 'profile'` etc. checks the page with that layer open. `selector` is the
 * control that opens it (not every size has every opener: the drawer is only on medium windows); `null` means a key
 * press opens it (M0 #06 / M1 #02: `?` opens the help for the screen; the search button opens the command palette). `wait` is
 * what shows once it is open (`.layer [data-panel]` unless it says otherwise: a glossary pop-up is not a layer). `open` may
 * return `{ skipped }` when this page has nothing to open.
 */
const OPENERS = {
  profile: { selector: 'button[aria-label^="Profile scope"]', open: (page) => page.click('button[aria-label^="Profile scope"]') },
  search: { selector: '.appbar__search, button[aria-label="Search and commands"]', open: (page) => page.click('button[aria-label="Search and commands"], .appbar__search') },
  drawer: { selector: 'button[aria-label="Open navigation drawer"]', open: (page) => page.click('button[aria-label="Open navigation drawer"]') },
  help: { selector: null, open: pressHelpKey },
  helpButton: { selector: 'button[aria-label="Help for this screen"]', open: (page) => page.click('button[aria-label="Help for this screen"]') },
  term: { selector: '.main .term', wait: '.term-pop', open: (page) => page.click('.main .term') },
  // A pop-up open over the help panel (a layer inside a layer), and the sign-in screen's own Help button.
  helpTerm: {
    selector: null,
    wait: '.term-pop',
    open: async (page) => {
      await pressHelpKey(page);
      await settled(page, '.layer [data-panel]');
      if (!(await page.$('.layer .help-page .term'))) return { skipped: 'this help page has no glossary term' };
      await page.click('.layer .help-page .term');
    },
  },
  signInHelp: { selector: '.sign-in-help', open: (page) => page.click('.sign-in-help') },
};

/**
 * Opens `route` at one viewport and runs the gates. Returns `{ ok, problems, ...details }`; `problems` is empty when
 * every gate passed.
 */
export async function checkRoute(page, { url, route, width, height, touch, name, shots, open, scheme = 'dark', skin = 'nous', density = 'auto', textSize = 'md' }) {
  const consoleErrors = [];
  const onConsole = (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  };
  const onPageError = (error) => consoleErrors.push(`pageerror: ${error.message}`);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  // The appearance is stored as a choice made here and not yet saved (`pending`), so the app keeps it rather than adopting what Caduceus stored for an earlier run.
  const appearance = { theme: scheme, skin, density, textSize };
  try {
    // Switching touch emulation reloads the page, which can hang while a sheet from the last run is open: start from a blank page.
    await page.goto('about:blank');
    await page.setViewport({ width, height, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme === 'dark' ? 'light' : 'dark' }]);
    // localStorage belongs to the origin: store the appearance from a public file of it (an icon; M0 #12 made a missing asset a 404, which logs a console error), then open the route.
    await page.goto(`${url}/icons/icon.svg`);
    await page.evaluate((raw) => localStorage.setItem('caduceus.appearance', raw), JSON.stringify({ appearance, pending: true }));
    // `load`, not `networkidle0`: the response of a no-store request nobody reads (the appearance PUT) never counts as finished, so the network never looks idle.
    await page.goto(`${url}${route}`, { waitUntil: 'load' });
    await settled(page, 'h1');
    // What `networkidle0` used to wait for: a screen still loading shows a busy (disabled) button, which is measured as it is.
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), { timeout: 10000 });
    // A button leaving its busy state fades between colours; axe samples the middle of the fade if it measures at once.
    await new Promise((resolve) => setTimeout(resolve, 600));
    if (open) {
      // Not every size has every opener.
      const opener = OPENERS[open];
      if (opener.selector && !(await page.$(opener.selector))) return { ok: true, skipped: `no ${open} opener at ${width}`, route, width, problems: [], axeMinor: [] };
      const opened = await opener.open(page);
      if (opened?.skipped) return { ok: true, skipped: opened.skipped, route, width, problems: [], axeMinor: [] };
      await settled(page, opener.wait ?? '.layer [data-panel]');
    }

    const layout = await page.evaluate(measure, { coarse: touch });
    await page.evaluate(AXE_SOURCE);
    const axe = await page.evaluate(() =>
      axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }).then((r) =>
        r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(' ')), help: v.help })),
      ),
    );
    const serious = axe.filter((v) => v.impact === 'serious' || v.impact === 'critical');

    const problems = [];
    const shown = await page.evaluate(() => ({ theme: document.documentElement.dataset.theme, skin: document.documentElement.dataset.skin, density: document.documentElement.dataset.density, textScale: document.documentElement.dataset.textScale }));
    if (shown.theme !== scheme || shown.skin !== skin || shown.density !== density || (shown.textScale ?? 'md') !== textSize) problems.push(`appearance on <html> is ${JSON.stringify(shown)}, expected ${JSON.stringify(appearance)}`);
    if (layout.overflowX > 0) problems.push(`horizontal overflow of ${layout.overflowX}px`);
    if (layout.outside.length) problems.push(`laid out outside the viewport: ${layout.outside.join('; ')}`);
    if (layout.targets.length) problems.push(`targets below ${touch ? 44 : 24}px: ${layout.targets.join('; ')}`);
    if (touch !== layout.coarse) problems.push(`pointer emulation: expected coarse=${touch}, got ${layout.coarse}`);
    for (const v of serious) problems.push(`axe ${v.impact} ${v.id}: ${v.nodes.join(' | ')}`);
    if (consoleErrors.length) problems.push(`console errors: ${consoleErrors.join(' | ').slice(0, 300)}`);
    if (shots) {
      fs.mkdirSync(shots, { recursive: true });
      await page.screenshot({ path: `${shots}/${name}${skin === 'nous' ? '' : '-' + skin}${scheme === 'dark' ? '' : '-' + scheme}-${width}.png` });
    }
    return { ok: problems.length === 0, route, width, problems, h1: layout.h1, axeMinor: axe.filter((v) => !serious.includes(v)).map((v) => `${v.impact} ${v.id}`) };
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
}
