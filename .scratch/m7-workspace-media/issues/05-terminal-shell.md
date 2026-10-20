# 05: Terminal shell

**What to build:** Workspace › Terminal gives the owner a real interactive shell (`$SHELL` in a PTY) provided by the Caduceus server itself, since Hermes only exposes its TUI over `/api/pty`. Opening it requires T2 passkey step-up; the shell starts in the selected workspace directory. Several browser tabs or devices can watch the same shell; resizing, copying the selection and restarting the shell are supported.

It is offered on tablet and desktop. On phones the screen explains it is not designed for small screens and offers an explicit "Open anyway".

**Blocked by:** M0 #08 (Policy proxy, risk tiers, read-only mode and tiered confirmations), M1 #02 (Contextual help framework)

**Status:** resolved

- [x] Opening a shell without a fresh step-up grant is refused by the server (test); the grant is checked on the WebSocket upgrade, not only in the UI.
- [x] The shell is unavailable in read-only mode (test).
- [x] Multiple viewers see the same output; the shell survives a dropped browser connection and is reattachable within the grace period; it is killed on Caduceus shutdown and after an idle timeout.
- [x] Resize follows the viewer's window; copy and paste work; Restart kills and respawns the shell after a T1 confirm.
- [x] Session start, end and restart are audited (actor, device, cwd, profile); keystrokes are not logged.
- [x] Theme follows Caduceus appearance tokens.
- [x] Phone (<600 px): explanatory screen with "Open anyway" (still behind step-up); tablet and desktop open directly.
- [x] Every new screen and sheet passes the M0 #05 gates (phone 390, small phone 320, tablet 820, desktop 1440: no overflow, axe clean, hit targets, tokens only).
- [x] All strings go through the message catalogues; the module registers its help page and glossary terms (Terminal shell, Step-up), and the missing-help test passes.
  Deviation: catalogue part deferred (owner). The Step-up term already exists (Settings); the page links it with `[[step-up]]` and the module adds only Terminal shell.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `a40c380` feat: Workspace Terminal: a real shell in a PTY run by Caduceus behind T2 step-up, shared by every viewer of a folder, reattachable within a grace period, idle timeout, restart, audit (M7 #05)
- **Tests added:**
  - `server/test/terminal-client.test.ts` (added in `a40c380`): 3 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API with the fake Hermes launcher
  - `server/test/terminal.test.ts` (added in `a40c380`): 11 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API with the fake Hermes launcher
  - `web/test/terminal-model.test.ts` (added in `a40c380`): 5 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. The ticket names tests for the step-up grant on the WebSocket upgrade, read-only refusal, multi-viewer output, reattach within the grace period, shutdown and idle kill, and audit. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded). The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - The Step-up glossary term already exists (Settings). The page links it with `[[step-up]]`; the module adds only Terminal shell.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
