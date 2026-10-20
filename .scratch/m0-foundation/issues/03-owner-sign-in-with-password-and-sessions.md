# 03: Owner sign-in with password, sessions and audit

**What to build:** Caduceus requires signing in.

- **First run:** the owner sets a password. This is only possible from this Mac, and only once.
- **After that:** every page, every Caduceus API call and every request proxied to Hermes needs a valid Caduceus session.
  - Sessions use a secure cookie with idle and absolute expiry.
  - Sign-out works.
  - Repeated wrong passwords are throttled.
  - Unsafe requests and WebSocket upgrades from any other origin are rejected.
  - Sign-ins, sign-outs and failures are written to an audit log.

This ticket also creates Caduceus's own store. It holds only Caduceus data, never copies of Hermes data, and lives in a `caduceus` directory inside the Hermes root home, so Hermes's own backup includes it. Files are readable by the owner only.

**Blocked by:** 01 (walking skeleton).

**Status:** resolved

- [x] Without a session, pages redirect to sign-in and the Caduceus API and Hermes proxy return 401 (tests).
- [x] Owner setup works only from loopback and only before an owner exists (tests).
- [x] The cookie is HttpOnly, SameSite=Strict, and Secure everywhere except localhost development. Idle and absolute expiry are enforced (tests with a controllable clock).
- [x] Exact-Origin checks apply to unsafe methods and WebSocket upgrades (tests).
- [x] Throttling starts after repeated failures and is shared across spoofed forwarding headers (test).
- [x] The password is stored with a memory-hard KDF.
- [x] Each audit entry records actor, action, target and time.
- [x] The Caduceus store is created with owner-only permissions (directory 0700, files 0600) under the Hermes root home. It is confirmed, from Hermes's backup rules and without running a restore, to be included in `hermes backup`. The docs note that backups therefore contain Caduceus secrets.
- [x] The sign-in screen meets WCAG 3.3.8: no cognitive test, and paste is allowed.

## Comments

**2026-10-07: resolved (TDD).**

- **What was built:**
  - **Store.** `server/src/caduceus-store.ts` opens `<Hermes root home>/caduceus/caduceus.db` (`node:sqlite`, WAL) and creates or re-tightens it to 0700/0600 on every start. Its tables are `owner`, `sessions` (token SHA-256 only) and `audit`. `hermesRootHome()` mirrors Hermes's `get_default_hermes_root()`, and `main.ts` uses it with the server's `HERMES_HOME`.
  - **Auth.** `server/src/owner-auth.ts` handles the scrypt hash (N=2^17, r=8, p=1), setup (once, race-safe), sign-in, sessions (7 days idle, 30 days absolute, last-seen recorded at most once a minute), per-account throttling (5 free failures, then a 60 s lock that doubles per failure up to 15 min) and sign-out. `server/src/audit-log.ts` writes the audit log.
  - **HTTP.** `server/src/auth-routes.ts` provides the gate middleware, the `GET /_caduceus/api/auth/session`, `POST …/setup`, `POST …/sign-in` and `POST …/sign-out` routes, `GET /_caduceus/api/audit`, the exact-Origin check, and `gateUpgrades()` for WebSocket upgrades. `startCaduceusServer` gains `hermesRoot` (required), `now` (the clock) and `publicOrigin` (the Serve origin, for ticket 13). The contracts gain `AuthState` and `AuditEntry`.
  - **Web.** `SignIn.tsx` shows setup or sign-in, a "no owner yet" message for remote visitors, Show/Hide, `role=alert` errors tied to the field through `aria-describedby`, and a hidden `username` for password managers. Nothing blocks paste and there is no cognitive test. Home gains Sign out and goes back to sign-in on a 401. `app.css` uses `--cd-*` tokens only and imports `docs/design/tokens.css`.
- **"Only from loopback" rule.** The peer must be loopback **and** the request must carry none of `Tailscale-User-Login`, `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto` or `Forwarded`. Tailscale Serve always adds `X-Forwarded-Host`/`-For` (`ipn/ipnlocal/serve.go` `addProxyForwardedHeaders`). The same rule decides when the cookie may drop `Secure`. It is documented in architecture §5.
- **Tests** (all red first, for the expected reason):
  - `server/test/owner-auth.test.ts` (Caduceus API seam, against a real `hermes serve` in a temp `HERMES_HOME` that also holds the store), 11 tests:
    - redirect and 401s (pages, Caduceus API, Hermes proxy);
    - first-run setup;
    - setup refused through Serve headers and once an owner exists;
    - sign-in, wrong password and sign-out;
    - cookie attributes (local vs via Serve);
    - idle and absolute expiry (injected clock);
    - exact Origin on POST/PUT/DELETE across 6 foreign origins plus none;
    - WebSocket upgrade gate (403/401/404);
    - throttle with spoofed headers, plus the doubling;
    - audit entries;
    - 12–1024 character limit and malformed bodies (400, previously 500).
  - The same file's store test checks 0700/0600 after a "restored" loose-mode store, and scrypt parameters with no plaintext anywhere in the store. It passed at once, so it was mutation-checked three times: dropping the directory chmod gave `755`; dropping the file chmod gave `644` on db, wal and shm; N=2^14 failed the hash format.
  - `server/test/hermes-root-home.test.ts` (pure module, 6 cases): root-home resolution.
  - Existing tests now sign in through the new helper `server/test/fixtures/owner.ts` (`ownerCookie`).
- **Verification:**
  - `npm test`: 39 pass, 1 opt-in skipped;
  - both typechecks are clean;
  - `npm run test:e2e`: 6 pass;
  - no stray processes afterwards.
- **Manual check against real Hermes** (`HERMES_HOME=<tmp>`, port 9139):
  - Ran setup → Home ("Hermes 0.21.4 · 1 profiles") → sign-out → deep-link redirect (`/sign-in?next=%2Fsome%2Fpage%3Fx%3D1`) → five wrong passwords → "Too many wrong passwords. Try again in 1 minute."
  - The audit rows were as expected, and the store was `drwx------` with `-rw-------` on db, wal and shm.
  - `hermes backup -o <tmp>.zip -k 0` of that temp home listed `caduceus/caduceus.db`. No restore was run, and the zip and temp homes were deleted.
- **Browser smoke check** (screenshots in `../m0-03-smoke/`):
  - Covered setup, wrong-password, throttled and remote-no-owner screens, plus Home, at 390/320/820/1440. Phones and tablet used a coarse pointer, desktop a fine one.
  - No horizontal overflow, nothing outside the card, axe (wcag2a/aa, 21aa, 22aa, best-practice) clean, and no console errors.
  - Targets are ≥44 px on a coarse pointer and ≥24 px on a fine one; Show is 71×48 and submit 254–334×44.
  - Clipboard paste into the password field works.
  - Fixed during the check: a 30 px overflow at 320 (the input's intrinsic width), and Home's Sign out at 21 px tall.
  - Chrome logs a benign `requestfailed ERR_ABORTED` for the setup and sign-out POSTs, because the page navigates right after the 201/204. It is not a console error, and the requests succeed.
- **E2E harness:** it sets up a documented test-only owner (`TEST_OWNER_PASSWORD`) from loopback, exactly as the owner would, and writes a Playwright `storageState`. The gate is not weakened. The webServer now waits for "harness ready" and uses `gracefulShutdown: SIGTERM`. Playwright's default SIGKILL had skipped the harness clean-up, which leaked a `caduceus-e2e-*` dir on every run (pre-existing).
- **Deviations:**
  - Throttled refusals are not audited, so a flood cannot bloat the log. Failures that are counted are audited.
  - Throttle state is in memory and a restart clears it; only the owner can restart Caduceus.
  - No Playwright test was added (AGENTS.md); UI was verified by the smoke check.
  - Vite warns `Unknown at rule: @theme` because `tokens.css` carries its Tailwind bridge. Browsers skip it.
  - `node:sqlite` prints an ExperimentalWarning at start.
- **Follow-ups:**
  - **M0 #04:** sessions already store `user_agent`, `created_at` and `last_seen_at` for the device list. Add revoke by `sessions.id` and audit it. The `/_caduceus/api/auth/` routes are public only through an explicit list, so new auth routes are gated by default.
  - **M0 #09:** replace `gateUpgrades`' 404 with the real WebSocket endpoint, keeping the Origin and session checks first.
  - **M0 #13:**
    - Pass `publicOrigin` (the `https://<mac>.ts.net:9443` origin) from config.
    - Add the `Tailscale-User-Login` allowlist.
    - **Cookies are not port-scoped**: the session cookie for `<mac>.ts.net:9443` is also sent to `https://<mac>.ts.net` (:443, the public Funnel) if the owner's browser visits it. Decide whether that is acceptable or use a separate hostname.
  - **M0 #08:** request bodies are unbounded (Hermes proxy and auth routes); add a body limit.
  - Pre-existing: `server/test/hermes-backend.test.ts` leaks a `fake-hermes-*` temp dir per `fakeStateDir()` call (two per `npm test`). Earlier runs also left 18 `caduceus-e2e-*` and about 90 `fake-hermes-*` dirs in the temp dir; they were not removed.

### Evidence (documentation pass)
- **Commit(s):** `a22d32b` feat: owner sign-in with password, sessions, origin checks, throttling and audit (M0 #03).
- **Tests added:**
  - `server/test/owner-auth.test.ts` (12): Caduceus HTTP/WS API seam over real Hermes in a temp home (401s, setup rules, cookie attributes, expiry with an injected clock, exact Origin, WebSocket gate, throttling, audit, body limits; plus the store-permission and scrypt checks).
  - `server/test/hermes-root-home.test.ts` (1 declaration; the ticket comment says 6 cases): pure module.
  - Modified: `server/test/caduceus-server.test.ts` (4, was 4), `server/test/hermes-compatibility.test.ts` (2, was 2), `e2e/harness.ts` (signs in through a test-only owner).
  - Fixture: `fixtures/owner.ts` (`ownerCookie`).
- **Verification recorded:** `npm test` 39 pass, 1 opt-in skipped; both typechecks clean; `npm run test:e2e` 6 pass. Manual run against real Hermes: setup, Home, sign-out, deep-link redirect, throttle after five wrong passwords; store modes `drwx------`/`-rw-------`; `hermes backup` of a temp home listed `caduceus/caduceus.db` (no restore run). Browser smoke at 390/320/820/1440: no overflow, axe (wcag2a/aa, 21aa, 22aa, best-practice) clean, targets ≥44 px coarse / ≥24 px fine, no console errors, paste works; screenshots in `m0-03-smoke/`. Three store mutation checks.
- **Deviations:**
  - Throttled refusals are not audited (so a flood cannot bloat the log); counted failures are.
  - Throttle state is in memory; a restart clears it.
  - No Playwright test added (AGENTS.md); the UI was checked by smoke.
  - Vite warns `Unknown at rule: @theme` (tokens.css Tailwind bridge); `node:sqlite` prints an ExperimentalWarning.
- **Follow-ups / open items:** M0 #04 revoke and device list; M0 #09 real WebSocket endpoint behind the gate; M0 #13 `publicOrigin`, the Tailscale login allowlist and the cookie-across-ports decision; M0 #08 body limits. Pre-existing leak of `fake-hermes-*` temp dirs by `hermes-backend.test.ts` is noted, not fixed here. Status: resolved.
