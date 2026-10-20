# 12: Installable PWA and offline shell

**What to build:** Caduceus can be installed as an app.

**Manifest:**
- a stable id;
- icons, including maskable ones;
- a theme colour that follows the chosen skin;
- shortcuts for Home and Health.

**Service worker:**
- precaches the shell;
- offline, shows the last Home snapshot marked "as of <time>", with write actions disabled;
- announces new versions with an "Update available" prompt.

**Install prompts:**
- Chromium browsers get an Install button in Settings and on first-run Home.
- iOS gets an "Add to Home Screen" guide, shown after a meaningful action. Dismissing it is remembered.

The service worker never caches auth responses, revealed secrets or Caduceus sign-in traffic.

The performance budget is asserted from here on.

**Blocked by:**
- 05 (adaptive app shell, module registry, profile scope and quality gates)
- 07 (appearance settings per device): the theme colour follows the skin.

**Status:** resolved

- [x] Installability passes on localhost, and the manifest id is stable across builds.
- [x] An offline reload shows the shell and the last Home snapshot with its "as of" time. Writes are disabled with a clear reason (test).
- [x] The service worker never caches auth, secret-reveal or Caduceus sign-in responses (test).
- [x] Update flow: a new build shows "Update available", and accepting it applies the new version on reload.
- [x] The Chromium install button and the iOS guide behave as specified, and dismissal is remembered per device.
- [x] Budgets are asserted by Lighthouse CI on Home: initial JS for the shell and Home ≤ 170 KB gzip, LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1 (mid-range mobile profile).

## Comments

**2026-10-07: resolved (TDD at the HTTP and pure-module seams; the worker, the UI, installability, offline and the update flow by browser smoke; the budgets by `npm run perf`).**

- **What was built.**
  - **Server** (`server/src/web-app.ts`, `caduceus-server.ts`, `auth-routes.ts`): the manifest, `/sw.js` (`Service-Worker-Allowed: /`), `/index.html` and `/icons/*` are public (a browser fetches the manifest and the worker without cookies, and a sign-in redirect would fail the worker's update check); `Cache-Control: no-cache` on everything but `/assets/*`, which is `public, max-age=31536000, immutable`; a missing `/assets/*` file is a 404, not the shell; the build's `.br`/`.gz` copies are served to browsers that take them (`precompressed`); **every answer under `/_caduceus/*` and `/api/*`, refusals included, carries `Cache-Control: no-store`** (it wraps the gate).
  - **Build** (`web/pwa/`): `manifest.ts`, `precache.ts`, `vite-plugin.ts` (writes `manifest.webmanifest`, bundles `web/src/sw/service-worker.ts` as `sw.js` with the precache list and the build's version injected, preloads the lazy shell and Home chunks from `index.html`, leaves `.gz`/`.br` copies), `render-icons.mjs` (draws `web/public/icons/*`: any 192/512 + SVG, maskable 192/512, apple-touch-icon).
  - **Worker** (`web/src/sw/cache-rules.ts` pure + `service-worker.ts`): precache the whole build into a cache named for the build; cache-first for those files; page loads network-first with the cached shell as the fallback (4 s patience); everything else untouched. A new worker waits; `skip-waiting` on accept.
  - **Page**: `pwa.ts` (register on `load`, look for a new build on visibility/online, `applyUpdate`), `shell/pwa-banners.ts` ("Update available"; the iOS invitation), `home-snapshot.ts` + `shell/home-snapshot-store.ts` + Home (snapshot view marked "as of", `NothingKept` when none), `offline.ts` + `shell/WriteButton.tsx` (writes off with the reason: Home sign out, Health fixes, every Security change), `install-prompt.ts` + `shell/install.ts` + `InstallCard` (first-run Home) + Settings › Install + `InstallGuide` (iOS sheet), `shell/theme-color.ts`.
- **Tests** (50 new; red first, and every one that passed at once was mutation-checked):
  - `server/test/web-app-serving.test.ts` (6, seam: Caduceus HTTP in front of real Hermes): manifest public with the manifest type and revalidation; `/sw.js` public, JavaScript, `Service-Worker-Allowed: /`, `no-cache`; hashed assets immutable and the shell never kept; a gone asset is a 404 while `/workspace/files/src/main.ts` is a route; compressed copies served with `Vary`; **sign-in, session, devices, step-up options, preferences, health, every Hermes answer, a policy refusal and a really revealed secret (`PUT /api/env`, then `POST /api/env/reveal` with its T3 confirmation) all carry `no-store`**.
  - `web/test/sw-cache-rules.test.ts` (6, pure): sign-in, session, passkey, step-up, secret-reveal and every Hermes request go to the network, even as a page load and even if a precache list names them; precached files from the cache and every app route the shell; non-GET, other origins, `/sw.js`, a gone asset left alone; `isStorable` (redirect to sign-in, `no-store`, `private`, non-200 are not kept); cache names per build and only the worker's own are deleted.
  - `web/test/pwa-precache.test.ts` (4): which files are the shell; the version is order-independent and moves with any content (same length), path or file list, and not with maps, `.gz`, or `sw.js`.
  - `web/test/pwa-manifest.test.ts` (4): `id` `/` pinned; 192/512 `any` and a maskable 512, each a file of the declared type and pixel size; Home and Health shortcuts equal the registry's paths; colours equal `--cd-bg-canvas` of Nous light read from `tokens.css` by the contrast engine.
  - `web/test/offline.test.ts` (4): the write gate and its two reasons. `web/test/home-snapshot.test.ts` (13): what is kept (no causes, paths or readings), incomplete Homes never replace a whole one, tolerant reading, "as of" on the device's own clock and zone, which view shows. `web/test/install-prompt.test.ts` (13): Chromium button/card, iOS guide after an action and never again once dismissed, platform detection (iPadOS as a Mac), memory parsing.
  - **Mutation checks** (each failed the named tests): serving headers (cache control, `/assets` 404, precompression, `Service-Worker-Allowed`); cache rules (method, origin, never-kept prefixes, app-route test, navigate test); precache (`sw.js`, maps, hashing of bytes and paths, sort); snapshot (state/severity/count/`takenAt` validation, completeness, view choice, `newest`, "as of" day and zone); install (platform tests, memory, dismissal, installed). Two survivors found weak assertions (`takenAt` = `1e999`, a non-integer count; the `navigate` check) and the tests were strengthened.
- **Browser smoke** (Chromium over CDP on `http://localhost:9212`, real Hermes 0.21.4 in a temp `HERMES_HOME`; `.scratch/m0-foundation/m0-12-smoke/serve.ts` + screenshots there):
  - **Installability:** `Page.getInstallabilityErrors` is empty, the manifest has no errors, app id `http://localhost:9212/`; the worker controls the page after the first load.
  - **Offline reload** (CDP `Network.emulateNetworkConditions` offline, and the emulated `navigator.onLine = false`): the shell opens from the worker and Home shows "Showing Home as of 18:34" with the chips and Hermes facts, the reason (Caduceus not reachable / this device has no network connection), and Sign out disabled with the same reason as its tooltip and accessible description. Back online it is live again (reload).
  - **Update flow:** with the build changed (Home's subtitle) and built again, the open page raised "Update available" with both caches present (`caduceus-shell-<old>`, `-<new>`), "Update now" reloaded into the new subtitle, and only the new cache remained. (The change was reverted.)
  - **Install:** headless Chromium really fires `beforeinstallprompt`: the Home card appeared, "Not now" hid it for good across reload, and Settings › Install kept the button. With an iPhone UA and the event blocked: nothing on first load, the guide banner after choosing an appearance, "Show me how" opened the sheet, "Got it" kept it dismissed after reload.
  - **Theme colour:** all 12 skin × theme combinations: the one `<meta name="theme-color">` equals the painted canvas (only Hermes Teal differs from Nous, as `tokens.css` has it); `system` follows the emulated OS scheme live.
  - **Gates** (`m0-05-smoke/ui-gates.mjs`; 390 / 320 / 820 / 1440, dark and light, Nous): `/home`, `/settings/install`, `/observe/health`, `/system/security` and the offline snapshot Home at all four widths: no overflow, targets at least 44/24 px, axe WCAG 2.2 AA + best practice clean of serious/critical, no console errors (offline: only the browser's own "no network" lines). Not re-run: every skin.
- **Budgets** (`npm run perf`, Lighthouse 13 mobile profile, Moto G Power, 4x CPU, slow 4G; Home in front of real Hermes): final run **initial JS 120.4 KB gzip** over 8 scripts (budget 170), **LCP 2.21 s** (2.5), **CLS 0.000** (0.1), **INP 100 ms** (200; a timespan over opening/closing the palette and moving between tabs; navigation runs cannot measure INP). The first runs were over budget and were fixed, not relaxed: LCP 2.62 s because the shell and Home chunks were fetched only after the entry had run: the build now preloads them from `index.html` (2.2 to 2.3 s); INP 350 ms in the first run was that lazy loading too (89 to 100 ms after). The server did not compress, so the 170 KB gzip budget was not what a phone downloaded: the build leaves `.gz`/`.br` copies and the server serves them.
- **Verification:** `npm test`: 324 pass, 1 opt-in skipped (50 new); both typechecks clean; `npm run lint:ui` clean; `npm run test:e2e`: 6 pass; `npm run perf`: within every budget. The throwaway server was stopped; no process or temp home is left.
- **Deviations:**
  - **`vite-plugin-pwa` is not used** (architecture §7 named it): a ~100-line plugin builds the worker, because the caching rules are a pure tested module and a worker with no workbox needs nothing else (M2 #03 adds push handlers to the same file).
  - **Theme colour:** the page sets `<meta name="theme-color">` from the canvas it paints (so it follows skin, theme and OS), and the manifest carries the default canvas (Nous light), per design-system §4.1. The manifest is static, so an installed app's splash uses the default.
  - **Manifest shortcuts** are Home and Health (the ticket), not New chat / Inbox / New task (mobile spec §6): those screens do not exist yet.
  - **The Home snapshot is page-side (`localStorage`), not cached API answers:** the worker stores no answer from Caduceus or Hermes at all, which makes "never caches auth, secrets or sign-in" true by construction. The snapshot holds only what Home shows and is cleared by sign-out and on the sign-in screen.
  - **Appearance changes stay enabled offline** (kept locally, sent later, as M0 #07 built them); Rename / Change password only open a form, the saving buttons are the gated ones.
  - **No Playwright test** (AGENTS.md); the criteria that need a browser are the smoke above. `ui-gates.mjs` changed: it seeds the appearance from `/icons/icon.svg` (a missing asset is now a 404 and logs a console error), waits for `load`, busy buttons and 600 ms of colour fades instead of `networkidle0` (an unread `no-store` response never counts as finished), because the old wait never returned.
  - "Lighthouse CI" is `lighthouse` itself driven by `server/scripts/perf.ts` (a navigation run plus a timespan flow), not `lhci`, which cannot measure INP.
- **Follow-ups:**
  - **M0 #13:** add the inline pre-paint script's hash and any CSP; tell the owner the install flow needs HTTPS (the manifest and worker are served at the Serve origin; `Secure` cookies and the `Service-Worker-Allowed` header already fit); the iOS guide wording ("Share" in Safari) wants a real iPhone check, which only the owner can do.
  - **M2 #03:** push handlers go in `web/src/sw/service-worker.ts`; the iOS permission ask belongs after install (`useInstallOffer().settings === 'installed'`).
  - **M1:** the outbox (IndexedDB) for queueable writes; move the new strings into the catalogues (M1 #01); Settings search metadata for Install (M1 #20); `noteMeaningfulAction()` is the hook for the first approval.
  - `Home` still shows "Hermes starting" for the first second of a load while Caduceus is down and the device is online (before the diagnosis marks it unreachable).

### Evidence (documentation pass)
- **Commit(s):** `b4c5643` feat: installable PWA and offline shell (M0 #12).
- **Tests added:**
  - `server/test/web-app-serving.test.ts` (6): Caduceus HTTP API seam over real Hermes (public manifest and worker, cache headers, `no-store` on API answers).
  - Pure web modules: `sw-cache-rules.test.ts` (6), `pwa-precache.test.ts` (4), `pwa-manifest.test.ts` (4), `offline.test.ts` (4), `home-snapshot.test.ts` (13), `install-prompt.test.ts` (13).
- **Verification recorded:** `npm test` 324 pass, 1 opt-in skipped; both typechecks, `lint:ui` clean; `npm run test:e2e` 6 pass. Browser smoke (Chromium over CDP, real Hermes): no installability errors, offline reload shows Home "as of" with writes disabled and the reason, the update flow (two caches, then only the new one), `beforeinstallprompt` card and its dismissal, the iOS guide with an iPhone UA, `theme-color` equal to the painted canvas in all 12 skin x theme combinations. Gates at 390/320/820/1440, dark and light, Nous only: clean; not re-run for every skin. `npm run perf` (Lighthouse 13, mobile): initial JS 120.4 KB gzip over 8 scripts (170), LCP 2.21 s (2.5), CLS 0.000 (0.1), INP 100 ms (200). The first runs were over budget and were fixed, not relaxed.
- **Deviations:**
  - `vite-plugin-pwa` is not used; a ~100-line plugin builds the worker.
  - The manifest carries the default (Nous light) canvas; the page sets `theme-color` from the painted canvas, so an installed app's splash uses the default.
  - Manifest shortcuts are Home and Health only (New chat, Inbox, New task do not exist yet).
  - The Home snapshot is page-side (`localStorage`); the worker stores no answer from Caduceus or Hermes.
  - Appearance changes stay enabled offline; only the saving buttons of Rename and Change password are gated.
  - No Playwright test; `ui-gates.mjs` changed (seeds appearance from `/icons/icon.svg`, no `networkidle0` wait).
  - "Lighthouse CI" is `lighthouse` driven by `server/scripts/perf.ts`, not `lhci` (it cannot measure INP).
- **Follow-ups / open items:** M0 #13 CSP hash and HTTPS install note; the iOS guide wording needs a real iPhone check (owner only, not verified); M2 #03 push handlers in `service-worker.ts`; M1 outbox, catalogues and Settings search metadata; Home still shows "Hermes starting" for the first second while Caduceus is down. Status: resolved.
