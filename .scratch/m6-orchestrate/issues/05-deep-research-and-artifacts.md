# 05: Deep Research and Artifacts

**What to build:** A seeded **Deep Research** playbook takes a question, a depth and a breadth as inputs. It runs on Kanban like any other playbook: plan → search and read (using the assignee's own web tools and research skills) → synthesise a cited report. The report is attached to the final task. There is no separate research engine.

A Caduceus-owned **Artifacts** store keeps derived outputs: research reports, and files a playbook or session marks as deliverables. Each artifact references its source session, task or playbook run. Workspace › Artifacts lists them with filters by source and kind, a viewer (Markdown with citations, images, PDFs, text), download and delete.

In Chat, the context panel gains an **Artifacts** tab. It shows the session's artifacts and the files the session changed, read live from Hermes's git review endpoints and `rollback.diff`.

**Blocked by:** 02 (Playbook engine tracer bullet), M1 #05 (Agent activity: reasoning, tools, subagents, todos)

**Status:** resolved

- [x] The Deep Research seed validates; depth and breadth are inputs that shape the stage briefs; a run against a test board produces a Markdown report with numbered citations attached to its final task.
- [x] When a research or deliverable task finishes, its report attachment is captured into the Artifacts store with metadata (kind, mime, size, source reference, created) and no copy of the task itself.
- [x] Artifacts screen: filter by source (session / task / playbook run) and kind, open the viewer, download; delete is T1 with undo; each artifact links back to its source.
- [x] HTML is rendered sandboxed, and any artifact with an unknown kind is offered as a download only.
- [x] Chat's Artifacts tab lists the session's artifacts and its changed files from Hermes (no stored file list); on a phone it opens in the context sheet.
- [x] Retention: a configurable size cap with oldest-first cleanup that skips pinned artifacts (test).
- [x] Passes the M0 #05 gates; strings via catalogues; Artifacts help page and glossary (Artifact, Deep Research).
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `c175931` fix: Keep in Artifacts finds a changed file below the repository root: Hermes lists it from the root, the chat may work in a folder under it (M6 #05)
  - `b260655` feat: Deep Research playbook and the Artifacts store: deliverable stages captured when their task is done, Workspace › Artifacts with viewer, download, pin, delete with undo and a size cap, chat Artifacts tab with live changed files (M6 #05)
  - Fix commit `c175931` makes Keep in Artifacts find a changed file below the repository root (Hermes lists it from the root; the chat may work in a folder under it).
- **Tests added:**
  - `server/test/artifacts.test.ts` (changed in `c175931`): 8 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `web/test/changed-files.test.ts` (changed in `c175931`): 2 `test(`/`it(` cases (whole file); seam: web pure module
  - `server/test/artifact-capture.test.ts` (added in `b260655`): 1 `test(`/`it(` cases (whole file); seam: server pure module
  - `server/test/artifacts.test.ts` (added in `b260655`): 8 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `server/test/playbook-definition.test.ts` (changed in `b260655`): 10 `test(`/`it(` cases (whole file); seam: server pure module
  - `server/test/playbooks.test.ts` (changed in `b260655`): 13 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `web/test/changed-files.test.ts` (added in `b260655`): 3 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. The ticket names a test for retention (size cap, oldest-first cleanup skipping pinned artifacts). Test files show a research-run capture test (`artifact-capture.test.ts`, 1 case). The ticket does not record a browser run of the Artifacts screen or the Chat tab (not recorded). The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded).
- **Deviations:**
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
