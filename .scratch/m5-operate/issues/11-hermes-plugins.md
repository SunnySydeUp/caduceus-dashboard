# 11: Hermes plugins

**What to build:** System › Plugins lists Hermes agent plugins from Hermes's agent-plugins endpoints. The owner can enable or disable them, update them (T3, because this runs git-installed Python), and remove them. Plugins can be installed from a git URL (T3), or from a curated catalogue with descriptions. Install and update stream their logs live.

**Blocked by:** M0 #08 (Policy proxy, risk tiers, read-only mode and tiered confirmations), M1 #02 (Contextual help framework)

**Status:** resolved

- [x] It is registered through the module registry and passes the M0 #05 gates at phone 390, small phone 320, tablet 820 and desktop 1440.
- [x] The installed list and enabled state come from Hermes, with no copy kept by Caduceus.
- [x] Install and update are T3 with typed confirmation of the plugin name or URL, refused in read-only mode and offline, and audited.
- [x] Enable/disable and remove are T1 with the plugin named.
- [x] Install and update logs stream live and end with a clear success or failure.
  Deviation: Hermes's install/update REST routes block and send no progress, so Caduceus runs `hermes plugins install|update` (same code) and relays its output over server-sent events; list, enable, disable and remove use Hermes's REST routes.
- [x] Actions that need a restart raise the restart prompt.
- [x] Phone: card list, with install as a full-screen sheet. The empty state offers Browse catalogue.
- [x] Every string goes through the message catalogues; the module registers its help page and glossary terms (plugin, catalogue), and the help test passes.
  Deviation: catalogue part deferred (owner). Catalogue installs cannot be exercised offline (they clone the entry's GitHub repo at a pinned SHA), so the test checks the request and a clean failure. The UI update ceremony could not be completed in the headless browser (passkey prompt hung); update is covered at the API seam.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `8a25987` feat: System › Plugins: installed list, enable/disable/remove, install and update with live logs, curated catalogue (M5 #11)
- **Tests added:**
  - `server/test/fixtures/plugin-repo.ts` (added in `8a25987`): fixture, no cases
  - `server/test/hermes-backend.test.ts` (changed in `8a25987`): 11 `test(`/`it(` cases (whole file); seam: server pure module
  - `server/test/plugins-hermes.test.ts` (added in `8a25987`): 6 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `web/test/plugins-model.test.ts` (added in `8a25987`): 8 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. The ticket records that catalogue installs cannot be exercised offline (they clone the entry's GitHub repo at a pinned SHA), so the test checks the request and a clean failure. The UI update ceremony could not be completed in the headless browser (passkey prompt hung); update is covered at the API seam. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded). The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - Hermes's install/update REST routes block and send no progress. Caduceus runs `hermes plugins install|update` (same code) and relays its output over server-sent events. List, enable, disable and remove use Hermes's REST routes.
  - Catalogue installs are not exercised offline (see Verification recorded).
  - The UI update ceremony was not completed in the headless browser.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - A catalogue install and the UI update ceremony were not verified end to end.
