# 04: Task detail

**What to build:** `/work/tasks/:taskId` shows one Kanban task with these tabs (a scrollable segmented header on phones):
- **Brief:** renders the Markdown body with the shared transcript renderer.
- **Runs:** lists every run with its status, outcome, duration and cost. Each run links to the run view (ticket 11).
- **Activity:** merges Kanban events and comments.
- **Links:** parents and children, with add and remove (`/links`).
- **Attachments:** list, preview, upload and delete.
- **Settings:** the structured fields, read-only, with an Edit entry. Editing lands in 07.

**Actions:**
- Run now (`ready` + a dispatcher nudge);
- Terminate the current run (`/runs/{id}/terminate`);
- Retry;
- Specify and Decompose (AI assists);
- Estimate;
- Reassign;
- Reclaim.

Comments are posted with the author stamped by the Caduceus server, never by the browser. Status changes made elsewhere (CLI, dispatcher, other devices) update the open page live from Kanban events.

**Blocked by:** 01 (Board tracer bullet), M1 #05 (Agent activity: reasoning, tools, subagents, todos)

**Status:** resolved

- [x] All six tabs load from Hermes Kanban endpoints, and deep links to a tab work.
  Deviation: each run links to `/work/runs/:runId`, which ticket 11 builds; until then the link opens Not found. Cost shows a dash unless the worker put `cost_usd` in the run metadata, since Hermes records no cost.
- [x] Tiers: Run now, Retry, Reassign and Reclaim are T1. Terminate is T1 and names the run and profile.
  Deviation: Terminate was T2 in the policy map; the ticket says T1, so the map and its test now say T1.
- [x] Decompose is T1 and shows the created subtasks as links. Specify replaces the brief only after the owner accepts a preview.
  Deviation: Hermes saves a Specify result at once (no preview endpoint), so the page shows what it wrote and Reject restores the old title, brief and column with a PATCH.
- [x] A comment posted with a forged author field is stored with Caduceus's stamped author (server test).
- [x] Attachment upload and delete work. Delete is T1 and names the file.
- [x] Status changes from other surfaces update the open detail live from Kanban events (test with a stub event stream).
- [x] Nothing about tasks or runs is copied into the Caduceus store.
- [x] Every screen passes the M0 #05 gates (390, 320, 820, 1440). All strings come from the catalogues. The module registers its help page and glossary terms (Specify, Decompose, Reclaim, Terminate).
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `43f20aa feat: task detail with six tabs, actions, live updates and server-stamped comment author; tests isolate Hermes's profile wrappers (M3 #04)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `43f20aa` `server/test/fixtures/real-hermes.ts`: 0 cases; seam: fixture (test support, no cases): Hermes launcher.
  - `43f20aa` `server/test/policy-map.test.ts`: 14 cases; seam: Caduceus server module / HTTP API (no Hermes launcher imported).
  - `43f20aa` `server/test/profile-wrapper-isolation.test.ts`: 1 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `43f20aa` `server/test/task-detail.test.ts`: 10 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `43f20aa` `web/test/task-live.test.ts`: 4 cases; seam: pure web module (model/render).
  - `43f20aa` `web/test/task-model.test.ts`: 9 cases; seam: pure web module (model/render).
  - `43f20aa` `web/test/tiered-fetch.test.ts`: 12 cases; seam: pure web module (model/render).
  - `43f20aa` `web/test/work-module.test.ts`: 3 cases; seam: pure web module (model/render).
- **Verification recorded:** Criteria ticked, including the forged-author comment server test and the live-update test with a stub event stream. The same commit makes tests isolate Hermes's profile wrappers (`profile-wrapper-isolation.test.ts`). Gate widths and results: not recorded. Perf numbers: not recorded.
- **Deviations:**
  - Each run links to `/work/runs/:runId`, which ticket 11 builds; until then the link opens Not found. Cost shows a dash unless the worker put `cost_usd` in the run metadata, since Hermes records no cost.
  - Terminate was T2 in the policy map; the ticket says T1, so the map and its test now say T1.
  - Hermes saves a Specify result at once (no preview endpoint). The page shows what it wrote, and Reject restores the old title, brief and column with a PATCH.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - The run link was Not found until M3 #11, which is resolved.
