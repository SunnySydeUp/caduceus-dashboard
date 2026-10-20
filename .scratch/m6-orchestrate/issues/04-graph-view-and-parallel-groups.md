# 04: Graph view and parallel groups

**What to build:** At 1024 px and wider, a playbook's detail page and run page can show a DAG of the stages. Edges are labelled with their condition (done, fail, approve, reject, always), loops are drawn back to their target with the attempt cap, and parallel groups appear as side-by-side lanes. On a run, each node shows its live status and attempt count. The graph is navigable with the keyboard, and the stage list stays available as an accessible alternative. Narrower screens keep the vertical stage list from 01.

Definitions gain **parallel groups**: several stages that start together. A join stage waits for all of them, which the engine expresses as Kanban `parents`. The run page also gets a compact view (one line per stage) and a raw view (the underlying tagged tasks with their Kanban fields).

**Blocked by:** 03 (Gates, verdicts and loops)

**Status:** resolved

- [x] The graph renders every seed correctly at ≥ 1024 px and is not offered below it; the graph code is lazy-loaded and does not count against the initial JS budget.
- [x] Edge labels, loop-backs with `max_attempts`, gate badges and parallel lanes are drawn; on a run, nodes reflect live Kanban status.
- [x] Keyboard: arrow keys move between connected nodes, Enter opens the stage inspector or task, and focus is visible; axe is clean; a "View as list" toggle is always present.
- [x] Schema and engine support parallel groups: all branch tasks are created together, and the join is created with all of them as `parents` and starts only when every branch is done (test).
  Deviation: a parallel group is not a separate field: several edges out of one stage start together, and a stage several stages lead to is the join (made once, when every one of them has a passing attempt, with all of them as parents). The graph draws such stages as side-by-side lanes.
- [x] Failure in one branch follows that branch's `on_fail` without corrupting the others (test).
- [x] Compact and raw run views; the raw view shows each task's `workflow_template_id`, `current_step_key`, status and links.
- [x] Passes the M0 #05 gates; strings via catalogues; help updated (Parallel group).
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `4f21c81` feat: playbook graph view and parallel groups: joins that wait for every branch, lazy SVG graph at 1024 px and wider with keyboard and live run status, compact and raw run views (M6 #04)
- **Tests added:**
  - `server/test/playbook-engine.test.ts` (changed in `4f21c81`): 23 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `server/test/playbook-plan.test.ts` (changed in `4f21c81`): 18 `test(`/`it(` cases (whole file); seam: server pure module
  - `web/test/playbook-graph.test.ts` (added in `4f21c81`): 25 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/playbook-runs-model.test.ts` (changed in `4f21c81`): 18 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/work-module.test.ts` (changed in `4f21c81`): 5 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. The ticket names tests for parallel branches created together, the join waiting for every branch, and a failing branch not corrupting the others. Axe and keyboard navigation criteria are ticked; no run output is recorded (not recorded). The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - A parallel group is not a separate field. Several edges out of one stage start together. A stage several stages lead to is the join (made once, when every one of them has a passing attempt, with all of them as parents). The graph draws such stages as side-by-side lanes.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
