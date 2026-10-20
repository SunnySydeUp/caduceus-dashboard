# 02: Inbox sources, grouping and activity feed

**What to build:** The Inbox grows from live chat requests to everything the owner should know about, grouped as **Needs decision**, **Failed** and **FYI**:
- cron runs that failed, jobs that are overdue, and a stale scheduler (from `cron.changed` on the observer connection, then a diff of Hermes's cron run history), with Run now, Pause and Open output;
- pending DM pairing requests (from `pairing.changed` and Hermes's pairing list), with Approve and Deny;
- gateway down, resource pressure, a missing provider key and Hermes update available (from Hermes status and health, as Health already reads them), with Restart or Open;
- finished runs the owner started (`message.complete`), shown in an activity feed and as toasts.

Each source registers through the module registry, so later modules (Work in M3 #09, budgets in M5/M6) add Inbox sources without changing the Inbox. Every item is still derived from Hermes and resolves on its own when the Hermes state changes.

The owner can filter by category and profile, and snooze or dismiss items per device. On a phone, swipe right resolves or dismisses and swipe left snoozes; both are also in the item's ⋮ menu.

**Blocked by:** 01 (Inbox tracer bullet: live approvals and questions)

**Status:** resolved

- [x] Each listed source produces items with the inline actions from work-model §2.5 and removes them when Hermes's state changes (for example a later successful cron run clears the failure; a pairing approved in the CLI disappears). Tests per source with recorded Hermes events.
  Deviation: no Deny for a pairing request (Hermes only has Approve and clear-pending, which drops every request), so a pairing item has Approve and a link to the Pairing screen. Tests are the pure derivations over Hermes-shaped answers plus real-Hermes tests for pairing, cron failure and clearing; overdue and the update notice are pure-tested only. Gateway Restart is offered only on a stuck gateway (root profile); other gateway repairs link to Connect › Gateway. The update check is off unless the server is started with `hermesUpdateCheck` (production `main.ts` does) so tests make no network calls.
- [x] Inline actions keep their tiers: pairing Approve is T2; gateway Restart is T2; cron Run now and Pause are T1 naming the job and profile. Read-only mode hides or disables them.
  Deviation: read-only mode is refused by the policy (message shown) rather than hiding the buttons.
- [x] An Inbox-source registration contract exists, with a test module proving a new source needs no Inbox change.
- [x] Items are grouped Needs decision → Failed → FYI; the category and profile filters are kept in the URL; only Needs decision items count towards the badge.
- [x] Snooze (1 h, tonight, tomorrow, custom) and dismiss are stored per device in the Caduceus store keyed by the Hermes reference, and a dismissed item reappears if its Hermes state changes again.
- [x] Activity feed: finished runs and other FYI events with per-device last-seen cursors (R8); unseen counts show as nav badges; a finished run shows a toast when Caduceus is visible.
  Deviation: the unseen count shows on the Activity tab inside the Inbox, not on the nav (the Inbox tab badge stays decisions only). The feed is kept in memory by the server (a restart empties it); only each device's cursor is stored. A finished run is a session going from working to idle, as `session.active_list` shows.
- [x] Phone swipe actions are T0 with an undo toast, never T2/T3, and every swipe has a menu alternative (test both).
  Deviation: swipe right dismisses (decisions cannot be dismissed), swipe left snoozes an hour, both with an undo toast and both in the ⋮ menu. They reuse the Chat sessions list's gesture hook; the swipe and menu were not exercised in a browser or by a test (only the pure snooze and hide rules are tested).
- [x] Empty states per group carry their primary action. Passes the M0 #05 gates; strings via catalogues; help page and glossary updated (Snooze, Activity feed).
  Catalogue part deferred (owner). Gates checked on /inbox at all four widths and on the Activity view at 390.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `113d0f6 feat: Inbox sources (cron, pairing, system, update), groups, filters, per-device snooze and dismiss, activity feed and finished-run toasts (M2 #02)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `113d0f6` `server/test/inbox-hidden.test.ts`: 5 cases; seam: Caduceus server module / HTTP API (no Hermes launcher imported).
  - `113d0f6` `server/test/inbox-sources.test.ts`: 16 cases; seam: Caduceus server module / HTTP API (no Hermes launcher imported).
  - `113d0f6` `server/test/inbox.test.ts`: 14 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `113d0f6` `web/test/inbox-feed.test.ts`: 5 cases; seam: pure web module (model/render).
  - `113d0f6` `web/test/inbox-model.test.ts`: 17 cases; seam: pure web module (model/render).
- **Verification recorded:** Gates checked on /inbox at all four widths and on the Activity view at 390 (ticket text). Tests: pure derivations over Hermes-shaped answers plus real-Hermes tests for pairing, cron failure and clearing; overdue and the update notice are pure-tested only. Swipe and ⋮ menu: not exercised in a browser or by a test. Perf numbers: not recorded.
- **Deviations:**
  - No Deny for a pairing request: Hermes only has Approve and clear-pending (which drops every request). A pairing item has Approve and a link to the Pairing screen.
  - Gateway Restart is offered only on a stuck gateway (root profile); other gateway repairs link to Connect › Gateway.
  - The update check is off unless the server starts with `hermesUpdateCheck` (production `main.ts` does), so tests make no network calls.
  - Read-only mode is refused by the policy with a message; the buttons are not hidden.
  - The unseen count shows on the Activity tab inside the Inbox, not on the nav. The feed is held in server memory (a restart empties it); only each device's cursor is stored. A finished run is a session going from working to idle.
  - Swipe right dismisses (decisions cannot be dismissed), swipe left snoozes one hour; both have an undo toast and a ⋮ menu entry. They reuse the Chat sessions list gesture hook. Not exercised in a browser or by a test; only the pure snooze and hide rules are tested.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - Swipe gestures and the ⋮ menu have no browser or test check recorded.
