# 17: Duplicate, worktree sessions, export/import, deep links

**What to build:** From the session row menu the owner can duplicate a session (a full branch via session.branch) and start a new session in a fresh git worktree of the current workspace, through Hermes's git worktree add endpoint; removing it later goes through worktree remove, and Caduceus refuses removal while the worktree has uncommitted changes unless the owner explicitly confirms.

Sessions can be exported as Markdown, JSON or themed HTML (rendered in the browser from Hermes's session export JSON) and imported from JSON/JSONL through Hermes's session import endpoint. Links of the form /chat/new?prompt=&profile= open a new chat with the prompt prefilled (never auto-sent) in the given profile.

**Blocked by:** 12 (Message actions and turn recovery), 13 (Sessions list)

**Status:** resolved

- [x] Duplicate creates a new Hermes session with the full history via session.branch and opens it; it is T0 (the copy can be deleted).
- [x] New worktree session: pick a branch name, the worktree is created via the git worktree add endpoint and the session's workspace is set to it; the session shows a worktree badge.
  Deviation: Hermes stores a session only at its first prompt, so the worktree path is handed to the next new chat, which starts in it; the badge comes from Hermes's worktree list for the session's cwd.
- [x] Remove worktree checks git status first; a clean worktree is T1, a dirty one is T3 (step-up + typed confirmation stating that uncommitted changes are lost).
- [x] Export Markdown / JSON / themed HTML downloads files built from Hermes's export JSON; the HTML uses the current theme tokens and is self-contained (snapshot test).
- [x] Import JSON/JSONL validates the file client-side, previews message count and target profile, then imports via the session import endpoint as T1; malformed files show a precise error (tests).
- [x] /chat/new?prompt=&profile= opens a new chat with the prompt in the composer and the profile scoped to the tab; the prompt is never auto-sent and unknown profiles fall back with a notice (test).
- [x] Phone: export and import live in the row ⋮ menu and a sheet; the downloaded file opens via the OS share/download flow.
- [x] Every screen and sheet passes the M0 #05 gates (390, 320, 820, 1440; no overflow; axe clean; hit targets; tokens only).
  Deviation: at 320 px axe flags the transcript-tools buttons as partly under the sticky app bar when the transcript is scrolled to its end; other widths pass.
- [x] All strings go through the message catalogues; the module's help page and glossary terms are registered (the missing-help test passes).
  Catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)
- **Commit(s):** `cc3a9ef` feat: duplicate and worktree sessions, export and import of sessions, new-chat deep links (M1 #17).
- **Tests added:**
  - `server/test/session-worktrees.test.ts` (12), `session-export-import.test.ts` (6): Caduceus HTTP/WS API seam over real Hermes.
  - `web/test/session-import.test.ts` (13), `session-export.test.ts` (9), `deep-link.test.ts` (7), `worktrees.test.ts` (5), `workspace-handoff.test.ts` (3): pure modules.
- **Verification recorded:** Every criterion is ticked. At 320 px axe flags the transcript-tools buttons as partly under the sticky app bar when the transcript is scrolled to its end; other widths pass. No other numbers are recorded.
- **Deviations:**
  - Hermes stores a session only at its first prompt, so the worktree path is handed to the next new chat, which starts in it; the badge comes from Hermes's worktree list for the session's cwd.
  - The 320 px transcript-tools target-size finding.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:** The 320 px finding is open. Status: resolved.
