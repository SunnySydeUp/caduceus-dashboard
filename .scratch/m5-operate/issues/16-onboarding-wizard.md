# 16: Onboarding wizard

**What to build:** On first sign-in, a resumable wizard walks the owner through setup. It first runs checks: Hermes reachable, a provider configured, gateway status, HTTPS and install state, and passkey enrolled. These come from the gateway's `setup.status` and `setup.runtime_check`. The wizard then sets up a provider with Hermes's recommended default model and providers validate, chooses a default workspace, and offers a notifications opt-in (on iOS, after install). Progress is stored in Caduceus preferences (R1), so it resumes on any device, and `profiles.remember_onboarding` is recorded when the owner finishes.

**Blocked by:** 10 (Keys, OAuth and credential pool), M2 #03 (Web Push notifications)

**Status:** resolved

- [x] It is registered through the module registry and passes the M0 #05 gates at phone 390, small phone 320, tablet 820 and desktop 1440.
- [x] Each check shows pass/fail with a fix link. The checks come from Hermes and reflect the current state.
- [x] Provider setup reuses ticket 10's flows and suggests Hermes's recommended default model.
  Deviation: no real provider account is reachable from the test environment, so a key's validation was exercised against real Hermes only as a rejection of a made-up key, and the strict per-provider check (`setup.runtime_check` with `provider`) against real Hermes with a stub provider; an accepted key and an account sign-in were not run end to end here. Saving a key is Tier 2 and the browser smoke could not complete a passkey ceremony at the smoke host, so the key was added through Hermes's API for the pass state.
- [x] Progress is saved on the Caduceus server, and leaving and returning resumes at the same step on another device (test).
- [x] Notification opt-in follows M2 #03 rules, including install-first on iOS.
- [x] The wizard can be skipped and reopened from Settings, and finishing records onboarding in Hermes.
  Deviation: finishing sends only the default folder as `context` (the one fact the wizard agrees); with no default folder Hermes's `remember_onboarding` has nothing to write and saves nothing. The default folder is Hermes's `terminal.cwd` (Tier 3, existing Terminal action), picked from the workspace registry; the T3 save was not completed in the browser smoke (no passkey ceremony at the smoke host).
- [x] Phone: one step per screen with a sticky primary action.
- [x] Every string goes through the message catalogues; the module registers its help page and glossary terms (onboarding, recommended model), and the help test passes.
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `254e38e` feat: Onboarding wizard: checks from setup.status/runtime_check, provider setup with the recommended model, default workspace, notifications opt-in, progress saved for every device (M5 #16)
- **Tests added:**
  - `server/test/onboarding-hermes.test.ts` (added in `254e38e`): 4 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `server/test/onboarding-preferences.test.ts` (added in `254e38e`): 4 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `web/test/module-registry.test.ts` (changed in `254e38e`): 10 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/setup-checks.test.ts` (added in `254e38e`): 6 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. Per the ticket: a key's validation was run against real Hermes only as a rejection of a made-up key; the strict per-provider check (`setup.runtime_check` with `provider`) was run against real Hermes with a stub provider. An accepted key and an account sign-in were not run end to end. The browser smoke could not complete a passkey ceremony at the smoke host, so the key was added through Hermes's API for the pass state, and the T3 default-folder save was not completed in the browser. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded).
- **Deviations:**
  - No real provider account is reachable from the test environment, so an accepted key and an account sign-in were not run end to end.
  - Finishing sends only the default folder as `context`. With no default folder Hermes's `remember_onboarding` has nothing to write and saves nothing. The default folder is Hermes's `terminal.cwd` (Tier 3, existing Terminal action), picked from the workspace registry; the T3 save was not completed in the browser smoke (no passkey ceremony at the smoke host).
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - An accepted provider key, an account sign-in and the T3 default-folder save in a browser are not verified.
