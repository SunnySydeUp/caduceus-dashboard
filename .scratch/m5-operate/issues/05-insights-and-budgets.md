# 05: Insights and budgets

**What to build:** Observe › Insights turns Hermes's usage analytics into charts: tokens, estimated and actual cost, cache and reasoning tokens over a chosen period. The data is broken down by model, source and profile. It also shows an activity heatmap, an hour-of-day chart and top skills. The data comes from Hermes's usage and models analytics endpoints and the gateway's `insights.get` method, and the cost fields that the stock dashboard hides are shown.

A provider quota card replaces the commandcode-usage plugin, using the account-usage windows from the gateway's `session.usage`. It shows spend pace against the current budget. Budgets are Caduceus-owned (R9) definitions: an amount per period, optionally per profile. When usage crosses 80% or 100% of a budget, an item goes to the Inbox and a push is sent under a budget category. Enforcement (the hard stop) is M6 #06 and not part of this ticket.

**Blocked by:** M1 #02 (Contextual help framework), M2 #03 (Web Push notifications)

**Status:** resolved

- [x] It is registered through the module registry and passes the M0 #05 gates at phone 390, small phone 320, tablet 820 and desktop 1440.
- [x] Charts read Hermes analytics live for the selected period (1 to 365 days). Nothing is copied into the Caduceus store except budget definitions and alert state.
- [x] The model, source and profile breakdowns, the heatmap, hour-of-day and top skills match a stub upstream fixture.
- [x] The provider quota card uses `session.usage` windows and degrades to "not available" for providers without them.
  Deviation: only the "not available" path was exercised in a browser (the temp Hermes has no provider with account limits); the window parsing is unit-tested on the lines Hermes renders.
- [x] Budget create/edit/delete is T1. The 80% and 100% thresholds each raise exactly one Inbox item and one push per period (deduped, tested with a clock fake).
- [x] Charts have accessible table alternatives. On phones they stack, with period selection in a sheet.
- [x] Empty state (no usage yet) links to starting a chat. Empty budgets state offers Add budget.
  Deviation: the no-usage state was not exercised in a browser; the empty budgets state was.
- [x] Every string goes through the message catalogues; the module registers its help page and glossary terms (cost, cache tokens, budget, spend pace), and the help test passes.
  catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `8b6f91b` fix: budgets alert test follows push subscription becoming a T2 (passkey step-up, loopback push stub) (M5 #05)
  - `398d7d4` fix: budgets list in the order they were made (a shared timestamp tied them and the id broke the tie at random) (M5 #05)
  - `c6fe3a4` feat: Insights gates fixed (terms in sentences, heading order), budgets test clock reset, ticket resolved (M5 #05)
  - `70a1fd2` feat: Observe › Insights with usage charts and table alternatives, provider quota card, and Caduceus-owned budgets with 80%/100% Inbox and push alerts (M5 #05)
  - Fix commits: `398d7d4` lists budgets in creation order (a shared timestamp tied and the id broke the tie at random); `c6fe3a4` fixes Insights gate findings (terms in sentences, heading order), resets the budgets test clock and marks the ticket resolved; `8b6f91b` makes the budgets alert test follow push subscription becoming T2 (passkey step-up, loopback push stub). `398d7d4` changes no test file.
- **Tests added:**
  - `server/test/budgets.test.ts` (changed in `8b6f91b`): 5 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API with the fake Hermes launcher
  - `398d7d4`: no test file changed.
  - `server/test/budgets.test.ts` (changed in `c6fe3a4`): 5 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API with the fake Hermes launcher
  - `server/test/budgets.test.ts` (added in `70a1fd2`): 5 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API with the fake Hermes launcher
  - `web/test/insights-model.test.ts` (added in `70a1fd2`): 10 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. Per the ticket: the 80% and 100% alerts (one Inbox item and one push per period) are tested with a clock fake; the breakdowns match a stub upstream fixture. Browser: only the "not available" quota path and the empty budgets state were exercised. The no-usage state was not exercised in a browser. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded). The fix commit `c6fe3a4` subject records gate fixes; it gives no gate output.
- **Deviations:**
  - Only the "not available" quota path was exercised in a browser, because the temporary Hermes has no provider with account limits. The window parsing is unit-tested on the lines Hermes renders.
  - The no-usage state was not exercised in a browser; the empty budgets state was.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - Enforcement (the hard stop) is M6 #06, not this ticket.
  - The quota card with real account-limit windows was not exercised in a browser (not verified).
