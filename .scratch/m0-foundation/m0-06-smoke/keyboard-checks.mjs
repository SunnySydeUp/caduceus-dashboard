// The M0 #06 behaviour checks for the command palette and keyboard shortcuts, as a repeatable throwaway browser check
// (AGENTS.md: no Playwright tests). Not part of `npm test`. It complements `m0-05-smoke/ui-gates.mjs` (overflow, axe,
// targets on every route, with the palette and the shortcut sheet open): this one drives the keyboard and the touch UI.
//
// Usage, from the eval tool's `browser`, with `serve.ts` (this folder) running and the tab signed in:
//
//   const result = await tab.run(({ page }, cfg) => import(cfg.checks).then((m) => m.checkKeyboard(page, cfg)),
//     { args: [{ checks: '/…/m0-06-smoke/keyboard-checks.mjs', url: 'http://127.0.0.1:9160', shots: '/…/m0-06-smoke' }] });
//
// Desktop part: 1440 px, mouse and hardware keyboard. Phone part: 390 px, touch. It returns `{ ok, problems, steps }`.
const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1, hasTouch: false, isMobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true };

export async function checkKeyboard(page, { url, shots }) {
  const problems = [];
  const steps = [];
  const check = (label, ok, detail) => {
    steps.push(label);
    if (!ok) problems.push(detail === undefined ? label : `${label}: ${JSON.stringify(detail)}`);
  };
  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  const path = () => new URL(page.url()).pathname;
  const key = (name) => page.keyboard.press(name);
  const chord = async (name, ...modifiers) => {
    for (const modifier of modifiers) await page.keyboard.down(modifier);
    await page.keyboard.press(name);
    for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier);
  };
  const go = async (to) => {
    // `load`, not `networkidle0`: the response of a no-store request nobody reads (the appearance PUT) never counts as finished.
    await page.goto(`${url}${to}`, { waitUntil: 'load' });
    await page.bringToFront();
    await page.waitForSelector('h1');
  };
  const waitPath = (to) => page.waitForFunction((target) => location.pathname === target, { timeout: 4000 }, to).then(() => true, () => false);
  const options = () => page.evaluate(() => [...document.querySelectorAll('.palette [role="option"]')].map((o) => o.querySelector('.palette__label')?.textContent));
  const status = () => page.evaluate(() => document.querySelector('.palette [role="status"]')?.textContent);
  const active = () => page.evaluate(() => document.getElementById(document.activeElement?.getAttribute('aria-activedescendant') ?? '')?.querySelector('.palette__label')?.textContent);
  const paletteOpen = () => page.$('.palette').then(Boolean);
  const openPalette = async () => {
    await chord('k', 'Meta');
    await page.waitForSelector('.palette', { visible: true });
    // A key sent in the frame the palette appears can arrive before the search field has focus.
    await page.waitForFunction(() => document.activeElement?.matches('.palette input'));
  };
  const closeLayer = async () => {
    await key('Escape');
    await page.waitForFunction(() => !document.querySelector('.layer'), { timeout: 4000 });
  };
  const storage = () => page.evaluate(() => localStorage.getItem('caduceus.keyboard'));
  /** Every finite animation (sheet slide-in, fades) has ended. */
  const settle = () =>
    page.waitForFunction(() =>
      document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().iterations ?? 1))
        .every((animation) => animation.playState !== 'running'),
    );
  const snap = async (name) => {
    if (!shots) return;
    await settle();
    await page.screenshot({ path: `${shots}/${name}.png` });
  };

  try {
  // ---------------------------------------------------------------- desktop
  await page.setViewport(DESKTOP);
  await go('/home');
  await page.evaluate(() => localStorage.removeItem('caduceus.keyboard'));
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector('h1');

  // ⌘K opens the palette with focus in the field; it lists the actions first, then the routes, with their shortcuts. Help pages and
  // glossary terms (M1 #02) are listed only for a query.
  await openPalette();
  check('⌘K opens the palette with focus in the search field', await page.evaluate(() => document.activeElement?.getAttribute('role') === 'combobox'));
  const all = await options();
  check('the empty query lists the shell actions first, then every route', JSON.stringify(all) === JSON.stringify(['Help', 'Keyboard shortcuts', 'Home', 'Health', 'Settings', 'Appearance', 'Security', 'Keyboard', 'Install app']), all);
  check('the results count is announced', (await status()) === '9 results', await status());
  const shown = await page.evaluate(() => [...document.querySelectorAll('.palette [role="option"]')].map((o) => [...o.querySelectorAll('kbd')].map((k) => k.textContent).join('')));
  check('each entry shows its shortcut', JSON.stringify(shown) === JSON.stringify(['?', '', 'GH', 'GE', 'G,', '', '', '', '']), shown);
  check('the groups are headed Actions and Navigate', JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('.palette__group')].map((g) => g.textContent))) === JSON.stringify(['Actions', 'Navigate']));
  await snap('palette-empty-1440');

  // Fuzzy matching with highlighted characters, and the count follows. Help pages come after the routes: the one that is about
  // fuzzy matching quotes "hlth", and Health and Repairs matches by its title.
  await page.keyboard.type('hlth');
  const fuzzy = await options();
  check('fuzzy: "hlth" finds Health first, then the help pages for it', fuzzy[0] === 'Health' && fuzzy[1] === 'Health and Repairs', fuzzy);
  check('the matched characters are highlighted', (await page.evaluate(() => [...document.querySelector('.palette [role="option"]').querySelectorAll('mark')].map((m) => m.textContent).join(''))) === 'Hlth');
  check('the number of results is announced', (await status()) === `${fuzzy.length} results`, { status: await status(), fuzzy });
  await snap('palette-fuzzy-1440');

  // ↑ ↓ wrap, and move aria-activedescendant.
  await page.$eval('.palette input', (el) => el.select());
  await page.keyboard.type('se');
  const ranked = await options();
  check('"se" ranks Settings and Security before the others', ranked[0] === 'Settings' && ranked.includes('Security'), ranked);
  const first = await active();
  await key('ArrowDown');
  const second = await active();
  await key('ArrowUp');
  const back = await active();
  await key('ArrowUp');
  const wrapped = await active();
  check('↓ moves, ↑ moves back and wraps', first === ranked[0] && second === ranked[1] && back === first && wrapped === ranked.at(-1), { first, second, back, wrapped });

  // ↵ runs the active result and closes the palette; focus goes to the new page's heading.
  await page.$eval('.palette input', (el) => el.select());
  await page.keyboard.type('hlth');
  await key('Enter');
  check('↵ opens the active result', await waitPath('/observe/health'), path());
  check('the palette closed', !(await paletteOpen()));
  check('focus moved to the page heading', await page.waitForFunction(() => document.activeElement?.tagName === 'H1', { timeout: 3000 }).then(() => true, () => false), await page.evaluate(() => document.activeElement?.tagName));

  // Esc closes and gives focus back.
  await openPalette();
  await closeLayer();
  check('Esc closes the palette', !(await paletteOpen()));
  check('focus returned to where it was', await page.waitForFunction(() => document.activeElement?.tagName === 'H1', { timeout: 3000 }).then(() => true, () => false), await page.evaluate(() => document.activeElement?.tagName));
  // ⌘K again while it is open closes it.
  await openPalette();
  await chord('k', 'Meta');
  check('⌘K while open closes it', await page.waitForFunction(() => !document.querySelector('.palette'), { timeout: 3000 }).then(() => true, () => false));

  // g then a letter.
  await key('g');
  check('`g` shows the hint', await page.waitForSelector('.ghint', { visible: true, timeout: 2000 }).then(() => true, () => false));
  await key('h');
  check('`g` `h` goes Home', await waitPath('/home'), path());
  check('the hint is gone', await page.waitForFunction(() => !document.querySelector('.ghint'), { timeout: 2000 }).then(() => true, () => false));
  await key('g');
  await key('e');
  check('`g` `e` goes to Health', await waitPath('/observe/health'), path());
  await key('g');
  await key(',');
  check('`g` `,` goes to Settings', await waitPath('/settings'), path());
  await key('g');
  await key('z');
  check('`g` then a key that is no destination goes nowhere', path() === '/settings', path());

  // ? opens the help for this screen (M1 #02; the shortcut sheet is its Shortcuts tab); not while typing; Esc closes.
  await key('?');
  await page.waitForSelector('.layer [role="dialog"]', { visible: true });
  const helpText = await page.evaluate(() => document.querySelector('.layer [role="dialog"]')?.textContent ?? '');
  check('`?` opens the help panel on the page for this screen, with its two tabs', helpText.includes('Settings') && (await page.$$eval('.layer [role="tab"]', (tabs) => tabs.map((tab) => tab.textContent).join())) === 'Help,Shortcuts');
  await settle();
  await page.click('.layer [role="tab"]:not([aria-selected="true"])');
  const sheet = await page.evaluate(() => document.querySelector('.layer [role="tabpanel"]:not([hidden])')?.textContent ?? '');
  check('its Shortcuts tab lists the shortcuts', ['Go to Home', 'Open the command palette', 'Show help for this screen', 'Single-key shortcuts'].every((text) => sheet.includes(text)), sheet.slice(0, 160));
  await snap('shortcut-sheet-1440');
  await closeLayer();
  await openPalette();
  await page.keyboard.type('?');
  check('`?` typed in the palette is text, not the help panel', (await page.$$('.layer [role="dialog"]')).length === 1 && (await page.$('.palette input')) !== null);
  await closeLayer();

  // Settings › Keyboard: the single-key switch.
  await go('/settings/keyboard');
  const switchSelector = '.switch[role="switch"]';
  check('Settings › Keyboard lists the switch, on by default', (await page.$eval(switchSelector, (el) => el.getAttribute('aria-checked'))) === 'true');
  await page.click(switchSelector);
  check('turning it off is stored on this device', JSON.parse((await storage()) ?? '{}').singleKey === false, await storage());
  await key('g');
  await key('h');
  check('with single-key shortcuts off, `g` `h` does nothing', !(await waitPath('/home')), path());
  await key('?');
  check('with single-key shortcuts off, `?` does nothing', (await page.$('.layer')) === null);
  await openPalette();
  check('⌘K still works with single-key shortcuts off', await paletteOpen());
  await closeLayer();
  await page.reload({ waitUntil: 'load' });
  await page.waitForSelector(switchSelector);
  check('the setting survives a reload', (await page.$eval(switchSelector, (el) => el.getAttribute('aria-checked'))) === 'false');
  await snap('settings-keyboard-off-1440');
  await page.click(switchSelector);

  // Remapping.
  const change = (label) => `button[aria-label="Change shortcut for ${label}"]`;
  await page.click(change('Go to Home'));
  check('Change waits for the new keys', (await page.$eval('[data-key-capture]', (el) => el.textContent)).startsWith('Press the new keys'));
  await key('e');
  check('a key another shortcut holds is refused, with its name', (await page.evaluate(() => document.querySelector('[role="alert"].error-text')?.textContent ?? '')).includes('Go to Health'));
  await chord('k', 'Meta');
  check('⌘K while choosing keys is the new binding, not the palette, and a jump takes a plain key', !(await paletteOpen()) && (await page.evaluate(() => document.querySelector('[role="alert"].error-text')?.textContent ?? '')).includes('plain key'));
  // The same for a shortcut that is not a jump: ⌘K is taken, and ⇧⌘O is reserved for New chat.
  await page.click(change('Show help for this screen'));
  await chord('k', 'Meta');
  check('⌘K is held by the palette', (await page.evaluate(() => document.querySelector('[role="alert"].error-text')?.textContent ?? '')).includes('Open the command palette'));
  await chord('o', 'Meta', 'Shift');
  check('⇧⌘O is reserved for New chat', (await page.evaluate(() => document.querySelector('[role="alert"].error-text')?.textContent ?? '')).includes('New chat'));
  await key('Escape');
  await page.click(change('Go to Home'));
  await key('x');
  check('a free key is accepted and stored', JSON.parse((await storage()) ?? '{}').remaps?.['go:home'] === 'g x', await storage());
  check('the row shows the new keys and a Reset button', await page.evaluate(() => !!document.querySelector('button[aria-label^="Reset Go to Home"]')));
  check('the Change button kept focus', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Change shortcut for Go to Home'), await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)));
  await snap('settings-keyboard-remap-1440');
  await go('/observe/health');
  await key('g');
  await key('x');
  check('`g` `x` now goes Home', await waitPath('/home'), path());
  await go('/observe/health');
  await key('g');
  await key('h');
  check('`g` `h` no longer does', !(await waitPath('/home')), path());
  await go('/settings/keyboard');
  await page.click('button[aria-label^="Reset Go to Home"]');
  check('Reset restores the default', JSON.parse((await storage()) ?? '{}').remaps?.['go:home'] === undefined, await storage());
  await page.click(change('Go to Home'));
  await key('Escape');
  check('Esc cancels choosing', (await page.$('[data-key-capture]')) === null);
  // Tab leaves a waiting Change button (no keyboard trap).
  await page.click(change('Go to Health'));
  await key('Tab');
  check('Tab is never captured: it moves focus on and ends choosing', (await page.$('[data-key-capture]')) === null);

  // ---------------------------------------------------------------- phone
  await page.setViewport(PHONE);
  await go('/home');
  await page.click('button[aria-label="Search and commands"]');
  await page.waitForSelector('.palette--full', { visible: true });
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
  const box = await page.$eval('.palette--full', (el) => {
    const r = el.getBoundingClientRect();
    return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight };
  });
  check('on a phone the palette is a full-screen sheet opened from the app bar', box.w === box.vw && box.h === box.vh, box);
  check('the phone palette shows no hardware key hints', await page.evaluate(() => getComputedStyle(document.querySelector('.palette__foot')).display === 'none'));
  await snap('palette-phone-390');
  await page.type('.palette input', 'sec');
  await page.waitForSelector('.palette [role="option"]');
  await page.tap('.palette [role="option"]');
  check('tapping a result opens it and closes the sheet', (await waitPath('/system/security')) && !(await paletteOpen()), path());
  await page.click('button[aria-label="Search and commands"]');
  await page.waitForSelector('.palette--full', { visible: true });
  await page.tap('.palette button[aria-label="Close search"]');
  check('the close button closes it', await page.waitForFunction(() => !document.querySelector('.palette'), { timeout: 3000 }).then(() => true, () => false));

  check('no console errors', errors.length === 0, errors.slice(0, 3));
  } catch (error) {
    problems.push(`aborted after "${steps.at(-1)}": ${error.message}`);
  }
  return { ok: problems.length === 0, problems, steps };
}
