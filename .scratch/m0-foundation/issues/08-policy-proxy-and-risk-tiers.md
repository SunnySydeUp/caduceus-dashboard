# 08: Policy proxy, risk tiers, read-only mode and tiered confirmations

**What to build:** Every request Caduceus forwards to Hermes is classified by one policy map as T0, T1, T2, T3 or Denied. "Request" means both REST operations and gateway methods.

**Denied** requests never reach Hermes:
- shell and CLI execution;
- exec-type quick commands;
- vault;
- billing and subscription changes;
- peer groups and bot relay;
- debug-bundle upload to Nous;
- Hermes's frame-injection publish endpoint.

**T2 and T3:**
- T2 needs a step-up grant (ticket 04).
- T3 needs step-up plus a typed confirmation bound to the specific target.
- T3 is refused while read-only or offline.

**Read-only mode** lets only classified reads through. Turning it on or off is itself T2, and a banner shows while it is on.

**Known Hermes gaps** are guarded here: writes through Hermes's file-write endpoint to `.env`, the auth file or Caduceus's own directory, or outside allowed roots, are refused.

**Confirmation dialog.** The web app gets the single tiered confirmation dialog every module will use:
- T1 confirms and names the object and the profile chip;
- T2 asks for a passkey;
- T3 asks for the typed name and states whether the action can be undone.

**Blocked by:**
- 02 (pinned Hermes contracts, generated types, drift check): the operation and method list.
- 04 (passkeys, device list and step-up re-auth).

**Status:** resolved

- [x] The policy map covers every pinned REST operation and gateway method. A test fails if any is unclassified, including new ones after a contract regenerate.
- [x] Denied requests are blocked for both REST and gateway calls before reaching Hermes, with an error the UI can display (tests against a stub upstream).
- [x] T2 without a grant returns "step-up required". The UI prompts for the passkey and retries automatically.
- [x] T3 requires a step-up grant plus a typed confirmation token bound to the target. It is refused offline and in read-only mode (tests).
- [x] Read-only mode is enforced at the proxy, toggling it is T2, and the shell shows a banner while it is on.
- [x] File-write guard: protected paths and paths outside allowed roots are refused (tests).
- [x] Every T1+ action writes an audit entry with actor, tier, target and profile.
- [x] The tiered confirmation dialog has unit and end-to-end tests at phone and desktop sizes, and matches the prototype's tier dialogs.

## Comments

**2026-10-07: resolved (TDD).**

- **What was built:**
  - **Policy map** (`contracts/policy/`, shared by the server and the web app): `rest.ts` (333 operations keyed `METHOD /path`, plus Hermes's WebSocket routes: `/api/pub` and `/api/events` denied, `/api/pty` and `/api/console` T2), `gateway.ts` (219 methods, 12 server requests, 69 events), `tiers.ts` (tiers, denial reasons and messages, `STEP_UP_MS`), `guards.ts`. Tiers that depend on the request are lifted from its query, body or params (`REFINED` / `refine`): cron scripts and `no_agent`, stdio MCP servers, `?delete=true` on a board, recursive file delete, `approval.respond` "always", `config.set` by key, the action of `cron.manage` / `plugins.manage` / `skills.manage`, and slash commands by name.
  - **Server** (`server/src/`): `policy.ts` (classify, body limits, file guard, read-only, step-up via the `auth.hasStepUp` the `requireStepUp(auth)` helper uses, typed confirmation, audit), `hermes-proxy.ts` (the `/api/*` route; only `Content-Type` and the classified path are forwarded), `confirmations.ts`, `read-only.ts`, `file-guard.ts`, `policy-routes.ts` (`GET`/`PUT /_caduceus/api/policy/read-only`, `POST /_caduceus/api/policy/confirmations`), `gateway-policy.ts` and `exec-quick-commands.ts` (the hook M0 #09 calls; reachable as `server.gatewayPolicy`). Store migration 3 adds `audit.tier`, `audit.profile` and a `settings` table.
  - **Web:** `web/src/tiered-fetch.ts` + `tiered.ts` (`fetchTiered`), `shell/TierDialog.tsx` (installed with `setTierConfirmer`; the T1/T2/T3 dialog on `Sheet`, per the prototype), `tier-flow.ts`, `policy-state.ts` (read-only state and banner), Security gains a Read-only section and uses the shared dialog for passkey delete (T2), session revoke (T1) and the read-only toggle (T2). `confirmTier()` is the dialog for Caduceus's own actions.
  - **Docs:** architecture §5 "Policy proxy as built (M0 #08)"; AGENTS.md.
- **Tests (all red first unless noted; every test that passed at once was mutation-checked, and each mutation made a test fail):**
  - `server/test/policy-map.test.ts` (pure, 13): every pinned REST operation / gateway method / server request / event is classified and nothing unpinned is; overlapping paths agree on tier; spec tiers (architecture §5, coverage §7); lifts; dry-run prune is a read; profile derivation; path normalisation (`%2e%2e`, `%2F`, `//`, NUL…); WebSocket routes; the denied list with reasons; `__proto__`/`toString` are unclassified.
  - `server/test/file-guard.test.ts` (pure, 5, real dirs and symlinks): roots, protected names/dir in any case or via symlink, `..` after a symlink, relative/`file:`/`~user`/NUL.
  - `server/test/policy-proxy.test.ts` (HTTP seam, stub upstream that counts hits, 14): denied never reaches Hermes; T2 step-up and its 5-minute expiry; T1 needs none; read-only (every tier, ordering before step-up, persistence across restart); T3 token (none, wrong target, replayed, 60 s TTL to the millisecond, other session, body-bound, mint refused in read-only); file guard (14 attempts incl. multipart and `NaN` JSON; reads); body limits (1 MiB, chunked, 64 KiB API); audit.
  - `server/test/policy-proxy-hermes.test.ts` (real `hermes serve`, temp `HERMES_HOME`, 4): T1 create then T3 delete really deletes; T3 raw write really writes; `.env`, `caduceus.db` and outside paths are untouched; T1 inside a workspace; the gateway hook wired to the real server and Hermes's own config.
  - `server/test/gateway-policy.test.ts` (pure, 13), `server/test/exec-quick-commands.test.ts` (real Hermes, 2), `server/test/passkeys.test.ts` (+1; six existing tests now step up before adding a second passkey or deleting one), `web/test/tier-flow.test.ts` (4), `web/test/tiered-fetch.test.ts` (10).
  - Mutation checks that caught real gaps while writing: `skills.manage` with no action was a read; a `..` test normalised by `path.join` before the guard saw it; the symlink emulation was redundant until a `..`-after-symlink case was added.
- **Verification:** `npm test` 199 pass, 1 opt-in skipped; both typechecks clean; `npm run lint:ui` clean; `npm run test:e2e` 6 pass (its harness needed `extraRoutes` for the fake Hermes's routes).
- **Browser smoke** (throwaway; Caduceus on `http://localhost:9180` in front of real Hermes in a temp home; `.scratch/m0-foundation/m0-08-smoke/` has `serve.ts` and the screenshots `tier-t1|t2|t3-{390,320,820,1440}.png`): at 390, 320, 820 (touch) and 1440 (mouse) the T1, T2 and T3 dialogs have no horizontal overflow, no serious/critical axe violation (wcag2a/aa, 21aa, 22aa, best-practice), targets ≥44 px coarse / ≥24 px fine, no console errors. T1 sent the request (200); the T3 confirm button is disabled until the name is typed and the dialog says "This cannot be undone."; Escape declines; T2 with no passkey registered shows "Confirming needs a passkey. Add one in Security first."
- **Deviations:**
  - **No Playwright tests** (AGENTS.md): the dialog's "end-to-end tests at phone and desktop sizes" are the smoke above plus the pure tests. The smoke hook was a throwaway edit of `main.tsx`, reverted.
  - **Not verified in a browser:** completing a passkey step-up in the dialog and the read-only banner. The headless tab's CDP virtual authenticator refused registration ("prompt closed or timed out"; M0 #04's smoke did it, this tab did not), so a passkey could not be added, and the banner needs the T2 toggle. Both are covered at the server seam (software authenticator) and by the unit tests; a quick manual check is worth doing once.
  - **Snapshot + stale-overwrite refusal for `fs/write-text`** (architecture §5) is not here: it belongs to the editors (M4 #02, M7 #01). The guard supplies the T1/T3 split and refusals; a workspace is T1 only once M3 #10's registry passes `workspaceRoots` (none yet, so every raw write is T3).
  - **Protected names apply anywhere**, like Hermes's own read guard: a project's `.env` too (the ticket says `.env`, the auth file and `caduceus/`). Reads of those are guarded too, since Hermes's read guard does not know `caduceus/`.
  - **Tier choices where documents disagree** (architecture first, then the owning ticket, then research §7): kept T2 for kanban run terminate (architecture) although M3 #04/#11 say T1; local models, cron trigger, kanban dispatch T1 (their tickets) although research says T3; hermes update T2 (M5 #12); hook delete T2 (M4 #08), create T3; profile rename T0 (M4 #01); soul PUT T3 (M4 #02); `DELETE /api/sessions/empty` T1 (M1 #14). Changing one is a row edit plus its test case.
  - **Passkey and session tiers (decided here):** first passkey T1, further passkey and deleting one T2, rename T0, session revoke T1. This closes the hole M0 #04 recorded: with a stolen cookie alone, delete every passkey then add your own. Cost: if the only passkey's device is lost, removing it needs a store edit (M5 #15).
  - **Slash commands:** a built-in's alias is not resolved, so a quick command named like a built-in is reachable through its alias; names Hermes adds later default to T0 (agent turn). The built-in lists are a snapshot of 0.21.4.
  - **Gateway T3 confirmation** is bound to the method and the typed target, not to the params (a browser client re-serialises frames); REST binds the exact body too.
  - Audit is written when the request is forwarded, not when Hermes answers; T0 and reads are not audited.
  - Kanban comment-author stamping (also an architecture §5 hole) is not here; M3 #04 owns it.
- **Follow-ups:**
  - **M0 #09:** call `server.gatewayPolicy.connect({ sessionId, source })`; `fromBrowser(text)` and `fromHermes(text)` each return `{ forward?, reply? }`. Frames from the browser carry a T3 token as `caduceus: { confirmation }`. Also close live connections on `auth.revoke` and check `auth.hasStepUp` on upgrades for `/api/pty` and `/api/console` (T2, `classifyWebSocketRoute`).
  - **M0 #11:** an incompatible Hermes should turn read-only mode on through `readOnly.set`; the banner already follows the state.
  - **M3 #10:** pass `workspaceRoots` to `startCaduceusServer`.
  - **Later tickets:** classify new Hermes operations in `contracts/policy/` (a test fails otherwise); call `fetchTiered` for every non-read route and `confirmTier` for Caduceus's own tiered actions.
  - Two Hermes plugin routes the owner has (`/api/plugins/commandcode-usage/*`) are now denied as unclassified until someone classifies them.
- **Housekeeping:** no stray processes or temp dirs (checked `ps` and `/tmp`); the owner's `~/.hermes`, :9119, :8787 and the gateway were not touched.

### Evidence (documentation pass)
- **Commit(s):** `58addad` feat: policy proxy, risk tiers, read-only mode and tiered confirmations (M0 #08).
- **Tests added:**
  - `server/test/policy-map.test.ts` (13), `gateway-policy.test.ts` (13), `file-guard.test.ts` (5): pure modules (the last on real dirs and symlinks).
  - `server/test/policy-proxy.test.ts` (12 declarations; the comment says 14 cases): Caduceus HTTP API seam against a stub upstream that counts hits.
  - `server/test/policy-proxy-hermes.test.ts` (4), `exec-quick-commands.test.ts` (2): Caduceus HTTP API over real Hermes.
  - `web/test/tiered-fetch.test.ts` (10), `tier-flow.test.ts` (4): pure web modules.
  - Modified: `passkeys.test.ts` (12, was 11), `caduceus-server.test.ts` (4), `e2e/harness.ts`. Fixtures: `step-up.ts`, `fake-hermes.*`.
- **Verification recorded:** `npm test` 199 pass, 1 opt-in skipped; both typechecks, `lint:ui` clean; `npm run test:e2e` 6 pass. Browser smoke at 390/320/820 (touch) and 1440: T1, T2 and T3 dialogs have no overflow, no serious/critical axe, targets ≥44/24 px, no console errors; T1 sent its request (200); T3 confirm stays disabled until the name is typed; T2 with no passkey says so. Screenshots in `m0-08-smoke/`. Mutation checks caught three real gaps while writing.
- **Deviations:**
  - No Playwright tests: dialog "end-to-end" is the smoke above plus pure tests; the smoke hook was a throwaway `main.tsx` edit, reverted.
  - Not verified in a browser: completing a passkey step-up in the dialog, and the read-only banner (the headless tab's virtual authenticator refused registration). Covered at the server seam and by unit tests; a manual check is still worth doing once.
  - Snapshot and stale-overwrite refusal for `fs/write-text` belongs to the editors (M4 #02, M7 #01); every raw write is T3 until M3 #10 passes `workspaceRoots`.
  - Protected names (`.env`, `auth.json`, `caduceus/`) apply anywhere, reads included.
  - Tier choices where documents disagree are listed in the comment (e.g. kanban run terminate T2, local models and cron trigger T1); changing one is a row edit plus its test.
  - Passkey and session tiers decided here: first passkey T1, further add and delete T2, rename T0, revoke T1.
  - A built-in slash command's alias is not resolved; names Hermes adds later default to T0.
  - Gateway T3 confirmation binds method and typed target, not params; audit is written at forward time; T0 and reads are not audited; kanban comment-author stamping is left to M3 #04.
- **Follow-ups / open items:** M0 #09 wiring (done there); M0 #11 automatic read-only (done there); M3 #10 `workspaceRoots`; later tickets classify new Hermes operations (a test fails otherwise). Two owner plugin routes (`/api/plugins/commandcode-usage/*`) are denied as unclassified. Status: resolved.
