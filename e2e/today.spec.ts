import { expect, test } from '@playwright/test';
import { fakeLaunch } from '../server/test/fixtures/fake-hermes.ts';

/** Where the harness's fake Hermes records its launches (set by playwright.config.ts). */
const STATE_DIR = process.env.FAKE_HERMES_STATE_DIR!;

/** The crew the fake Hermes lists: Today shows one row for each profile. */
const CREW = ['default', 'coder', 'librarian'];

test('the app opens on Today, with the crew of profiles from this Mac', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveURL(/\/today$/);
  await expect(page.getByRole('heading', { name: 'Today', exact: true })).toBeVisible();
  for (const name of CREW) await expect(page.getByText(name, { exact: true }).first()).toBeVisible();
});

test('Today says Hermes is being reached again instead of stale facts, then reads them again once Hermes is back', async ({ page }) => {
  // The page redials Hermes on a full-jitter ladder (a random 0-0.3 s, 0-0.6 s, ... 0-4.8 s). An unlucky draw puts the first dial
  // after Hermes's return more than the 5 s expect timeout away. Math.random is only used for that jitter, so a fixed draw makes the
  // dials land at 0.15, 0.45, 1.05, 2.25 s: always one shortly after Hermes is back (1.5 s restart delay plus launch).
  await page.addInitScript(() => {
    Math.random = () => 0.5;
  });
  await page.goto('/');
  await expect(page.getByText('librarian', { exact: true }).first()).toBeVisible();

  process.kill(fakeLaunch(STATE_DIR).pid, 'SIGKILL');

  await expect(page.getByText('Reconnecting to Hermes')).toBeVisible();
  // The banner goes once the page has Hermes again, and the crew is read from the new backend.
  await expect(page.getByText('Reconnecting to Hermes')).toBeHidden();
  await expect(page.getByText('librarian', { exact: true }).first()).toBeVisible();
});

test('the launch secret never reaches the page, browser storage or any response the browser receives', async ({ page, context }) => {
  // Intercept every response and read its full body before the page gets it, so no body can be missed.
  const received: string[] = [];
  await page.route('**/*', async (route) => {
    // The Inbox's stream (M2) never ends, so its body cannot be read whole before the page gets it. What it says comes from Hermes through the observer connection, whose every frame has the secret replaced (`backend.redact`) like the browser's own gateway frames.
    if (route.request().url().endsWith('/_caduceus/api/inbox/stream')) return route.continue();
    const response = await route.fetch();
    const body = await response.text();
    received.push(`${JSON.stringify(response.headers())}\n${body}`);
    await route.fulfill({ response, body });
  });

  await page.goto('/');
  await expect(page.getByText('librarian', { exact: true }).first()).toBeVisible();
  // A full load of a client-side route (not `/`): the server answers it with the app shell.
  await page.goto('/notices');
  await expect(page.getByRole('heading', { name: 'Notices', exact: true })).toBeVisible();
  // An upstream endpoint that echoes the secret, fetched by the page itself.
  await page.evaluate(() => fetch('/api/__fake/leak').then((res) => res.text()));
  const { token } = fakeLaunch(STATE_DIR);

  const pageAndStorage = await page.evaluate(
    () => document.documentElement.outerHTML + JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }),
  );
  const cookies = JSON.stringify(await context.cookies());

  expect(received.some((r) => r.includes('[redacted]'))).toBe(true);
  expect([...received, pageAndStorage, cookies].filter((seen) => seen.includes(token))).toEqual([]);
});
