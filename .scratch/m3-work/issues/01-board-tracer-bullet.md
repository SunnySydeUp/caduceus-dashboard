# 01: Board tracer bullet

**What to build:** Work › Board shows the current Hermes Kanban board live. Columns follow Hermes's lifecycle (Triage, Todo, Scheduled, Ready, Running, Blocked, Review, Done; Archived hidden by default) and cards show title, assignee profile, priority, block kind and a running indicator. Lanes can be grouped by status or by assignee profile, and filters narrow by assignee, priority, project, tenant and text. The URL `/work/board/:board?` carries board and filters.

Data comes from the Kanban plugin's board and task list endpoints through the policy proxy, then stays live from the Kanban events WebSocket: cards move, appear and disappear without reload, and a reconnect refetches the board. This replaces PatterStage's mission board.

On a phone the board is a status segmented control (Triage · Ready · Running · Review · Blocked · Done) above a vertical card list, with an optional snap-columns variant at 82 vw. Tapping a card opens a read-only peek (brief excerpt, status, assignee, latest run outcome) with a link to the task. This ticket is read-only; operations come in 02.

**Blocked by:** M0 #08 (Policy proxy, risk tiers, read-only mode and tiered confirmations), M0 #09 (Live gateway connection with reconnect), M1 #02 (Contextual help framework)

**Status:** resolved

- [x] The board renders every non-archived task of the current board in its Hermes status column; counts per column match Hermes (test against a stub Kanban API).
- [x] Lanes switch between by-status and by-profile; filters (assignee, priority, project, tenant, text) apply instantly and survive reload via the URL.
- [x] A Kanban event (create, status change, delete) updates the board within a second without reload; after a dropped socket the board refetches and shows no stale cards (test).
- [x] Phone 390: segmented status control over a vertical list; the snap-columns variant is selectable and remembered per device; tablet and desktop show columns.
- [x] The task peek opens as a sheet on phones and a side panel on desktop, is read-only and links to `/work/tasks/:taskId`.
- [x] Empty board shows the primary action (New task, disabled with explanation until M3 #07 lands); a Hermes Kanban error shows a Repair-style message, not a blank screen.
- [x] Nothing from Kanban is written to the Caduceus store (test asserts no Kanban tables in `caduceus.db`).
- [x] Work module registers Board in the module registry with nav entry, route and palette command "Open board".
- [x] Every screen passes the M0 #05 gates (390, 320, 820, 1440); all strings come from the catalogues; the module registers its help page and glossary terms (Task, Board, Dispatcher, block kinds).
Deviation: catalogue part deferred (owner); the M0 #05 gates were run as the throwaway smoke check, not Playwright.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `1d545be feat: Work › Board live Kanban board with lanes, filters, phone segments and task peek (M3 #01)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `1d545be` `server/test/fixtures/fake-hermes.mjs`: 0 cases; seam: fixture (test support, no cases): fake Hermes launcher.
  - `1d545be` `server/test/health-rules.test.ts`: 19 cases; seam: Caduceus server module / HTTP API (no Hermes launcher imported).
  - `1d545be` `server/test/health.test.ts`: 14 cases; seam: Caduceus HTTP/WS API over the fake Hermes fixture.
  - `1d545be` `server/test/kanban-board.test.ts`: 5 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `1d545be` `server/test/kanban-events.test.ts`: 3 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `1d545be` `server/test/policy-proxy.test.ts`: 12 cases; seam: Caduceus HTTP/WS API over the fake Hermes fixture.
  - `1d545be` `web/test/board-model.test.ts`: 13 cases; seam: pure web module (model/render).
  - `1d545be` `web/test/shortcuts.test.ts`: 12 cases; seam: pure web module (model/render).
  - `1d545be` `web/test/work-module.test.ts`: 1 cases; seam: pure web module (model/render).
- **Verification recorded:** The M0 #05 gates ran as the throwaway smoke check, not Playwright; widths and results not recorded in the ticket. Board counts, live update and reconnect, and "no Kanban tables in `caduceus.db`" are criteria ticked with tests. Perf numbers: not recorded.
- **Deviations:**
  - The M0 #05 gates ran as the throwaway smoke check, not as Playwright tests.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - New task is disabled with an explanation until M3 #07 (M3 #07 is resolved).
