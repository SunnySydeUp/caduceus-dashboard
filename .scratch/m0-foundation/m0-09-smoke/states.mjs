// The M0 #09 browser checks (throwaway, not part of `npm test`): the app bar's dot and the banner in each state of the live
// gateway connection, at one viewport. Run from the eval tool's `browser`, with `serve.ts` (this folder) running:
//
//   const { checkStates } = await import('/…/.scratch/m0-foundation/m0-09-smoke/states.mjs');
//   const result = await tab.run(({ page }, args) => import(args.states).then((s) => s.checkStates(page, args)),
//     { args: { states, url: 'http://127.0.0.1:9190', pid, shots, width: 390, height: 844, touch: true }, timeout: 180_000 });
//
// `pid` is the node process of serve.ts: SIGUSR1 kills the private Hermes (the dot goes reconnecting with the attempt count
// and the reason, Home's active-session row is cleared, then everything comes back after the restart), SIGUSR2 stops Caduceus
// (offline, "Caduceus is not reachable"), and again starts it (connected again).
// (Waits poll on an interval: a hidden tab does not fire animation frames.)
// Per state it runs the layout, target and axe gates of `../m0-05-smoke/ui-gates.mjs` and saves a screenshot. Console errors
// count only while connected: a refused WebSocket handshake and a refused fetch are what the faults cause.
import fs from 'node:fs';
import { AXE_SOURCE, measure } from '../m0-05-smoke/ui-gates.mjs';

async function settled(page) {
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .filter((animation) => Number.isFinite(animation.effect?.getComputedTiming().iterations ?? 1))
      .every((animation) => animation.playState !== 'running'),
    { polling: 100 },
  );
}

/** What the page says right now about the connection. */
const readState = (page) =>
  page.evaluate(() => ({
    dot: document.querySelector('.appbar__conn .sr-only')?.textContent ?? null,
    visibleCount: document.querySelector('.appbar__conn-count')?.textContent ?? null,
    hover: document.querySelector('.appbar__conn')?.getAttribute('title') ?? null,
    banner: document.querySelector('.banner .banner__title')?.textContent ?? null,
    bannerBody: document.querySelector('.banner .banner__body')?.textContent ?? null,
    sessionsRow: [...document.querySelectorAll('.list-row__title')].map((el) => el.textContent).find((text) => /active session/.test(text)) ?? null,
  }));

/** Layout, targets and axe, as in ui-gates.mjs, for the page as it is now. */
async function gates(page, { touch }) {
  const layout = await page.evaluate(measure, { coarse: touch });
  await page.evaluate(AXE_SOURCE);
  const axe = await page.evaluate(() =>
    axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }).then((r) =>
      r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(' ')) })),
    ),
  );
  const problems = [];
  if (layout.overflowX > 0) problems.push(`horizontal overflow of ${layout.overflowX}px`);
  if (layout.outside.length) problems.push(`laid out outside the viewport: ${layout.outside.join('; ')}`);
  if (layout.targets.length) problems.push(`targets below ${touch ? 44 : 24}px: ${layout.targets.join('; ')}`);
  for (const v of axe.filter((v) => v.impact === 'serious' || v.impact === 'critical')) problems.push(`axe ${v.impact} ${v.id}: ${v.nodes.join(' | ')}`);
  return problems;
}

export async function checkStates(page, { url, pid, width, height, touch, shots }) {
  const consoleErrors = [];
  const onConsole = (message) => message.type() === 'error' && consoleErrors.push(message.text());
  page.on('console', onConsole);
  page.on('pageerror', (error) => consoleErrors.push(`pageerror: ${error.message}`));
  const problems = [];
  const states = {};
  const expect = (ok, what) => ok || problems.push(what);
  const shot = (name) => {
    fs.mkdirSync(shots, { recursive: true });
    return page.screenshot({ path: `${shots}/dot-${name}-${width}.png` });
  };
  try {
    await page.goto('about:blank');
    await page.setViewport({ width, height, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch });
    await page.goto(`${url}/home`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('h1', { visible: true });

    // 1. Connected: the dot says so, the banner is absent and Home counts the active sessions.
    await page.waitForFunction(() => document.querySelector('.appbar__conn .sr-only')?.textContent === 'Connection: Connected', { timeout: 20_000, polling: 100 });
    await page.waitForFunction(() => [...document.querySelectorAll('.list-row__title')].some((el) => /active session/.test(el.textContent)), { timeout: 20_000, polling: 100 });
    await settled(page);
    states.connected = await readState(page);
    expect(states.connected.banner === null, `connected, but a banner shows: ${states.connected.banner}`);
    expect(states.connected.sessionsRow === '0 active sessions', `connected: expected "0 active sessions", got ${states.connected.sessionsRow}`);
    problems.push(...(await gates(page, { touch })).map((p) => `connected: ${p}`));
    if (consoleErrors.length) problems.push(`console errors while connected: ${consoleErrors.join(' | ').slice(0, 300)}`);
    await shot('connected');

    // 2. The private Hermes is killed: reconnecting, with the attempt count and why; Home's live row is cleared.
    process.kill(pid, 'SIGUSR1');
    await page.waitForSelector('.appbar__conn-count', { visible: true, timeout: 20_000 });
    await page.waitForFunction(() => /Hermes is restarting/.test(document.querySelector('.appbar__conn .sr-only')?.textContent ?? ''), { timeout: 20_000, polling: 100 });
    await settled(page);
    states.reconnecting = await readState(page);
    expect(/^Connection: Reconnecting, attempt \d+\. Hermes is restarting\.$/.test(states.reconnecting.dot), `reconnecting: dot says ${states.reconnecting.dot}`);
    expect(states.reconnecting.visibleCount === String(Number(states.reconnecting.visibleCount)), `reconnecting: the count is ${states.reconnecting.visibleCount}`);
    expect(states.reconnecting.banner === 'Reconnecting to Hermes' && /^Attempt \d+\. Hermes is restarting\./.test(states.reconnecting.bannerBody ?? ''), `reconnecting: banner is ${states.reconnecting.banner} / ${states.reconnecting.bannerBody}`);
    expect(states.reconnecting.sessionsRow === null, `reconnecting: Home still shows ${states.reconnecting.sessionsRow}`);
    problems.push(...(await gates(page, { touch })).map((p) => `reconnecting: ${p}`));
    await shot('reconnecting');
    // The count goes up while Hermes stays down (the restart delay of serve.ts is 10 s).
    const first = Number(states.reconnecting.visibleCount);
    await page.waitForFunction((n) => Number(document.querySelector('.appbar__conn-count')?.textContent) > n, { timeout: 15_000, polling: 100 }, first).catch(() => problems.push(`reconnecting: the attempt count stayed at ${first}`));

    // 3. Hermes is back: connected, the banner gone, the row back (a Hermes restart reads live data afresh).
    await page.waitForFunction(() => document.querySelector('.appbar__conn .sr-only')?.textContent === 'Connection: Connected', { timeout: 60_000, polling: 100 });
    await page.waitForFunction(() => [...document.querySelectorAll('.list-row__title')].some((el) => /active session/.test(el.textContent)), { timeout: 20_000, polling: 100 });
    states.recovered = await readState(page);
    expect(states.recovered.banner === null, `recovered, but a banner shows: ${states.recovered.banner}`);
    expect(states.recovered.sessionsRow === '0 active sessions', `recovered: expected "0 active sessions", got ${states.recovered.sessionsRow}`);

    // 4. Caduceus stops: offline, and why; its page stays up.
    process.kill(pid, 'SIGUSR2');
    await page.waitForFunction(() => /Offline/.test(document.querySelector('.appbar__conn .sr-only')?.textContent ?? ''), { timeout: 30_000, polling: 100 });
    await settled(page);
    states.offline = await readState(page);
    expect(states.offline.dot === 'Connection: Offline. Caduceus is not reachable.', `offline: dot says ${states.offline.dot}`);
    expect(states.offline.banner === 'Caduceus is not reachable', `offline: banner is ${states.offline.banner}`);
    expect(states.offline.sessionsRow === null, `offline: Home still shows ${states.offline.sessionsRow}`);
    problems.push(...(await gates(page, { touch })).map((p) => `offline: ${p}`));
    await shot('offline');

    // 5. Caduceus is back: connected again, by itself.
    process.kill(pid, 'SIGUSR2');
    await page.waitForFunction(() => document.querySelector('.appbar__conn .sr-only')?.textContent === 'Connection: Connected', { timeout: 60_000, polling: 100 });
    await page.waitForFunction(() => [...document.querySelectorAll('.list-row__title')].some((el) => /active session/.test(el.textContent)), { timeout: 20_000, polling: 100 });
    states.back = await readState(page);
    expect(states.back.banner === null, `back: a banner shows: ${states.back.banner}`);
    return { ok: problems.length === 0, width, problems, states };
  } finally {
    page.off('console', onConsole);
  }
}
