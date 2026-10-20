# 11: Caduceus as an MCP server

**What to build:** Caduceus ships a stdio MCP server that agents can register in Hermes. It exposes tools to list, create, rename and delete Hermes projects and to list, rename and move sessions between projects. Each tool call goes to the Caduceus server and through the policy proxy, so tiers, read-only mode and audit apply exactly as for the web app.

Agents › Tools & MCP shows an info card explaining the server, with the exact registration command and a one-click "Add to this profile" that adds it through the MCP servers flow.

**Blocked by:** 07 (MCP servers and catalogue), M0 #09 (Live gateway connection with reconnect)

**Status:** resolved

- [x] The stdio server lists its tools with schemas and works with an MCP inspector/test client (integration test).
- [x] Every tool call authenticates to the Caduceus server with a scoped token and passes through the policy proxy; read-only mode refuses writes (test).
- [x] Actions needing T2/T3 (e.g. project delete) are refused from the MCP server with a machine-readable reason instead of bypassing step-up (test).
- [x] Calls are audited with the MCP client as actor.
- [x] Results reflect Hermes's projects (gateway projects methods) and session data; Caduceus stores nothing new.
- [x] The info card shows the registration command, and "Add to this profile" registers the server through ticket 07's add flow (stdio, so T3).
- [x] Strings and help for the info card follow the catalogue and help rules.
  Deviation: catalogue part deferred (owner); the help page section and glossary term `caduceus-mcp-server` are written.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `a94b332 feat: Caduceus as an MCP server: stdio server with project and session tools through the policy proxy, scoped token, audit by MCP client, info card with registration command and Add to this profile (M4 #11)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `a94b332` `server/test/fixtures/mcp-client.ts`: 0 cases; seam: fixture (test support, no cases).
  - `a94b332` `server/test/mcp-server.test.ts`: 21 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `a94b332` `server/test/owner-auth.test.ts`: 12 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `a94b332` `web/test/caduceus-mcp.test.ts`: 4 cases; seam: pure web module (model/render).
- **Verification recorded:** Criteria ticked: stdio server with a test MCP client (`fixtures/mcp-client.ts`); read-only refusal and T2/T3 refusal with a machine-readable reason are tested; audit by MCP client. Gate widths: the ticket lists only the catalogue/help criterion; browser results not recorded.
- **Deviations:**
  - The help page section and glossary term `caduceus-mcp-server` are written.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
