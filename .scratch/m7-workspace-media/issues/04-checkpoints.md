# 04: Checkpoints

**What to build:** Workspace › Checkpoints lists the agent checkpoints Hermes takes per workspace, with their count and storage, from Hermes's `ops/checkpoints` endpoint and the gateway's `rollback.list`. Selecting one shows its diff (`rollback.diff`) and offers Restore (`rollback.restore`, T3). Pruning old checkpoints is a global maintenance action in M5 #14; this screen links to it.

`rollback.diff` and `rollback.restore` need a live session on that workspace; Caduceus opens or resumes one for the workspace when needed and says so. Verify whether `rollback.diff` offers plain diff fields or only an ANSI rendering; render plain diffs with the shared diff view, otherwise render ANSI safely.

**Blocked by:** M0 #08 (Policy proxy, risk tiers, read-only mode and tiered confirmations), M3 #10 (Projects and spaces)

**Status:** resolved

- [x] Checkpoints list per workspace with time, triggering session/turn where available, and total count/size.
  Deviation: Hermes 0.21.4 gives no triggering session or turn, and leaves each checkpoint's message empty, so the list shows time and short hash. Size is the whole store (`ops/checkpoints`).
- [x] Diff view reuses the unified/split diff from the Git panel rules (unified on phone, split ≥1024 px); ANSI output, if that is all Hermes returns, is rendered without injecting markup (test).
  `rollback.diff` returns a plain unified `diff` (cut at 4000 characters) beside the ANSI `rendered`; the page uses the plain one, with escapes stripped. Browser smoke covered the empty/error state at 4 widths; the diff view is the one the Git panel passed.
- [x] Restore is T3 with typed confirmation stating what is overwritten and that it can be reversed only by another checkpoint; blocked in read-only and offline (proxy test).
  Needed a way to confirm a gateway T3: `POST /_caduceus/api/policy/confirmations` now accepts `rpc <method>`, and `GatewayConnection.requestConfirmed` carries the token in the frame. Proxy tests: `server/test/checkpoints-hermes.test.ts`.
- [x] The storage total links to System › Maintenance for pruning (M5 #14). No prune action is duplicated here.
  Deviation: System › Maintenance (M5 #14) does not exist yet, so the page names it in text without a link.
- [x] When no live session exists for the workspace, the UI explains it will attach one and does so through the gateway, not by touching files directly.
- [x] Empty state explains checkpoints and links to the agent settings that enable them.
  Hermes's gateway takes checkpoints only with HERMES_TUI_CHECKPOINTS=1 (its config key is for the CLI). Caduceus's launcher now sets it by default (`server/src/hermes-backend.ts`, tested); the help page and empty state say so. The link is to Config.
- [x] Every new screen and sheet passes the M0 #05 gates (phone 390, small phone 320, tablet 820, desktop 1440: no overflow, axe clean, hit targets, tokens only).
- [x] All strings go through the message catalogues; the module registers its help page and glossary terms (Checkpoint, Restore), and the missing-help test passes.
  Catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `f9be020` feat: Workspace Checkpoints: list, diff and T3 restore through an attached session; checkpoints on by default for the Hermes Caduceus runs (M7 #04)
- **Tests added:**
  - `server/test/checkpoints-hermes.test.ts` (added in `f9be020`): 3 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `server/test/hermes-backend.test.ts` (changed in `f9be020`): 12 `test(`/`it(` cases (whole file); seam: server pure module
  - `web/test/checkpoints-model.test.ts` (added in `f9be020`): 4 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. Per the ticket: `rollback.diff` returns a plain unified `diff` (cut at 4000 characters) beside the ANSI `rendered`, and the page uses the plain one with escapes stripped. Browser smoke covered the empty/error state at 4 widths; the diff view is the one the Git panel passed. Proxy tests are in `server/test/checkpoints-hermes.test.ts`. A real restore is not recorded as run. The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - Hermes 0.21.4 gives no triggering session or turn and leaves each checkpoint message empty, so the list shows time and short hash. Size is the whole store (`ops/checkpoints`).
  - System › Maintenance (M5 #14) did not exist when this ticket was done, so the page names it in text without a link.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - The ticket text says the storage total should link to System › Maintenance. M5 #14 now exists; the ticket does not record that the link was added (not verified).
  - `POST /_caduceus/api/policy/confirmations` now accepts `rpc <method>`, and `GatewayConnection.requestConfirmed` carries the token (ticket text).
  - Caduceus's launcher now sets HERMES_TUI_CHECKPOINTS=1 by default (`server/src/hermes-backend.ts`, tested).
