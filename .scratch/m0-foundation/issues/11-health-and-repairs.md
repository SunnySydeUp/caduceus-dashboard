# 11: Health and Repairs (basic)

**What to build:** A Health screen and a health strip on Home cover each subsystem:
- the Caduceus server;
- the private Hermes backend, including recent restarts;
- the messaging gateway;
- the cron scheduler tick;
- the Kanban dispatcher;
- providers;
- host resources.

Each subsystem shows its state, a plain-language reason and the last check time, and updates live. All of it is read from Hermes's own status endpoints through the proxy, with no copy kept by Caduceus.

Problems appear as **Repairs**: severity, cause, and a one-tap fix where one exists.

- **Fix example:** "Restart Hermes backend" (T2, through the tiered dialog and audited).
- **Contract mismatch:** when the running Hermes no longer matches the pinned contracts (ticket 02's startup check), a Repair explains the mismatch and Caduceus switches itself to read-only automatically.

Health also serves as Caduceus's liveness endpoint for its supervisor.

**Blocked by:**
- 02 (pinned Hermes contracts, generated types, drift check)
- 05 (adaptive app shell, module registry, profile scope and quality gates)
- 08 (policy proxy, risk tiers, read-only mode and tiered confirmations)
- 09 (live gateway connection with reconnect and epoch detection)

**Status:** resolved

- [x] Health is registered through the module registry and passes the ticket 05 gates at every size.
- [x] Subsystem states come from real Hermes status data and update live.
- [x] These conditions produce Repairs:
  - repeated backend restarts;
  - gateway not running;
  - scheduler tick stale;
  - contract mismatch, which also turns on automatic read-only with a banner.
  
  Each condition is tested with a stub upstream.
- [x] "Restart Hermes backend" works end to end: it requires T2 step-up, writes an audit entry, and the connection dot recovers afterwards.
- [x] The Home health strip links to Health. The liveness endpoint answers without authentication and reveals nothing sensitive.

## Comments

**2026-10-07: resolved (TDD).**

- **What was built:**
  - Server: `health-rules.ts` (pure rules), `health.ts`, `health-routes.ts`; `GET /_caduceus/healthz` (public, `{ok:true}`), `GET /_caduceus/api/health`, `POST /_caduceus/api/health/fixes/restart-backend` (T2, audited `backend.restart`). Launcher: `restarts` and `restart()`. `read-only.ts`: `turnOnAutomatically` (audited as actor `caduceus`) and `automatic` in `GET /policy/read-only`. `contract-diff.ts`: `contractDrift`. Types in `contracts/caduceus-api.ts`.
  - Web: real Health screen, Home health strip (chips plus the worst Repair, linking to Health), `useHealth` (loads at `gateway.ready`, `platforms.changed`, `cron.changed`, backend lifecycle changes and tab-visible; no timer), `health-view.ts`, and a read-only banner that says when Caduceus switched itself on.
- **Tests (red first; each test that passed at once was mutation-checked):** `health.test.ts` (13: liveness incl. while Hermes is down; report; gateway; scheduler; backend restarts and critical crash loop; contract mismatch with auto read-only, re-engage after the owner lifts it, unreadable contract is no read-only; the fix needs step-up, audited, works in read-only, unknown fix 404, clears its Repair), `health-hermes.test.ts` (4, real Hermes: subsystems from real endpoints, stale scheduler through Hermes's own heartbeat marker, restart end to end with the page's connection dropping and returning on a new epoch, a crash counted), `health-rules.test.ts` (25 boundaries), `hermes-backend.test.ts` (+4: `restarts`, `restart()`), `web/test/health-view.test.ts` (2). Mutations that were caught include the 200/201 s boundary, the 59/60 min window, the 3-restart threshold, 5-difference listing, host 85/95 %, the retired-child guard and an auto read-only on unreadable contracts.
- **Verification:** `npm test` 274 passed (1 opt-in skipped); both typechecks and `npm run lint:ui` clean; `npm run test:e2e` 6 passed. No stray processes or temp dirs.
- **Browser smoke** (`.scratch/m0-foundation/m0-11-smoke/`, `serve.ts` plus screenshots): Caduceus in front of real Hermes in a temp home. Health and Home at 390, 320, 820 and 1440, healthy and with a contract mismatch plus a stale scheduler: no overflow, targets at least 44 px (coarse) or 24 px (fine), no serious axe violation, no console errors. Live: three crashes with the page open updated the backend row and raised "Hermes keeps restarting"; in a visible tab with a virtual authenticator the Restart fix opened the T2 dialog, asked the passkey, toasted, the dot went Reconnecting then Connected and the Repair cleared. The mismatch showed the "Caduceus switched to read-only mode" banner with Open Health / Open Security.
- **Deviations and decisions:**
  - **No fix for gateway-not-running or scheduler-stale:** Hermes's own start/restart routes (T2) belong to the M5 Connect screens, where they can be tested; those Repairs name the command to run. Only "Restart Hermes backend" is a fix.
  - **Auto read-only only for a read difference** (removed or changed operation or method, lost or changed marker), never for a contract that could not be read (a warning Repair): a transient failure must not latch a persisted mode. Each backend launch is checked again, and a Hermes that is still wrong puts read-only mode back after the owner lifted it. Caduceus never turns it off; the banner says so.
  - **The fix is allowed in read-only mode** (it changes no Hermes data, and that is when it is needed); it is still T2 and audited.
  - **A requested restart forgets earlier stops** so the Repair clears at once; it is not counted as a crash.
  - The restart history lives in the launcher (in memory, one day), so stops before the server started are counted too.
  - **The fake Hermes now follows the pinned contracts** (`/openapi.json`, `gateway.capabilities`), and `fakeHermesInstall()` supplies the gateway contract, so fake-based tests are compatible unless a test pins otherwise.
  - Subsystem facts exist only for the backend and host; other rows show state, reason and check time. Real Hermes in a temp home on this Mac sees the owner's running gateway in `/api/status`, so the real test compares the gateway row with Hermes's own answer rather than expecting "down".
  - Live: a scheduler that goes stale by the passage of time raises no event, so it shows at the next trigger (reconnect, `platforms.changed`, `cron.changed`, tab shown) or "Check now".
- **Follow-ups:** M5 Connect: gateway start/restart fixes; M2 #02 can reuse `evaluateHealth` for Inbox sources (stale scheduler, gateway down, resource pressure); the settings badge with the Repair count is not built.

### Evidence (documentation pass)
- **Commit(s):** `36392e9` feat: Health screen, Repairs and liveness endpoint (M0 #11).
- **Tests added:**
  - `server/test/health-rules.test.ts` (19 declarations; the comment says 25 boundaries): pure module.
  - `server/test/health.test.ts` (14): Caduceus HTTP API seam over the fake Hermes, scripted through `scriptFakeHermes`.
  - `server/test/health-hermes.test.ts` (4): Caduceus HTTP/WS API over real Hermes.
  - `server/test/hermes-backend.test.ts` (8, was 5): Hermes launcher seam (`restarts`, `restart()`).
  - `web/test/health-view.test.ts` (2): pure module.
- **Verification recorded:** `npm test` 274 passed (1 opt-in skipped); both typechecks, `lint:ui` clean; `npm run test:e2e` 6 pass. Browser smoke on Health and Home at 390/320/820/1440, healthy and with a contract mismatch plus a stale scheduler: no overflow, targets ≥44/24 px, no serious axe, no console errors. Live: three crashes updated the backend row and raised "Hermes keeps restarting"; the Restart fix opened the T2 dialog with a virtual authenticator, the dot went Reconnecting then Connected and the Repair cleared; the mismatch showed the read-only banner. Screenshots in `m0-11-smoke/`. Mutation checks on boundaries and thresholds.
- **Deviations:**
  - Only "Restart Hermes backend" is a fix; gateway-not-running and scheduler-stale Repairs name the command to run (Hermes's start/restart routes belong to M5).
  - Automatic read-only only for a read difference, never for a contract that could not be read (that is a warning Repair).
  - The fix is allowed in read-only mode (still T2, audited).
  - A requested restart forgets earlier stops and is not counted as a crash; restart history lives in the launcher (memory, one day).
  - The fake Hermes now follows the pinned contracts.
  - Subsystem facts exist only for the backend and host; the real test compares the gateway row with Hermes's own answer (the owner's gateway runs on this Mac).
  - A scheduler that goes stale raises no event; it shows at the next trigger or "Check now".
- **Follow-ups / open items:** M5 gateway start/restart fixes; M2 #02 can reuse `evaluateHealth`; the settings badge with the Repair count is not built. Status: resolved.
