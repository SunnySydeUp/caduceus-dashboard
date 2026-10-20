# 09: Live gateway connection with reconnect and epoch detection

**What to build:** The web app holds a live connection to Hermes's gateway, routed through Caduceus:
- the browser socket goes to the Caduceus server;
- the Caduceus server opens an upstream to its private Hermes backend using the per-launch secret;
- every frame in both directions passes the policy proxy.

The client is Hermes's vendored shared gateway client. On every connect it sends the capabilities handshake, so approvals and clarify prompts will work in M1. It also handles heartbeats and reconnect backoff, and detects a Hermes restart through the replay epoch.

The app-bar dot shows one of three states:
- connected;
- reconnecting, with the attempt count;
- offline, with a plain reason.

Home shows a live count of active Hermes sessions. It updates from Hermes's change events when sessions start or stop elsewhere.

Reconnects triggered by bursts of visibility, page-show or online events are coalesced to at most one per second.

**Blocked by:**
- 05 (adaptive app shell, module registry, profile scope and quality gates)
- 08 (policy proxy, risk tiers, read-only mode and tiered confirmations)

**Status:** resolved

- [x] Upgrading the browser socket requires a Caduceus session and an exact Origin. The upstream connection uses the per-launch secret, and the browser's Origin is never forwarded (tests).
- [x] A Denied gateway method sent by the browser gets an error and never reaches Hermes (test).
- [x] The capabilities handshake is sent on every connect and reconnect.
- [x] Killing the Hermes backend moves the dot to reconnecting and then back to connected after the restart. The client sees the new replay epoch and refetches live data (end-to-end test).
- [x] Bursts of visibility, page-show and online events cause at most one reconnect per second (test).
- [x] Revoking a session (ticket 04) closes that session's live connections.
- [x] Home's live session count updates from change events without polling.

## Comments

**2026-10-07: handoff of the first agent (it stopped at its request budget; superseded by the RESOLVED entry below).**

- **Built and green (server seam):** `ws` dependency; `server/src/websocket-routes.ts` (upgrade gate: exact Origin, session, `classifyWebSocketRoute` policy, step-up for T2 `/api/pty` and `/api/console`, read-only refuses non-reads except the gateway; replaces the 404 `gateUpgrades`); `server/src/gateway-proxy.ts` (upstream-first via `backend.openGateway()`, per-frame `gatewayPolicy`, ordered judging, Hermes frames redacted with new `HermesBackend.redact`, close propagation both ways, registry per session); `OwnerAuth.onSessionEnded` (sign-out, revoke, expiry) closes live sockets with `GATEWAY_CLOSE.sessionEnded` (4401); `contracts` `GATEWAY_CLOSE` and exports for the vendored client and backoff; policy fix: `gateway.ping` (Hermes's transport heartbeat, not in the contract) was denied as unclassified by M0 #08, now T0 read (`TRANSPORT_METHODS`).
- **Built (web):** `web/src/reconnect-coalescer.ts` (+3 tests, mutation-checked); `web/src/gateway-connection.ts` (controller around the vendored `JsonRpcGatewayClient`: status connected / reconnecting(attempt) / offline(reason), diagnosis through `GET /_caduceus/api/backend`, backoff ladder, epoch/`restarted` on `gateway.ready`, `reconnect()` with liveness probe, signed-out stop); `web/src/gateway.ts` (page singleton, resume signals to coalescer, hooks `useGatewayStatus`, `useBackend`, `useGatewayEvent`, `useLiveLoad`). Typechecks clean.
- **Tests added:** `server/test/gateway-proxy.test.ts` (fake Hermes: Denied method blocked, secret-only upstream with no Origin/cookie/token, secret redacted, upgrade gate, T2 routes and read-only, revoke/sign-out close sockets, Hermes drop and browser leave, capabilities on connect and reconnect), `server/test/gateway-live.test.ts` (real Hermes: `gateway.ready` + capabilities, `gateway.ping`, kill Hermes then reconnect with new epoch), `web/test/reconnect-coalescer.test.ts`; `owner-auth.test.ts` updated (101 past the gate). Fixtures: `browser-socket.ts`, `gateway-client.ts`, `killHermes` in `real-hermes.ts`, WebSocket support in `fake-hermes.mjs`.
- **Known flake to fix first:** the kill-Hermes test in `gateway-live.test.ts` timed out once in 3 runs (15 s, then a 10 s hook timeout in `afterEach`). Not yet diagnosed: a dial may hang (client `connectTimeoutMs` is 15 s) when Caduceus accepts the upgrade while Hermes is just back or just dead; check `GatewayProxy.accept` for an upstream that neither opens nor closes (add an open timeout, 502), and give the test fixture a short `connectTimeoutMs`.
- **Remaining work:** (1) fix the flake above; (2) tests still to write: Caduceus unreachable and Hermes-backend-stopped offline reasons, signed-out stop (revoke -> `onSignedOut`, no more dials), liveness probe on `reconnect()` (fake `params.mute`), `sessions.changed` through the proxy with live `/api/status.active_sessions` 0 -> 1 -> 0 (create a seeded session `session.create {messages:[...]}` and `session.close`; Hermes's change watcher only baselines ~0.5 s after the first gateway connection, so prime with a bounded poll and say why); (3) wire the UI: replace `web/src/backend-status.ts` (1 s poll) by `useBackend` from `gateway.ts`, rewrite `web/src/shell/connection.ts` (`useConnection` = online override + gateway status; banners with attempt and reason) and `AppBar` dot (attempt count, plain reason), Home live "N active sessions" (`useLiveLoad` + `useGatewayEvent('sessions.changed')`, facts cleared while not connected); (4) browser smoke at 390/320/820/1440 with screenshots in `.scratch/m0-foundation/m0-09-smoke/`; (5) architecture §4/§7 and AGENTS.md notes (`gateway-proxy.ts`, `websocket-routes.ts`, `gateway.ts`), `npm test`, both typechecks, `npm run lint:ui`, `npm run test:e2e` (kept Home specs run through the new WebSocket path; the fake Hermes now has `/api/ws`); (6) tick criteria, `Status: resolved`, commit `feat: live gateway connection with reconnect and epoch detection (M0 #09)`.
- **Follow-ups noted:** no server-side keepalive for a dead browser socket (a leaked upstream until TCP notices); M1 #19 / M7 #05 need to add the `/api/pty` and `/api/console` relays (the gate already enforces step-up and read-only for them); M1 #03's grace hold replaces the 1:1 upstream.

**2026-10-07: RESOLVED (continuation agent).** Evidence per criterion:

- **Gate, secret, no Origin** — `gateway-proxy.test.ts`: the upgrade needs the exact Origin, then a session (403/401), denied and unknown routes are refused, T2 routes need step-up, read-only closes them; Hermes is dialled with the secret alone (the fake records `authorized: true`, `origin: null`, `cookie: null`).
- **Denied method** — same file: `shell.exec` gets the policy error and the fake's frames show only `session.list`.
- **Capabilities** — `gateway-proxy.test.ts` (fake records `client.capabilities` twice, once per connect and reconnect) and `gateway-live.test.ts` (real Hermes answers with `approval`/`clarify`).
- **Kill Hermes** — `gateway-live.test.ts`: real Hermes killed with SIGKILL; the page goes connected, reconnecting (attempts counted from 1, "Hermes is restarting."), connected; the two `gateway.ready` frames carry different epochs and the second has `restarted: true`. In a real browser (`m0-09-smoke`) the dot, banner and Home's live row follow, and Home refetches (e2e Home specs, now through the WebSocket path, pass).
- **Coalescing** — `web/test/reconnect-coalescer.test.ts` (3 tests, mutation-checked). **Revoke** — `gateway-proxy.test.ts` (revoke and sign-out close the sockets with 4401 and their upstreams, only that session's). **Home count** — `gateway-live.test.ts`: real Hermes, `/api/status.active_sessions` 0 → 1 → 0 through `session.create` and `session.close`, each step awaited on `sessions.changed` through the proxy; Home reads it from `useLiveLoad` + `useGatewayEvent('sessions.changed')`, no timer.
- **The flake, diagnosed:** the kill test timed out in about 4 of 12 runs. Cause: right after a kill the launcher has not yet seen Hermes exit, so Caduceus dialled the dead port; Node's global `WebSocket` reports a refused dial as `error` alone and never closes it, and the proxy waited only for `close`, so the browser's handshake hung (the page's 15 s connect timeout, then `server.close()` waiting on the raw socket). Fixed by moving the upstream to the `ws` client (error followed by close; a built-in handshake timeout; no second connection when closed while opening, which the global one does) plus a 10 s `gatewayOpenTimeoutMs` (502). Tests: fake Hermes `DEAF_AFTER_READY` (refused dial → 502 at once) and `?stall=1` (no answer → 502 after the timeout, and the connection is let go). After the fix `gateway-live.test.ts` ran 12 times and again 10 times in a row without a failure. The fixture does not get a short client `connectTimeoutMs` (deviation from the suggestion): it would turn a hung dial into a silent retry and hide this class of bug.
- **Tests added this round** (fake Hermes, `gateway-proxy.test.ts`): refused upstream 502; stalled upstream 502 and released; browser keepalive (a socket that never pongs is dropped with its upstream, a ponging one stays; mutation-checked); offline reasons (Caduceus unreachable, backend stopped); signed-out stop (close code path: no `reconnecting` in between and one dial; refused-dial path: diagnosis 401); `reconnect()` liveness probe (answered: stays; muted via `?mute=1`: redials, same epoch, `restarted: false`); offline does not flicker back to `reconnecting` on each failed dial (found by the browser smoke). Live: `sessions.changed` (priming touches `state.db` in a bounded poll because Hermes's watcher only baselines on its first 0.5 s pass). Mutation checks were run on every test that passed at once. Also: `GATEWAY_CLOSE` reasons are sentences, the fake closes its sockets on SIGTERM, the fixture records only real status changes.
- **UI wired:** `backend-status.ts` (the 1 s poll) is gone; `useBackend` comes from `gateway.ts`; `shell/connection.ts` is the gateway status plus the browser's "no network" override; the banners say the attempt and the reason; the dot shows the count while reconnecting and the reason in `title` and screen-reader text; Home has a live "N active sessions" row, cleared while not connected (a sequence guard drops late answers).
- **Browser smoke** (`.scratch/m0-foundation/m0-09-smoke/`: `serve.ts`, `states.mjs`, screenshots `dot-{connected,reconnecting,offline}-{390,320,820,1440}.png`): at all four widths no horizontal overflow, targets at least 44 px (coarse) or 24 px (fine), axe has no serious or critical violations, no console errors while connected; the private Hermes killed → "Reconnecting, attempt N. Hermes is restarting." with a visible count that rises, row cleared, then connected again with the row back; Caduceus stopped → "Offline. Caduceus is not reachable." and the banner, then connected again by itself after it restarts.
- **Checks:** `npm test` 223 passed, 1 skipped (the opt-in real smoke); both typechecks and `npm run lint:ui` clean; `npm run test:e2e` 6 passed. No stray processes or temp dirs.
- **Follow-ups:** Home keeps showing the last Hermes facts (version, profiles) while Caduceus is unreachable (only the live row is cleared); M1 #19 / M7 #05 add the `/api/pty` and `/api/console` relays; M1 #03's grace hold replaces the 1:1 upstream; the "tap the dot for connection details" of the design system is not built.

### Evidence (documentation pass)
- **Commit(s):** `f5ce733` feat: live gateway connection with reconnect and epoch detection (M0 #09).
- **Tests added:**
  - `server/test/gateway-proxy.test.ts` (17): Caduceus WS seam against the fake Hermes (fault injection).
  - `server/test/gateway-live.test.ts` (4): Caduceus WS seam over real Hermes (ready, ping, kill and reconnect with new epoch, `sessions.changed`).
  - `web/test/reconnect-coalescer.test.ts` (3): pure module.
  - Modified: `owner-auth.test.ts` (12, was 12), `e2e/harness.ts`. Fixtures: `browser-socket.ts`, `gateway-client.ts`, `real-hermes.ts` (`killHermes`), `fake-hermes.mjs`.
- **Verification recorded:** `npm test` 223 passed, 1 skipped; both typechecks and `lint:ui` clean; `npm run test:e2e` 6 pass (Home specs through the WebSocket path). Browser smoke at 390/320/820/1440: no overflow, targets ≥44/24 px, no serious/critical axe, no console errors while connected; killing Hermes showed "Reconnecting, attempt N" then recovery; stopping Caduceus showed "Offline" then recovery. Screenshots in `m0-09-smoke/`. The kill-test flake (about 4 in 12 runs) was diagnosed and fixed; 12 and 10 green runs in a row followed.
- **Deviations:**
  - The first agent stopped at its budget; a continuation agent finished (both recorded in the comments).
  - The test fixture does not get a short client `connectTimeoutMs` (it would hide the hung-dial class of bug).
  - The upstream uses the `ws` client, not Node's global `WebSocket`, with a 10 s `gatewayOpenTimeoutMs` (502).
  - Priming for `sessions.changed` uses a bounded poll on `state.db` (Hermes's watcher baselines on its first 0.5 s pass).
- **Follow-ups / open items:** Home keeps the last Hermes facts while Caduceus is unreachable (only the live row clears); the `/api/pty` and `/api/console` relays were left to M1 #19 (resolved) and M7 #05; the "tap the dot for connection details" of the design system is not built. Status: resolved.
