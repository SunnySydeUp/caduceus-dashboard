# 03: Gates, verdicts and loops

**What to build:** Playbooks branch and loop.

**Gates.** A gate stage's task waits in Kanban's own `review` status, assigned to the owner, so it appears in the Inbox as a review item (M3 #09) and pushes. **Approve** marks it done, and the engine follows `on_approve`. **Reject with a note** posts the note as a Kanban comment, follows `on_reject`, and creates the rework attempt with the note inlined in its brief.

**Verdicts.** A stage passes when its task reaches `done`. A goal-mode judge rejection, a completion-contract failure, or an explicit `VERDICT: FAIL` in the run result routes to `on_fail`. Loops are bounded by the stage's `max_attempts`; when they run out, the run stops with a failed item in the Inbox.

**Clarify.** A stage that needs the owner is blocked with `needs_input`; answering in the Inbox adds a comment and unblocks it.

**Re-run.** From the run page, the owner can re-run from any stage, creating a new attempt.

**Blocked by:** 02 (Playbook engine tracer bullet), M3 #09 (Work in the Inbox and notifications)

**Status:** resolved

- [x] Gate tasks are created in `review` assigned to the owner and show in the Inbox with Approve / Reject + note; the decision is read back from Kanban, never stored by Caduceus.
  Deviation: a gate task is made in Triage with nobody assigned (so Hermes's dispatcher can never claim it) and moved to `review` (approval) or blocked with `needs_input` (clarify); "assigned to the owner" is not done because an unassigned review task shows in the Inbox the same and cannot be claimed. Reject sends the gate back to ready (the Inbox's own Reject), and the engine then records it as a done task whose result starts `VERDICT: REJECTED` plus the note; a blocked stage Hermes gave up on is recorded the same way as `VERDICT: FAIL`.
- [x] Reject + note: the note is posted as a comment authored by Caduceus-stamped owner, and the rework attempt's brief contains it (test).
- [x] Verdict routing covers all three failure signals and `done`, with `always` edges; each is tested with recorded Kanban events.
- [x] Attempts are counted from the stage's tasks in Kanban; exceeding `max_attempts` ends the run as failed and raises an Inbox item; no infinite loop is possible (test).
- [x] Clarify pauses are `blocked` + `needs_input`; answering from the Inbox comments and unblocks, and the run continues.
- [x] Re-run from stage is T1 and creates a new attempt without touching completed stages; the timeline shows attempts and verdicts.
- [x] The Software Delivery seed runs end to end against a test board with fake workers, including one rejection loop.
- [x] Restart safety from 02 still holds mid-gate and mid-loop (test).
- [x] Passes the M0 #05 gates; strings via catalogues; help and glossary updated (Verdict, Attempt).
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `062c7be` feat: playbook gates, verdicts and loops: human gates in review and clarify, verdict routing with bounded attempts, owner decisions read back from Kanban, re-run from a stage, stopped-run Inbox item (M6 #03)
- **Tests added:**
  - `server/test/playbook-engine.test.ts` (changed in `062c7be`): 22 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `server/test/playbook-plan.test.ts` (changed in `062c7be`): 15 `test(`/`it(` cases (whole file); seam: server pure module
  - `server/test/playbook-runs.test.ts` (changed in `062c7be`): 4 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `web/test/playbook-runs-model.test.ts` (changed in `062c7be`): 15 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/work-module.test.ts` (changed in `062c7be`): 5 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. The ticket names tests with recorded Kanban events for verdict routing, the Reject + note brief, bounded attempts, and restart safety mid-gate and mid-loop. The Software Delivery seed ran end to end against a test board with fake workers, including one rejection loop. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded). The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - A gate task is made in Triage with nobody assigned (so Hermes's dispatcher can never claim it) and moved to `review` (approval) or blocked with `needs_input` (clarify). "Assigned to the owner" is not done: an unassigned review task shows in the Inbox the same and cannot be claimed.
  - Reject sends the gate back to ready (the Inbox's own Reject). The engine then records it as a done task whose result starts `VERDICT: REJECTED` plus the note. A blocked stage Hermes gave up on is recorded the same way as `VERDICT: FAIL`.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
