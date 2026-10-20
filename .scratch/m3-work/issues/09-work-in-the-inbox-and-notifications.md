# 09: Work in the Inbox and notifications

**What to build:** Work that needs the owner appears in the Inbox as items derived live from Hermes state: tasks in `review`, tasks `blocked` with `needs_input`, tasks that gave up or whose run failed, and cron job failures. Each item has inline actions: **Approve** (done) and **Reject + note** (the note is posted as a stamped comment and the task returns to work) for review; **Answer** (comment + unblock) for needs-input; **Retry** and **Reassign** for gave-up/failed tasks; Run now / Pause / Open output for cron failures. Items resolve themselves when the task or job changes elsewhere (CLI, Telegram, another device).

Push uses the M2 categories: "Reviews & blocked tasks" and "Failures", deep-linking to the decision. Each cron job gets a notification toggle on its detail page; it is a Caduceus preference keyed by job id and does not change the job in Hermes.

**Blocked by:** 04 (Task detail), 05 (Schedules list and job detail), M2 #02 (Inbox sources, grouping and activity feed), M2 #03 (Web Push notifications)

**Status:** resolved

- [x] Review, needs-input, gave-up/failed and cron-failure items appear within seconds of the Kanban event or `cron.changed`, grouped as Needs decision or Failed.
- [x] Approve and Answer are T1; Reject requires a note and posts it as a comment with Caduceus-stamped author; Retry and Reassign are T1 (tests against stub).
  Deviation: Reject is a T0 (the owner has just written the note); Reassign is Hermes's own T1 route. Tests run against the real Hermes, not a stub.
- [x] An item disappears when the same task is approved or unblocked from the CLI (test with a simulated Kanban event).
- [x] Push for review/needs-input uses "Reviews & blocked tasks"; task and cron failures use "Failures"; each deep-links to the item and is deduplicated server-side.
- [x] The per-job notification toggle suppresses that job's failure push and Inbox item only; Hermes's job config is unchanged.
- [x] Phone: swipe actions have menu alternatives; Reject + note opens a sheet above the soft keyboard.
- [x] No Inbox item is persisted; only per-device snooze/dismiss and the job toggles are stored.
- [x] Every screen passes the M0 #05 gates (390, 320, 820, 1440); all strings come from the catalogues; the module registers its help page and glossary terms (Review, needs input, gave up). Catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `d5832fe feat: Work in the Inbox and notifications: review, needs-input and gave-up tasks with Approve, Reject + note, Answer, Retry, Reassign; Reviews & blocked tasks push; per-job notification switch (M3 #09)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `d5832fe` `server/test/inbox-sources.test.ts`: 21 cases; seam: Caduceus server module / HTTP API (no Hermes launcher imported).
  - `d5832fe` `server/test/inbox-work.test.ts`: 7 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `d5832fe` `server/test/push-rules.test.ts`: 8 cases; seam: Caduceus server module / HTTP API (no Hermes launcher imported).
  - `d5832fe` `server/test/push.test.ts`: 16 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
- **Verification recorded:** Criteria ticked; tests run against the real Hermes, not a stub; the removal-on-CLI-change check uses a simulated Kanban event. Gate widths and results: not recorded.
- **Deviations:**
  - Reject is a T0 (the owner has just written the note). Reassign is Hermes's own T1 route.
  - Tests run against the real Hermes, not a stub.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
