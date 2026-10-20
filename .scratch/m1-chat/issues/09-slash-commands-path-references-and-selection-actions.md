# 09: Slash commands, path references and selection actions

**What to build:** Typing `/` in the composer opens a menu built from Hermes's command catalogue (commands.catalog, with complete.slash for arguments): agent commands, skills, quick and plugin commands, personalities, retry, undo, title and the others. Choosing one runs it through slash.exec or command.dispatch and shows the result in the transcript. Commands that the policy proxy classifies as Denied (exec-type quick commands) are shown disabled with the reason.

Typing `@` or `~/` offers path completion from Hermes's file-system listing endpoint, inserting a path reference in the prompt. Selecting text in a reply shows selection actions: Reply with selection (quotes it into the composer) and Refine chips (shorter, simpler, more detail…) that send a follow-up about the selection.

**Blocked by:** 08 (Composer chips, config sheet and context ring)

**Status:** resolved

- [x] The slash menu lists commands from Hermes's catalogue with descriptions, filters as you type and works by keyboard (tests against a recorded catalogue).
- [x] `/personality`, `/retry`, `/undo` and `/title` work end to end against real Hermes.
- [x] Denied commands are disabled with their reason and never reach Hermes (test).
- [x] `@` and `~/` completion lists entries from the session's workspace and stays within Hermes's allowed roots.
  Deviation: "allowed roots" for reads are the file guard's (M0 #08): everything but protected paths (`.env`, `auth.json`, `caduceus/`), which the proxy refuses (test); the roots limit writes only. Hermes's own listing also hides its sensitive names and folders such as `node_modules`.
- [x] Reply with selection and the Refine chips work by mouse, touch and keyboard; on a phone they appear in a menu after a long-press selection.
  Deviation: on a phone, once text is selected an "Ask about the selection" bar appears above the message box and one tap opens the menu (a sheet), so that the actions never sit on the system's own selection handles. Headless Chromium's long press does not select text, so the phone path was checked with a selection made in the page under touch emulation.
- [x] Passes the M0 #05 gates; strings via catalogues; help page and glossary terms (slash command, personality).
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)
- **Commit(s):** `b8a8b8d` feat: slash commands, path references and selection actions in the composer (M1 #09).
- **Tests added:**
  - `server/test/chat-slash.test.ts` (9): Caduceus HTTP/WS API seam over real Hermes (`/personality`, `/retry`, `/undo`, `/title`; denied commands; path listing and the guard).
  - `web/test/slash-menu.test.ts` (14), `path-reference.test.ts` (16), `selection-actions.test.ts` (6): pure modules (the slash menu against a recorded catalogue).
- **Verification recorded:** Every criterion is ticked, including the M0 #05 gates. The phone path was checked in the browser with a selection made in the page under touch emulation, because headless Chromium's long press does not select text. Smoke scripts are committed in `.scratch/m1-chat/m1-09-smoke/` (`serve.ts`, `gates-extra.mjs`, `states.mjs`); the ticket records no widths or results.
- **Deviations:**
  - "Allowed roots" for reads are the file guard's (M0 #08): everything but protected paths (`.env`, `auth.json`, `caduceus/`), which the proxy refuses (test); the roots limit writes only. Hermes's own listing also hides sensitive names and folders such as `node_modules`.
  - On a phone, once text is selected an "Ask about the selection" bar appears above the message box and one tap opens the menu (a sheet), so the actions never sit on the system's selection handles.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:** None recorded. Status: resolved.
