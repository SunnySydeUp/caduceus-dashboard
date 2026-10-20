# 11: Drafts and saved prompts

**What to build:** Whatever the owner types in the composer is kept as a draft on the Caduceus server, keyed by profile and session (or "new chat"), so it survives a reload and follows them from phone to desktop. Sessions with an unsent draft show a draft indicator in the session list, and sending or clearing the composer deletes the draft.

A saved-prompts library (a composer chip, and a palette command) lets the owner save the current text as a named prompt with tags and an optional profile scope, then search, insert, edit and delete saved prompts. Drafts and saved prompts are Caduceus-owned concepts (Caduceus store, requirement R5); Hermes has no backing for them.

**Blocked by:** 08 (Composer chips, config sheet and context ring)

**Status:** resolved

- [x] Composer text is saved to the Caduceus server debounced (about 1 s) and on page hide; reopening the session on another signed-in device shows the same draft (end-to-end test with two browser contexts).
  Deviation: the two-device check is `server/test/chat-drafts-sync.test.ts` (two sign-ins against the real server, the page's own sync code) plus a throwaway two-tab browser check, not a Playwright test (project rule). Another device's save is noticed when the page is looked at again (focus, visibility) and on the next save, not by a poll.
- [x] Drafts are keyed by (profile, session id or "new") and store only the text, attachment references and updated time; sending or clearing the composer deletes the draft, and a session deleted in Hermes drops its orphaned draft (test).
  Deviation: M1 #10 follow-up (owner): a draft also keeps its attachments across a reload, so it stores their bytes too (capped: 8 MB each, 24 MB per draft, 20 per draft, 40 KB of text, 200 drafts, 256 MB in all; the composer, the attach menu and the help page say so), plus a revision counter for the conflict notice. A text or file that looks like a secret (key shapes, a named password or token, a private key, `.env` and key files) is refused with the reason and never stored. The orphan is dropped when the draft is read or listed.
- [x] When two devices edit the same draft, the latest write wins and the other device shows a non-blocking "draft updated elsewhere" notice instead of silently overwriting typed text.
- [x] The session list shows a draft indicator on rows with an unsent draft; the indicator has an accessible label.
- [x] Saved prompts: create from the composer, list with search and tag filter, insert at the cursor, edit, delete (T0 with undo toast); the profile scope hides prompts scoped to other profiles.
- [x] On phones the saved-prompts library opens as a bottom sheet from the composer config sheet; on desktop it is a chip popover; both are reachable from the palette.
  Deviation: the palette's New chat command, which Saved prompts uses from other screens, never left the page (its URL push was popped by the palette layer closing); `openNewChat` now waits for the layers to close.
- [x] Read-only mode blocks draft and prompt writes with a clear message, and drafts are never sent to Hermes before the owner presses Send.
  Deviation: reading and inserting saved prompts stays allowed in read-only mode.
- [x] Every screen and sheet passes the M0 #05 gates (390, 320, 820, 1440; no overflow; axe clean; hit targets; tokens only).
  Deviation: the only console lines are Chrome's own `Failed to load resource … 422` for the deliberate refusal of a secret (the notes state), as in M0 #04.
- [x] All strings go through the message catalogues; the module's help page and glossary terms are registered (the missing-help test passes).
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)
- **Commit(s):** `a47869a` feat: drafts kept on the Caduceus server with attachments, session draft indicator, saved prompts library (M1 #11).
- **Tests added:**
  - `server/test/chat-drafts.test.ts` (9), `chat-drafts-sync.test.ts` (5): Caduceus HTTP API seam (the second is two sign-ins against the real server, running the page's own sync code).
  - `web/test/chat-drafts-contract.test.ts` (5), `saved-prompts.test.ts` (5): pure modules.
- **Verification recorded:** Every criterion is ticked, including the gates at 390/320/820/1440. A throwaway two-tab browser check is recorded in a Deviation line. The only console lines were Chrome's own `Failed to load resource … 422` for the deliberate refusal of a secret. No numbers beyond that are recorded.
- **Deviations:**
  - The two-device check is `chat-drafts-sync.test.ts` plus a throwaway two-tab browser check, not Playwright; another device's save is noticed on focus or visibility and on the next save, not by a poll.
  - M1 #10 follow-up (owner): a draft also keeps its attachments across a reload, so it stores their bytes (caps: 8 MB each, 24 MB per draft, 20 per draft, 40 KB of text, 200 drafts, 256 MB total; the composer, attach menu and help page say so) and a revision counter for the conflict notice. A text or file that looks like a secret is refused with the reason and never stored. An orphaned draft is dropped when read or listed.
  - The palette's New chat command never left the page (its URL push was popped by the palette layer closing); `openNewChat` now waits for the layers to close.
  - Reading and inserting saved prompts stays allowed in read-only mode.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:** None recorded. Status: resolved.
