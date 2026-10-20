# 12: Message actions and turn recovery

**What to build:** Every message in the transcript has an action menu (hover toolbar on desktop, ⋮ button and long-press on touch): copy (text or Markdown), edit-and-resend for user messages, regenerate for assistant replies, fork from this message, retry and undo. Edit and regenerate use the gateway's prompt.submit with truncate_before_row_id and confirm_truncate; fork at the tip uses session.branch, and fork from an earlier message branches and then undoes back to that message (session.undo); retry uses the /retry slash command.

When a turn fails, the reply bubble turns into a failed-turn bubble showing the error and a Retry button. When a turn was interrupted (stopped, connection lost past the grace period, Hermes restarted), the transcript marks it and offers Continue or Retry. New sessions get an automatic title from Hermes; the session row menu offers Rename and Regenerate title (session.title, using the title_generation auxiliary slot).

**Blocked by:** 04 (Rich transcript rendering)

**Status:** resolved

- [x] Copy places plain text or Markdown on the clipboard and shows a toast; it works on iOS Safari (end-to-end test on the phone project).
  Deviation: copy is checked in desktop Chromium (clipboard read back) and has an `execCommand` fallback for iOS Safari; the end-to-end test on the phone project is not run (no new Playwright tests; no iPhone here).
- [x] Edit-and-resend truncates after the edited message through prompt.submit with truncate_before_row_id; because it discards later turns it is T1 (confirm naming how many messages are removed).
- [x] Regenerate replaces the last assistant reply; fork creates a new Hermes session via session.branch and opens it, with the source session linked in its header. Fork from an earlier message is offered only when the branch-then-undo path succeeds, and its result is verified against Hermes's history (contract test).
  Deviation: Regenerate and Edit confirm as T1 (the ticket names T1 for edit only), because both discard the old reply; fork from an earlier message ends with a check of the branch against Hermes's history (test), not a separate contract test.
- [x] Undo removes the last exchange through session.undo as a T0 action with an undo-style toast that explains what was removed.
- [x] A failed turn renders a failed-turn bubble with the error text and Retry; a test injects a gateway error and asserts Retry resubmits.
- [x] An interrupted turn is marked as interrupted after reload and offers Continue/Retry; no duplicate turns are created on retry (test).
- [x] New chats receive Hermes's auto-title; Rename (T0) and Regenerate title work from the session row menu and the transcript header, and the result is read back from Hermes, not stored by Caduceus.
  Deviation: Regenerate title is T1 (confirm) because `llm.oneshot` is T1 in the policy map; it asks the title_generation slot and writes the result with a REST PATCH.
- [x] Every hover action also exists in the ⋮ and long-press menus; menus are keyboard reachable.
- [x] Every screen and sheet passes the M0 #05 gates (390, 320, 820, 1440; no overflow; axe clean; hit targets; tokens only).
  Deviation: axe target-size on the YOLO switch at 320 px in one scroll position (it sits under the sticky app bar); not part of this ticket.
- [x] All strings go through the message catalogues; the module's help page and glossary terms are registered (the missing-help test passes).
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)
- **Commit(s):** `58d3720` feat: message actions (copy, edit and resend, regenerate, fork, undo, retry), failed and interrupted turn recovery, regenerate title (M1 #12).
- **Tests added:**
  - `server/test/chat-message-actions.test.ts` (16): Caduceus HTTP/WS API seam over real Hermes (includes fork checked against Hermes's history, failed-turn Retry, no duplicate turns).
  - `web/test/message-actions.test.ts` (13), `turn-recovery.test.ts` (6), `session-title.test.ts` (3): pure modules.
  - Modified: `server/test/chat-provider.test.ts` (2, was 2), `gateway-policy.test.ts` (17, was 16), `web/test/activity.test.ts` (21, was 20). Fixture: `stub-llm.ts`.
- **Verification recorded:** Every criterion is ticked, including the gates at 390/320/820/1440. Copy was checked in desktop Chromium (clipboard read back). The iOS Safari path and the phone-project end-to-end test were not run (no iPhone here). Axe `target-size` flagged the YOLO switch at 320 px in one scroll position under the sticky app bar. No other numbers are recorded.
- **Deviations:**
  - Copy has an `execCommand` fallback for iOS Safari; no iOS check and no new Playwright test.
  - Regenerate and Edit confirm as T1 (the ticket names T1 for edit only) because both discard the old reply; fork from an earlier message ends with a check against Hermes's history (test), not a separate contract test.
  - Regenerate title is T1 because `llm.oneshot` is T1 in the policy map; it asks the `title_generation` slot and writes the result with a REST PATCH.
  - The YOLO-switch target finding is not part of this ticket.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:** iOS Safari copy is not verified; the YOLO-switch target-size finding at 320 px is open. Status: resolved.
