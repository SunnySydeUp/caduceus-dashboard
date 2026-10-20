# 12: Updates

**What to build:** System › Maintenance › Updates checks for a newer Hermes through Hermes's update check endpoint and shows the result as an update-available banner. The matching Inbox item is M2 #02's and links here. Updating runs Hermes's update endpoint. First Caduceus drains: it pauses new turns, lets clients know, and resumes them afterwards. The update log streams live, and the result is confirmed from the update receipt endpoint, followed by a What's New summary.

Caduceus self-update updates Caduceus's own deployment the same way, with a drained restart and a What's New of its own.

**Blocked by:** M0 #11 (Health and Repairs), M1 #02 (Contextual help framework)

**Status:** resolved

- [x] It is registered through the module registry and passes the M0 #05 gates at phone 390, small phone 320, tablet 820 and desktop 1440.
- [x] Check uses Hermes's update check. The banner shows when an update is available and clears afterwards, and the M2 #02 Inbox item links to this screen.
  - Deviation: the Inbox item is M2 #02's. This ticket gives it the screen to link to (`UPDATES_PATH`, `/system/maintenance`, in `web/src/update-banners.ts`).
- [x] Hermes update is T2. It drains first, streams the log, resumes clients and verifies through the receipt (stub upstream test).
- [x] After update the pinned-contract drift check reruns, and a mismatch turns on M0 read-only automatically.
- [x] Caduceus self-update restarts the Caduceus server, and connected clients resume their streams.
  - Deviation: tested with a fake restart hook (no launchd). Connections end with close code 1001 (the page reconnects), then the hook runs while still draining. The real restart needs the background service (`restart` is given only under `CADUCEUS_CONFIG`); the owner must run `npm run caduceus -- restart` once for this code to be live.
- [x] What's New shows the summary of changes for each update.
- [x] Phone: the update log is readable full-screen, and the banner sits under the top bar.
- [x] Every string goes through the message catalogues; the module registers its help page and glossary terms (drain, update receipt, what's new), and the help test passes.
  - Deviation: catalogue part deferred (owner). The drain term's id is `update-drain` because `drain` is already the Gateway module's (Hermes's gateway drain).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `7180030` feat: System › Maintenance › Updates: Hermes and Caduceus update checks and banner, drained updates with live log and receipt check, contract drift recheck, self-update with restart, What's New (M5 #12)
- **Tests added:**
  - `server/test/fixtures/deployment-repo.ts` (added in `7180030`): fixture, no cases
  - `server/test/fixtures/fake-hermes.mjs` (changed in `7180030`): fixture, no cases
  - `server/test/update-log.test.ts` (added in `7180030`): 5 `test(`/`it(` cases (whole file); seam: server pure module
  - `server/test/updates-hermes.test.ts` (added in `7180030`): 2 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `server/test/updates.test.ts` (added in `7180030`): 19 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API with the fake Hermes launcher
  - `web/test/update-banners.test.ts` (added in `7180030`): 6 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/updates-model.test.ts` (added in `7180030`): 11 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. The Hermes update flow (drain, log, resume, receipt check) is a stub upstream test. The self-update restart was tested with a fake restart hook, not launchd; the real restart was not run. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded). The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - The Inbox item is M2 #02's. This ticket gives it the screen to link to (`UPDATES_PATH`, `/system/maintenance`, in `web/src/update-banners.ts`).
  - Self-update was tested with a fake restart hook (no launchd). Connections end with close code 1001 (the page reconnects), then the hook runs while still draining.
  - The drain glossary term id is `update-drain`, because `drain` already belongs to the Gateway module.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - The real restart needs the background service (`restart` is given only under `CADUCEUS_CONFIG`). The owner must run `npm run caduceus -- restart` once for this code to be live.
