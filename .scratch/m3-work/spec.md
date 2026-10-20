# M3 — Work (spec)

**Goal:** unattended work runs on Hermes Kanban and Hermes cron, and the owner drives it from Caduceus: briefs, boards, runs, schedules and review, on the phone as well as the desktop.

**Done when:** on the owner's phone, the owner can:
- write a brief from a template and Queue it, Run it now, or Schedule it;
- watch the task move across the live board and open its run (step list, worker log, transcript);
- get a push when it lands in `review`, then Approve it or Reject it with a note from the Inbox;
- see a failed cron job in the Inbox, open its output and run it again.

Everything shown is read from Hermes. Caduceus stores only templates, categories, saved filters and the workspace registry.

## Design sources (approved)
- `docs/design/README.md`: D1 (Hermes is the source of truth), D4 (Kanban is the task substrate), D5 (Hermes cron is the only scheduler).
- `docs/design/work-model.md`:
  - §1 what Hermes Kanban provides;
  - §2.1 Task, Brief sections → Markdown `body`, field mapping, dispatch modes;
  - §2.2 Run;
  - §2.3 Templates as one-stage playbooks (the engine itself is M6);
  - §2.4 Schedules and the four job types;
  - §2.5 Inbox sources (Kanban and cron rows);
  - §3 screens.
- `docs/design/architecture.md`: §2 data ownership (`kanban.db`, `cron/`, `caduceus.db`), §3 Kanban events WebSocket and `cron.changed`, §4 push sources, §5 tiers (cron script jobs and `fs/write-text` are T3; comment authors stamped server-side).
- `docs/design/information-architecture.md`: §7 URLs `/work/board/:board?`, `/work/tasks`, `/work/tasks/:taskId`, `/work/runs/:runId`, `/work/schedules`, `/work/schedules/:jobId`, `/work/projects/:projectId`.
- `docs/design/mobile-and-interaction.md`: gestures table (long-press "Move to…" sheet, drag as enhancement), per-module layouts for Board, Task / Run and Schedules, push categories.
- `docs/research/hermes-api-coverage.md` §2.7 (cron), §2.8 (Kanban), §2.10 (projects, git), §3 R5.
- `docs/design/prototype/`: Board, Tasks, Schedules, Playbooks (template library cards), Inbox.

## Vocabulary
| Term | Meaning |
|---|---|
| **Task** | A Hermes Kanban task; the single unit of work (formerly a PatterStage Mission) |
| **Brief** | The guided task editor; its sections serialise to Markdown headings in the task `body` |
| **Run** | One attempt at a task: a Kanban `task_runs` row with its worker log and Hermes session |
| **Dispatcher** | Hermes's Kanban dispatcher, which spawns a worker for each `ready` task within its concurrency settings |
| **Dispatch mode** | Save draft · Queue · Run now · Schedule |
| **Board** | A Hermes Kanban board; several may exist and one is current |
| **Schedule / job** | A Hermes cron job of type Agent prompt, Script, Create task or Blueprint |
| **Blueprint** | One of Hermes's Automation Blueprints, instantiated as a cron job |
| **Template** | A Caduceus-owned one-stage playbook definition used to start a task |
| **Project** | A Hermes project (repo-anchored, shared across profiles) |
| **Workspace** | A Caduceus-registered directory offered in the composer and the brief editor |

## Coverage
Every `feature-traceability.md` row with milestone M3, plus the M3 rows of its "Hermes capabilities" table.

| Row | Feature | Status | Ticket(s) |
|---|---|---|---|
| 2.8.1 | Hermes Kanban: boards, lanes, comments, links | USED | 01 (board, lanes, live events), 04 (comments, links) |
| 2.8.2 | Dispatcher (preview / run, per-profile workers, orchestration settings) | USED | 02 |
| + | Multiple boards (switch, create/edit, archive, export/import) | USED | 02 |
| + | Board diagnostics, stats chips, active workers | UNUSED | 02 |
| + | PS Mission board (draft/queued/dispatched/successful/failed) | Replaced | 01: replaced by the Kanban board (D4); statuses map to `triage/ready/running/done` |
| 2.8.3 | Missions: structured brief, 4 dispatch modes, queue | PARTIAL | 07 (brief, dispatch modes), 06 (Schedule via Create-task job), 02 (queue via dispatcher) |
| 2.2.11 | Session ↔ mission linkage | PARTIAL | 11 (run view opens the run's Hermes session; no Caduceus link table) |
| + | Task modal/detail: comments, events, links, attachments, runs, worker log, decompose/specify/reassign/reclaim/terminate | USED | 04 (detail and actions), 11 (run view and worker log) |
| + | Mission composer prompt assembly (`<hermes_mission>` XML) + preview | Replaced | 07: replaced by Brief sections serialised to Markdown with a preview |
| + | Mission queue single-flight, cancellation finalise, reconcile/deadlines | Replaced | 02 (dispatcher concurrency settings), 04 (Terminate), 07 (`max_runtime_seconds`): replaced by the Hermes dispatcher (D4) |
| + | Directory picker + git branch for working dir | UNUSED | 07 |
| + | Mission templates & categories (12 seeded, quick-load pills) | Caduceus-owned (R5) | 08 |
| + | Review gates and `needs_input` clarify | USED | 09 |
| 2.7.1 | Hermes cron CRUD | USED | 05 (list, delete), 06 (create, edit) |
| 2.7.2 | Schedule builder with preview (next 3 fire times) | CLIENT | 06 |
| 2.7.3 | Run history and output | UNUSED | 05 |
| 2.7.4 | Automation Blueprints (16 templates) | USED | 06 |
| 2.7.5 | Script-mode jobs | USED | 12 |
| 2.7.6 | Cross-profile job list | USED | 05 |
| + | PS Scripts page (editor, run now, logs, examples) | Replaced | 12 (Script job type with editor), 05 (run now, output): replaced by the cron Script job type |
| + | Schedule a mission / recurring mission | Replaced | 06 (Create-task job type), 07 (Schedule dispatch mode): replaced by a cron script job running `hermes kanban create` |
| + | Stale-scheduler warning / scheduler heartbeat | USED | 05 |
| + | Job actions: run now, pause/resume, duplicate, copy diagnostics, deliver-to targets | USED | 05 (actions), 12 (deliver-to targets) |
| 2.10.2 | Workspaces / spaces | UNUSED | 10 |
| + | Project OS dashboard (repo, git, docs overview); projects tree | UNUSED | 10 |
| cap | Cron run history and output | — | 05 |
| cap | Cron monitor options (`monitor_script`/`monitor_url`, `context_from`, `failure_deliver`, `attach_to_session`) | — | 12 |
| cap | Projects (folders, active project, discover repos, project tree) | — | 10 |
| cap | Kanban dispatcher dry-run, diagnostics, active workers, run inspect/terminate, estimate, stats/assignees, board export/import/switch | — | 02 (dispatcher, diagnostics, workers, stats, boards), 04 (terminate, estimate), 11 (run inspect) |

Not in M3: the playbook engine, gates, verdicts and Deep Research (M6), the budget guard (M6 #06), the Git panel (M7 #03).

## Constraints
- No copies of Kanban or cron data in `caduceus.db`. Live views come from the Kanban events WebSocket and `cron.changed`, with REST refetch on reconnect.
- Templates use the playbook YAML shape of `work-model.md` §2.3 (one stage), so M6 #01 extends them rather than migrating them.
- Comment authors are stamped by the Caduceus server, never taken from the browser.
