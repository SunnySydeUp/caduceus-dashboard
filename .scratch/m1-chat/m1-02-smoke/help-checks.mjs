// The M1 #02 behaviour checks for contextual help, as a repeatable throwaway browser check (AGENTS.md: no Playwright tests). Not
// part of `npm test`. It complements `m0-05-smoke/ui-gates.mjs` (overflow, axe, targets with the help panel and a glossary
// pop-up open, via the `help`, `helpButton` and `term` openers): this one drives the keyboard, the touch UI and the offline start.
//
// Usage, from the eval tool's `browser`, with `serve.ts` (this folder) running and the tab signed in (cookie in
// /tmp/caduceus-m1-02-cookie), at http://localhost:9230 (a secure context, so the service worker registers):
//
//   const result = await tab.run(({ page }, cfg) => import(cfg.checks).then((m) => m.checkHelp(page, cfg)),
//     { args: [{ checks: '/…/m1-02-smoke/help-checks.mjs', url: 'http://localhost:9230', cookie: 'caduceus_session=…', shots: '/…/m1-02-smoke' }] });
//
// It returns `{ ok, problems, steps }`.
const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1, hasTouch: false, isMobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const SMALL = { width: 320, height: 568, deviceScaleFactor: 2, hasTouch: true, isMobile: true };

/** Every M0 screen and the heading of the page its help opens on. */
const SCREENS = [
  ['/home', 'Home'],
  ['/observe/health', 'Health and Repairs'],
  ['/settings', 'Settings'],
  ['/settings/appearance', 'Appearance'],
  ['/system/security', 'Security'],
  ['/settings/keyboard', 'Keyboard'],
  ['/settings/install', 'Install app'],
  ['/more', 'More'],
];

export async function checkHelp(page, { url, cookie, shots }) {
  const problems = [];
  const steps = [];
  const check = (label, ok, detail) => {
    steps.push(label);
    if (!ok) problems.push(detail === undefined ? label : `${label}: ${JSON.stringify(detail)}`);
  };
  const errors = [];
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const key = (name) => page.keyboard.press(name);
  const chord = async (name, ...modifiers) => {
    for (const modifier of modifiers) await page.keyboard.down(modifier);
    await page.keyboard.press(name);
    for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier);
  };
  const go = async (to) => {
    await page.goto(`${url}${to}`, { waitUntil: 'load' });
    // In the shared headless browser a page can stop producing frames until it is brought to the front, and the waits below poll on frames.
    await page.bringToFront();
    await page.waitForSelector('h1');
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), { timeout: 10000 });
    await sleep(300);
  };
  /** Every finite animation (sheet slide-in, fades) has ended. */
  const settle = () =>
    page.waitForFunction(() =>
      document
        .getAnimations()
        .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().iterations ?? 1))
        .every((animation) => animation.playState !== 'running'),
    );
  const panelOpen = () => page.waitForSelector('.layer [data-panel]:has(.help)', { visible: true, timeout: 4000 }).then(() => settle(), () => false);
  const noLayer = () => page.waitForFunction(() => !document.querySelector('.layer'), { timeout: 4000 }).then(() => true, () => false);
  const panel = () =>
    page.evaluate(() => {
      const element = document.querySelector('.layer [data-panel]:has(.help)');
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        kind: element.classList.contains('sheet') ? 'sheet' : element.classList.contains('drawer') ? 'drawer' : 'dialog',
        title: element.querySelector('h2')?.textContent,
        heading: element.querySelector('[data-help-heading]')?.textContent,
        headingFocused: document.activeElement?.hasAttribute('data-help-heading') ?? false,
        tabs: [...element.querySelectorAll('[role="tab"]')].map((tab) => `${tab.textContent}:${tab.getAttribute('aria-selected')}`),
        term: element.querySelector('.help-term')?.textContent ?? null,
        rect: [Math.round(rect.left), Math.round(rect.right), Math.round(rect.width)],
      };
    });
  const termState = () =>
    page.evaluate(() => {
      const pop = document.querySelector('.term-pop');
      const rect = pop?.getBoundingClientRect();
      return pop
        ? { text: pop.textContent, open: pop.matches(':popover-open'), inside: rect.left >= 0 && rect.right <= document.documentElement.clientWidth && rect.top >= 0 && rect.bottom <= window.innerHeight, live: document.getElementById('toasts').textContent, liveMode: document.getElementById('toasts').getAttribute('aria-live') }
        : null;
    });
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  const options = () => page.evaluate(() => [...document.querySelectorAll('.palette [role="option"]')].map((option) => option.querySelector('.palette__label')?.textContent));
  const groups = () => page.evaluate(() => [...document.querySelectorAll('.palette .palette__group')].map((group) => group.textContent));
  const type = async (text) => {
    await page.keyboard.type(text);
    await sleep(150);
  };

  // ---- Desktop: keyboard and mouse -------------------------------------------------------------------------------------
  await page.goto('about:blank');
  await page.setViewport(DESKTOP);
  await page.goto(`${url}/icons/icon.svg`);
  if (cookie) {
    const [name, ...rest] = cookie.split('=');
    await page.setCookie({ name, value: rest.join('='), url });
  }

  for (const [route, heading] of SCREENS) {
    await go(route);
    await key('?');
    check(`${route}: ? opens the help panel`, await panelOpen());
    const state = await panel();
    check(`${route}: it is a side panel on the page for this screen`, state?.kind === 'drawer' && state.title === 'Help' && state.heading === heading, state);
    check(`${route}: focus starts on the page heading`, state?.headingFocused === true, state);
    if (route === '/home') await page.screenshot({ path: `${shots}/help-panel-home-1440.png` });
    await key('Escape');
    check(`${route}: Escape closes it`, await noLayer());
  }

  await go('/no/such/page');
  await key('?');
  await panelOpen();
  check('an unknown address opens the list of topics', (await panel())?.heading === 'Help topics', await panel());
  await key('Escape');
  await noLayer();

  // The help button, the Shortcuts tab and the tabs' keyboard.
  await go('/settings/keyboard');
  await page.click('button[aria-label="Help for this screen"]');
  await panelOpen();
  check('the app bar help button opens the same panel', (await panel())?.heading === 'Keyboard');
  await page.click('[role="tab"]:not([aria-selected="true"])');
  await settle();
  const shortcuts = await page.evaluate(() => document.querySelector('[role="tabpanel"]:not([hidden])')?.textContent ?? '');
  check('the Shortcuts tab lists the shortcuts and the single-key switch', ['Go to Home', 'Open the command palette', 'Show help for this screen', 'Single-key shortcuts'].every((text) => shortcuts.includes(text)), shortcuts.slice(0, 200));
  if (shots) await page.screenshot({ path: `${shots}/help-shortcuts-1440.png` });
  await key('ArrowLeft');
  check('ArrowLeft goes back to the Help tab', (await panel())?.tabs.join() === 'Help:true,Shortcuts:false', await panel());
  await key('End');
  check('End goes to the Shortcuts tab', (await panel())?.tabs.join() === 'Help:false,Shortcuts:true', await panel());
  await key('Escape');
  await noLayer();

  // ---- Glossary terms --------------------------------------------------------------------------------------------------
  await go('/system/security');
  await page.focus('.main .term');
  await sleep(150);
  let term = await termState();
  check('keyboard focus on a term opens its definition, in the top layer and inside the viewport', term?.open === true && term.inside && term.text.startsWith('Passkey'), term);
  check('the definition is announced through the polite live region', term?.live.startsWith('Passkey: ') === true && term.liveMode === 'polite', term);
  if (shots) await page.screenshot({ path: `${shots}/help-term-1440.png` });
  await key('Escape');
  await sleep(150);
  check('Escape closes the definition and leaves focus on the term', (await termState()) === null && (await page.evaluate(() => document.activeElement?.classList.contains('term'))));
  await page.mouse.click(5, 5);
  await sleep(100);
  await page.click('.main .term');
  await sleep(150);
  check('a click opens it too', (await termState())?.open === true);
  await page.click('.main h1');
  await sleep(150);
  check('a click elsewhere closes it', (await termState()) === null);
  await page.click('.main .term');
  await sleep(150);
  await page.click('.term-pop button');
  await panelOpen();
  const more = await panel();
  check('More opens the help panel on the term’s page, with the term’s meaning above it', more?.heading === 'Security' && more.term?.startsWith('Passkey') === true, more);
  // A term inside the panel: Escape closes its pop-up first and the panel second.
  await page.click('.layer .help-page .term');
  await sleep(150);
  check('a term in the panel opens its definition', (await termState())?.open === true);
  await key('Escape');
  await sleep(150);
  check('Escape closes the pop-up and leaves the panel open', (await termState()) === null && (await panel()) !== null);
  await page.click('.layer .help-page .term');
  await sleep(150);
  await page.click('.term-pop button');
  await sleep(300);
  const turned = await panel();
  check('More in the panel turns its page and does not open a second panel', turned && (await page.$$eval('.layer', (layers) => layers.length)) === 1 && turned.term !== null, turned);
  check('the heading of the new page has focus', turned?.headingFocused === true, turned);
  await page.click('.layer .help-nav button');
  await sleep(200);
  check('Back returns to the page before', (await panel())?.heading === 'Security', await panel());
  await key('Escape');
  await noLayer();

  // ---- The command palette ---------------------------------------------------------------------------------------------
  const openPalette = async (query) => {
    await chord('k', 'Meta');
    await page.waitForSelector('.palette', { visible: true });
    // Typing is something a person does once the search field has focus; a key sent in the frame the palette appears can arrive before it.
    await page.waitForFunction(() => document.activeElement?.matches('.palette input'));
    if (query) await type(query);
  };
  await go('/home');
  await openPalette();
  check('with no query the palette lists no help', !(await groups()).includes('Help'), await groups());
  await type('passkey');
  check('a query lists help pages and glossary terms in their own group, after the commands and routes', (await groups()).at(-1) === 'Help' && (await options()).includes('Passkey'), { groups: await groups(), options: await options() });
  await key('Escape');
  await noLayer();
  await openPalette('step-up');
  const found = await options();
  check('“step-up” finds the page and the term', found.includes('Step-up confirmation') && found.includes('Step-up'), found);
  await page.click('.palette [role="option"]');
  await panelOpen();
  const chosen = await panel();
  check('choosing a result opens it in the help panel', chosen?.kind === 'drawer' && chosen.heading === 'Step-up confirmation', chosen);
  await key('Escape');
  await noLayer();
  await openPalette('keyboard shortcuts');
  await key('Enter');
  await panelOpen();
  check('the Keyboard shortcuts entry opens the Shortcuts tab', (await panel())?.tabs.join() === 'Help:false,Shortcuts:true', await panel());
  await key('Escape');
  await noLayer();
  await openPalette('?');
  const typed = await page.evaluate(() => ({ value: document.querySelector('.palette input')?.value ?? null, palette: Boolean(document.querySelector('.palette')), active: document.activeElement?.tagName }));
  check('`?` typed in the palette is text, not a shortcut', typed.value === '?' && (await panel()) === null, { typed, panel: await panel() });
  await key('Escape');
  await noLayer();

  // ---- Offline: help ships in the precached build ---------------------------------------------------------------------
  // The browser keeps its service workers and caches between runs, and a stale worker would serve an older build offline: start
  // from none, so the worker that controls the page is this build's. (`navigator.serviceWorker.ready` cannot be read from here:
  // the evaluation is not in the page's main world, so it asks the registration instead.)
  // `unregister()` leaves a worker running while a page it controls is open, so the browser is asked to forget the origin's workers
  // and caches, and the page then starts again from a blank one.
  await page.goto('about:blank');
  const forget = await page.createCDPSession();
  await forget.send('Storage.clearDataForOrigin', { origin: url, storageTypes: 'service_workers,cache_storage' });
  await forget.detach();
  await go('/home');
  await page.waitForFunction(
    async () => {
      const names = await caches.keys();
      const urls = (await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname)))).flat();
      const registration = await navigator.serviceWorker.getRegistration();
      return registration?.active?.state === 'activated' && urls.includes('/index.html') && urls.some((path) => /\/assets\/HelpPanel-.*\.js$/.test(path));
    },
    { polling: 250, timeout: 20000 },
  );
  await go('/home');
  const controlled = await page.evaluate(() => navigator.serviceWorker.controller !== null);
  check('the service worker controls the page', controlled);
  const precached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (name) => (await (await caches.open(name)).keys()).map((request) => new URL(request.url).pathname)))).flat());
  check('the build’s help chunk is in the cache the worker filled', precached.some((path) => /\/assets\/HelpPanel-.*\.js$/.test(path)) && precached.includes('/index.html'), precached.length);
  const cdp = await page.createCDPSession();
  await cdp.send('Network.enable');
  try {
    await cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('h1');
    await sleep(500);
    await key('?');
    const offlinePanel = await panelOpen();
    const offlineState = await panel();
    check('offline, after a reload, ? opens the help for Home', offlinePanel && offlineState?.heading === 'Home', offlineState);
    await page.click('.layer .help-page .term');
    await sleep(150);
    check('offline, a glossary term opens its definition', (await termState())?.open === true);
    await key('Escape');
    await key('Escape');
    await noLayer();
    await openPalette('read-only');
    check('offline, the palette searches help', (await options()).some((label) => label.includes('Read-only mode')), await options());
    await key('Escape');
    await noLayer();
    if (shots) await page.screenshot({ path: `${shots}/help-offline-1440.png` });
  } finally {
    // Never leave the shared browser offline, whatever failed above.
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await cdp.detach();
  }

  // ---- Sign-in screen --------------------------------------------------------------------------------------------------
  await page.deleteCookie({ name: 'caduceus_session', url });
  await page.goto(`${url}/sign-in`, { waitUntil: 'load' });
  await page.waitForSelector('h1');
  await sleep(300);
  await page.evaluate(() => document.querySelector('.sign-in-help')?.focus());
  await page.keyboard.press('Enter');
  const signInPanel = await panelOpen();
  const signIn = await panel();
  check('the sign-in screen has a Help button that opens its help', signInPanel && signIn?.heading === 'Signing in', signIn);
  check('it has no Shortcuts tab', signIn?.tabs.length === 0, signIn);
  if (shots) await page.screenshot({ path: `${shots}/help-sign-in-1440.png` });
  await key('Escape');
  await noLayer();
  await page.evaluate(() => document.querySelector('.sign-in-help')?.focus());
  await key('?');
  check('? on the sign-in screen, outside a field, opens it too', await panelOpen());
  await key('Escape');
  await noLayer();
  if (cookie) {
    const [name, ...rest] = cookie.split('=');
    await page.setCookie({ name, value: rest.join('='), url });
  }

  // ---- Phone and small phone: touch -------------------------------------------------------------------------------------
  for (const [label, size] of [['phone', PHONE], ['small phone', SMALL]]) {
    await page.goto('about:blank');
    await page.setViewport(size);
    await go('/system/security');
    const visible = await page.evaluate(() => {
      const button = document.querySelector('button[aria-label="Help for this screen"]');
      const rect = button?.getBoundingClientRect();
      return rect && rect.width >= 44 && rect.height >= 44 && rect.right <= document.documentElement.clientWidth;
    });
    check(`${label}: the app bar has a help button of at least 44 px, inside the screen`, visible === true, visible);
    await page.tap('button[aria-label="Help for this screen"]');
    check(`${label}: it opens`, await panelOpen());
    const sheet = await panel();
    check(`${label}: the help is a sheet`, sheet?.kind === 'sheet' && sheet.heading === 'Security' && sheet.tabs.length === 2, sheet);
    if (shots && size === PHONE) await page.screenshot({ path: `${shots}/help-sheet-390.png` });
    await page.tap('.layer .help-page .term');
    await sleep(200);
    term = await termState();
    check(`${label}: tapping a term opens its definition, inside the screen`, term?.open === true && term.inside, term);
    if (shots && size === PHONE) await page.screenshot({ path: `${shots}/help-term-390.png` });
    await page.tap('.term-pop button');
    await sleep(300);
    check(`${label}: More turns the sheet’s page`, (await panel())?.term !== null && (await page.$$eval('.layer', (layers) => layers.length)) === 1);
    check(`${label}: no horizontal overflow with the sheet open`, (await overflow()) === 0, await overflow());
    await page.tap('.layer button[aria-label="Close"]');
    check(`${label}: the Close button closes it`, await noLayer());
    await page.tap('.main .term');
    await sleep(200);
    term = await termState();
    check(`${label}: a term on the page opens inside the screen`, term?.open === true && term.inside, term);
    await page.tap('.main h1');
    await sleep(150);
    check(`${label}: a tap elsewhere closes it`, (await termState()) === null);
  }

  check('no console errors (the offline reload logs only the browser’s own network lines)', errors.filter((message) => !/Failed to load resource|net::ERR|ERR_INTERNET_DISCONNECTED|Failed to fetch|NetworkError/.test(message)).length === 0, errors.slice(0, 5));
  return { ok: problems.length === 0, problems, steps };
}
