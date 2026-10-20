# 06: Logs

**What to build:** Observe › Logs reads Hermes's logs endpoint with filters for file, level and component, a structured query, and server-side search through its search parameter. Live tail uses Caduceus's R12 relay. The Caduceus server tails Hermes logs once and pushes new lines to each subscribed client, and the viewer can pause and jump back to live. Lines can be copied, the current view downloaded, and the filter state is a deep link.

"Truncate file" is a Caduceus-owned guarded file operation (R11) at T3, with typed confirmation of the file name.

**Blocked by:** M0 #08 (Policy proxy, risk tiers, read-only mode and tiered confirmations), M1 #02 (Contextual help framework)

**Status:** resolved

- [x] It is registered through the module registry and passes the M0 #05 gates at phone 390, small phone 320, tablet 820 and desktop 1440.
- [x] Filters and search map onto Hermes's log query parameters and live in the URL. Opening a deep link restores the view.
- [x] The live tail relay keeps one upstream tail however many clients subscribe, and stops when the last one leaves (test). Pause buffers lines, and Jump to live catches up.
- [x] Long logs are virtualised and stay responsive within the mobile performance budget.
- [x] Download saves the filtered view. Copy works per line and per selection.
- [x] Truncate is T3, only touches Hermes log files inside allowed roots, is refused in read-only mode and offline, and is audited (tests).
- [x] Phone: the filters collapse into a sheet, lines wrap, and the toolbar uses visible buttons rather than gestures.
- [x] Every string goes through the message catalogues; the module registers its help page and glossary terms (log level, component, live tail), and the help test passes.
  Deviation: catalogue part deferred (owner); strings are plain English. The help page and the glossary terms (log level, component, live tail) are registered and the help test passes.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `94e196e` feat: Observe › Logs with filters, server-side search, live tail relay and guarded Truncate file (M5 #06)
- **Tests added:**
  - `server/test/fixtures/event-stream.ts` (added in `94e196e`): fixture, no cases
  - `server/test/fixtures/seed-logs.ts` (added in `94e196e`): fixture, no cases
  - `server/test/log-relay.test.ts` (added in `94e196e`): 7 `test(`/`it(` cases (whole file); seam: server pure module
  - `server/test/logs-hermes.test.ts` (added in `94e196e`): 11 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `web/test/logs-model.test.ts` (added in `94e196e`): 15 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/shortcuts.test.ts` (changed in `94e196e`): 12 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/sw-cache-rules.test.ts` (changed in `94e196e`): 6 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/tiered-fetch.test.ts` (changed in `94e196e`): 11 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. The ticket names tests for the live tail relay (one upstream tail for many clients, stops when the last leaves) and for Truncate (T3, allowed roots, refused in read-only mode and offline, audited). The help-page criterion says the help test passes. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded). The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - Strings are plain English; the help page and glossary terms (log level, component, live tail) are registered and the help test passes.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
