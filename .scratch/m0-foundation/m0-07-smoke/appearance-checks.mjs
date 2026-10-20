// The M0 #07 behaviour checks for per-device appearance, as a repeatable throwaway browser check (AGENTS.md: no Playwright
// tests). Not part of `npm test`. It complements `m0-05-smoke/ui-gates.mjs` (overflow, axe, targets on every route, now in
// every skin, light and dark): this one checks the first painted frame (no flash of the wrong theme), persistence across
// reload / sign-out / sign-in, two devices staying independent, offline choices, reduced motion and density.
//
// Usage, from the eval tool's `browser`, with `serve.ts` (this folder) running:
//
//   const result = await tab.run((ctx, cfg) => import(cfg.checks).then((m) => m.checkAppearance(ctx, cfg)),
//     { args: [{ checks: '/…/m0-07-smoke/appearance-checks.mjs', url: 'http://127.0.0.1:9170', shots: '/…/m0-07-smoke' }] });
//
// The first-paint checks serve the page's HTML with a small probe script first in <head> (the harness's raw `evaluateOnNewDocument`
// does not run, and its `page.evaluate` is an isolated world: page globals are invisible, the DOM and storage are shared). The
// probe logs every change to the attributes of <html> into sessionStorage. Every device after that is its own browser context
// (its own cookies and localStorage), signed in as the throwaway owner.
const PASSWORD = 'test owner passphrase';
const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1, hasTouch: false, isMobile: false };
const PHONE = { width: 390, height: 844, deviceScaleFactor: 2, hasTouch: true, isMobile: true };
const KEY = 'caduceus.appearance';
const ROUTE = '/_caduceus/api/preferences/appearance';

/** Signs the page's browser in as the throwaway owner (on the sign-in page, which is public). */
async function signIn(page, url) {
  await page.goto(`${url}/sign-in`, { waitUntil: 'networkidle0' });
  const ok = await page.evaluate(async (password) => (await fetch('/_caduceus/api/auth/session')).json().then(async (state) => (await fetch(`/_caduceus/api/auth/${state.ownerExists ? 'sign-in' : 'setup'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) })).ok), PASSWORD);
  if (!ok) throw new Error('could not sign in the throwaway owner');
}

/** A page that is in front: a page behind another one gets no animation frames or intersection callbacks, so clicks and waits on it would hang. */
async function newTab(context) {
  const page = await context.newPage();
  await page.bringToFront();
  return page;
}

/** A new browser context (a device), signed in. */
async function newDevice(browser, url, viewport, scheme = 'light') {
  const context = await browser.createBrowserContext();
  const page = await newTab(context);
  await page.setViewport(viewport);
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme }]);
  await signIn(page, url);
  return { context, page };
}

/** Put first in <head> (see `withProbe`): logs every change to the attributes of <html>, with the value it replaced, into sessionStorage. */
const PROBE = `
  sessionStorage.setItem('__attrLog', '[]');
  new MutationObserver((records) => {
    const log = JSON.parse(sessionStorage.getItem('__attrLog'));
    for (const record of records) log.push({ name: record.attributeName, was: record.oldValue, now: document.documentElement.getAttribute(record.attributeName) });
    sessionStorage.setItem('__attrLog', JSON.stringify(log));
  }).observe(document.documentElement, { attributes: true, attributeOldValue: true });
`;
const MODULE_SCRIPT = /<script type="module"[^>]*><\/script>\s*/;
const BOOT_SCRIPT = /<script>(?!\s*sessionStorage)[\s\S]*?<\/script>\s*/;
const withProbe = (html) => html.replace('<head>', `<head><script>${PROBE}</script>`);
const attributeLog = (page) => page.evaluate(() => JSON.parse(sessionStorage.getItem('__attrLog') ?? '[]').filter((c) => /^data-(theme|skin|density|text-scale)$/.test(c.name)));
/** What the page looks like now: the attributes, the canvas colour, the root font size, and whether React has mounted anything. */
const painted = (page) =>
  page.bringToFront().then(() => page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const root = document.documentElement;
    return {
      theme: root.dataset.theme ?? null,
      skin: root.dataset.skin ?? null,
      density: root.dataset.density ?? null,
      textScale: root.dataset.textScale ?? null,
      canvas: getComputedStyle(document.body).backgroundColor,
      fontSize: parseFloat(getComputedStyle(root).fontSize),
      appMounted: document.querySelector('#root')?.children.length > 0,
    };
  }));

/** Loads `route` with `html` served in place of the real document (everything else is the real server's), then runs `then`. */
async function loadServed(page, url, route, html, then) {
  const handler = (request) => {
    if (request.isNavigationRequest() && request.url() === `${url}${route}`) request.respond({ status: 200, contentType: 'text/html', body: html });
    else request.continue();
  };
  await page.setRequestInterception(true);
  page.on('request', handler);
  try {
    await page.goto(`${url}${route}`, { waitUntil: 'networkidle0' });
    return await then();
  } finally {
    page.off('request', handler);
    await page.setRequestInterception(false);
  }
}

const attrs = (page) => page.evaluate(() => ({ theme: document.documentElement.dataset.theme ?? null, skin: document.documentElement.dataset.skin ?? null, density: document.documentElement.dataset.density ?? null, textScale: document.documentElement.dataset.textScale ?? null }));
const stored = (page) => page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), KEY);
const server = (page) => page.evaluate(async (route) => (await (await fetch(route)).json()).appearance, ROUTE);
const canvas = (page) => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const rootSize = (page) => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Waits until `fn(arg)`, run in the page, is truthy; polls the page every 50 ms (bounded by `timeout`), and survives navigations.
 * (`page.waitForFunction` does not run while a navigation is held open by a stalled script, which is what some checks do on purpose.)
 */
async function until(page, fn, arg, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.evaluate(fn, arg).catch(() => false)) return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return false;
}

/** Clicks the radio `label` of the group headed `group` on Settings › Appearance, with a real pointer click. */
async function choose(page, group, label) {
  await page.bringToFront();
  const handle = await page.evaluateHandle(
    (group, label) => {
      const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent === group);
      const radios = [...document.querySelectorAll(`[role="radiogroup"][aria-labelledby="${heading.id}"] [role="radio"]`)];
      return radios.find((r) => r.textContent.trim().startsWith(label));
    },
    group,
    label,
  );
  await handle.asElement().click();
}

const checked = (page, group) =>
  page.evaluate((group) => {
    const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent === group);
    const radio = document.querySelector(`[role="radiogroup"][aria-labelledby="${heading.id}"] [role="radio"][aria-checked="true"]`);
    return (radio?.querySelector('.skin-card__name') ?? radio)?.textContent.trim();
  }, group);

const savedStatus = (page) => page.evaluate(() => document.querySelector('main [role="status"]')?.textContent ?? '');
const waitSaved = (page) => until(page, () => /Saved on this device and in Caduceus/.test(document.querySelector('main [role="status"]')?.textContent ?? ''));

export async function checkAppearance({ browser, page: tabPage }, { url, shots }) {
  const problems = [];
  const steps = [];
  const check = (label, ok, detail) => {
    steps.push(label);
    if (!ok) problems.push(detail === undefined ? label : `${label}: ${JSON.stringify(detail)}`);
  };
  const contexts = [];
  const errors = [];
  const watch = (page, label) => {
    page.on('console', (message) => message.type() === 'error' && errors.push(`${label}: ${message.text()}`));
    page.on('pageerror', (error) => errors.push(`${label} pageerror: ${error.message}`));
  };

  try {
    // ------------------------------------------------------------------ no flash: the first painted frame
    {
      const page = tabPage;
      watch(page, 'flash');
      await page.setViewport(DESKTOP);
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
      await signIn(page, url);
      const choice = { appearance: { theme: 'light', skin: 'hermes', density: 'compact', textSize: 'lg' }, pending: true };
      await page.evaluate((key, raw) => localStorage.setItem(key, raw), KEY, JSON.stringify(choice));
      const cookies = (await page.cookies(url)).map((c) => `${c.name}=${c.value}`).join('; ');
      const original = await (await fetch(`${url}/settings/appearance`, { headers: { cookie: cookies } })).text();
      check('the page ships the inline script first and the module bundle after it', original.search(BOOT_SCRIPT) > -1 && original.search(BOOT_SCRIPT) < original.search(MODULE_SCRIPT), original.slice(0, 120));

      // Without the bundle, nothing hydrates: what shows is what the document and the inline script made, the first painted frame.
      const first = await loadServed(page, url, '/settings/appearance', withProbe(original.replace(MODULE_SCRIPT, '')), () => painted(page));
      if (shots) await loadServed(page, url, '/settings/appearance', withProbe(original.replace(MODULE_SCRIPT, '')), () => page.screenshot({ path: `${shots}/first-paint-before-hydration-light-hermes.png` }));
      check('the first painted frame, with the bundle not loaded: the app has not mounted', first.appMounted === false, first);
      check('...it already carries the stored appearance although the OS is dark: light, hermes, compact, large', same([first.theme, first.skin, first.density, first.textScale], ['light', 'hermes', 'compact', 'lg']), first);
      check('...it is on the light Hermes Teal canvas (#fbf6ee), not the OS-dark canvas', first.canvas === 'rgb(251, 246, 238)', first.canvas);
      check('...it has the large text size (112.5% of 16px)', first.fontSize === 18, first.fontSize);

      // With the bundle: the attributes were set once, before anything else, and hydration never changes them to another value.
      const { log, after } = await loadServed(page, url, '/settings/appearance', withProbe(original), async () => {
        await page.waitForSelector('h1');
        return { log: await attributeLog(page), after: await painted(page) };
      });
      check('with the bundle, the four attributes were set once first (nothing before them) and never changed to another value', log.filter((c) => c.was === null).length === 4 && log.every((c) => c.was === null || c.was === c.now), log);
      check('...and after hydration the page is still light, hermes, compact, large', same([after.theme, after.skin, after.density, after.textScale], ['light', 'hermes', 'compact', 'lg']) && after.appMounted === true, after);

      // The control: the same page without the inline script flashes the OS's dark theme, so this check can fail.
      const stripped = original.replace(BOOT_SCRIPT, '');
      check('control: the page served without the inline script really lacks it', stripped !== original && !stripped.includes('caduceus.appearance'));
      const wrong = await loadServed(page, url, '/settings/appearance', withProbe(stripped.replace(MODULE_SCRIPT, '')), () => painted(page));
      check('control: without the script the first painted frame has no attributes and the OS-dark canvas (a flash of the wrong theme)', wrong.theme === null && wrong.skin === null && wrong.canvas === 'rgb(14, 16, 20)', wrong);

      await page.evaluate((key) => localStorage.removeItem(key), KEY);
      await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    }

    // ------------------------------------------------------------------ choose, persist, sign out and in, lose storage, lose the cookie
    const { context: phoneCtx, page: phone } = await newDevice(browser, url, DESKTOP, 'light');
    contexts.push(phoneCtx);
    watch(phone, 'device A');
    await phone.goto(`${url}/settings/appearance`, { waitUntil: 'networkidle0' });
    await phone.waitForSelector('h1');
    check('a new device: nothing stored locally or in Caduceus, the defaults show', (await stored(phone)) === null && (await server(phone)) === null && same(await attrs(phone), { theme: null, skin: null, density: null, textScale: null }));
    check('the controls start on the defaults: System, Nous, Auto, Default', same([await checked(phone, 'Theme'), await checked(phone, 'Skin'), await checked(phone, 'Density'), await checked(phone, 'Text size')], ['System', 'Nous', 'Auto', 'Default']));

    await choose(phone, 'Theme', 'Dark');
    check('choosing Dark takes effect in the same frame', (await attrs(phone)).theme === 'dark' && (await canvas(phone)) === 'rgb(14, 16, 20)');
    await choose(phone, 'Skin', 'Gold');
    await choose(phone, 'Density', 'Compact');
    await choose(phone, 'Text size', 'Large');
    const chosen = { theme: 'dark', skin: 'gold', density: 'compact', textSize: 'lg' };
    check('all four choices are on <html>', same(await attrs(phone), { theme: 'dark', skin: 'gold', density: 'compact', textScale: 'lg' }), await attrs(phone));
    check('the large text size scales the root to 18px', (await rootSize(phone)) === 18);
    check('the controls show the choices', same([await checked(phone, 'Theme'), await checked(phone, 'Skin'), await checked(phone, 'Density'), await checked(phone, 'Text size')], ['Dark', 'Gold', 'Compact', 'Large']));
    check('the choice was saved to Caduceus and the page says so', (await waitSaved(phone)) && same(await server(phone), chosen), await server(phone));
    check('the local copy holds the choices and is no longer pending', same(await stored(phone), { appearance: chosen, pending: false }), await stored(phone));
    if (shots) await phone.screenshot({ path: `${shots}/appearance-dark-gold-compact-large-1440.png` });

    await phone.reload({ waitUntil: 'networkidle0' });
    check('after a reload the appearance is still on <html>', same(await attrs(phone), { theme: 'dark', skin: 'gold', density: 'compact', textScale: 'lg' }));

    // Sign out and in again: a new session on the same device.
    await phone.evaluate(() => fetch('/_caduceus/api/auth/sign-out', { method: 'POST' }));
    await phone.goto(`${url}/sign-in`, { waitUntil: 'networkidle0' });
    check('the sign-in screen, before anyone is signed in, already wears the device appearance', same(await attrs(phone), { theme: 'dark', skin: 'gold', density: 'compact', textScale: 'lg' }));
    if (shots) await phone.screenshot({ path: `${shots}/sign-in-dark-gold-1440.png` });
    await phone.evaluate((password) => fetch('/_caduceus/api/auth/sign-in', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) }), PASSWORD);
    await phone.goto(`${url}/settings/appearance`, { waitUntil: 'networkidle0' });
    check('after signing out and in, Caduceus still has this device’s choices', same(await server(phone), chosen) && same(await attrs(phone), { theme: 'dark', skin: 'gold', density: 'compact', textScale: 'lg' }));

    // The browser forgot localStorage (some browsers drop it after a while): Caduceus's record brings it back.
    await phone.evaluate((key) => localStorage.removeItem(key), KEY);
    await phone.reload({ waitUntil: 'networkidle0' });
    await until(phone, () => document.documentElement.dataset.skin === 'gold');
    check('with localStorage emptied, the app adopts what Caduceus stores for the device', same(await attrs(phone), { theme: 'dark', skin: 'gold', density: 'compact', textScale: 'lg' }) && same(await stored(phone), { appearance: chosen, pending: false }), { attrs: await attrs(phone), stored: await stored(phone) });

    // The browser forgot its device cookie: Caduceus sees a new device and is offered the local copy.
    const before = (await phone.cookies(url)).find((c) => c.name === 'caduceus_device');
    await phone.deleteCookie({ name: 'caduceus_device', url });
    await phone.reload({ waitUntil: 'networkidle0' });
    await until(phone, async (route) => (await (await fetch(route)).json()).appearance?.skin === 'gold', ROUTE);
    const after = (await phone.cookies(url)).find((c) => c.name === 'caduceus_device');
    check('without its device cookie the device gets a new id, and the local copy is saved under it', before && after && before.value !== after.value && same(await server(phone), chosen), { before: before?.value, after: after?.value, server: await server(phone) });
    check('the device cookie is HttpOnly, SameSite=Strict, long-lived', after.httpOnly && after.sameSite === 'Strict' && after.expires - Date.now() / 1000 > 300 * 86400, after);

    // ------------------------------------------------------------------ the radio groups by keyboard
    {
      await phone.bringToFront();
      await phone.goto(`${url}/settings/appearance`, { waitUntil: 'networkidle0' });
      await phone.waitForSelector('h1');
      const groupState = () =>
        phone.evaluate(() => {
          const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent === 'Theme');
          const radios = [...document.querySelectorAll(`[role="radiogroup"][aria-labelledby="${heading.id}"] [role="radio"]`)];
          return { checked: radios.find((r) => r.getAttribute('aria-checked') === 'true')?.textContent.trim(), focused: document.activeElement?.textContent.trim(), tabStops: radios.filter((r) => r.tabIndex === 0).length };
        });
      await phone.evaluate(() => {
        const heading = [...document.querySelectorAll('h2')].find((h) => h.textContent === 'Theme');
        document.querySelector(`[role="radiogroup"][aria-labelledby="${heading.id}"] [role="radio"][aria-checked="true"]`).focus();
      });
      check('keyboard: a radio group is one stop in the tab order (the checked radio)', same(await groupState(), { checked: 'Dark', focused: 'Dark', tabStops: 1 }), await groupState());
      await phone.keyboard.press('ArrowRight');
      check('keyboard: ArrowRight checks the next radio and moves focus to it', same(await groupState(), { checked: 'System', focused: 'System', tabStops: 1 }), await groupState());
      await phone.keyboard.press('ArrowRight');
      check('keyboard: it wraps from the last radio to the first', (await groupState()).checked === 'Light');
      await phone.keyboard.press('End');
      await phone.keyboard.press('ArrowLeft');
      check('keyboard: End jumps to the last, ArrowLeft goes back one', (await groupState()).checked === 'Dark');
      await phone.keyboard.press('Home');
      check('keyboard: Home jumps to the first, and the choice is applied to the page', (await groupState()).checked === 'Light' && (await attrs(phone)).theme === 'light');
      await phone.keyboard.press('Tab');
      const afterTab = await phone.evaluate(() => document.activeElement?.getAttribute('role') ?? document.activeElement?.tagName);
      check('keyboard: Tab leaves the group for the next control (a skin card)', afterTab === 'radio' && (await phone.evaluate(() => document.activeElement?.classList.contains('skin-card'))), afterTab);
      await choose(phone, 'Theme', 'Dark');
    }

    // ------------------------------------------------------------------ a second device
    const { context: laptopCtx, page: laptop } = await newDevice(browser, url, PHONE, 'dark');
    contexts.push(laptopCtx);
    watch(laptop, 'device B');
    await laptop.goto(`${url}/settings/appearance`, { waitUntil: 'networkidle0' });
    await laptop.waitForSelector('h1');
    check('device B: signed in as the same owner, it starts from the defaults, not device A’s choices', (await server(laptop)) === null && same(await attrs(laptop), { theme: null, skin: null, density: null, textScale: null }), { server: await server(laptop), attrs: await attrs(laptop) });
    await choose(laptop, 'Theme', 'Light');
    await choose(laptop, 'Skin', 'Mono');
    await choose(laptop, 'Density', 'Comfortable');
    await choose(laptop, 'Text size', 'Small');
    const chosenB = { theme: 'light', skin: 'mono', density: 'comfortable', textSize: 'sm' };
    check('device B saved its own choices', (await waitSaved(laptop)) && same(await server(laptop), chosenB), await server(laptop));
    check('device A is untouched by it: Caduceus and the page still say dark, gold, compact, large', same(await server(phone), chosen) && same(await attrs(phone), { theme: 'dark', skin: 'gold', density: 'compact', textScale: 'lg' }));
    await laptop.reload({ waitUntil: 'networkidle0' });
    await phone.reload({ waitUntil: 'networkidle0' });
    check('after both reload, each device shows its own', same(await attrs(laptop), { theme: 'light', skin: 'mono', density: 'comfortable', textScale: 'sm' }) && same(await attrs(phone), { theme: 'dark', skin: 'gold', density: 'compact', textScale: 'lg' }));
    check('small text scales the root to 15px', (await rootSize(laptop)) === 15);
    if (shots) await laptop.screenshot({ path: `${shots}/appearance-light-mono-comfortable-small-390.png`, fullPage: true });

    // ------------------------------------------------------------------ offline
    await laptop.setOfflineMode(true);
    await choose(laptop, 'Theme', 'Dark');
    check('offline, a choice still takes effect and the page says it is not saved to Caduceus yet', (await attrs(laptop)).theme === 'dark' && /as soon as it can be reached/.test(await savedStatus(laptop)) && (await stored(laptop)).pending === true, { attrs: await attrs(laptop), status: await savedStatus(laptop) });
    await laptop.setOfflineMode(false);
    await laptop.evaluate(() => window.dispatchEvent(new Event('online')));
    check('back online, it is saved to Caduceus on its own', (await waitSaved(laptop)) && (await server(laptop)).theme === 'dark', await server(laptop));

    // ------------------------------------------------------------------ the other tab of the same device follows
    const second = await newTab(laptopCtx);
    await second.setViewport(PHONE);
    await second.goto(`${url}/settings/appearance`, { waitUntil: 'networkidle0' });
    await choose(laptop, 'Skin', 'Verdant');
    await until(second, () => document.documentElement.dataset.skin === 'verdant');
    check('another tab of the same browser follows a change at once', (await attrs(second)).skin === 'verdant', await attrs(second));
    await second.close();

    // ------------------------------------------------------------------ reduced motion
    const motion = await newTab(laptopCtx);
    await motion.setViewport(DESKTOP);
    await motion.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await motion.goto(`${url}/home`, { waitUntil: 'networkidle0' });
    await motion.waitForSelector('h1');
    const animated = (page) =>
      page.evaluate(() => {
        // A busy button's spinner, a spinning glyph, a pulse and a skeleton, which the app shows in states a static page does not reach.
        const probe = document.createElement('div');
        probe.innerHTML = '<button class="btn"><span class="spinner" id="p1"></span></button><svg class="spin" id="p2"></svg><span class="pulse" id="p3"></span><span class="skel" id="p4"></span>';
        document.body.append(probe);
        const names = ['p1', 'p2', 'p3', 'p4'].map((id) => getComputedStyle(document.getElementById(id)).animationName);
        const pulse = getComputedStyle(document.getElementById('p3'), '::after').animationName;
        probe.remove();
        return { names, pulse };
      });
    check('reduced motion: spinner, spin, skeleton have no animation, and the pulse ring has none', same(await animated(motion), { names: ['none', 'none', 'none', 'none'], pulse: 'none' }), await animated(motion));
    await motion.keyboard.down('Meta');
    await motion.keyboard.press('k');
    await motion.keyboard.up('Meta');
    await motion.waitForSelector('.palette');
    const running = await motion.evaluate(() => document.getAnimations().filter((a) => a.effect.getComputedTiming().activeDuration > 0).map((a) => a.animationName ?? a.transitionProperty));
    check('reduced motion: opening the palette runs no animation that takes time', running.length === 0, running);
    await motion.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    check('control: without the preference the spinner and spin animate', same((await animated(motion)).names.slice(0, 2), ['hc-spin', 'hc-spin']), await animated(motion));
    await motion.close();

    // ------------------------------------------------------------------ density changes targets
    // A control's size is `min-block-size: max(--cd-control-h, --cd-target-min)`, so that is what is read (at the default text size, so rem is 16px).
    const density = async (page, value) => {
      await page.goto(`${url}/settings/appearance`, { waitUntil: 'networkidle0' });
      await choose(page, 'Text size', 'Default');
      await choose(page, 'Density', value);
      await page.goto(`${url}/settings/keyboard`, { waitUntil: 'networkidle0' });
      await page.waitForSelector('main .btn');
      const sizes = await page.evaluate(() => [...document.querySelectorAll('main .btn')].map((el) => parseFloat(getComputedStyle(el).minBlockSize)));
      return { min: Math.min(...sizes), max: Math.max(...sizes) };
    };
    const mouse = await newTab(laptopCtx);
    await mouse.setViewport(DESKTOP);
    const comfortableMouse = await density(mouse, 'Comfortable');
    const compactMouse = await density(mouse, 'Compact');
    check('with a mouse, Comfortable controls are 44px tall and Compact ones 32px', comfortableMouse.min === 44 && comfortableMouse.max === 44 && compactMouse.min === 32 && compactMouse.max === 32, { comfortableMouse, compactMouse });
    await mouse.close();
    const touch = await newTab(laptopCtx);
    await touch.setViewport(PHONE);
    const comfortableTouch = await density(touch, 'Comfortable');
    const compactTouch = await density(touch, 'Compact');
    check('on a touch screen, every density keeps controls at least 44px', comfortableTouch.min >= 44 && compactTouch.min >= 44, { comfortableTouch, compactTouch });
    await touch.close();

    // Going offline on purpose (the offline check) makes the browser report the failed requests it was told to fail.
    const unexpected = errors.filter((error) => !/ERR_INTERNET_DISCONNECTED/.test(error));
    check('no console errors on any device', unexpected.length === 0, unexpected);
  } finally {
    for (const context of contexts) await context.close().catch(() => {});
  }
  return { ok: problems.length === 0, problems, steps };
}
