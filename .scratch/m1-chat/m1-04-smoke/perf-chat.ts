// Throwaway: Lighthouse's mobile profile on the 2,000-message session (M1 #04), against the smoke server of `serve.ts` (running on :9231).
//   npx tsx .scratch/m1-chat/m1-04-smoke/perf-chat.ts
// LCP / CLS / TBT from a navigation run of /chat/long-rich, INP from a timespan over real taps (Load earlier, Jump to latest, Copy link)
// with scrolling between them. The budgets are the M0 #12 ones (LCP 2.5 s, CLS 0.1, INP 200 ms).
import fs from 'node:fs';
import { launch } from 'chrome-launcher';
import lighthouse, { startFlow, type Flags } from 'lighthouse';
import { chromium } from '@playwright/test';
import puppeteer from 'puppeteer-core';

const cookie = fs.readFileSync('/tmp/caduceus-m1-04-cookie', 'utf8').trim();
const base = 'http://localhost:9231';
const chrome = await launch({ chromePath: chromium.executablePath(), chromeFlags: ['--headless=new', '--no-sandbox'] });
try {
  const flags: Flags = { port: chrome.port, logLevel: 'error', output: 'json', onlyCategories: ['performance'], formFactor: 'mobile', extraHeaders: { Cookie: cookie } };
  for (const [label, route] of [['2,000-message session, newest messages', '/chat/long-rich'], ['2,000-message session, opened at a message link', `/chat/long-rich?message=${JSON.parse(fs.readFileSync('/tmp/caduceus-m1-04-info.json', 'utf8')).promptRowIds[580]}`]] as const) {
    const run = await lighthouse(`${base}${route}`, flags);
    const audits = run!.lhr.audits;
    if (run!.lhr.runtimeError) throw new Error(run!.lhr.runtimeError.message);
    console.log(`${label}: LCP ${((audits['largest-contentful-paint'].numericValue ?? NaN) / 1000).toFixed(2)} s  CLS ${(audits['cumulative-layout-shift'].numericValue ?? NaN).toFixed(3)}  TBT ${(audits['total-blocking-time'].numericValue ?? NaN).toFixed(0)} ms  LCP element: ${JSON.stringify((audits['largest-contentful-paint-element']?.details as { items?: { items?: { node?: { snippet?: string } }[] }[] } | undefined)?.items?.[0]?.items?.[0]?.node?.snippet ?? '').slice(0, 80)}`);
  }
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${chrome.port}` });
  try {
    const page = await browser.newPage();
    await page.setCookie({ name: cookie.slice(0, cookie.indexOf('=')), value: cookie.slice(cookie.indexOf('=') + 1), url: base });
    await page.goto(`${base}/chat/long-rich`, { waitUntil: 'load' });
    await page.waitForSelector('.chat__item .rich');
    const flow = await startFlow(page, { config: undefined, flags: { formFactor: 'mobile', onlyCategories: ['performance'] } });
    await flow.startTimespan();
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 6; i++) await page.evaluate(() => window.scrollBy(0, -1500));
      await new Promise((resolve) => setTimeout(resolve, 600));
      // Taps are made where a finger would: on the control, scrolled into view (a click on a point that is off screen is not a tap).
      const tap = async (selector: string) => {
        const handle = await page.waitForSelector(selector, { visible: true });
        await handle!.evaluate((element) => element.scrollIntoView({ block: 'center' }));
        const box = await handle!.boundingBox();
        if (!box) throw new Error(`${selector} has no box`);
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      };
      await tap('.chat__user .rich__copy');
      await new Promise((resolve) => setTimeout(resolve, 300));
      const jump = await page.waitForSelector('.chat__jump', { visible: true });
      const at = await jump!.boundingBox();
      await page.mouse.click(at!.x + at!.width / 2, at!.y + at!.height / 2);
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    await flow.endTimespan();
    const result = await flow.createFlowResult();
    console.log(`INP ${result.steps[0].lhr.audits['interaction-to-next-paint']?.numericValue?.toFixed(0)} ms`);
    await page.close();
  } finally {
    await browser.disconnect();
  }
} finally {
  await chrome.kill();
}
