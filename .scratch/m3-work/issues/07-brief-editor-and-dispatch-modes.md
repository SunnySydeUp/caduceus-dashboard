# 07: Brief editor and dispatch modes

**What to build:** New task opens the Brief editor. Sections (Goal, Context, References, Constraints, Expected output, Scope and safety) serialise into the Kanban task `body` as plain Markdown headings, with a preview of exactly what the worker will read; existing bodies parse back into sections where headings match and fall back to one free section otherwise. This replaces PatterStage's `<hermes_mission>` prompt assembly.

Structured fields map to native Kanban fields: assignee profile; model/provider override (shared model picker); reasoning effort; skills; workspace (scratch, directory from the workspace registry or a directory picker over Hermes's file list, or worktree with a branch picker from Hermes's git endpoints) plus project; max runtime; max retries; goal mode with max turns; completion contract (local-only, OWNER/REPO, PR URL); attachments and links. Toolsets are shown read-only from the assignee profile, with a link to edit it.

Four dispatch modes: **Save draft** (triage, with optional Specify, or todo), **Queue** (`ready`), **Run now** (`ready` + dispatcher nudge) and **Schedule** (once or recurring, which creates a Create-task cron job through ticket 06's builder). Editing an existing task uses the same editor. In Chat, "Make this a task" prefills a brief from the conversation.

**Blocked by:** 04 (Task detail), 06 (Schedule builder and job types)

**Status:** resolved

- [x] Sections serialise to Markdown headings and round-trip: create → reload → edit shows the same sections (unit tests, including bodies written by the CLI).
- [x] Every structured field is written to Hermes and read back on task detail Settings (contract test per field). Fields the Kanban REST API can't set (branch name, max retries, completion contract, initial status) go through the Caduceus server's `hermes kanban create` path: fixed argument list, no shell, scoped to profile and board. Fields that can't be changed after creation are shown read-only with a "duplicate with changes" action.
  Deviation: a task made through `hermes kanban create` gets its reasoning effort in a second request (the CLI has no flag for it), and a scheduled task cannot carry a reasoning effort or parents at all (its script can only call the CLI). The CLI's `--initial-status blocked` is not offered: Save draft (Triage or Todo) is how a task is parked.
- [x] Save draft, Queue, Run now and Schedule each produce the Hermes state from work-model §2.1 (tests); Schedule creates a Create-task cron job visible in Schedules.
- [x] Worktree mode lists branches from Hermes's git endpoints and validates the directory exists via Hermes's file list.
  Deviation: the workspace registry belongs to M3 #10 and does not exist yet, so the directory choice is the Browse picker over Hermes's file list (plus a typed path, checked against Hermes).
- [x] The assignee's toolsets appear read-only with an edit link; no per-task toolset is sent to Hermes.
- [x] "Make this a task" from a chat message or session prefills Goal and Context and links the source session.
- [x] Phone: the editor is a full-screen sheet with sections collapsible and fields above the soft keyboard; an unsaved-draft guard prevents loss.
  Deviation: as in the schedule builder (M3 #06), the phone editor is a full-screen page on its own route (`/work/tasks/new`, `/:taskId/edit`), not a modal sheet, so the address, the back button and the unsaved-changes guard work as for any page. Its sections fold away and the Save bar stays above the keyboard.
- [x] Every screen passes the M0 #05 gates (390, 320, 820, 1440); all strings come from the catalogues; the module registers its help page and glossary terms (Brief, dispatch mode, goal mode, completion contract).
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `79c6b6b feat: brief editor with four dispatch modes, workspace pickers, chat Make this a task, task Settings edit and duplicate (M3 #07)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `79c6b6b` `server/test/brief-hermes.test.ts`: 21 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `79c6b6b` `server/test/create-task-script.test.ts`: 7 cases; seam: Caduceus server module / HTTP API (no Hermes launcher imported).
  - `79c6b6b` `server/test/hermes-backend.test.ts`: 10 cases; seam: Caduceus HTTP/WS API over the fake Hermes fixture.
  - `79c6b6b` `server/test/schedule-jobs-hermes.test.ts`: 7 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `79c6b6b` `web/test/brief-prefill.test.ts`: 16 cases; seam: pure web module (model/render).
  - `79c6b6b` `web/test/brief-task.test.ts`: 12 cases; seam: pure web module (model/render).
  - `79c6b6b` `web/test/brief.test.ts`: 9 cases; seam: pure web module (model/render).
  - `79c6b6b` `web/test/work-module.test.ts`: 3 cases; seam: pure web module (model/render).
- **Verification recorded:** Criteria ticked: round-trip unit tests including CLI-written bodies; a contract test per field; tests for each dispatch mode. Gate widths and results: not recorded.
- **Deviations:**
  - A task made through `hermes kanban create` gets its reasoning effort in a second request (the CLI has no flag). A scheduled task cannot carry a reasoning effort or parents at all, because its script can only call the CLI. The CLI's `--initial-status blocked` is not offered; Save draft (Triage or Todo) parks a task.
  - The workspace registry belongs to M3 #10 and did not exist yet, so the directory choice is the Browse picker over Hermes's file list, plus a typed path checked against Hermes.
  - As in the schedule builder, the phone editor is a full-screen page on its own route (`/work/tasks/new`, `/:taskId/edit`), not a modal sheet. Its sections fold away and the Save bar stays above the keyboard.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - The registry-backed workspace choice is covered by M3 #10 (resolved): its criterion has the Brief editor list registry entries.
