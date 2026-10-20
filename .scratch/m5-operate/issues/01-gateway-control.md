# 01: Gateway control

**What to build:** Connect › Gateway shows, for every Hermes profile, whether its messaging gateway is running, with the same status dot the profile cards use. The data comes from Hermes's profile list and status endpoints, plus the running gateway processes and a gateway health badge. The owner can start, stop or restart a profile's gateway through Hermes's gateway start / stop / restart endpoints, and drain it through the gateway drain endpoint. Stop, restart and drain are T2.

When a change elsewhere in Caduceus needs a gateway restart to apply (channels, platform settings, config), a restart-to-apply banner names the profile and offers the restart in place. Hosts that still run one gateway per profile can open Gateway › Migrate. It shows Hermes's migration plan with any blockers, and runs the migration only when nothing blocks it (T2).

**Blocked by:** M0 #08 (Policy proxy, risk tiers, read-only mode and tiered confirmations), M1 #02 (Contextual help framework)

**Status:** resolved

- [x] It is registered through the module registry and passes the M0 #05 gates at phone 390, small phone 320, tablet 820 and desktop 1440.
- [x] Status dots and running processes come from Hermes's profile list and status endpoints and update live, with no copy kept by Caduceus. Stopping a gateway outside Caduceus shows up without a reload.
- [x] Start is T1. Stop, restart and drain are T2 through the shared dialog, which shows the profile chip. Each writes an audit entry (proxy tests against a stub upstream).
- [x] A restart-to-apply banner can be raised by any module through one shared mechanism. It clears once the gateway reports a start time newer than the change.
- [x] Migrate shows the plan and its blockers. The run button is disabled while any blocker remains, and the migration itself is T2.
- [x] On phones the gateways are a card list with actions in a sheet. No gateway action sits behind a swipe.
- [x] Empty state (no gateway configured) offers Start gateway or links to Channels.
- [x] Tests: tier enforcement for each action, banner lifecycle, and a blocked migration plan.
- [x] Every string goes through the message catalogues; the module registers its help page and glossary terms (gateway, drain, multiplexed gateway), and the help test passes.
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `753fe9c` feat: gateway control, restart-to-apply banner and migrate (M5 #01)
  - `57b1707` feat: gateway control, restart-to-apply banner and migrate (M5 #01)
  - Both commits have the same subject and the same test files; both are on main. The test counts below come from `753fe9c`.
- **Tests added:**
  - `server/test/fixtures/fake-hermes.mjs` (changed in `753fe9c`): fixture, no cases
  - `server/test/gateway-control.test.ts` (added in `753fe9c`): 5 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API with the fake Hermes launcher
  - `server/test/gateway-hermes.test.ts` (added in `753fe9c`): 3 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `server/test/health-rules.test.ts` (changed in `753fe9c`): 19 `test(`/`it(` cases (whole file); seam: server pure module
  - `server/test/health.test.ts` (changed in `753fe9c`): 14 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API with the fake Hermes launcher
  - `server/test/policy-proxy.test.ts` (changed in `753fe9c`): 12 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API with the fake Hermes launcher
  - `web/test/gateway-model.test.ts` (added in `753fe9c`): 12 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/shortcuts.test.ts` (changed in `753fe9c`): 12 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. The ticket names proxy tests against a stub upstream for tier enforcement of each action (Start T1; Stop, restart, drain T2; audit entries), the banner lifecycle and a blocked migration plan. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded). The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
