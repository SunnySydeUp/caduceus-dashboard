# 13: Diagnostics and operations

**What to build:** System › Maintenance runs Hermes's doctor, security audit, prompt size, config migrate and support dump operations (T1 where costly) and shows their output with status from Hermes's action status endpoint. Debug share uploads a redacted bundle through Hermes's debug-share operation at T3; the gateway's Nous diagnostics share remains Denied.

Install facts (Hermes, Caduceus and contract versions, host identity) come with Copy for bug report. The restricted `hermes>` console opens Hermes's console socket at T2, limited to its allow-list. "Restart Hermes backend" and "Restart Caduceus server" replace WebUI's stop and hot-reload buttons; both are T2, drained, and clients resume. Help › API reference renders the pinned REST and gateway contracts read-only.

**Blocked by:** M0 #08 (Policy proxy, risk tiers, read-only mode and tiered confirmations), M1 #02 (Contextual help framework)

**Status:** resolved

- [x] It is registered through the module registry and passes the M0 #05 gates at phone 390, small phone 320, tablet 820 and desktop 1440.
- [x] Doctor, security audit, prompt size and support dump run with live status and show their results. The costly ones are T1.
- [x] Debug share is T3 with typed confirmation and shows what is redacted. The Nous share RPC stays Denied (proxy test).
  - Deviation: the upload itself was not run end to end (it would reach a public paste service); the T3 route is classified and tested through the policy map, and the page shows the answer's `redacted` flag and auto-delete time.
- [x] Copy for bug report puts a redacted install-facts block on the clipboard.
- [x] The `hermes>` console requires T2, rejects commands outside Hermes's restricted set, audits the session, and is hidden on phones with an explicit "open anyway" option.
- [x] Both restarts are T2, drain first, and connected clients resume (test).
- [x] The API reference renders from the pinned contracts with no call to Hermes's docs routes.
  - Deviation: it is the API reference tab of System › Maintenance (`/system/maintenance/api`), which the help page of the same name points to, not a page inside the Help panel: the list has hundreds of entries with search and filters.
- [x] Every string goes through the message catalogues; the module registers its help page and glossary terms (doctor, security audit, support dump, debug share), and the help test passes.
  - Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `f86a78a` feat: System › Maintenance › Diagnostics: Hermes diagnostic actions with live output, debug share, install facts with Copy for bug report, drained restarts of Hermes and Caduceus, audited hermes> console, API reference from the pinned contracts (M5 #13)
- **Tests added:**
  - `server/test/console-hermes.test.ts` (added in `f86a78a`): 6 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `server/test/fixtures/fake-hermes.mjs` (changed in `f86a78a`): fixture, no cases
  - `server/test/gateway-proxy.test.ts` (changed in `f86a78a`): 23 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API with the fake Hermes launcher
  - `server/test/maintenance.test.ts` (added in `f86a78a`): 12 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API with the fake Hermes launcher
  - `server/test/updates.test.ts` (changed in `f86a78a`): 19 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API with the fake Hermes launcher
  - `web/test/api-reference-model.test.ts` (added in `f86a78a`): 3 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/console-model.test.ts` (added in `f86a78a`): 7 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/diagnostics-model.test.ts` (added in `f86a78a`): 6 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. The debug-share upload was not run end to end (it would reach a public paste service); its T3 route is classified and tested through the policy map. Both restarts are covered by a test (T2, drain first, clients resume). The help-page criterion says the help test passes. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded). The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - The debug-share upload was not run end to end. The T3 route is classified and tested through the policy map; the page shows the answer's `redacted` flag and auto-delete time.
  - The API reference is the API reference tab of System › Maintenance (`/system/maintenance/api`), not a page inside the Help panel, because the list has hundreds of entries with search and filters.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - The debug-share upload to the paste service is not verified.
