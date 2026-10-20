// Throwaway: the M0 #05 gates for a state that needs steps first (a sheet opened, text typed). `steps(page)` runs after the route has loaded.
import { measure, AXE_SOURCE } from '../../m0-foundation/m0-05-smoke/ui-gates.mjs';

export async function check(page, { url, route, width, height, touch, scheme = 'dark', steps, label }) {
  const errors = [];
  const onConsole = (m) => m.type() === 'error' && errors.push(m.text());
  const onPageError = (e) => errors.push(`pageerror: ${e.message}`);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);
  try {
    await page.goto('about:blank');
    await page.setViewport({ width, height, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch });
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: scheme === 'dark' ? 'light' : 'dark' }]);
    await page.goto(`${url}/icons/icon.svg`);
    await page.evaluate((raw) => localStorage.setItem('caduceus.appearance', raw), JSON.stringify({ appearance: { theme: scheme, skin: 'nous', density: 'auto', textSize: 'md' }, pending: true }));
    await page.goto(`${url}${route}`, { waitUntil: 'load' });
    await page.bringToFront();
    await page.waitForSelector('h1', { visible: true });
    await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 600));
    if (steps) await steps(page);
    await page.waitForFunction(() => document.getAnimations().filter((a) => Number.isFinite(a.effect?.getComputedTiming().iterations ?? 1)).every((a) => a.playState !== 'running'));
    await new Promise((r) => setTimeout(r, 400));
    const layout = await page.evaluate(measure, { coarse: touch });
    await page.evaluate(AXE_SOURCE);
    const axe = await page.evaluate(() => axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } }).then((r) => r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.slice(0, 4).map((n) => n.target.join(' ')) }))));
    const problems = [];
    if (layout.overflowX > 0) problems.push(`overflow ${layout.overflowX}px`);
    if (layout.outside.length) problems.push(`outside: ${layout.outside.join('; ')}`);
    if (layout.targets.length) problems.push(`targets: ${layout.targets.join('; ')}`);
    for (const v of axe.filter((v) => v.impact === 'serious' || v.impact === 'critical')) problems.push(`axe ${v.impact} ${v.id}: ${v.nodes.join(' | ')}`);
    if (errors.length) problems.push(`console: ${errors.join(' | ').slice(0, 300)}`);
    return { label, width, scheme, ok: problems.length === 0, problems, minor: axe.filter((v) => v.impact !== 'serious' && v.impact !== 'critical').map((v) => `${v.impact} ${v.id}`) };
  } finally {
    page.off('console', onConsole);
    page.off('pageerror', onPageError);
  }
}
