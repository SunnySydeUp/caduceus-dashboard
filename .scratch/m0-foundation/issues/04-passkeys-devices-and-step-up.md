# 04: Passkeys, device list and step-up re-auth

**What to build:** Once signed in, the owner can register passkeys and then sign in with one. The browser offers it automatically where supported (conditional UI), and the password stays as a fallback.

Settings › Security lists every signed-in device or session with its last-seen time. Revoking one signs it out immediately.

Sensitive actions can ask for a fresh passkey confirmation ("step-up"). Step-up gives the current session a short-lived grant, and the server can require that grant. Later tickets build risk tiers T2 and T3 on this.

**Blocked by:** 03 (owner sign-in with password, sessions and audit).

**Status:** resolved

- [x] Passkeys can be registered, renamed and deleted. The last remaining sign-in method cannot be deleted.
- [x] Passkey sign-in, with conditional UI where supported, works on localhost in development. The relying-party ID is configurable so ticket 13 can switch it to the tailnet hostname.
- [x] The device/session list shows device, created time and last seen. A revoked session is rejected on its next request (test).
- [x] Step-up: a passkey assertion yields a grant tied to the session that expires after about 5 minutes. A server-side requirement helper returns a 403 with a machine-readable "step-up required" reason the web app understands. Expired or missing grants are rejected (tests).
- [x] Passkey changes, step-ups and revokes are audited.
- [x] Register, sign-in and step-up are covered by end-to-end tests using a virtual authenticator. (Per AGENTS.md: HTTP-seam tests with a software authenticator, plus a browser smoke check with Chrome's virtual authenticator; see Deviations.)

## Comments

**2026-10-07: resolved (TDD).**

- **What was built:**
  - **Store.** `caduceus-store.ts` gains ordered migrations counted by `PRAGMA user_version` (append-only). Migration 1 rebuilds `owner` with a nullable `password_hash` (passkey-only owners) and a random `webauthn_user_id`, and adds `passkeys` (credential ID, public key, counter, transports, name, created, last used).
  - **Passkeys.** `server/src/passkeys.ts` (`@simplewebauthn/server` 14): registration (discoverable, user verification required, `none` attestation, `excludeCredentials`), discoverable sign-in, step-up (`allowCredentials` = the owner's passkeys), rename, delete. Challenges are single-use, expire after 5 min, are bound to their purpose and session, and are kept in two capped books (64 each): anonymous sign-in challenges cannot evict a signed-in owner's. Sign counters are checked and stored.
  - **Relying party.** `startCaduceusServer({ rpId })`, default `localhost`. Expected origins are Caduceus's own origins on the RP ID's hostname, so ticket 13 only sets `rpId` and `publicOrigin`.
  - **Owner auth.** `owner-auth.ts` gains `signInWithPasskey`, `sessions`, `revoke`, `grantStepUp` / `hasStepUp` (5 min, in memory, per session id; dropped on revoke and sign-out), `hasPassword`, `setPassword`, `removePassword`. Removing the password and deleting a passkey each refuse, in one SQL statement, to leave the owner with no sign-in method (`409 last-sign-in-method`).
  - **HTTP.** `passkey-routes.ts`: `POST /_caduceus/api/auth/passkey-sign-in/options` and `…/passkey-sign-in` (public, added to the gate's explicit list); `GET/POST /_caduceus/api/auth/passkeys`, `POST …/passkeys/registration-options`, `PATCH/DELETE …/passkeys/:id`; `POST …/step-up/options` (`409 no-passkey` without one) and `…/step-up`. `auth-routes.ts`: `GET …/auth/sessions`, `DELETE …/auth/sessions/:id`, `PUT/DELETE …/auth/password` (both behind step-up), `AuthState.passwordSignIn`, and **`requireStepUp(auth)`**: the requirement helper for M0 #08 (403 `{"error":"step-up-required"}`). The gate now hands routes the request's session (`AuthEnv`).
  - **Contracts.** `Passkey`, `SessionInfo`, `StepUpRequired`, `StepUpGrant`; `AuthState.passwordSignIn`.
  - **Web.** `web/src/passkeys.ts` (ceremonies via `@simplewebauthn/browser`, browser errors turned into owner-facing messages, `fetchWithStepUp`: on `403 step-up-required` it opens the step-up dialog and retries once). `StepUpDialog.tsx` (native `<dialog>`, mounted on every signed-in page; the passkey prompt opens from the button press because Safari needs a user gesture). `SignIn.tsx`: conditional UI on load (`autocomplete="current-password webauthn"`), a "Sign in with a passkey" button, and a passkey-only variant when the password is off. `Security.tsx` at `/system/security` (IA §7): passkeys (add, rename, delete with inline confirm; the only remaining method's Delete is disabled with a reason), password (change, turn off, set again; step-up asked by the server), signed-in devices (device name from the User-Agent, This device tag, signed in, last seen, Revoke / Sign out). Home links to Security.
  - **Docs.** Architecture §5 gains "Passkeys, devices and step-up as built (M0 #04)" and the updated gate and audit lists.
- **Tests** (`server/test/passkeys.test.ts`, Caduceus HTTP API seam, real `hermes serve` in a temp `HERMES_HOME`, injected clock; the browser's authenticator is `server/test/fixtures/software-authenticator.ts`: P-256 keys, `none` attestation in hand-rolled CBOR, ES256 assertions, honouring `allowCredentials` / `excludeCredentials`). 11 tests:
  - registers a discoverable, user-verified passkey and lists it (red first: 404);
  - passkey sign-in; replayed, stale (5 min) and unknown assertions refused (red: 401 signed-out on the options route);
  - signed-in devices: list with device, created, last seen, current; revoked session gets 401 on its next request (red: no route);
  - step-up: grant tied to the session, ~5 min (`5 min − 1 ms` passes, `5 min` refused), another session's challenge refused, 403 `step-up-required` without/after the grant (red: 404);
  - rename (1–64 chars) and delete without step-up (red: 404);
  - passkey-only and back; the last remaining method cannot be deleted either way (red: 404);
  - step-up needs a passkey (`409 no-passkey`) (red: 200 with empty allowCredentials);
  - audit of passkey register/rename/delete, passkey sign-in, step-up, password set/remove and revoke;
  - configurable RP ID: through Serve with `rpId` = tailnet host it works; a registration or assertion from the loopback origin is refused;
  - challenge flood: only the newest 64 anonymous challenges kept; the owner's registration challenge survives;
  - a pre-passkey (M0 #03) store keeps its owner and sessions, gains passkeys, and survives a restart.
  - Tests that passed on first run were mutation-checked: audit (dropping the revoke or step-up record → fail); step-up expiry (ignoring expiry, or +1 ms grant → fail); delete without step-up (a 403 guard → fail); last-method SQL (`> 0` → fail); RP ID (ignoring `rpId`, or accepting any origin → fail); flood (cap 1000, or one shared book → fail); migration (dropping the owner copy, or re-running migrations each start → fail).
  - `owner-auth.test.ts`: `AuthState` expectations gain `passwordSignIn`.
- **Verification:**
  - `npm test`: 50 pass, 1 opt-in skipped;
  - both typechecks clean;
  - `npm run test:e2e`: 6 pass;
  - no stray processes or temp dirs afterwards (the two `browser_harness.daemon` processes from Oct 2/5 are not this ticket's).
- **Browser smoke check** (throwaway; Caduceus on `http://localhost:9141` in front of real Hermes 0.21.4 in a temp `HERMES_HOME`, headless Chromium with the CDP virtual authenticator: `WebAuthn.enable` + `addVirtualAuthenticator` ctap2/internal, resident key, UV, via `tab.run` with raw Puppeteer `page`). Screenshots in `../m0-04-smoke/`.
  - First-run setup → Security → **register** "Mac" (resident credential, rpId `localhost`) → **rename** to "MacBook".
  - **Step-up:** Change password → server 403 `step-up-required` → dialog "Confirm it's you" → Use passkey → saved ("Password changed."), dialog closed.
  - **Revoke:** a phone session (Safari on iPhone UA) listed → Revoke → its next request 401.
  - **Conditional UI:** Sign out → the sign-in page's autofill request was answered by the virtual authenticator with no click (audit: `session.sign-out` then `session.sign-in-passkey` in the same second; seen twice).
  - **Passkey-only:** Turn off password sign-in (step-up) → sign out → the sign-in screen shows only "Sign in with a passkey" → clicked → Home. Then Set a password (step-up on the new session) → on again.
  - Widths 390/320/820 (coarse pointer) and 1440 (fine): sign-in, Security, Security with rename form + delete confirm, step-up dialog, cancelled step-up, Home. No horizontal overflow, nothing outside the viewport, axe (wcag2a/aa, 21aa, 22aa, best-practice) clean, targets ≥44 px coarse / ≥24 px fine. Fixed during the check: the Security "Home" back link was 43 px wide.
  - Console: no errors except Chrome's network log line `Failed to load resource: … 403 (Forbidden)` for the deliberate `step-up-required` answer before the dialog (expected protocol, like M0 #03's `ERR_ABORTED` note).
- **Deviations:**
  - **No Playwright tests** (AGENTS.md): the "end-to-end tests using a virtual authenticator" are the HTTP-seam tests with the software authenticator plus the virtual-authenticator browser smoke check above.
  - **Password removal** was added so "the last remaining sign-in method cannot be deleted" is real: the owner may go passkey-only (architecture §8 already allows a passkey-only owner) and set a password again. Both are behind step-up and are the helper's first consumers.
  - **Passkey register/delete are not behind step-up**, so the password alone can remove a lost device's passkey. Consequence: a stolen session cookie can add or delete passkeys (audited, visible in the list). A "password or passkey" re-auth for security settings would close this; left to M0 #08's tiering.
  - Changing the password needs step-up, so a password-only owner adds a passkey first (Security says so).
  - Failed **anonymous** passkey sign-ins are not audited (unthrottled, so they could flood the log); failed password sign-ins still are.
  - Device names come from the User-Agent at sign-in (e.g. "Chrome on Mac"); Safari on iPadOS reports a Mac UA.
  - UI strings are hard-coded until the message catalogues (M1 #01).
- **Follow-ups:**
  - **M0 #05:** move Security under the shell's Settings/System nav and the step-up dialog into the shell; Home's Security link is temporary.
  - **M0 #08:** use `requireStepUp(auth)` for T2/T3 and `fetchWithStepUp` (or its successor) in the shared tier dialog; decide whether passkey management and session revoke get a tier.
  - **M0 #09:** close a revoked session's live connections (`auth.revoke` is the hook) and check step-up grants on WebSocket upgrades with `auth.hasStepUp(session.id)` (M1 #19, M7 #05).
  - **M0 #13:** set `rpId` to the stable ts.net hostname with `publicOrigin`; passkeys registered on `localhost` will not work there (register again on the phone).
  - **M5 #15:** password change for password-only owners (today it needs a passkey for step-up), and an audit-log viewer for the new entries.

### Evidence (documentation pass)
- **Commit(s):** `1999ccc` feat: passkeys, device list and step-up re-auth (M0 #04).
- **Tests added:**
  - `server/test/passkeys.test.ts` (11): Caduceus HTTP API seam over real Hermes, with a software authenticator (`fixtures/software-authenticator.ts`: P-256, `none` attestation, ES256).
  - Modified: `server/test/owner-auth.test.ts` (12, was 12; `AuthState` expectations).
- **Verification recorded:** `npm test` 50 pass, 1 opt-in skipped; both typechecks clean; `npm run test:e2e` 6 pass. Browser smoke with Chrome's CDP virtual authenticator against real Hermes 0.21.4 in a temp home: register, rename, step-up (403 then dialog then saved), revoke (next request 401), conditional UI sign-in, passkey-only and back. Widths 390/320/820 (coarse) and 1440 (fine): no overflow, axe clean, targets ≥44/24 px; screenshots in `m0-04-smoke/`. The only console line was Chrome's 403 log for the deliberate `step-up-required`. Mutation checks listed in the comment.
- **Deviations:**
  - No Playwright tests: "end-to-end with a virtual authenticator" is HTTP-seam tests with a software authenticator plus the virtual-authenticator browser smoke.
  - Password removal was added so "last sign-in method cannot be deleted" is real (passkey-only owner; both directions behind step-up).
  - Passkey register/delete were not behind step-up in this ticket; M0 #08 later tiered them (first passkey T1, further add and delete T2).
  - Changing the password needs step-up, so a password-only owner adds a passkey first.
  - Failed anonymous passkey sign-ins are not audited (unthrottled, would flood the log).
  - Device names come from the User-Agent; Safari on iPadOS reports a Mac UA.
  - UI strings are hard-coded until the catalogues (M1 #01, now deferred).
- **Follow-ups / open items:** M0 #13 sets `rpId` to the ts.net hostname (passkeys from `localhost` do not carry over; register again on the phone); M5 #15 password change for password-only owners and an audit viewer. Status: resolved.
