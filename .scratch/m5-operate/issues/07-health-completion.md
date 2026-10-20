# 07: Health completion

**What to build:** This ticket completes M0's basic Health screen. Every subsystem gets an actionable plain-language reason built from Hermes's status, health and egress status endpoints, plus host identity and the idle and retirement health signals. Host stats (CPU, memory, disk) come from Hermes's system stats endpoint. When Hermes reports resource pressure, a banner appears across the app.

Home gains an errors panel that groups recent ERROR and CRITICAL log lines without duplicates and links into Logs. Health flags failures that keep recurring. Settings shows the count of open Repairs. The resource-pressure Inbox item stays with M2 #02, which reads Hermes status directly; this ticket adds the banner and the Health detail it links to.

**Blocked by:** M0 #11 (Health and Repairs), M2 #04 (Home overview)

**Status:** resolved

- [x] It is registered through the module registry and passes the M0 #05 gates at phone 390, small phone 320, tablet 820 and desktop 1440.
- [x] Each subsystem shows a state, a reason with a suggested fix, and the time of its last check. The reason text is unit-tested per signal.
- [x] Host stats and the resource-pressure banner follow Hermes's pressure signal. The banner is dismissible per session and comes back on a new episode.
  Deviation: "per session" is the shell's convention for dismissals (until the page is reloaded), not stored across reloads. Hermes's pressure is re-read on connection, session and platform events and when the tab returns (at most every 30 s), not on a timer.
- [x] The Home errors panel groups duplicate ERROR/CRITICAL lines with counts and links to Logs pre-filtered.
- [x] A failure that recurs within a window is flagged as recurring (tested with a stub upstream).
  Deviation: the history of when each Repair appeared is kept in the Caduceus server's memory only (24 h window), so a Caduceus restart forgets it.
- [x] Settings shows the Repairs count, and it updates live.
- [x] Phone: the subsystem list becomes cards, and the banner never covers the composer or the tab bar.
- [x] Every string goes through the message catalogues; the module registers its help page and glossary terms (resource pressure, recurring failure, egress), and the help test passes.
  Deviation: catalogue part deferred (owner); strings are plain English. The help page and the glossary terms are registered and the help test passes.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `39ecf4b` feat: Health completion: per-signal reasons with suggested fixes, egress/activity/identity signals, pressure banner, Home errors panel, recurring failures, Repairs count in Settings (M5 #07)
- **Tests added:**
  - `server/test/errors-panel-hermes.test.ts` (added in `39ecf4b`): 3 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `server/test/fixtures/fake-hermes.mjs` (changed in `39ecf4b`): fixture, no cases
  - `server/test/health-hermes.test.ts` (changed in `39ecf4b`): 6 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `server/test/health-rules.test.ts` (changed in `39ecf4b`): 45 `test(`/`it(` cases (whole file); seam: server pure module
  - `server/test/health.test.ts` (changed in `39ecf4b`): 16 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API with the fake Hermes launcher
  - `server/test/repair-recurrence.test.ts` (added in `39ecf4b`): 5 `test(`/`it(` cases (whole file); seam: server pure module
  - `web/test/error-groups.test.ts` (added in `39ecf4b`): 10 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/health-view.test.ts` (changed in `39ecf4b`): 3 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/pressure-banner.test.ts` (added in `39ecf4b`): 9 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. Per the ticket: reason text is unit-tested per signal; recurring failure is tested with a stub upstream. The help-page criterion says the help test passes. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded). The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - "Per session" for the pressure banner dismissal means until the page reloads; it is not stored across reloads. Hermes's pressure is re-read on connection, session and platform events and when the tab returns (at most every 30 s), not on a timer.
  - The history of when each Repair appeared is kept in Caduceus server memory only (24 h window). A Caduceus restart forgets it.
  - Strings are plain English; the help page and glossary terms are registered and the help test passes.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - The resource-pressure Inbox item stays with M2 #02 (ticket text).
