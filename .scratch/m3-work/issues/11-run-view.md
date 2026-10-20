# 11: Run view

**What to build:** `/work/runs/:runId` shows one attempt at a Kanban task:
- **Header:** status, assignee profile, elapsed time and cost.
- **Steps:** a list with each step's outcome, duration, tokens and cost.
- **Worker log:** live, relayed by the Caduceus server from Hermes's task-log endpoint while the run is running. It is end-anchored, with jump-to-latest, and it stops when the run completes.
- **Step transcripts:** tapping a step opens its transcript, drawn from the run's Hermes session through run inspect. It uses Chat's tool and reasoning cards and shows as a sheet on phones and a side panel on desktop.
- **Open in Chat:** opens that Hermes session.

This page is the link between sessions and tasks, so Caduceus keeps no link table of its own. A Stream / Worklog / Raw density switch matches Chat's activity modes. The actions Terminate, Reclaim and Retry are available here as well as on the task.

**Blocked by:** 04 (Task detail)

**Status:** resolved

- [x] The step list shows outcome, duration, tokens and cost per step, read from Hermes's run and inspect endpoints.
  Deviation: Hermes has no step records, and run inspect only gives the worker process's live figures (shown in the header). A step is one turn of the worker, read from the run's Hermes session; the cost of a step is a dash, since Hermes keeps cost per session (the header shows it).
- [x] The worker log tails live while running and stops at completion. Several viewers share one Caduceus relay poller (server test). The log is end-anchored and virtualised, with jump-to-latest.
- [x] Tapping a step opens its transcript with the same cards as Chat: a sheet on phones, a side panel at 1024 px and wider.
  Deviation: Hermes records no link from a run to its session, so the page finds the session by what a dispatched worker leaves (source `kanban`, first message `work kanban task <id>`, start time inside the run).
- [x] "Open in Chat" opens the run's Hermes session. Nothing about runs or sessions is copied into the Caduceus store.
- [x] The Stream / Worklog / Raw switch changes the rendering, and the choice is remembered per device.
- [x] Terminate is T1 and names the run and profile. Reclaim and Retry are T1. All three are audited.
  Deviation: Retry was a plain T0 `PATCH` of the status; it is now `POST /_caduceus/api/work/tasks/{task_id}/retry`, a T1 of Caduceus's own, so that the server audits it (the task page uses it too).
- [x] Every screen passes the M0 #05 gates (390, 320, 820, 1440). All strings come from the catalogues. The module's help page covers runs and glossary terms (Run, Step, Worker log).
  Deviation: catalogue part deferred (owner). Axe on a missing run reports the browser's own console 404 for Hermes's answer, as on a missing task.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `c39ff7e feat: run view with steps, live worker log relay, step transcripts, Stream/Worklog/Raw and run actions; Retry is a T1 route (M3 #11)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `c39ff7e` `server/test/fixtures/seed-session.ts`: 0 cases; seam: fixture (test support, no cases).
  - `c39ff7e` `server/test/log-relay.test.ts`: 8 cases; seam: Caduceus server module / HTTP API (no Hermes launcher imported).
  - `c39ff7e` `server/test/run-log-hermes.test.ts`: 8 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `c39ff7e` `server/test/run-view-hermes.test.ts`: 4 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `c39ff7e` `web/test/run-model.test.ts`: 24 cases; seam: pure web module (model/render).
  - `c39ff7e` `web/test/work-module.test.ts`: 5 cases; seam: pure web module (model/render).
- **Verification recorded:** Criteria ticked, including the server test that several viewers share one relay poller. Axe on a missing run reports the browser's own console 404 for Hermes's answer, as on a missing task. Gate widths and other results: not recorded.
- **Deviations:**
  - Hermes has no step records, and run inspect gives only the worker process's live figures (shown in the header). A step is one turn of the worker, read from the run's Hermes session. A step's cost is a dash, since Hermes keeps cost per session (the header shows it).
  - Hermes records no link from a run to its session. The page finds the session by what a dispatched worker leaves: source `kanban`, first message `work kanban task <id>`, start time inside the run.
  - Retry was a plain T0 `PATCH` of the status. It is now `POST /_caduceus/api/work/tasks/{task_id}/retry`, a Caduceus T1 route, so the server audits it. The task page uses it too.
  - Axe on a missing run reports the browser's own console 404, as on a missing task.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
