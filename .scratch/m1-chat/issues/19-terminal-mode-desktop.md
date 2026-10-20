# 19: Terminal mode (desktop)

**What to build:** On tablets and desktops an app-bar toggle in Chat switches the current session to Terminal mode: the Hermes TUI running in an xterm pane over Hermes's PTY WebSocket, proxied by the Caduceus server. Opening it needs a T2 passkey step-up, because the TUI reaches a shell.

The PTY is kept alive on the Caduceus server so that a reload or tab switch reattaches to the same terminal with scrollback. The terminal follows the current theme, supports copy-last-output and terminal shortcuts, and works on the same Hermes session as the native chat view, so the owner can switch back and forth. Terminal mode is hidden on phones.

**Blocked by:** 03 (Chat tracer bullet: new chat, streamed reply, resume), M0 #08 (Policy proxy, risk tiers, read-only mode and tiered confirmations)

**Status:** resolved

- [x] Opening terminal mode requires a T2 step-up; without a valid grant the PTY upgrade is refused by the Caduceus server (test), and read-only mode blocks it.
- [x] The xterm pane connects through Caduceus to Hermes's PTY WebSocket for the current session and profile; resize events are forwarded.
- [x] Reload or reconnect within the keep-alive window reattaches to the same PTY with scrollback; after the window ends the PTY is closed and the UI says so (test).
  Deviation: Caduceus holds the upstream itself for 10 minutes (not Hermes's 30-minute attach registry) so it can close the PTY on time.
- [x] Switching between terminal and native chat keeps the same Hermes session; messages sent in either appear in the other after refresh (end-to-end test).
- [x] The terminal uses theme tokens for its palette and updates when the theme changes; reduced motion disables cursor blink.
- [x] Copy-last-output and documented terminal shortcuts work and are listed in the ? shortcut sheet; the terminal never swallows the global Escape/palette shortcuts without an escape hatch.
- [x] The toggle is not rendered below 600 px; a test on the phone project asserts it is absent and the route is unreachable.
  Deviation: no Playwright test (repo rule); `terminalModeOffered` is unit-tested and the phone widths were checked in the browser smoke (the `?mode=terminal` address shows the chat view).
- [x] Open and close of terminal mode are audited.
- [x] Every screen and sheet passes the M0 #05 gates (390, 320, 820, 1440; no overflow; axe clean; hit targets; tokens only).
- [x] All strings go through the message catalogues; the module's help page and glossary terms are registered (the missing-help test passes).
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)
- **Commit(s):** `c80968e` feat: Chat terminal mode: Hermes's TUI over its PTY relayed by Caduceus behind T2 step-up, kept alive for a grace period, shared xterm pane, copy last output and shortcuts (M1 #19).
- **Tests added:**
  - `server/test/terminal-mode-hermes.test.ts` (5): Caduceus WS seam over real Hermes.
  - Modified: `server/test/gateway-proxy.test.ts` (23, was 23), `server/test/terminal-client.test.ts` (4, was 3), `web/test/terminal-model.test.ts` (8, was 5; pure module).
- **Verification recorded:** Every criterion is ticked, including the gates at 390/320/820/1440. The phone widths were checked in the browser smoke (the `?mode=terminal` address shows the chat view). No other numbers are recorded.
- **Deviations:**
  - Caduceus holds the upstream itself for 10 minutes (not Hermes's 30-minute attach registry) so it can close the PTY on time.
  - No Playwright test; `terminalModeOffered` is unit-tested.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:** None recorded. Status: resolved.
