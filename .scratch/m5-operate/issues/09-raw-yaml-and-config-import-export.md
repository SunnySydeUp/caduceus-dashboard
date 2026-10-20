# 09: Raw YAML and config import/export

**What to build:** On tablet and desktop, Config › YAML edits the raw config through Hermes's raw config endpoint, with syntax and schema validation before save (T3). On phones the YAML is read-only, with a "continue on a larger screen" handoff link. The toolbar exports the config as a file. Import is staged: the file is parsed, validated and shown as a diff, then saved through the same T3 path. Reset puts a chosen section or the whole config back to its defaults (T3), and config migrate runs through Hermes's config-migrate operation.

**Blocked by:** 08 (Config form)

**Status:** resolved

- [x] It is registered through the module registry and passes the M0 #05 gates at phone 390, small phone 320, tablet 820 and desktop 1440.
- [x] Invalid YAML or schema violations block save and point to the line.
- [x] Raw save, import apply and reset are T3 each, refused in read-only mode and offline, and audited.
  Deviation: reset never clears a credential and leaves keys the schema does not name (such as `mcp_servers`) alone, so it cannot lose a server or a key.
- [x] Import never writes before the diff review is confirmed.
- [x] Export downloads the current config. Values that refer to secrets stay references, never values.
- [x] Phone (below the tablet breakpoint): the YAML is read-only with a handoff link, and there is no edit affordance (test at 390 and 320).
- [x] Config migrate shows Hermes's output and refreshes the form.
- [x] Every string goes through the message catalogues (catalogue part deferred (owner)); the module registers its help page and glossary terms (raw YAML, staged import, config migrate), and the help test passes.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `f24579a` feat: raw YAML editor, config import/export, reset and migrate; config secrets (MCP env and headers, raw file) masked and kept on save (M5 #09)
- **Tests added:**
  - `server/test/config-hermes.test.ts` (changed in `f24579a`): 18 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `server/test/mcp-hermes.test.ts` (changed in `f24579a`): 22 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `web/test/config-yaml.test.ts` (added in `f24579a`): 13 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. Per the ticket: the phone read-only YAML has a test at 390 and 320. The help-page criterion says the help test passes. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded). The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - Reset never clears a credential and leaves keys the schema does not name (such as `mcp_servers`) alone, so it cannot lose a server or a key.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
