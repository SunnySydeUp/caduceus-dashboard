# 02: Playbook engine tracer bullet

**What to build:** From a playbook's detail page, the owner presses Run. A form generated from the inputs schema opens; it is a full-screen sheet on a phone. Submitting creates the first stage as a Hermes Kanban task. The task's brief is the stage template with the inputs filled in, and the stage's assignee, model, skills, goal mode and contract map onto Kanban's own fields.

**Tagging.** Hermes 0.21.4 reads and filters `workflow_template_id` / `current_step_key` but offers no way to set them. Neither the REST create body nor the CLI accepts them, so stage tasks are tagged through Hermes's settable `idempotency_key`. The key encodes playbook, version, root task, stage and attempt. Hermes returns the existing task for a repeated key, so stage creation is exactly-once for free. When a pinned contract shows that Hermes accepts the native fields on create, the engine also writes them, and the Board and Tasks filters switch to the native filter.

Caduceus's **playbook engine** subscribes to Hermes's Kanban events socket, with a periodic sweep as a safety net. When a stage task reaches `done`, the engine creates the next stage task with `parents` linking it to its predecessor. It uses the Kanban REST API, or the Caduceus server's `hermes kanban create` path when the stage sets fields REST can't (completion contract, branch, max retries). It keeps no run state of its own: on start, it reconstructs every run from the tagged tasks, their links and comments. A single-writer lease in the Caduceus data folder guarantees that two Caduceus processes never both advance a run.

The run page at `/work/playbooks/:id/runs/:rootTaskId` shows a timeline of stages with status and links to each task. The runs list groups runs by playbook. The same tasks show up on the Board and in Tasks, filterable by playbook.

**Blocked by:** 01 (Playbook definitions and library), M3 #04 (Task detail)

**Status:** resolved

- [x] Every stage task carries an `idempotency_key` encoding playbook@version, root task, stage and attempt, and is linked to its predecessor through `parents`. The engine reconstructs runs from these alone. A capability check over the pinned contracts turns on writing the native `workflow_template_id` / `current_step_key` once Hermes accepts them on create (test with a faked contract).
  Deviation: the first stage's task (the root) carries a `root-<hex>` nonce where later keys carry the root task's id, because a task cannot name its own id before it exists; the run is still named by its root task. Inputs ride in a trailing HTML comment of every stage task body, and a run started "as a profile" keeps that profile in a second comment; the capability check reads the pinned contract (tested with fake contracts).
- [x] Starting a run is T1 naming the playbook and the profiles it will assign; input validation follows the schema; tasks carry the tags and the brief sections from work-model §2.1.
- [x] A linear playbook advances stage by stage on Kanban events, and the sweep repairs a missed event (test by dropping an event).
- [x] Restart-safe: killing the Caduceus server mid-run and restarting it resumes every run with no duplicate stage tasks (idempotency keys per run + stage + attempt; test).
- [x] Single-writer lease: a second engine instance stays passive while the lease is held and takes over after it expires (test with two engines).
- [x] No Caduceus table or file stores run state; deleting the Caduceus store except definitions still lets the engine resume (test).
- [x] The engine has a single switch that hands routing to Hermes when Hermes reports native workflow routing on these fields, and then stops writing; definitions stay unchanged (test with a faked capability).
- [x] Run timeline with task links; runs list grouped by playbook; Board and Tasks filter tasks by playbook (from the tag, or natively once available).
- [x] Passes the M0 #05 gates; strings via catalogues; help and glossary updated (Playbook run, Playbook engine).
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `628f69d` feat: playbook engine tracer bullet: stage tasks tagged through idempotency_key, advanced on Kanban events with a sweep, single-writer lease, restart-safe, native-field and native-routing switches, run API (M6 #02)
- **Tests added:**
  - `server/test/playbook-capabilities.test.ts` (added in `628f69d`): 2 `test(`/`it(` cases (whole file); seam: server pure module
  - `server/test/playbook-engine.test.ts` (added in `628f69d`): 13 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `server/test/playbook-lease.test.ts` (added in `628f69d`): 4 `test(`/`it(` cases (whole file); seam: server pure module
  - `server/test/playbook-plan.test.ts` (added in `628f69d`): 8 `test(`/`it(` cases (whole file); seam: server pure module
  - `server/test/playbook-runs.test.ts` (added in `628f69d`): 3 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
- **Verification recorded:** All criteria are ticked `[x]`. The ticket names tests for: the capability check with a faked contract, a dropped event repaired by the sweep, restart safety with no duplicate stage tasks, a two-engine lease, resume with the Caduceus store deleted, and the native-routing switch with a faked capability. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded). The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - The first stage's task (the root) carries a `root-<hex>` nonce where later keys carry the root task's id, because a task cannot name its own id before it exists. The run is still named by its root task.
  - Inputs ride in a trailing HTML comment of every stage task body. A run started "as a profile" keeps that profile in a second comment. The capability check reads the pinned contract (tested with fake contracts).
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - Native `workflow_template_id` / `current_step_key` writing turns on only once Hermes accepts them on create (ticket text); not verified against a Hermes that does.
