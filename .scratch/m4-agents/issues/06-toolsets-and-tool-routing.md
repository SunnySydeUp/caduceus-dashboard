# 06: Toolsets and tool routing

**What to build:** Agents › Tools & MCP › Toolsets shows a grid of Hermes toolsets for the scoped profile with enabled state and setup state (Hermes's toolsets endpoints). A configure drawer sets provider, per-toolset model (Hermes's toolset model endpoints) and required keys, and runs setup (the gateway's tools.configure) with a live log.

A per-platform tab edits `platform_toolsets` as a grid of platform × toolset, with an advanced JSON view. A Tool gateway card shows how tools are routed (Nous Portal backends) from Hermes status. Computer-use permissions from Hermes's computer-use endpoints are shown and editable here.

**Blocked by:** M0 #08 (Policy proxy, risk tiers, read-only mode and tiered confirmations), M1 #02 (Contextual help framework)

**Status:** resolved

- [x] The grid lists every toolset Hermes reports with enabled and setup state (needs keys / ready / error); empty or error states carry their action.
  Deviation: Hermes's list gives only configured or not, so a toolset is Ready or Needs keys; an error is the grid's error state (Hermes not answering) with Retry, not a per-toolset state.
- [x] Configure drawer saves provider and per-toolset model through Hermes; key fields are masked and written via the Keys path (env write is T2); values are never echoed back.
- [x] Run setup streams a live log and ends with a clear success/failure state; re-opening shows Hermes's current state.
  Deviation: Run setup is Hermes's `POST /api/tools/toolsets/{name}/post-setup` (T3), whose background action log the page follows; the gateway's `tools.configure` only enables or disables toolsets for the default profile and has no setup, so toolset switches use `PUT /api/tools/toolsets/{name}` (T1, profile scoped).
- [x] Per-platform grid and advanced JSON edit the same `platform_toolsets` value; invalid JSON blocks save; saving is a config write at T3, blocked in read-only mode.
- [x] Tool gateway card shows routing read from Hermes; computer-use permission changes use their proxy tier.
  Deviation: the only computer-use change Hermes exposes is Grant permissions (T3); taking a permission back is System Settings, and the page says so. The grant itself was not run (it opens macOS dialogs); its tier and read-only refusal are tested.
- [x] Phone: grid becomes a list; configure uses a full-screen sheet; advanced JSON is read-only on phones with a hand-off note.
- [x] Every new screen passes the M0 #05 gates (390, 320, 820, 1440; no overflow; axe clean; hit targets; tokens only). All strings come from the catalogues (catalogue part deferred (owner)), and the module registers its help page and glossary terms (toolset, per-platform toolsets, tool gateway).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `aa0d094 feat: toolsets grid, configure drawer, per-platform toolsets and Tool gateway routing (M4 #06)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `aa0d094` `server/test/toolsets-hermes.test.ts`: 15 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `aa0d094` `web/test/tools-model.test.ts`: 22 cases; seam: pure web module (model/render).
- **Verification recorded:** The Grant permissions action was not run (it opens macOS dialogs); its tier and read-only refusal are tested. The criterion "passes the M0 #05 gates" (390, 320, 820, 1440; overflow, axe, hit targets, tokens) is ticked; widths and results not recorded.
- **Deviations:**
  - Hermes's list gives only configured or not, so a toolset is Ready or Needs keys. An error is the grid's error state (Hermes not answering) with Retry, not a per-toolset state.
  - Run setup is Hermes's `POST /api/tools/toolsets/{name}/post-setup` (T3), and the page follows its background action log. The gateway's `tools.configure` has no setup and only affects the default profile, so toolset switches use `PUT /api/tools/toolsets/{name}` (T1, profile scoped).
  - The only computer-use change Hermes exposes is Grant permissions (T3). Taking a permission back is done in System Settings, and the page says so. The grant itself was not run.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - Grant permissions has no live run recorded.
