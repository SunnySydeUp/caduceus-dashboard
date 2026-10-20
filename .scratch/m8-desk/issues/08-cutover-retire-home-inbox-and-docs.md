# 08: Cutover: retire Home and Inbox, docs and budgets

**What to build:** Remove the screens the Desk replaces (Home, the Inbox decision list), redirect their routes to Today, delete dead code, update help pages, the design system and architecture docs, the owner checklist and the screenshots. Re-run the whole suite and the performance budget.

**Blocked by:** 03, 04, 05, 06, 07

**Status:** resolved (the parent runs the full suite, `npm run perf` and the live-data smoke; see the unticked boxes)

- [x] No dead module, route, test or help page remains for Home or the Inbox decision list; old URLs redirect.
- [x] Docs describe the Desk; `docs/design/design-system.md` records the Desk skin and the Geist decision.
- [ ] Full test suite, both typechecks, `lint:ui`, `test:e2e` and `npm run perf` pass; budgets recorded. The parent runs the full suite, `perf` and `test:e2e` (they rebuild `web/dist`, which the live service serves). Done here: both typechecks, `lint:ui`, `npx vitest run web` (160 files, 1681 tests), the server test files named below, and the three Playwright checks (phone and desktop, twice) against a build in a temp folder.
- [ ] A throwaway browser smoke check of Today, Talk, Work and the tray at 390 and 1440 on the live data. The parent runs it on the live data. Done here, against a private Hermes with a stub model: see Comments.

## Comments

### What was done (M8 #08, DeskCutover)
- **Home is gone.** `web/src/modules/home/`, its route, help page, tests, the offline snapshot (`home-snapshot.ts`, `shell/home-snapshot-store.ts`), the Errors block (`error-groups.ts` and `server/test/errors-panel-hermes.test.ts`) and the dead CSS (`.hchips`, `.hchip`, `a.banner`, `.home__snapshot`). `spendOf` moved to `chat/talk-details.ts` (its tests with it). The server's Steer and Stop routes (`home-routes.ts`, two entries of `contracts/policy/owned.ts`, `LiveRequests.steer`/`stop`) only served Home and are removed; `HomeRun` is now `LiveRun`.
- **The Inbox decision list is gone**, its data layer stays in `modules/inbox/` (`inbox-feed`, `inbox-model`, `inbox-actions`, `InboxDecision`, `NoticeActions`). The list CSS moved to `modules/notices/notices.css` (`.nt-*`), the decision CSS stays in `inbox.css`.
- **Notices** (`modules/notices/`, Control › Main, `/notices`, `/notices/:itemId`): the Inbox's non-decision items (failed, FYI) with their actions, snooze and dismiss, the Activity feed, the profile and category filters, j/k and the detail pane. It lists what `noticesIn` returns: notices that are not decisions. No `g` key (the old `g i` is dropped).
- **Redirects:** `/home`, `/inbox`, `/inbox/:itemId` go to `/today`, the query string kept (`today` module `redirects`; `/` already did). Test: `web/test/desk-routes.test.ts` (the redirect table the router is built from; a router test needs a DOM and the project has none). Verified with a real browser too.
- **Deep links:** push for an approval, a question or any decision opens `/today`; push for a failed or FYI notice opens `/notices/<id>`; the digest opens `/notices`; the test notification and a finished run without a session open `/today`; the service worker's fallback is `/today`. Tests: `server/test/push.test.ts`, `web/test/push-client.test.ts`.
- **Tray gap:** the tray lists decisions of the same agent's other sessions too (the card says which session: "In <title>"); only the open session's decision stays inline. `trayView` lost its `profile` input. Test first: `web/test/decide-tray.test.ts`.
- **Opened marker:** `finishSeqIn` (`chat/talk-review.ts`) is the newest finish of the open session in the activity feed; `useReviewOpened` asks again each time it changes. Test first: `web/test/decide-tray.test.ts`.
- **Fixture:** `launchTestHermes()` already removed its home on a throw. New: a launch is abandoned when the file ends, and the fixture's own `afterAll` (`endLaunches`) makes it clean up at its next step and stops any Hermes nobody stopped. Test: `server/test/real-hermes-fixture.test.ts` (mutation check: removing the cleanup in the catch fails all three).
- **Docs:** `AGENTS.md`, `docs/design/information-architecture.md`, `design-system.md`, `architecture.md`, `docs/OWNER-CHECKLIST.md` (and small fixes in README, USER-GUIDE and the other design docs). In-app help: Today (absorbed the decision help, `profile-scope`, `hermes`, `session` and the review terms), Notices (new), chat (the tray), settings, insights, health, keys, onboarding, work, shell. `help-contract` passes.
- **Server tests moved:** `server/test/home.test.ts` became `inbox-running.test.ts` (the runs of the stream; Steer and Stop tests deleted with the routes); the delegate test about Steer/Stop was deleted.
- **E2E:** `e2e/home.spec.ts` became `e2e/today.spec.ts` (the same three checks over Today: crew, the Reconnecting banner, the secret never reaches the page). `e2e/harness.ts` takes `E2E_WEB_ROOT`, so a run can use a build made elsewhere (`vite build --outDir`).

### Verification (this session)
- `npx tsc -p server --noEmit && npx tsc -p web --noEmit`: clean. `npm run lint:ui`: clean. `npx vitest run web`: 160 files, 1681 tests pass.
- Server: `push`, `push-rules`, `inbox-running`, `delegate-hermes`, `health-rules`, `inbox`, `policy-map`, `policy-proxy`, `inbox-sources`, `today`, `today-review`, `real-hermes-fixture`: 164 tests pass (plus the fixture file's 3).
- Playwright against `vite build --outDir /tmp/...`: 6 passed (phone and desktop), twice.
- Browser smoke (real clicks, private Hermes with a stub model, built to a temp folder; `web/dist` untouched): at 390 and 1440, `/`, `/home`, `/inbox` and `/inbox/x?profile=default` land on Today (query kept); Today shows the waiting approval and the finished run; opening the finished run's chat from Review takes it out of Ready; in that chat the tray says "1 more needs you elsewhere" for another session of the same agent (two at 1440), its cards say "In Clean up"; Allow once in the tray lets that run finish and it is listed in Ready (its chat is not open); a message sent in the open chat finishes and the run is not listed in Ready (the opened marker); More › Notices opens `/notices` (list, Details sheet at 390, detail pane at 1440, Activity view, a gone notice at `/notices/nope`); no horizontal overflow; no console errors besides the existing aborted presence beacon.

### Deviations and notes
- The Install card and the setup guide's offer (`OnboardingCard`) were Home's. They are not in the ticket, but removing Home would have left them with no place: they now show after Today's blocks (`modules/today/InstallCard.tsx`; the offer field `home` of `install-prompt.ts` is `today`). Easy to drop if the owner does not want them on Today.
- The sign-in screen clears `caduceus.home-snapshot` from devices that kept one (one line; nothing else of the snapshot remains).
- Home's health strip, spend and errors block are not replaced (Health, Talk's Details and Insights hold the facts; the errors summary was dropped with `error-groups.ts`).
- Screenshots of the new screens were not saved (the owner asked for no screenshots until the end; none was asked for here).

### Landing LCP and CLS regression (DeskPerf)
The first measurement of Today against the commit before the Desk work (`6cf706b`, landing on Home) was over the LCP budget (2.61 s against 2.28 s) and its CLS was 0.017 against 0.003. Found, fixed and measured as below. Nothing was built in `~/hermes-dashboard`: both sides were built and measured in git worktrees (own `node_modules` with the workspace links pointing into each worktree), through Lighthouse the way `server/scripts/perf.ts` runs it (mobile profile, a fresh Chrome, a fresh owner cookie, a fresh private Hermes for every run: the same cold first run `npm run perf` makes).

**The cause (with evidence).**
- **What the LCP is.** On Home the LCP element was "Checking Hermes and everything around it…", painted with the first paint (real 1.39 s under 4x CPU and slow 4G). On Today it is the quiet-answer paragraph of Ready for review ("Nothing is waiting for your review…", the largest text, after Needs you's) and it only exists once the block has its data: 1.45 s first paint, LCP at 1.7 to 3.1 s (the same 4x CPU, slow 4G emulation in Playwright, six runs of each). Lighthouse's estimate of the LCP is the real LCP time plus every request that finished before it, each a round trip after the script that asked for it, so the time to Today's data is the LCP.
- **Why the data was late (three things).** (1) `useBlock` dropped an answer when a newer ask was out. Ready for review is asked three times in the first 140 ms (the mount, Hermes becoming ready, the feed), so the first answer was thrown away and the block waited for the last. (2) Hermes answers one thing at a time. `/api/cron/blueprints` (22 KB, 0.6 s cold) was asked for at 82 ms by the schedule and put Today's own read behind it: measured against a Hermes, `today/ready` takes 16 ms alone, 93 ms with `/api/status` beside it and 157 ms with the blueprints too (213 to 330 ms in the page). (3) The read began only after the scripts had run.
- **Why the first paint moved (2.10 s to 2.25 s).** Today's small satellites (the crew, the schedule's jobs, the decision card, Today's data and model) were chunks of their own: 17 scripts and 3 stylesheets in front of the first paint. A browser keeps six requests to a host going, so that was a further wave of round trips (0.15 s).
- **CLS 0.017.** (a) The Crew placeholder held 8.5 rem and the tiles are 9.375 rem: 14 px under the schedule (0.002). (b) The 0.017 itself: the Ready block's error banner (134 px) replacing its 176 px quiet panel, a 42 px move of everything below. The refresh that failed with `HTTP 401` is the one Lighthouse causes when it drops its cookie header at the end of the run (watched in a polled run: the layout is flat until then). It lands inside the trace on the first run after Hermes starts, which is every `npm run perf`. A refresh that fails (Hermes restarting, a session that ended) must not move the screen either way.
- **Rejected, with evidence:** fonts and images (the network log has none), the Install card (it sits after the grid, below the blocks; it arrives at 1.6 s and moves nothing), the sigil CSS and the Desk skin (no layout change in the shift sources), the modulepreload list (the same shape as Home's, just longer), the crew list rendering late (its placeholder already held room; only the height was 14 px short).

**The fix.**
- `web/src/block-asks.ts` (new, test `web/test/block-asks.test.ts`, red first) and `web/src/use-block.ts`: an answer is shown unless it belongs to an earlier scope or comes after a newer answer; an older answer that arrives while a newer ask is out is shown (the newer one replaces it). A failure shows only for the newest ask.
- `web/vite.config.ts`: the `landing` chunk group takes Today's satellites. First load: 12 scripts, 150.1 KB, no extra stylesheet request.
- `web/src/modules/work/schedules-data.ts` (`useJobs(enabled)`) and `Today.tsx`: the schedule's reads wait until Ready for review has answered or failed; the visit is recorded after the first paint (`usePainted`, `use-settled.ts`).
- `server/src/web-app.ts` (test `server/test/web-app-serving.test.ts`, red first): the document of `/` and `/today` carries `Link: </_caduceus/api/today/ready>; rel=preload; as=fetch; crossorigin`; Today's own `fetch` takes it (checked: the page makes no second request for the preloaded one). The read is in flight while the scripts download and Hermes is idle.
- `TodayBlocks.tsx`, `today.css`: the Crew room is 9.375 rem; a block's error sits over the room of its usual answer (`.today-room`).

**Paired runs** (six rounds, order rotated, one cold run of each build per round, load average of the machine when the run started; 4x CPU, slow 4G, Lighthouse mobile; `base` is `6cf706b` on `/home`, `head` is `9ee70f9` on `/today`, `fix` is this change on `/today`):

| round | base LCP | base CLS | base INP | load | head LCP | head CLS | head INP | load | fix LCP | fix CLS | fix INP | load |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2.29 | 0.003 | 79 | 5.55 | 2.61 | 0.017 | 72 | 4.66 | 2.44 | 0.000 | 73 | 3.88 |
| 2 | 2.28 | 0.003 | 76 | 2.51 | 2.61 | 0.017 | 77 | 3.43 | 2.41 | 0.000 | 78 | 2.65 |
| 3 | 2.28 | 0.003 | 76 | 3.45 | 2.61 | 0.017 | 73 | 3.35 | 2.28 | 0.000 | 72 | 4.20 |
| 4 | 2.29 | 0.003 | 74 | 4.10 | 2.61 | 0.002 | 77 | 4.14 | 2.28 | 0.000 | 74 | 3.81 |
| 5 | 2.28 | 0.003 | 75 | 4.09 | 2.61 | 0.017 | 74 | 3.98 | 2.44 | 0.000 | 74 | 4.33 |
| 6 | 2.29 | 0.003 | 76 | 5.83 | 2.61 | 0.017 | 72 | 7.97 | 2.44 | 0.000 | 76 | 5.13 |

| | LCP (s) | CLS | INP (ms) | initial JS (transfer size as Lighthouse counts it) | first paint |
|---|---|---|---|---|---|
| `6cf706b` (Home) | 2.28 to 2.29, median 2.28 | 0.003 | 74 to 79, median 76 | 150.9 KB, 16 scripts | 2.10 s |
| `9ee70f9` (Today, before) | 2.61 in all six | 0.017 (0.002 once) | 72 to 77, median 73 | 153.8 KB, 17 scripts | 2.25 s |
| this change | 2.28 to 2.44, median 2.42 | 0.000 | 72 to 78, median 74 | 150.1 KB, 12 scripts | 2.10 s |

Every run of the fix is under the 2.5 s budget (worst 2.44 s, 0.06 s of room; spread 0.16 s, in two groups, 2.28 and 2.41 to 2.44: Lighthouse counts every request that finished before the real LCP, and which of the page's other requests that is differs from run to run; the split was not chased further); the old Today was over in all six. Initial JS, INP and CLS are inside their budgets with room (170 KB, 200 ms, 0.1). Home's own number was measured the same way, so Today's LCP is now a data paint against Home's loading text and still 0.14 s above Home's.
- Not run here (the parent does, because they rebuild `web/dist`): `npm run perf`, `npm run test:e2e`, the full suite. Run here: both typechecks, `npm run lint:ui`, `web/test/block-asks.test.ts`, `server/test/web-app-serving.test.ts` (new test red first), `web/test/desk-routes.test.ts`, `web/test/today-model.test.ts`.
- The change reaches the live service after the owner rebuilds `web/dist` and restarts it (`npm run build -w web && npm run caduceus -- restart`); the `Link` header is in the server code, so a restart is needed for it too.
