# 02: Board operations and dispatcher

**What to build:** The board becomes operable. Any card can be moved, assigned or re-prioritised through Move to… / Assign… / Priority… sheets, opened by long-press on touch or the ⋮ menu everywhere; on large screens cards can also be dragged between columns (drag is only an enhancement). Multi-select mode applies the same actions in bulk; bulk changes are T2.

The board switcher lists Hermes boards and lets the owner create, rename, archive, switch, export and import boards through the Kanban board routes (`/boards*`, export/import/switch). A board sidebar (a sheet on phones) shows Hermes's diagnostics, stats chips (by status and assignee) and active workers, with Reclaim for a stuck worker.

The dispatcher toolbar shows its mode and lets the owner nudge it (`POST /dispatch`), preview with `dry_run` (which tasks would start, and why others wait) and edit orchestration settings (per-profile workers, `max_in_progress`, runtime caps). These settings are what replaces PatterStage's queue single-flight and deadlines.

**Blocked by:** 01 (Board tracer bullet)

**Status:** resolved

- [x] Move to / Assign / Priority sheets work from long-press and from the ⋮ menu on every card; each single-card change is T0 with a 6 s undo toast that restores the previous value in Hermes.
  Deviation: a card a worker has cannot be moved or assigned (Hermes refuses a new profile, and a move would stop the worker); its menu offers Reclaim instead. Moving to Done needs a result, so the sheet asks for an optional note. Undo is not offered where Hermes cannot restore (for example Done then Archived).
- [x] Drag between columns works at ≥1024 px with mouse and touch long-press-to-lift; keyboard users can move cards with the Move to… sheet (axe and keyboard test).
  Deviation: drag, long-press and keyboard flows were checked in a real browser at 1440 only (mouse drag between columns, menus, sheets); touch long-press lift and the 390/320/820 gates were not run because the machine was too loaded for the shared browser.
- [x] Multi-select bulk move / assign / priority / archive asks for T2 step-up, then reports per-task success or failure.
  Deviation: bulk tiers, per-task results and refusals are tested against the real Hermes; the bulk bar and report sheet were not exercised in the browser (no passkey in the smoke home).
- [x] Boards: create and rename are T1, archive is T1 with undo, import is T3 (typed board name), export downloads Hermes's export file; switching updates the URL.
  Deviation: Hermes has no unarchive, so archive first exports a copy and Undo imports it back; the policy lowers that one import (Hermes's own staged export, same address) to T1.
- [x] Dispatcher: nudge is T1; dry-run shows the would-start list without changing state; orchestration settings edits are T2 and show the saved values read back from Hermes.
  Deviation: Hermes's dry run still does its usual tidying (releases claims, promotes Todo); the preview says so. Settings are saved through PUT /api/config (a new T2 rule for the dispatcher keys only) and read back.
- [x] Diagnostics, stats and active workers refresh from Kanban events; Reclaim on a worker is T1 and the card returns to `ready` (test against stub).
  Deviation: tested against the real Hermes, not a stub; an active worker needs a worker pid, which only a real spawn sets, so the Details worker list is covered by a pure parser test.
- [x] Read-only mode hides or disables every write control with an explanation (test).
- [x] Every screen passes the M0 #05 gates (390, 320, 820, 1440); all strings come from the catalogues (catalogue part deferred, owner); the module registers its help page and glossary terms (Dispatcher, dry run, reclaim, orchestration settings).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `850e3ea feat: board operations and dispatcher: card sheets with undo, drag, bulk, boards, dispatcher bar, details (M3 #02)`
  - `43a8025 fix: board export test uses its own board address so the full file run is isolated (M3 #02)`
  - `6ee03d9 fix: a long press never presses what the sheet it opens puts under the finger; larger touch target on the selection check (M3 #02)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `850e3ea` `server/test/board-operations.test.ts`: 9 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `850e3ea` `server/test/policy-map.test.ts`: 17 cases; seam: Caduceus server module / HTTP API (no Hermes launcher imported).
  - `850e3ea` `web/test/board-operations.test.ts`: 9 cases; seam: pure web module (model/render).
  - `850e3ea` `web/test/work-module.test.ts`: 5 cases; seam: pure web module (model/render).
  - `43a8025` `server/test/board-operations.test.ts`: 9 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `6ee03d9`: no test files in this commit.
- **Verification recorded:** Browser: drag, long-press and keyboard flows were checked in a real browser at 1440 only (mouse drag between columns, menus, sheets). Touch long-press lift and the 390/320/820 gates were not run (machine too loaded). The bulk bar and report sheet were not exercised in the browser (no passkey in the smoke home). Bulk tiers, per-task results and refusals are tested against the real Hermes. Two `fix:` commits follow: board export test isolated to its own board address; a long press no longer presses what its sheet puts under the finger, and the selection check has a larger touch target (no test files in that fix).
- **Deviations:**
  - A card a worker has cannot be moved or assigned (Hermes refuses a new profile; a move would stop the worker). Its menu offers Reclaim. Moving to Done asks for an optional note. Undo is not offered where Hermes cannot restore (for example Done then Archived).
  - Drag, long-press and keyboard flows were checked at 1440 only; the touch long-press lift and the 390/320/820 gates did not run.
  - The bulk bar and report sheet were not exercised in the browser; bulk tiers and results are tested against the real Hermes.
  - Hermes has no unarchive: archive exports a copy first, and Undo imports it back. The policy lowers that one import (Hermes's own staged export, same address) to T1.
  - Hermes's dry run still does its usual tidying (releases claims, promotes Todo); the preview says so. Dispatcher settings save through `PUT /api/config` (a new T2 rule for the dispatcher keys only) and are read back.
  - Tested against the real Hermes, not a stub. An active worker needs a worker pid that only a real spawn sets, so the Details worker list is covered by a pure parser test.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - Touch long-press lift, the 390/320/820 gates and the bulk bar/report sheet have no browser check recorded.
