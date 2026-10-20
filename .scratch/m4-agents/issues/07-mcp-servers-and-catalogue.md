# 07: MCP servers and catalogue

**What to build:** Agents › Tools & MCP › MCP servers lists the scoped profile's MCP servers (Hermes's MCP servers endpoints) with status. The owner can add HTTP, SSE or stdio servers, edit them (Hermes's MCP servers PUT), authenticate with OAuth, test a server and see its tool inventory (the gateway's mcp.servers.status and tools.list/show), enable or disable, and delete.

A Catalogue tab searches Hermes's MCP catalogue and installs an entry, prompting for its required environment values.

**Blocked by:** 06 (Toolsets and tool routing)

**Status:** resolved

- [x] Add form validates per transport; adding or editing an stdio server is T3 (shows the exact command and args in the typed confirmation), HTTP/SSE use their lower proxy tier.
  Deviation: Hermes's edit is `PUT /api/mcp/servers` (replaces the whole map), so the policy map now makes it T2 while no server in the map is stdio and T3 otherwise; the typed name is the server's, and the exact command line is in the confirmation text.
- [x] Edit preserves fields the form does not show (round-trip test against Hermes's server definition).
- [x] OAuth authenticate runs Hermes's MCP auth flow and reflects the authenticated state; failure shows the reason.
  Deviation: Hermes's redirect points at its private loopback address, so from another device the owner pastes the redirect address into the sign-in sheet and Caduceus relays it (tested).
- [x] Test shows success/failure and the full tool inventory (names, descriptions) from the gateway methods.
  Deviation: the inventory comes from Hermes's REST test probe (names and descriptions), status from gateway `mcp.servers.status`; `tools.list/show` take no profile and are session-scoped, so they are not used.
- [x] Enable/disable is T0 with undo; delete is T1 naming server and profile; all writes blocked in read-only mode.
- [x] Catalogue is searchable; install prompts for each env value (masked) and lands the server in the list; an installed entry is marked.
- [x] Phone: list → detail sheet; add/edit forms are full-screen sheets.
- [x] Every new screen passes the M0 #05 gates (390, 320, 820, 1440; no overflow; axe clean; hit targets; tokens only). All strings come from the catalogues (catalogue part deferred (owner)), and the module registers its help page and glossary terms (MCP server, transport (stdio/HTTP/SSE), tool inventory).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `f041110 feat: MCP servers (add, edit, OAuth, test, toggle, delete) and the MCP catalogue (M4 #07)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `f041110` `server/test/fixtures/mcp-oauth-server.ts`: 0 cases; seam: fixture (test support, no cases).
  - `f041110` `server/test/fixtures/mcp-server.mjs`: 0 cases; seam: fixture (test support, no cases).
  - `f041110` `server/test/mcp-hermes.test.ts`: 22 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `f041110` `server/test/policy-map.test.ts`: 14 cases; seam: Caduceus server module / HTTP API (no Hermes launcher imported).
  - `f041110` `web/test/mcp-model.test.ts`: 2 cases; seam: pure web module (model/render).
- **Verification recorded:** Edit round-trip tested against Hermes's server definition; OAuth redirect relay tested; real MCP and OAuth server fixtures used (`mcp-server.mjs`, `mcp-oauth-server.ts`). The criterion "passes the M0 #05 gates" (390, 320, 820, 1440; overflow, axe, hit targets, tokens) is ticked; widths and results not recorded.
- **Deviations:**
  - Hermes's edit is `PUT /api/mcp/servers`, which replaces the whole map. The policy map makes it T2 while no server in the map is stdio, and T3 otherwise. The typed name is the server's; the exact command line is in the confirmation text.
  - Hermes's OAuth redirect points at its private loopback address. From another device the owner pastes the redirect address into the sign-in sheet and Caduceus relays it (tested).
  - The tool inventory comes from Hermes's REST test probe (names and descriptions), status from gateway `mcp.servers.status`. `tools.list/show` take no profile and are session-scoped, so they are not used.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
