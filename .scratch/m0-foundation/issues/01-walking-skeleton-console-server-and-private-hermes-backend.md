# 01: Walking skeleton — Caduceus server, private Hermes backend, live Home

**What to build:** One command starts Caduceus in development:

1. The Caduceus server comes up on loopback only.
2. It launches its own private Hermes backend (`hermes serve`) on loopback, with a fresh per-launch secret. This uses the launcher contract Hermes Desktop uses.
3. It serves a minimal web app whose Home shows real facts from this Mac's Hermes: version, whether the messaging gateway is running, and how many profiles exist.

All Hermes REST traffic from the browser goes through the Caduceus server. The server adds the secret and rewrites the host, and the secret never reaches the browser.

If the Hermes backend dies, the Caduceus server restarts it with backoff. Home shows "Hermes restarting" and then recovers without a manual reload.

This ticket also answers the first early check: what a second Hermes backend costs on this Mac.

**Blocked by:** None (can start immediately).

**Status:** resolved

- [x] The project is under version control and set up as npm workspaces (web app, Caduceus server). One documented command starts everything in development (`npm run dev`, see the project README). The contracts workspace is created by ticket 02, its first consumer. Git is initialised; the first commit is waiting on the owner's git identity.
- [x] The Caduceus server listens on loopback only. The Hermes backend is bound to loopback and launched with a per-launch secret, which `.env` cannot override (Hermes's launcher contract).
- [x] Home shows Hermes version, gateway state and profile count, fetched through the Caduceus server from the real local Hermes.
- [x] Automated test: the secret never appears in any HTTP response body or header, page or browser storage.
- [x] Killing the Hermes backend process makes the Caduceus server restart it with backoff. Home shows a restarting state and then recovers (automated test plus a manual check).
- [x] Memory and CPU of the private Hermes backend are measured at idle and after Home loads, alongside the existing dashboard and gateway processes. The numbers and a go/no-go note are added to the architecture doc's risks section.
- [x] Nothing outside the project directory is modified. The existing Hermes dashboard, WebUI and gateway keep running.

## Comments

**2026-10-07: resolved (TDD).** Seams agreed with the owner: the Caduceus server over HTTP, the Hermes backend launcher, and Home in a real browser. Tests run against a fake Hermes that follows the launch contract, plus one opt-in smoke test against the real `hermes serve`.

- **Tests:**
  - `npm test`: 7 pass. Launcher: ready on announce, secret attached, restart with fresh secret, backoff and status, never outlives its owner. Server: proxying on loopback, the secret never leaks (including Hermes's token page at `/` and an echoing endpoint), and a fast 503 while Hermes is restarting.
  - `npm run test:e2e`: 6 pass (3 behaviours × phone and desktop).
  - `npm run smoke:real`: passes against Hermes 0.21.4.
- **Manual check against real Hermes:**
  - Home showed "Hermes 0.21.4 · Gateway running · 6 profiles".
  - After a SIGKILL of the backend, Home showed "Hermes restarting" and recovered by itself (page text captured in a headless browser at 390 px).
- **Found and fixed during the work:** stopping the dev server orphaned `hermes serve`. Hermes now runs under a stdin-pipe watchdog (architecture §8), covered by the "never outlives its owner" test and re-checked with real Hermes.
- **Outside the project:** nothing was edited by us. The real Hermes backend writes its usual logs under `~/.hermes` while it runs. The stock dashboard (:9119), WebUI (:8787) and gateway were running throughout.

**2026-10-07: reopened after /code-review, then resolved.** Each fix was written test-first, and each test was confirmed to catch its bug with a mutation check:
- **Unread stderr pipe stalled Hermes without a restart.** The launcher now drains stderr and emits it as `log` events.
  - New test: Hermes writes 1 MiB to stderr, then keeps serving.
  - Removing the drain makes the test hang until its abort fires. The stuck fake is then cleaned up by the watchdog's SIGKILL escalation.
- **Backoff reset the moment Hermes announced ready.** The backoff now resets only after 30 s of stable running.
  - The backoff test runs for crashes both before and right after ready.
  - Before the fix, the after-ready case retried at `[10,10,10,10]`; now it backs off `[10,20,40,40]`.
- **Stale facts during a restart.** Home clears its facts whenever Hermes isn't ready.
  - The browser test now requires the facts to disappear and then reappear, which proves they were re-fetched.
  - Checked by hand against real Hermes: "6 profiles" → "Hermes restarting" with no facts → "6 profiles".
- **Weak secret and Host tests.**
  - The browser test now intercepts every response and reads its full body. It also fetches an echoing endpoint, and asserts that a `[redacted]` marker was seen.
  - Disabling body redaction makes it fail.
  - New server test: Hermes sees its own Host and the real secret, even when the browser sends a forged secret.
  - A mutation that let the browser's secret take precedence makes it fail. Node's fetch always sets Host from the target URL, so the Host half is enforced by the transport.
- **CPU figures** were added to architecture §9: idle, during Home loads, and after Home, for the private backend, watchdog, stock dashboard and gateway.
- **Standards clean-up:**
  - shared fake-Hermes test helpers;
  - removed an unused delay knob and a one-line `start` helper;
  - the echo route is now used, and `fingerprint` is gone;
  - the harness explains its 1.5 s restart delay and drops an unset environment knob;
  - the launcher-host fixture has no timer and correct usage notes;
  - readiness is tracked through the status, with the gate renamed `#readyGate`.
- **Deferred:**
  - The copy of the backend-state union in Home moves into the contracts workspace in ticket 02 (criterion added there).
  - The 6-line shutdown handlers in `main.ts` and the e2e harness stay duplicated. They are two separate entry points, and extracting them would only add a pass-through layer.
- **Final run:**
  - `npm test`: 10 pass and 1 opt-in test skipped.
  - `npm run test:e2e`: 6 pass.
  - `npm run smoke:real`: passes.
  - Typechecks are clean, and no orphaned processes were left.
  - The stock dashboard (:9119), WebUI (:8787) and gateway kept running throughout.

### Evidence (documentation pass)
- **Commit(s):** `e042260` feat: walking skeleton with private Hermes backend and live Home (M0 #01).
- **Tests added** (cases = `test(`/`it(` declarations in the file at that commit):
  - `server/test/hermes-backend.test.ts` (5): Hermes launcher seam (ready on announce, secret, restart with fresh secret, backoff, never outlives its owner).
  - `server/test/caduceus-server.test.ts` (4): Caduceus HTTP API seam (loopback proxy, secret never leaks, fast 503 while Hermes restarts).
  - `server/test/real-hermes.smoke.test.ts` (1, opt-in, `npm run smoke:real`): real `hermes serve`.
  - `e2e/home.spec.ts` (3, run on a phone and a desktop project): Playwright Home tests, written before the no-new-browser-tests rule.
  - Fixtures: `fake-hermes.mjs`, `fake-hermes.ts`, `launcher-host.ts`; `e2e/harness.ts`.
- **Verification recorded:** The ticket comment records `npm test` 10 pass and 1 opt-in skipped, `npm run test:e2e` 6 pass, `npm run smoke:real` pass against Hermes 0.21.4, both typechecks clean. Manual check against real Hermes: Home read "Hermes 0.21.4 · Gateway running · 6 profiles"; after SIGKILL of the backend it showed "Hermes restarting" and recovered (page text captured in headless Chromium at 390 px). CPU/memory figures went into architecture §9. Each code-review fix had a mutation check. No width sweep, axe or perf run is recorded.
- **Deviations:**
  - A fake Hermes plus one opt-in real-Hermes smoke test, instead of a real Hermes in every test (this was the first ticket; the temp-home real Hermes arrives in M0 #02).
  - The backend-state union copy in Home was left for M0 #02 to move into `contracts/`.
  - The 6-line shutdown handlers in `main.ts` and the e2e harness stay duplicated (two separate entry points).
  - Git was initialised; the first commit waited on the owner's identity (criterion text).
- **Follow-ups / open items:** None open. Status: resolved.
