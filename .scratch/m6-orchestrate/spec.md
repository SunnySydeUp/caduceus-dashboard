# M6 — Orchestrate (spec)

**Goal:** multi-stage work runs by itself on Hermes Kanban. Playbooks chain tasks through stages, human gates, verdict routing and bounded loops. Deep Research produces cited reports into an Artifacts store. A budget guard stops unattended spending.

**Done when:** on the owner's phone:
- they start "Draft → review" from the Playbooks library with a topic as input;
- the run's stages appear as tagged tasks on the normal Board and advance by themselves;
- the human gate arrives in the Inbox with a push notification, and rejecting it with a note creates a rework attempt whose brief contains the note;
- killing and restarting the Caduceus server mid-run loses nothing;
- a Deep Research run produces a cited report that opens in Artifacts;
- when a test budget is crossed, the dispatcher and unattended cron jobs pause, an Inbox alert appears, and attended chat still works.

## Design sources (approved)
- `docs/design/work-model.md` §2.3 (Template and Playbook: the model this milestone implements exactly), §2.5 (Inbox), §2.6 (Budgets), §3 (Playbooks screen).
- `docs/design/architecture.md`: §1 workers (playbook engine, budget guard, single-writer lease), §2 data ownership (`playbooks/*.yaml`, `artifacts/`, budgets and the guard's own pause list), §4 push watcher, §5 tiers, §9 risk "kanban reserved workflow fields".
- `docs/design/mobile-and-interaction.md`: Playbooks row (card library, vertical stage list, graph only ≥ 1024 px, run form as full-screen sheet), §9 accessibility, §10 lazy-loaded graph editor.
- `docs/design/information-architecture.md`: §1 Work › Playbooks, Workspace › Artifacts, Observe › Insights; §7 `/work/playbooks/:id/runs/:rootTaskId`.
- `docs/research/hermes-api-coverage.md` §2.8 (Kanban substrate; REST create body cannot set the reserved fields), §3 R6, R7, R9.
- `docs/design/prototype/`: `playbooks.js`.

## The playbook model (work-model §2.3, binding)
- **Definitions** are Caduceus-owned, versioned YAML files in the Caduceus data folder. A Template is a one-stage Playbook (shared with M3 #08).
- **Runs are Kanban tasks**, tagged `workflow_template_id = <playbook>@<version>` and `current_step_key = <stage>`. There is no Caduceus run table: run state lives in Kanban fields, links and comments, and a run is filterable on the Board by template.
- **Gates** are tasks in Kanban's `review` status, assigned to the owner. **Clarify** is a `blocked` task with `needs_input`.
- **Verdicts:** `done` passes; a goal-mode judge rejection, a completion-contract failure or `VERDICT: FAIL` in the run result routes `on_fail`; loops are bounded by `max_attempts`.
- **Engine:** stateless apart from the definitions; holds a single-writer lease; driven by the Kanban events socket plus a sweep; retires when Hermes ships native workflow routing on the same fields, and the definitions stay valid.

## Vocabulary
| Term | Meaning |
|---|---|
| **Playbook** | A Caduceus-owned, versioned YAML definition of stages, edges, inputs and gates |
| **Template** | A one-stage Playbook |
| **Stage** | One node of a playbook; each attempt becomes one Kanban task |
| **Playbook run** | The set of Kanban tasks sharing one root task and `workflow_template_id`; identified by its root task |
| **Gate** | A stage whose task waits in Kanban `review` for the owner |
| **Verdict** | Pass or fail of a stage attempt, read from Kanban |
| **Playbook engine** | The Caduceus worker that applies edges on Kanban transitions under a single-writer lease |
| **Artifact** | A derived output (report, deliverable) in Caduceus's artifacts folder, referencing its source session, task or run |
| **Budget guard** | The worker that pauses unattended work on a budget breach and undoes only its own pauses |
| **Unattended work** | Kanban dispatcher runs and cron jobs; never interactive chat |

## Coverage
Every `feature-traceability.md` row with M = M6.

| Ref | Feature | Status | Ticket(s) |
|---|---|---|---|
| 2.8.4 | Composer workflow graph (loops, verdicts, human gates, clarify) | Caduceus-owned (R6) | 01 (definitions), 02 (engine, linear stages), 03 (gates, verdicts, loops, clarify), 04 (graph view, parallel groups) |
| 2.8.5 | Deep Research → Artifacts store | Caduceus-owned (R7) | 05 |
| + | Seeded workflows (Software Delivery, Research→summarise, Draft→review) | Caduceus-owned (R6) | 01 (seed definitions), 03 (Software Delivery's gates and loops run end to end) |
| 2.10.5 | Artifacts (files changed this session; artifact store) | Caduceus-owned (R7) | 05 |
| 2.7.9 | Spend gate on unattended runs (hard stop) | Caduceus-owned (R9) | 06 |

Related rows owned elsewhere, consumed here: mission templates and categories (M3 #08, the one-stage templates that 01 generalises); review gates and `needs_input` Inbox items (M3 #09, reused by 03); budgets and spend (2.4.8, M5 #05, which 06 enforces).
