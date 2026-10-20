# 08: Config form

**What to build:** System › Config renders Hermes configuration as a form generated from Hermes's config schema, defaults and current values. It has search plus `@modified`, `@profile` and `@restart-required` filters, and each field has a deep link. The owner can reset a field to its default and review a diff of all pending changes. Save goes through Hermes's config endpoint and is T3, because config can enable execution paths. Afterwards, fields that need a restart prompt the owner through ticket 01's restart banner or a backend restart.

**Blocked by:** M0 #08 (Policy proxy, risk tiers, read-only mode and tiered confirmations), M1 #02 (Contextual help framework)

**Status:** resolved

- [x] It is registered through the module registry and passes the M0 #05 gates at phone 390, small phone 320, tablet 820 and desktop 1440.
- [x] The form is driven entirely by Hermes's schema. A schema fixture with a new key renders without code changes (test).
- [x] Search and the three filters work together and are kept in the URL. Field deep links scroll to and highlight the field.
- [x] Reset to default stages the default value. The diff review lists every changed key, old and new.
- [x] Save is T3 with typed confirmation, refused in read-only mode and offline, and audited with the changed keys (not secret values).
- [x] After save, restart-required changes raise a restart prompt.
  Deviation: Hermes flags no key as restart-required, so Caduceus keeps its own list of keys the gateway reads once at start (`needsRestart` in `config-model.ts`). The prompt is ticket 01's gateway banner; no backend restart is offered.
- [x] Phone: sections become a list that drills into its fields, and Save sits in a sticky footer with the diff in a sheet.
- [x] The unsaved-changes guard stops the owner from navigating away and losing edits.
- [x] Every string goes through the message catalogues; the module registers its help page and glossary terms (restart-required, modified, default value), and the help test passes.
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `bfbd7be` feat: System › Config schema-driven form with search, filters, reset, diff review and T3 save (M5 #08)
- **Tests added:**
  - `server/test/config-hermes.test.ts` (added in `bfbd7be`): 3 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `server/test/policy-proxy.test.ts` (changed in `bfbd7be`): 13 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API with the fake Hermes launcher
  - `web/test/config-model.test.ts` (added in `bfbd7be`): 16 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/shortcuts.test.ts` (changed in `bfbd7be`): 12 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. Per the ticket: a schema fixture with a new key renders without code changes (test). The help-page criterion says the help test passes. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded). The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - Hermes flags no key as restart-required. Caduceus keeps its own list of keys the gateway reads once at start (`needsRestart` in `config-model.ts`). The prompt is the ticket 01 gateway banner; no backend restart is offered.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
