# 08: Shell hooks and terminal backends

**What to build:** Agents › Tools & MCP › Hooks lists Hermes's shell hooks (Hermes's ops hooks endpoint) with event and command, and lets the owner create and remove them.

Agents › Tools & MCP › Terminal sets the profile's terminal backend (local / ssh / docker) from Hermes's terminal backends endpoints and its working directory. When a backend is remote, workspace paths shown in the composer workspace chip and task workspaces are labelled as remote, and Hermes's validation of remote paths is surfaced.

**Blocked by:** 06 (Toolsets and tool routing)

**Status:** resolved

- [x] Hooks list shows each hook's event, command and profile; empty state offers Create hook.
- [x] Create hook is T3 with the full command shown in the typed confirmation; remove is T2; both blocked in read-only mode and offline.
- [x] Terminal backend choices come from Hermes; switching backend saves through Hermes and shows a restart-required note if Hermes reports one.
- [x] With an ssh/docker backend, the workspace chip and workspace pickers show a remote badge and paths Hermes rejects show Hermes's error (test with a mocked validation failure).
  Deviation: no mock needed. Hermes refuses a path it cannot find on its own Mac (`session.cwd.set`, `GET /api/fs/list`) with a real error, which the test shows verbatim; the page adds why under a remote backend. Hermes has no check for remote paths, so the working-directory field under a remote backend is saved as typed.
- [x] Phone: hooks list with ⋮ remove; create is a full-screen sheet.
- [x] Every new screen passes the M0 #05 gates (390, 320, 820, 1440; no overflow; axe clean; hit targets; tokens only). catalogue part deferred (owner). The module registers its help page and glossary terms (shell hook, terminal backend, remote workspace).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `639f593 feat: Agents › Tools & MCP › Hooks and Terminal: shell hooks, terminal backends, working directory, remote workspace labels (M4 #08)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `639f593` `server/test/hooks-backends-hermes.test.ts`: 12 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
- **Verification recorded:** The criterion "passes the M0 #05 gates" (390, 320, 820, 1440; overflow, axe, hit targets, tokens) is ticked; widths and results not recorded. The remote-path check was tested with real Hermes errors, not a mock.
- **Deviations:**
  - No mock was needed: Hermes refuses a path it cannot find on its own Mac (`session.cwd.set`, `GET /api/fs/list`) with a real error, which the test shows verbatim. The page adds why under a remote backend. Hermes has no check for remote paths, so the working-directory field under a remote backend is saved as typed.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
