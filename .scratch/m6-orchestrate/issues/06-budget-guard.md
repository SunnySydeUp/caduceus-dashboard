# 06: Budget guard

**What to build:** Budgets defined in Insights (M5 #05) become a hard stop for unattended work. Caduceus's **budget guard** periodically evaluates spend from Hermes's usage analytics against each budget. When a budget is breached, it:
- pauses the Kanban dispatcher through Hermes's orchestration settings;
- pauses every cron job counted as unattended through Hermes's cron pause endpoint;
- raises an Inbox alert with a push notification.

The guard records only the pauses it made itself. It never touches jobs or settings the owner had already paused, and it never blocks attended chat.

Insights shows the guard's state: armed, tripped (what it paused and when) or disabled. It also offers **Undo guard actions**, which resumes exactly what the guard paused. When a new period starts, the guard lifts its own pauses by itself if the owner allowed that. Like the playbook engine, the guard runs under the single-writer lease.

**Blocked by:** M2 #03 (Web Push notifications), M3 #02 (Board operations and dispatcher), M3 #05 (Schedules list and job detail), M5 #05 (Insights and budgets)

**Status:** resolved

- [x] The evaluator polls Hermes usage analytics per profile and globally on a set interval. Its documented overshoot bound is interval × burn rate, and Insights shows it.
  Deviation: it reads the budgets of Insights (which read Hermes usage analytics per profile) at a set interval (one minute) and is documented and shown in Insights as interval × burn rate; there is no separate analytics poll.
- [x] On breach, it pauses the dispatcher and the unattended cron jobs and records each action. Jobs and dispatcher settings already paused by the owner are left alone and not recorded (test).
  Deviation: Hermes 0.21.4's orchestration route has no dispatcher switch, and `kanban.dispatch_in_gateway` is read only when the gateway starts. The dispatcher is stopped through `kanban.dispatch_profiles` in Hermes's config (read at every dispatch tick, fail-closed: an empty list claims nothing), edited through Hermes's raw config route and put back as it was, absent included. Workers already running finish.
- [x] Undo guard actions (T1, naming what will resume) and the automatic new-period lift resume exactly the recorded set. If the owner changed one of those since, it is skipped and reported (test).
- [x] Unattended is defined in one place: dispatcher runs and cron jobs that are not exempted per job in Schedules. Chat sessions and their tool runs are never paused or blocked (test).
- [x] An Inbox item (Open spend, Raise budget, Undo guard actions) and a Budget-category push are raised once per breach, using dedupe from M2 #03.
- [x] Single-writer lease: two Caduceus processes never both act on one breach (test).
- [x] Insights shows the guard state, last evaluation and recorded actions. The guard can be disabled (T2).
- [x] Passes the M0 #05 gates; strings via catalogues; help and glossary updated (Budget guard, Unattended work).
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `9345dea` feat: budget guard: pauses the dispatcher's claims and unattended cron jobs when a budget is used up, records and undoes only its own pauses, Inbox alert with Undo and Raise budget, per-job exemption in Schedules, guard state in Insights, single-writer lease (M6 #06)
- **Tests added:**
  - `server/test/budget-guard.test.ts` (added in `9345dea`): 11 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
- **Verification recorded:** All criteria are ticked `[x]`. The ticket names tests for: pauses already made by the owner left alone and not recorded; Undo and the new-period lift resuming exactly the recorded set (a changed one is skipped and reported); chat never paused; one action per breach under the lease. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded). The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - The guard reads the budgets of Insights (which read Hermes usage analytics per profile) at a set interval (one minute). It is documented and shown in Insights as interval × burn rate. There is no separate analytics poll.
  - Hermes 0.21.4's orchestration route has no dispatcher switch, and `kanban.dispatch_in_gateway` is read only when the gateway starts. The dispatcher is stopped through `kanban.dispatch_profiles` in Hermes's config (read at every dispatch tick, fail-closed: an empty list claims nothing), edited through Hermes's raw config route and put back as it was, absent included. Workers already running finish.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
