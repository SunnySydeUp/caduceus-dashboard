# 06: Schedule builder and job types

**What to build:** Create and edit Hermes cron jobs.

The builder offers interval, daily, weekly, monthly, once and raw cron modes. It always previews the next three fire times, computed in the browser in the owner's time zone. On phones it is a stepped sheet; on desktop, a form.

This ticket delivers three of the four job types:
- **Agent prompt:** profile, prompt, model and skills.
- **Create task:** a script job that runs `hermes kanban create …` with a brief and fields. This is how recurring and scheduled tasks are implemented, and ticket 07's Schedule mode uses it.
- **Blueprint:** chosen from a gallery of Hermes's Automation Blueprints (`/api/cron/blueprints`) and filled in from the blueprint's inputs.

Script jobs and the advanced options come in ticket 12.

**Blocked by:** 05 (Schedules list and job detail)

**Status:** resolved

- [x] Each schedule mode produces a cron spec Hermes accepts, and the next-3 preview matches Hermes's own next fire time after save. There is a test per mode, including days when daylight saving time changes.
- [x] Agent prompt, Create task and Blueprint jobs can be created and edited end to end, and appear in the list with the right badge.
- [x] Running a Create task job "now" produces a Kanban task with the configured fields (integration test against a stub or real Hermes).
- [x] The blueprints gallery lists every Hermes blueprint with search, and instantiating one prefills the builder.
- [x] Invalid input (bad cron, missing prompt, unknown profile) shows field errors before submit, and an unsaved-changes guard protects edits.
- [x] Creating or editing a job uses the tier the policy proxy assigns to cron writes.
- [x] Every screen passes the M0 #05 gates (390, 320, 820, 1440). All strings come from the catalogues. The module registers its help page and glossary terms (Schedule, Blueprint, Create-task job).
  Deviation: catalogue part deferred (owner). On a phone the stepped “sheet” is a stepped full page on its own route (`/work/schedules/new`, `/:jobId/edit`), not a modal layer, so the address, the back button and the unsaved-changes guard work as for any page.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `a3f0529 feat: Work › schedule builder, Create-task jobs and blueprint gallery (M3 #06)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `a3f0529` `server/test/create-task-script.test.ts`: 6 cases; seam: Caduceus server module / HTTP API (no Hermes launcher imported).
  - `a3f0529` `server/test/schedule-builder-hermes.test.ts`: 4 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `a3f0529` `server/test/schedule-jobs-hermes.test.ts`: 6 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `a3f0529` `web/test/job-form.test.ts`: 17 cases; seam: pure web module (model/render).
  - `a3f0529` `web/test/schedule-spec.test.ts`: 23 cases; seam: pure web module (model/render).
  - `a3f0529` `web/test/work-module.test.ts`: 3 cases; seam: pure web module (model/render).
- **Verification recorded:** Criteria ticked: a test per schedule mode including daylight-saving days; Create-task "run now" integration test. Gate widths and results: not recorded.
- **Deviations:**
  - On a phone the stepped "sheet" is a stepped full page on its own route (`/work/schedules/new`, `/:jobId/edit`), not a modal layer, so the address, the back button and the unsaved-changes guard work as for any page.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
