// `npm run perf`: the performance budgets of the mobile spec §10, asserted with Lighthouse against the BUILT app on Today, the screen the app opens on (M0 #12, M8 #03).
// Tooling, not a test seam. It builds nothing itself (`npm run perf` builds the web app first), and it starts the same stack a
// browser meets: Caduceus on a free loopback port in front of the real `hermes serve` in a throwaway HERMES_HOME, with the owner
// signed in (the session cookie goes to Lighthouse as a header). Never touches ~/.hermes, :9119, :8787 or the gateway.
//
// Mobile profile: Lighthouse's own (Moto G Power, 4x CPU slowdown, simulated slow 4G), the mid-range Android of the spec.
//   - Initial JS of the shell and Today: the bytes the page fetched as scripts for the first load, transfer size. The server hands
//     out the gzip copies the build leaves beside every file, so this is the gzip size. Budget 170 KB (170 000 bytes).
//   - LCP <= 2.5 s and CLS <= 0.1 from a navigation run.
//   - INP <= 200 ms from a timespan run over real interactions (opening and closing the command palette, moving between tabs).
//     A navigation run cannot measure INP (nothing is pressed), hence the second run.
// Exits 1 listing every budget that was exceeded.
import { launch } from 'chrome-launcher';
import lighthouse, { startFlow, type Flags } from 'lighthouse';
import { chromium } from '@playwright/test';
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startCaduceusServer } from '../src/caduceus-server.ts';
import { launchTestHermes } from '../test/fixtures/real-hermes.ts';
import { ownerCookie } from '../test/fixtures/owner.ts';

const BUDGETS = { initialJsBytes: 170_000, lcpMs: 2_500, inpMs: 200, cls: 0.1 };

const hermes = await launchTestHermes();
await hermes.backend.ready();
const server = await startCaduceusServer({
  backend: hermes.backend,
  hermesRoot: hermes.home,
  webRoot: fileURLToPath(new URL('../../web/dist', import.meta.url)),
  hermesInstallDir: hermes.install.dir,
});
const chrome = await launch({ chromePath: chromium.executablePath(), chromeFlags: ['--headless=new', '--no-sandbox'] });
const problems: string[] = [];
try {
  const cookie = await ownerCookie(server.url);
  const landing = `${server.url.replace('127.0.0.1', 'localhost')}/today`;
  // Lighthouse's mobile defaults: formFactor mobile, simulated throttling (slow 4G, 4x CPU), mobile screen emulation.
  const flags: Flags = { port: chrome.port, logLevel: 'error', output: 'json', onlyCategories: ['performance'], formFactor: 'mobile', extraHeaders: { Cookie: cookie } };

  // 1. A navigation run: first load of Today, nothing cached, no service worker yet.
  const run = await lighthouse(landing, flags);
  const audits = run!.lhr.audits;
  if (run!.lhr.runtimeError) throw new Error(`Lighthouse: ${run!.lhr.runtimeError.message}`);
  // Lighthouse types an audit's details as an open union; the network-requests table is a list of `{ url, resourceType, transferSize }` rows.
  const table: { items: { url: string; resourceType?: string; transferSize: number }[] } = audits['network-requests'].details as never;
  // The scripts of the first load: everything the page fetched as a script up to `load`, lazy route chunks (Today's own) included.
  const scripts = table.items.filter((request) => request.resourceType === 'Script');
  const initialJsBytes = scripts.reduce((sum, request) => sum + request.transferSize, 0);
  const lcpMs = audits['largest-contentful-paint'].numericValue ?? NaN;
  const cls = audits['cumulative-layout-shift'].numericValue ?? NaN;
  const tbtMs = audits['total-blocking-time'].numericValue ?? NaN;
  console.log(`initial JS  ${(initialJsBytes / 1000).toFixed(1)} KB gzip over ${scripts.length} scripts  (budget ${BUDGETS.initialJsBytes / 1000} KB)`);
  console.log(`LCP         ${(lcpMs / 1000).toFixed(2)} s  (budget ${BUDGETS.lcpMs / 1000} s)`);
  console.log(`CLS         ${cls.toFixed(3)}  (budget ${BUDGETS.cls})`);
  console.log(`TBT         ${tbtMs.toFixed(0)} ms  (the lab stand-in for responsiveness during load; no budget of its own)`);
  if (!(initialJsBytes <= BUDGETS.initialJsBytes)) problems.push(`initial JS ${initialJsBytes} bytes > ${BUDGETS.initialJsBytes}`);
  if (!(lcpMs <= BUDGETS.lcpMs)) problems.push(`LCP ${lcpMs} ms > ${BUDGETS.lcpMs}`);
  if (!(cls <= BUDGETS.cls)) problems.push(`CLS ${cls} > ${BUDGETS.cls}`);

  // 2. A timespan run over interactions, for INP.
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}` });
  try {
    const page = await browser.newPage();
    await page.setCookie({ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1), url: server.url.replace('127.0.0.1', 'localhost') });
    await page.goto(landing, { waitUntil: 'load' });
    await page.waitForSelector('h1');
    const flow = await startFlow(page, { config: undefined, flags: { formFactor: 'mobile', onlyCategories: ['performance'] } });
    await flow.startTimespan();
    for (let round = 0; round < 3; round++) {
      await page.click('button[aria-label="Search and commands"], .appbar__search');
      await page.waitForSelector('.layer [data-panel]', { visible: true });
      await page.keyboard.press('Escape');
      await page.waitForSelector('.layer [data-panel]', { hidden: true });
      await page.click('nav[aria-label] a[href="/settings"], nav a[href="/more"], a[href="/more"]').catch(() => undefined);
      await page.waitForSelector('h1');
      await page.click('a[href="/today"]').catch(() => undefined);
      await page.waitForSelector('h1');
    }
    await flow.endTimespan();
    const result = await flow.createFlowResult();
    const inpAudit = result.steps[0].lhr.audits['interaction-to-next-paint'];
    const inp = inpAudit?.numericValue;
    if (inp !== undefined && inp > BUDGETS.inpMs) console.log(`INP detail: ${JSON.stringify(inpAudit.details)?.slice(0, 1200)}`);
    if (inp === undefined) problems.push('INP was not measured: the timespan saw no interaction');
    else {
      console.log(`INP         ${inp.toFixed(0)} ms  (budget ${BUDGETS.inpMs} ms)`);
      if (!(inp <= BUDGETS.inpMs)) problems.push(`INP ${inp} ms > ${BUDGETS.inpMs}`);
    }
    await page.close();
  } finally {
    await browser.disconnect();
  }
} catch (error) {
  problems.push(`the run failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  await chrome.kill();
  await server.close();
  await hermes.stop();
}
if (problems.length > 0) {
  console.error(`\nperf: over budget\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('\nperf: within every budget.');
fs.rmSync('/tmp/caduceus-perf-unused', { force: true });
