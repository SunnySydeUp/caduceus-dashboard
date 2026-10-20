# 02: Profile file editors

**What to build:** Profile detail gains editors for the profile's behaviour files: SOUL.md on Identity (Hermes's profile soul endpoint), AGENTS.md / HERMES.md on Instructions, MEMORY.md / USER.md on Memory, and raw config.yaml on Files (Hermes's raw config endpoint with the profile parameter). Files without a dedicated endpoint use Hermes's fs read-text / write-text, limited by the proxy to the scoped profile's directory.

Each editor offers Preview / Edit / Split (Split on wide screens only), an unsaved-changes guard on navigation, and size versus limit indicators for MEMORY and USER from Hermes's memory endpoint with a reset action. Before every write Caduceus stores the previous text as a snapshot (R1 ring buffer), and the owner can view and restore the previous version.

**Blocked by:** 01 (Profiles list and overview)

**Status:** resolved

- [x] SOUL, AGENTS/HERMES, MEMORY/USER and config.yaml load from Hermes and save back through Hermes; no Caduceus copy is kept except the R1 pre-write snapshots.
- [x] Every write (soul PUT, fs write-text, raw config PUT) is T3 per the proxy map, blocked in read-only mode and offline; writes outside the scoped profile directory or to `.env`/`auth.json`/`caduceus/` are denied (test).
  Deviation: the file guard confines writes to the Hermes root home and the roots the server is given (`fileRoots`), not to each profile's own folder, so a write into another profile's folder is allowed (and still T3). Offline is refused by `fetchTiered` (its own test), not by the server.
- [x] Before each write the prior text is snapshotted; a History control lists snapshots with time and size and Restore previous writes it back (itself a T3 write that is snapshotted first) (test).
- [x] MEMORY and USER show current size against the configured limit; Reset (MEMORY / USER / all) is T3 via Hermes's memory reset endpoint.
- [x] Raw config.yaml is validated as YAML before save; invalid YAML blocks saving with the parse error located.
- [x] Unsaved guard: leaving with edits prompts Keep editing / Discard; a save conflict (file changed in Hermes since load) shows a diff and refuses a blind overwrite.
  The conflict check is the `X-Caduceus-Base-Sha256` header of a save, enforced by the server (409 with the text now in Hermes).
- [x] Phone: editors are full-screen with Preview/Edit toggle (no Split), stay above the keyboard; raw config.yaml is read-only on phones with a hand-off to desktop.
- [x] Every new screen passes the M0 #05 gates (390, 320, 820, 1440; no overflow; axe clean; hit targets; tokens only). All strings come from the catalogues, and the module registers its help page and glossary terms (SOUL, AGENTS.md, MEMORY.md, USER.md, snapshot).
  Catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `cedd930 feat: profile behaviour-file editors with snapshots, conflict check and masked config.yaml (M4 #02)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `cedd930` `server/test/behaviour-files-hermes.test.ts`: 13 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `cedd930` `server/test/policy-proxy.test.ts`: 14 cases; seam: Caduceus HTTP/WS API over the fake Hermes fixture.
  - `cedd930` `web/test/behaviour-files.test.ts`: 5 cases; seam: pure web module (model/render).
  - `cedd930` `web/test/gateway-model.test.ts`: 12 cases; seam: pure web module (model/render).
  - `cedd930` `web/test/profiles-model.test.ts`: 13 cases; seam: pure web module (model/render).
  - `cedd930` `web/test/tiered-fetch.test.ts`: 14 cases; seam: pure web module (model/render).
- **Verification recorded:** The criterion "passes the M0 #05 gates" (390, 320, 820, 1440; overflow, axe, hit targets, tokens) is ticked; widths and results not recorded. Server test covers the conflict check (409 with the current text), snapshots and the write guard. Perf numbers: not recorded.
- **Deviations:**
  - The file guard confines writes to the Hermes root home and the roots given to the server (`fileRoots`), not to each profile's own folder. A write into another profile's folder is allowed (still T3).
  - Offline is refused by `fetchTiered` (its own test), not by the server.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
