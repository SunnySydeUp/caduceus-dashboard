# 10: Projects and spaces

**What to build:** Work › Projects shows the Hermes projects tree (`GET /api/profiles/projects/tree`, gateway `projects.*`), with discover-repos to add projects found on disk. A project overview (`/work/projects/:projectId`) shows the repo, git status summary and recent commits from Hermes's git endpoints, docs found in the repo (README and docs folder, previewed), and the Kanban boards and tasks linked to that project.

The workspace registry is Caduceus's list of named directories (Hermes projects are WebUI's "spaces"): add (validated through Hermes's file list), rename, reorder and remove. It feeds the composer's workspace chip and the Brief editor's workspace field. Removing a registry entry never deletes files.

**Blocked by:** M0 #08 (Policy proxy, risk tiers, read-only mode and tiered confirmations), M0 #09 (Live gateway connection with reconnect), M1 #02 (Contextual help framework)

**Status:** resolved

- [x] The projects tree matches Hermes across profiles; create, rename and activate through `projects.*` are T1 (contract tests).
- [x] Discover repos lists candidates and adds the chosen ones as Hermes projects.
- [x] Project overview shows repo path, branch, ahead/behind, dirty count and recent commits; docs preview renders Markdown; linked boards/tasks open their Work screens.
  - Deviation: Hermes's git endpoints give only the subjects of the ten latest commits (`review/commit-context`), so the list shows subjects without hashes or dates.
- [x] Workspace registry add validates the path exists inside allowed roots; rename and reorder (↑/↓ alternative to drag) are T0; remove is T1 and states files are untouched.
  - Deviation: add is T1 too (a registered workspace turns a raw file write inside it from T3 into T1), and the dialog says so.
- [x] The composer workspace chip and the Brief editor list registry entries in registry order (integration test).
- [x] Only the registry is stored by Caduceus; project data is always read from Hermes.
- [x] Phone: tree becomes a drill-down list; overview sections stack.
- [x] Every screen passes the M0 #05 gates (390, 320, 820, 1440); all strings come from the catalogues; the module registers its help page and glossary terms (Project, Workspace).
  - Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `5bb4ec9 feat: Work › Projects: Hermes projects tree, discover repos, project overview, workspace registry feeding the composer chip and the Brief editor (M3 #10)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `5bb4ec9` `server/test/projects-hermes.test.ts`: 7 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `5bb4ec9` `server/test/workspaces.test.ts`: 6 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `5bb4ec9` `web/test/work-module.test.ts`: 5 cases; seam: pure web module (model/render).
- **Verification recorded:** Criteria ticked: contract tests for `projects.*`; integration test for composer chip and Brief editor order. Gate widths and results: not recorded.
- **Deviations:**
  - Hermes's git endpoints give only the subjects of the ten latest commits (`review/commit-context`), so the list shows subjects without hashes or dates.
  - Registry add is T1 too: a registered workspace turns a raw file write inside it from T3 into T1. The dialog says so.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
