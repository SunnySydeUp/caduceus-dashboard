# 20: Chat behaviour settings and settings search

**What to build:** Settings gains a Chat panel with behaviour preferences stored in the Caduceus store (R1 prefs, per device where it makes sense): send key (Enter vs ⌘/Ctrl+Enter), completion sound, timestamps, transcript and list density, pin limit, auto-follow, default activity mode and similar toggles. Settings › Navigation lets the owner reorder and hide nav entries (and composer chip order from ticket 08 is reachable here).

A search field at the top of Settings searches every setting across all registered modules' settings panels, by label, description and keywords, and jumps to the matching field with a highlight. Settings search is also available from the palette.

**Blocked by:** 08 (Composer chips, config sheet and context ring), 13 (Sessions list)

**Status:** resolved

- [x] Each toggle takes effect immediately in Chat (tests for send key, timestamps, density, pin limit and auto-follow behaviour).
  Deviation: tests cover send key, timestamps (`timeLabel`), pin limit and auto-follow as pure functions plus the page's store over the real server; transcript density is a data attribute and CSS, checked in the browser, not by a test. Completion sound is checked by hand only.
- [x] Preferences are Caduceus-owned (R1) and never written into Hermes config; device-scoped vs account-scoped preferences are labelled.
- [x] Nav order: reorder with drag on desktop and ↑/↓ buttons in reorder mode (the always-available alternative), hide/show entries; the shell's tab bar, rail and sidebar follow the order (test).
  Deviation: the More screen still lists entries in registry order (hidden entries stay reachable there).
- [x] Settings search indexes every setting registered through the module registry; a test fails if a module's settings panel registers a field without search metadata.
- [x] Choosing a result navigates to the panel, scrolls to and focuses the field and highlights it; results also appear in the palette.
- [x] Reset to defaults per panel is T1.
  Deviation: the Chat and Navigation panels (the ones that hold this ticket's preferences) have Reset to defaults; Appearance, Keyboard, Security and Install do not.
- [x] Phone: settings is a list → panel push navigation with the search field pinned at the top.
- [x] Every screen and sheet passes the M0 #05 gates (390, 320, 820, 1440; no overflow; axe clean; hit targets; tokens only).
- [x] All strings go through the message catalogues; the module's help page and glossary terms are registered (the missing-help test passes).
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)
- **Commit(s):** `39fc1fa` feat: Settings › Chat behaviour preferences (send key shared with fast chat, completion sound, timestamps, density, auto-follow, pin limit, default activity mode), Settings › Navigation reorder and hide, settings search with palette results and jump-to-field (M1 #20).
- **Tests added:**
  - `server/test/chat-behaviour.test.ts` (4): Caduceus HTTP API seam over real Hermes (the page's store).
  - `web/test/chat-behaviour.test.ts` (5), `nav-order.test.ts` (14), `settings-search.test.ts` (6): pure modules.
  - Modified: `server/test/chat-message-actions.test.ts` (16, was 16), `chat.test.ts` (15, was 15), `web/test/help.test.ts` (21, was 21), `module-registry.test.ts` (8, was 8).
- **Verification recorded:** Transcript density (a data attribute and CSS) was checked in the browser, not by a test. Completion sound was checked by hand only. The gates criterion is ticked; the ticket records no widths or numbers: not recorded.
- **Deviations:**
  - Tests cover send key, `timeLabel`, pin limit and auto-follow as pure functions plus the page's store over the real server; density and sound are not unit-tested.
  - The More screen still lists entries in registry order (hidden entries stay reachable there).
  - Only the Chat and Navigation panels have Reset to defaults; Appearance, Keyboard, Security and Install do not.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:** Reset to defaults is missing on four panels. Status: resolved.
