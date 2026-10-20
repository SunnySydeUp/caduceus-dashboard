# 10: Hindsight browser and external notes

**What to build:** When Hindsight is the memory provider, Agents › Memory › Hindsight lets the owner browse memories, directives and mental models and run recall, reflect and add. Hermes stores only the provider config, so the Caduceus server proxies Hindsight's own HTTP API (R10), using the key obtained through Hermes's audited env reveal; nothing is cached beyond the bank list.

Notes lists MCP servers marked as notes sources and lets the owner search and preview notes. The Caduceus server acts as an MCP client to call their tools (R11 external notes), restricted to read-only tool calls.

**Blocked by:** 09 (Memory, context engine and learning graph)

**Status:** resolved

- [x] Hindsight tab appears only when Hindsight is configured; otherwise it shows how to enable it.
- [x] Recall and reflect return results in the UI; add memory is T1; all calls go through the policy proxy and are audited.
- [x] The Hindsight key is fetched via Hermes's env reveal (audited, server-side only) and never sent to the browser (test).
  Deviation: Hermes allows five reveals per 30 s, so the key is held in server memory for 60 s (dropped when Hindsight refuses it); it is never written down.
- [x] No Hindsight data is persisted by Caduceus except the bank list (D1).
- [x] Notes sources come from Hermes's MCP server config; starting an stdio notes source is T3 the first time per server; only allow-listed read/search tools can be invoked (test that other tools are refused).
  Deviation: "Marked as notes sources" is Caduceus's own per-profile preference (Hermes has no such flag); the stdio approval is stored against a hash of the command line, so a changed command asks again, and unmarking forgets it. Transports: stdio and streamable HTTP; OAuth servers and servers whose settings use `${NAME}` variables are listed as unsupported.
- [x] Search returns snippets; preview opens a note read-only.
- [x] Phone: list → detail sheet; search-first.
- [x] Every new screen passes the M0 #05 gates (390, 320, 820, 1440; no overflow; axe clean; hit targets; tokens only). All strings come from the catalogues, and the module registers its help page and glossary terms (Hindsight, directive, mental model, external notes).
  Deviation: catalogue part deferred (owner). The passkey step of the Approve-command dialog was not driven in the smoke browser (a headless browser has no authenticator, and passkeys are bound to `localhost`); the server's T3 path is tested and the approval was made through the stepped-up session's API.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `194df48 feat: Hindsight browser (memories, directives, mental models, recall, reflect, add) and external notes from MCP servers, read-only (M4 #10)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `194df48` `server/test/fixtures/hindsight-stub.ts`: 0 cases; seam: fixture (test support, no cases).
  - `194df48` `server/test/fixtures/mcp-http-server.ts`: 0 cases; seam: fixture (test support, no cases).
  - `194df48` `server/test/fixtures/mcp-server.mjs`: 0 cases; seam: fixture (test support, no cases).
  - `194df48` `server/test/hindsight-hermes.test.ts`: 13 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `194df48` `server/test/notes-hermes.test.ts`: 11 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `194df48` `server/test/notes-tools.test.ts`: 7 cases; seam: Caduceus server module / HTTP API (no Hermes launcher imported).
- **Verification recorded:** The passkey step of the Approve-command dialog was not driven in the smoke browser (a headless browser has no authenticator and passkeys are bound to `localhost`). The server's T3 path is tested, and the approval was made through the stepped-up session's API. The criterion "passes the M0 #05 gates" (390, 320, 820, 1440; overflow, axe, hit targets, tokens) is ticked; widths and results not recorded.
- **Deviations:**
  - Hermes allows five reveals per 30 s, so the key is held in server memory for 60 s (dropped when Hindsight refuses it). It is never written down.
  - "Marked as notes sources" is Caduceus's own per-profile preference (Hermes has no such flag). The stdio approval is stored against a hash of the command line, so a changed command asks again, and unmarking forgets it. Transports: stdio and streamable HTTP. OAuth servers and servers whose settings use `${NAME}` variables are listed as unsupported.
  - The passkey step of the Approve-command dialog was not driven in the browser.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - Passkey step of the Approve-command dialog has no browser check recorded.
