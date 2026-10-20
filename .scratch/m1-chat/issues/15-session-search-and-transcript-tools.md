# 15: Session search and transcript tools

**What to build:** Full-text search across message bodies uses Hermes's session search endpoint. Results appear in the sessions pane and in the command palette with highlighted snippets; choosing a hit opens the session and jumps to the first matching message using Hermes's messages-around and timeline endpoints, highlighting it.

Inside a transcript the owner can search (with next/previous and a match count), filter by role (user, assistant, tool, reasoning), expand or collapse all tool and reasoning cards, and copy the whole transcript as Markdown or plain text.

**Blocked by:** 13 (Sessions list), 05 (Agent activity: reasoning, tools, subagents, todos)

**Status:** resolved

- [x] Search queries Hermes's session search endpoint (no Caduceus index or copied text) and shows highlighted snippets with session title, profile and date; the query lives in the URL.
- [x] Palette session search returns the same hits and opens them; results are keyboard navigable.
- [x] Opening a hit loads the surrounding messages via messages/around even when the hit is far back in a long transcript, scrolls to it and highlights the match (end-to-end test with a 1,000-message session).
- [x] In-transcript search shows match count and next/previous (Enter / Shift+Enter, and buttons), including inside collapsed cards, which expand when matched.
- [x] Role filters hide/show user, assistant, tool and reasoning items and are announced to screen readers.
- [x] Expand all / collapse all apply to tool, reasoning and subagent cards.
- [x] Copy transcript produces Markdown or plain text matching the visible filters, with a toast.
- [x] Phone: search is a full-width field at the top of the list; in-transcript search opens as a top bar above the keyboard.
  Deviation: the in-transcript find bar is a bar pinned under the app bar at the top of the conversation (it stays there while the transcript scrolls); it is not moved above the on-screen keyboard.
- [x] Every screen and sheet passes the M0 #05 gates (390, 320, 820, 1440; no overflow; axe clean; hit targets; tokens only).
- [x] All strings go through the message catalogues; the module's help page and glossary terms are registered (the missing-help test passes).
  Catalogue part deferred (owner); the help page text and glossary terms are registered.

## Comments

### Evidence (documentation pass)
- **Commit(s):** `37deb3f` feat: session search in the list and palette, open a hit at its first matching message, find/filter/expand/copy in the transcript (M1 #15).
- **Tests added:**
  - `server/test/session-search.test.ts` (4): Caduceus HTTP/WS API seam over real Hermes (includes a hit far back in a long transcript).
  - `web/test/transcript-tools.test.ts` (11): pure module.
  - Modified: `web/test/palette.test.ts` (21, was 18). Fixture: `seed-session.ts`.
- **Verification recorded:** Every criterion is ticked, including the gates at 390/320/820/1440. The ticket records no widths, axe results or numbers: not recorded. The end-to-end test with a 1,000-message session exists as a `session-search.test.ts` case ("far back in a 1,000-message session").
- **Deviations:**
  - The in-transcript find bar is pinned under the app bar at the top of the conversation (it stays while the transcript scrolls); it is not moved above the on-screen keyboard.
  - Catalogue part deferred (owner); the help page text and glossary terms are registered.
- **Follow-ups / open items:** None recorded. Status: resolved.
