# 03: Tasks list with saved filters

**What to build:** Work › Tasks is a dense list of Kanban tasks across the current board. On wide screens it is a sortable table (title, status, assignee, priority, project, template, updated, last run outcome); on phones each row restacks into a card. Rows open task detail.

Saved filters sit above the list: Mine (assigned to the profile in scope), Waiting for me (`review` and `blocked` with `needs_input`), Failed (gave up or last run failed), By playbook (`workflow_template_id`), By project. They map onto the Kanban list endpoint's query parameters, so filtering happens in Hermes, and the active filter lives in `/work/tasks?filter=` so it can be bookmarked and deep-linked from Home and the Inbox. Owner-defined saved filters are stored in the Caduceus store as filter definitions only.

**Blocked by:** 01 (Board tracer bullet)

**Status:** resolved

- [x] The table virtualises and stays responsive with 2,000 tasks (performance test against a stub).
- [x] Each built-in filter returns exactly the tasks Hermes returns for the equivalent query (contract test per filter).
Deviation: Hermes's Kanban endpoints take only `tenant` and `workflow_template_id` as filters, so By playbook is asked of Hermes and the other filters (Mine, Waiting for me, Failed, By project) are applied by the page to Hermes's board answer. The contract test compares each with `hermes kanban list` and the board endpoint's own query. Failed reads Hermes's `consecutive_failures` and `last_failure_error` on the task.
- [x] The active filter, sort and search are in the URL; reload and back/forward restore them.
- [x] The owner can save, rename and delete custom filters; only the filter definition is stored in the Caduceus store.
- [x] Phone 390 and 320 show restacked cards with status, assignee and age, no horizontal scroll; desktop shows the table with column sort by click and keyboard.
- [x] The list updates live from Kanban events while a filter is applied.
- [x] Empty filter results show the primary action (New task, or Clear filter).
Deviation: with no task at all, New task is shown disabled with its explanation (creating tasks is M3 #07), as on the board.
- [x] Every screen passes the M0 #05 gates (390, 320, 820, 1440); all strings come from the catalogues; the module registers its help page and glossary terms (Saved filter, Waiting for me).
Deviation: catalogue part deferred (owner); the M0 #05 gates were run as the throwaway smoke check, not Playwright. The Last run column reads the task's own fields (the board list carries no run rows).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `4978a4a feat: Work › Tasks sortable virtualised list with saved filters (M3 #03)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `4978a4a` `server/test/kanban-task-filters.test.ts`: 4 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `4978a4a` `server/test/saved-filters.test.ts`: 3 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `4978a4a` `web/test/shortcuts.test.ts`: 12 cases; seam: pure web module (model/render).
  - `4978a4a` `web/test/tasks-model.test.ts`: 11 cases; seam: pure web module (model/render).
  - `4978a4a` `web/test/tasks-table-render.test.ts`: 2 cases; seam: pure web module (model/render).
  - `4978a4a` `web/test/work-module.test.ts`: 2 cases; seam: pure web module (model/render).
- **Verification recorded:** The 2,000-task performance criterion and the per-filter contract test criterion are ticked; no timing numbers recorded. The M0 #05 gates ran as the throwaway smoke check, not Playwright; widths and results not recorded.
- **Deviations:**
  - Hermes's Kanban endpoints take only `tenant` and `workflow_template_id`. By playbook is asked of Hermes; Mine, Waiting for me, Failed and By project are applied by the page to Hermes's board answer. The contract test compares each filter with `hermes kanban list` and the board endpoint's own query. Failed reads `consecutive_failures` and `last_failure_error` on the task.
  - With no task at all, New task is shown disabled with its explanation (creating tasks is M3 #07), as on the board.
  - The M0 #05 gates ran as the throwaway smoke check, not as Playwright tests. The Last run column reads the task's own fields, because the board list carries no run rows.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
