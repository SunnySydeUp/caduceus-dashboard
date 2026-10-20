# 05: Schedules list and job detail

**What to build:** Work › Schedules lists Hermes cron jobs across all profiles (`GET /api/cron/jobs?profile=all`) with a type badge (Agent prompt, Script, Create task, Blueprint), profile, schedule in words, next fire, last result and enabled state. Filters by profile, type and status. A header warns when the scheduler is stale (cron ticker last-tick older than expected), with a link to Health. On phones jobs are cards; on desktop a table.

`/work/schedules/:jobId` shows the job's configuration and its run history from `GET /api/cron/jobs/{id}/runs`, each run expandable to its output. Actions: Run now, Pause/Resume, Duplicate, Delete, and Copy diagnostics (job config, last runs and scheduler state as text for a bug report). The list stays live via the gateway's `cron.changed` signal.

**Blocked by:** M0 #08 (Policy proxy, risk tiers, read-only mode and tiered confirmations), M1 #02 (Contextual help framework)

**Status:** resolved

- [x] The list shows every job from every profile with correct type badge and next fire time (contract test against stub cron API).
  Deviation: Hermes marks neither Create-task nor Blueprint jobs; Create task is told by the script name (`caduceus-create-task-…` or one naming `kanban create`), Blueprint by the job being named like a blueprint.
- [x] The stale-scheduler warning appears when the last tick exceeds the threshold and disappears when ticks resume (test).
- [x] Run history lists runs newest-first with status and duration; output expands inline (an expandable list on phones) and long output is virtualised.
  Deviation: a Script job starts no agent, so Hermes's `/runs` is empty for it; its history is read from the output files Hermes saves, and shows no duration.
- [x] Run now and Pause/Resume are T1; Duplicate creates a paused copy through Hermes's create endpoint (script-type duplicates are T3 like any script job); Delete is T1 with a 6 s undo where Hermes allows re-creation, otherwise T1 stating it cannot be undone.
- [x] Copy diagnostics copies a redacted text bundle (no secrets) and confirms with a toast.
- [x] `cron.changed` refreshes the list and an open job detail without reload.
- [x] Empty state offers New schedule and Browse blueprints.
  Deviation: New schedule and Browse blueprints are shown but switched off, with the reason beside them, until the schedule builder (#06) exists.
- [x] Every screen passes the M0 #05 gates (390, 320, 820, 1440); all strings come from the catalogues; the module registers its help page and glossary terms (Schedule, job types, stale scheduler, Blueprint).
  Deviation: catalogue part deferred (owner); help page and glossary terms are registered.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `2cece89 feat: Work › Schedules list and job detail with run history, actions and diagnostics (M3 #05)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `2cece89` `server/test/schedules-hermes.test.ts`: 6 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `2cece89` `web/test/job-diagnostics.test.ts`: 4 cases; seam: pure web module (model/render).
  - `2cece89` `web/test/job-runs.test.ts`: 5 cases; seam: pure web module (model/render).
  - `2cece89` `web/test/run-output-render.test.ts`: 3 cases; seam: pure web module (model/render).
  - `2cece89` `web/test/schedules-model.test.ts`: 11 cases; seam: pure web module (model/render).
  - `2cece89` `web/test/shortcuts.test.ts`: 12 cases; seam: pure web module (model/render).
  - `2cece89` `web/test/work-module.test.ts`: 3 cases; seam: pure web module (model/render).
- **Verification recorded:** Criteria ticked (contract test against the cron API, stale-scheduler test). Gate widths and results: not recorded. Perf numbers: not recorded.
- **Deviations:**
  - Hermes marks neither Create-task nor Blueprint jobs. Create task is told by the script name (`caduceus-create-task-…` or one naming `kanban create`); Blueprint by the job being named like a blueprint.
  - A Script job starts no agent, so Hermes's `/runs` is empty for it. Its history is read from the output files Hermes saves, and shows no duration.
  - New schedule and Browse blueprints are shown but switched off, with the reason beside them, until the schedule builder (#06) exists.
  - Help page and glossary terms are registered.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - New schedule and Browse blueprints were switched off until M3 #06 (resolved).
