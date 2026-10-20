# 13: Sessions list

**What to build:** The Chat module's sessions pane becomes the full list. Sessions are grouped by date (Today, Yesterday, This week, Older) with pinned sessions on top, and rows show unread dots, a live marker for running sessions (gateway session.active_list) and a failed badge. A density toggle switches between comfortable and compact. Filters cover source and category tabs (Chats / Automation), failed-only and hide API noise, over Hermes's session list endpoint with source filters. A cross-profile toggle switches to Hermes's aggregate profiles sessions endpoint. A stats strip in the header summarises counts and token use from Hermes's session stats.

The list updates live on the gateway's sessions.changed broadcast. Keyboard users move with j/k and open with Enter. On phones the list is the first screen of a list → transcript push navigation, with pull-to-refresh (and a visible Refresh button as the alternative).

**Blocked by:** 03 (Chat tracer bullet: new chat, streamed reply, resume)

**Status:** resolved

- [x] Rows show title, last activity, source icon, unread dot, live marker and failed badge, all derived from Hermes data on every load; Caduceus stores none of it (test that the Caduceus store has no session rows).
  Deviation: Hermes writes no failed flag on a list row, so Failed is derived from `end_reason` (error, failure, crash, exception, abort, timeout); the live marker is `working`/`waiting` in `session.active_list`.
- [x] Date groups and the pinned section render correctly across time zones and locales (unit tests using the catalogue's date formatting).
  Deviation: "This week" is two to six days ago (not a locale's calendar week), so the groups do not depend on the locale; the locale only writes the labels (`Intl`, the catalogue part deferred (owner)).
- [x] Source filter, Chats/Automation tabs, failed-only and hide-API-noise filters are kept in the URL and combine correctly (tests).
- [x] The cross-profile toggle shows sessions from all profiles with a profile badge, using the aggregate endpoint; opening one scopes the tab to that profile.
- [x] A sessions.changed broadcast updates the list without a reload, preserving scroll position and selection (test with a simulated broadcast).
- [x] j/k move selection and Enter opens; shortcuts appear in the ? shortcut sheet.
- [x] Phone: list → transcript push navigation, pull-to-refresh with a visible Refresh button alternative, rows at least 44 px; desktop: list and transcript side by side.
- [x] The empty state offers "New chat"; the stats strip collapses to a single line on phones.
- [x] Long lists stay smooth: the list is virtualised or paginated against Hermes (test with 2,000 sessions).
- [x] Every screen and sheet passes the M0 #05 gates (390, 320, 820, 1440; no overflow; axe clean; hit targets; tokens only).
  Deviation: checked with `ui-gates.mjs` (no Playwright test), dark and light; the only axe finding is the pre-existing light-theme contrast of the transcript's copy button on `/chat/:id`, not this ticket's screens.
- [x] All strings go through the message catalogues; the module's help page and glossary terms are registered (the missing-help test passes).
  Deviation: catalogue part deferred (owner); help page and glossary term registered.

## Comments

### Evidence (documentation pass)
- **Commit(s):** `fe0f5fd` feat: sessions list with date groups, filters, cross-profile view, live updates and paging (M1 #13).
- **Tests added:**
  - `server/test/sessions.test.ts` (9): Caduceus HTTP/WS API seam (real Hermes; includes 2,000 sessions and the no-session-rows store check).
  - `web/test/sessions-model.test.ts` (23): pure module (groups, filters, URL state).
  - Modified: `server/test/chat.test.ts` (15, was 15), `run-control.test.ts` (10, was 10). Fixture: `seed-session.ts`.
- **Verification recorded:** Checked with `ui-gates.mjs` (no Playwright test), dark and light. The only axe finding is the pre-existing light-theme contrast of the transcript's copy button on `/chat/:id`, not this ticket's screens. The ticket does not list the widths run or any numbers.
- **Deviations:**
  - Hermes writes no failed flag on a list row, so Failed is derived from `end_reason` (error, failure, crash, exception, abort, timeout); the live marker is `working` or `waiting` in `session.active_list`.
  - "This week" is two to six days ago (not a locale's calendar week), so groups do not depend on the locale; the locale only writes the labels (`Intl`).
  - Checked with `ui-gates.mjs`, not Playwright.
  - Catalogue part deferred (owner); help page and glossary term registered.
- **Follow-ups / open items:** The pre-existing light-theme contrast of the transcript's copy button (see M1 #14 for the `.rich__copy` change). Status: resolved.
