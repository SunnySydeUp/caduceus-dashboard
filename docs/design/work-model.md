# Work Model — Tasks, Playbooks, Schedules, Inbox

Decision 4 asked for "the best version" of three overlapping concepts: Hermes Kanban (default dashboard and WebUI), PatterStage Missions, and PatterStage Composer workflows. Decision 1 requires Hermes to be the source of truth.

**Approach.** Hermes Kanban is already the most capable of the three, so the unified model builds on it rather than inventing a new task store. Missions become a structured way of creating Kanban tasks. Composer workflows become **Playbooks**: graphs of Kanban tasks connected through Kanban's own (not yet used) workflow fields. Everything that needs a human lands in one **Inbox**.

Paths are relative to `~/.hermes/hermes-agent/`. API paths are taken from the live OpenAPI dump (`/tmp/dashboard-research/hermes-openapi-endpoints.txt`).

---

## 1. What Hermes Kanban already provides

| Capability | Hermes field / API | Evidence |
|---|---|---|
| Lifecycle | `triage → todo → scheduled → ready → running → blocked → review → done → archived` | `hermes_cli/kanban_db.py:103` |
| Typed blockers | `block_kind` ∈ `dependency`, `needs_input`, `capability`, `transient`, plus a loop counter `block_recurrences` | `kanban_db.py:107, 731-733` |
| Brief + assignment | `title`, `body`, `assignee` (profile), `priority`, `tenant`, `project_id`, `skills` | `kanban_db.py:1249-1262` |
| Execution options | `model_override` / `provider_override`, `reasoning_effort`, `max_runtime_seconds`, `max_retries`, `idempotency_key` | `kanban_db.py:1249-1262, 1319-1326` |
| Workspace | `workspace_kind` ∈ scratch / dir / worktree, `workspace_path`, `branch_name`; project-anchored worktrees | `kanban_db.py:1124-1164, 1299-1335` |
| **Goal loop** | `goal_mode` + `goal_max_turns`: a judge keeps the worker going until the goal is met | `kanban_db.py:728, 946`; `hermes_cli/kanban.py:834-895` |
| **Completion contract** | `local-only`, `OWNER/REPO` or an exact PR URL; for the repo and PR forms, the CI gates must pass | `hermes_cli/kanban_pr_acceptance.py:21`; `kanban_parser.py:195` |
| **Workflow hooks** | `workflow_template_id`, `current_step_key`. The schema comment says they are "forward-compat for v2 workflow routing… the dispatcher doesn't consult them yet". Filterable in the API | `kanban_db.py:912-916`; `plugins/kanban/dashboard/plugin_api.py:271, 332` |
| Dependencies | `parents` / `task_links`; children wait for their parents | `kanban_db.py:1375`; `POST/DELETE /api/plugins/kanban/links` |
| Runs | `task_runs` (profile, step_key, outcome, summary, error, heartbeat), worker log, inspect, terminate, reclaim | `kanban_db.py:2237-2254`; `/runs/{id}`, `/runs/{id}/inspect`, `/runs/{id}/terminate`, `/tasks/{id}/log`, `/tasks/{id}/reclaim` |
| Dispatcher | Spawns `hermes -p <assignee> chat -q "work kanban task <id>"` for each ready task. It has a circuit breaker (`consecutive_failures` → blocked / gave_up) and max-runtime enforcement | `kanban_db_dispatch.py:2704-2847`; `kanban_db.py:2496-2499`; `POST /api/plugins/kanban/dispatch` |
| AI assists | `specify` (triage → full spec), `decompose` (split into subtasks), `estimate`, profile `describe-auto`, reassign | `/tasks/{id}/specify`, `/decompose`, `/estimate`, `/reassign` |
| Collaboration | Comments, attachments, home-channel subscriptions (results delivered to Telegram, Discord and others) | `/tasks/{id}/comments`, `/attachments`, `/home-subscribe/{platform}` |
| Boards | Multiple boards, export / import, switch, orchestration settings, diagnostics, stats, live events WebSocket | `/boards*`, `/orchestration`, `/diagnostics`, `/stats`; WS `/api/plugins/kanban/events` |
| Projects | `projects.db` (repo-anchored projects across profiles) | `hermes_cli/projects_db.py`; `/api/plugins/kanban/projects` |

**Consequence:** a PatterStage Mission is a Kanban task, apart from presentation. PatterStage's biggest gap, that a mission's chosen model was recorded but never sent, does not exist here because `model_override` and `provider_override` are first-class fields.

---

## 2. The unified concepts

```mermaid
flowchart LR
  T[Template / Playbook\n(definition)] -->|instantiate| K[(Hermes Kanban\ntasks + links)]
  C[Hermes cron job] -->|"script: hermes kanban create / playbook run"| K
  Chat[Chat session] -->|"/kanban, 'make this a task'"| K
  K -->|dispatcher| R[Runs → Hermes sessions]
  R -->|review · needs_input · gave_up| I[Inbox]
  A[Live approvals / clarify] --> I
  O[Cron failures · pairing · health · budget] --> I
  I -->|approve · answer · retry| K
```

### 2.1 Task (the single unit of work)
- **Storage:** a Hermes Kanban task, and nothing else.
- **The "Brief" editor.** This replaces the PatterStage mission composer. It is a guided form whose sections serialise into the task `body` as plain Markdown headings: Goal, Context, References, Constraints, Expected output, Scope and safety. Hermes workers read the body as-is. Structured fields map to native columns:

| Mission field (PatterStage) | Kanban field |
|---|---|
| Profile | `assignee` |
| Model / provider | `model_override` / `provider_override` |
| Reasoning | `reasoning_effort` |
| Recommended skills | `skills` |
| Working dir / git branch | `workspace_kind = dir \| worktree`, `workspace_path`, `branch_name`, `project_id` |
| References / files | attachments + links |
| Timeout | `max_runtime_seconds` |
| Retries | `max_retries` |
| "Done when…" | `goal_mode` (judge loop) and/or `completion_contract` (PR + CI) |
| Category | template category (see §2.3); `tenant` stays reserved for its Hermes meaning |
| Per-task toolsets | **not supported by Hermes.** Toolsets are per profile. Show the assignee profile's toolsets read-only, with a link to edit them |

- **Dispatch modes** (from PatterStage, mapped onto Hermes states):

| Mode | Hermes action |
|---|---|
| Save draft | create with `triage: true` (optionally **Specify** with AI) or status `todo` |
| Queue | status `ready`; the dispatcher's concurrency settings decide when it runs |
| Run now | `ready` + `POST /dispatch` (nudge) |
| Schedule once / recurring | a Hermes cron job in script mode that runs `hermes kanban create …` or `playbook run` at the schedule (§2.4) |

### 2.2 Run
- Each attempt is a `task_runs` row.
- The run view shows status, the worker log, and the worker's Hermes **session transcript**: the same tool cards and reasoning as Chat, rendered by the same components.
- Actions: Terminate, Reclaim, Reassign, Retry.

### 2.3 Template and Playbook (replaces Missions templates and Composer)
- **Definition** is a YAML file owned by the dashboard, stored under `HERMES_HOME/caduceus/playbooks/<id>.yaml`.
  - It holds stages with: key, title, brief template with `{{inputs}}`, assignee profile, skills, model, goal mode, completion contract and gate type.
  - It holds edges with conditions: `on_done`, `on_fail`, `on_approve`, `on_reject`, `always`.
  - It holds a `max_attempts` per stage and an inputs schema.
  - A **Template** is simply a one-stage Playbook, so there is one concept, not two.
  - Seeds:
    - one-stage Templates (M3): the 12 ported from PatterStage, including Bug hunt, Feature build, Code review, Research brief and Deploy & verify;
    - multi-stage Playbooks (M6): Software Delivery (16 stages), Research → summarise, Draft → review and Deep Research.
- **Instantiation** creates Kanban tasks that each carry a tag for playbook@version, stage and attempt.
  - Hermes 0.21.4 can filter on `workflow_template_id` / `current_step_key` but offers no way to set them. Until it does, the tag goes in `idempotency_key`, which Hermes also uses to de-duplicate, making stage creation exactly-once. Once a pinned contract shows Hermes accepts the native fields on create, the engine writes them too.
  - Fields the REST API can't set (completion contract, branch, max retries) go through `hermes kanban create` (`architecture.md` §3).
  - Stages are created lazily as their predecessors finish, or eagerly with `parents` when the graph is static.
  - The run is fully visible on the normal board and can be filtered by playbook, using the tag now and the native `?workflow_template_id=` filter once Hermes sets it.
- **Human gates** use Hermes's own `review` status. The gate task is assigned to "you" and appears on Today (Needs you).
  - **Approve** marks it done and the next stage proceeds.
  - **Reject + note** posts the note as a comment and creates the rework attempt with the note inlined in its brief. This is PatterStage's "note fed back to the redone stage".
- **Clarify pauses** are a block with `needs_input`; answering adds a comment and unblocks the task.
- **Verdict routing.** A stage passes when its task reaches `done`. A `goal_mode` judge rejection, a completion-contract failure, or an explicit `VERDICT: FAIL` in the run `result` routes to `on_fail`. Loops are bounded by `max_attempts`.
- **Routing engine** (companion service, see architecture):
  - It subscribes to the Kanban events WebSocket and, on each transition, applies the playbook edges through the Kanban REST API.
  - It is stateless apart from the YAML definitions; all run state lives in Kanban fields, links and comments, so a restart is lossless.
  - When Hermes ships native "v2 workflow routing" on these same fields, the engine retires and the definitions remain valid.
- **Deep Research** is a seeded Playbook, not a separate engine: plan → search and read (the agent's web tools, whatever search backend the toolset uses) → synthesise a cited report. The report is attached to the task and shows up in Artifacts. PatterStage's depth and breadth become playbook inputs.

### 2.4 Schedules (decision 5: Hermes cron only)
- All timing goes through Hermes cron (`/api/cron/jobs*`, `/api/cron/blueprints*`). There is no other scheduler.
- Job types are shown as one list with a type badge:
  1. **Agent prompt** (classic cron).
  2. **Script**: `no_agent` + script; stdout is delivered verbatim. This replaces PatterStage's host-crontab Scripts.
     - Scripts are edited in the dashboard.
     - Hermes requires them to live inside **that profile's** `HERMES_HOME/scripts/`, with traversal guarded (`cron/scheduler_script.py:257-295`).
     - A script without `no_agent` injects its stdout as context for an agent prompt (`cron/jobs.py:1735`).
  3. **Create task / run playbook**: a script job that calls `hermes kanban create …` (`hermes_cli/kanban.py:379-384`) or the companion's playbook runner. This is how "Schedule" and "recurring mission" are implemented.
  4. **Blueprint instance** (Hermes's 16 Automation Blueprints).
- Run history and output come from `GET /api/cron/jobs/{id}/runs`. This endpoint exists but the default dashboard never shows it.
- The editor also exposes Hermes cron options that no existing dashboard shows in full:
  - `monitor_script` / `monitor_url`: a cheap check runs first each tick, and unchanged output skips the agent run;
  - `context_from` (chain job outputs), `failure_deliver`, `attach_to_session` and `workdir` (`cron/jobs.py:1651-1739`).
- The schedule builder shows the next three fire times (PatterStage) on top of Hermes's builder modes.

### 2.5 Inbox data ("Waiting for you")
Items are shown on **Today** (Needs you: the decisions, answerable in place) and in the **Talk** tray (decisions of other agents and sessions); the items that are not decisions, and the activity feed, are in **Notices** (Control). The Inbox is no longer a screen: its data layer (live stream, model, decision component) feeds those places. Each item has inline actions and a deep link; deep links open Today.

| Source | Item | Inline actions | Push? |
|---|---|---|---|
| Live chat run | Tool approval | Allow once / session / always, Deny | yes, high |
| Live chat run | Clarify question | Choice buttons / reply | yes, high |
| Kanban | Task in `review` (incl. playbook gates) | Approve, Reject + note, Open diff/result | yes |
| Kanban | `blocked` with `needs_input` | Answer (comment + unblock) | yes |
| Kanban | `gave_up` / circuit breaker tripped, run failed | Retry, Reassign, Open log | yes |
| Cron | Run failed, job overdue, scheduler stale | Run now, Pause, Open output | yes (failures) |
| Gateway | Pending DM pairing request | Approve, Deny | yes |
| System | Gateway down, resource pressure, missing provider key, update available | Restart, Open | failures only |
| Budget | Spend crossed 80% / 100% | Open spend, Raise budget | yes |

- Items resolve automatically when the underlying Hermes state changes, for example when an approval is answered from Telegram or a task is approved in the CLI. The Inbox is a *view over Hermes state*, never a separate store.
- The only exceptions are dismissals and snoozes, which are kept per device.

### 2.6 Budgets (PatterStage spend governance on Hermes data)
- Spend is read from Hermes usage analytics: per-session estimated or actual cost, per model and per source.
- The budget definition (day / week / month limits, warn %) is dashboard-owned config in `HERMES_HOME/caduceus/config.yaml`.
- The hard stop applies to **unattended** work only, enforced with Hermes's own controls:
  - pause the Kanban dispatcher (orchestration settings);
  - pause cron jobs flagged unattended;
  - raise a notice.
- Attended chat is never blocked (PatterStage's rule).

---

## 3. Screens implied

| Screen | Purpose |
|---|---|
| **Work › Board** | Kanban with lanes by status or profile. On a phone, columns become a status segmented control over a vertical list; long-press opens a "Move to…" menu |
| **Work › Tasks** | Dense list / table with saved filters (mine, waiting, failed, by playbook, by project) |
| **Task detail** | Brief · Runs (with transcript) · Activity (events + comments) · Links · Attachments · Settings. Actions: run now, terminate, retry, specify, decompose, reassign |
| **Work › Playbooks** | Library (cards) → detail. Graph view at ≥1024 px, linear stage list on phone. Run form generated from the inputs schema. Runs list grouped by `workflow_template_id` |
| **Work › Schedules** | Cron jobs (4 types) with run history, blueprints gallery, schedule builder |
| **Today / Notices** | Today: what needs you (Needs you, answered in place), Ready for review, the day's schedule, While you were away. Notices (Control): the prioritised non-decision items plus the activity feed |
