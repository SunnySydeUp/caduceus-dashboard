# 03: Git panel

**What to build:** Workspace › Git shows the state of the repository behind the selected Hermes project or workspace: status (staged, unstaged, untracked), diffs, branches and worktrees, all through Hermes's `/api/git/*` routes. The owner can stage and unstage files, write a commit message or have one generated (Hermes's `review/commit-context` plus the gateway's `llm.oneshot`), commit, fetch, pull and push, switch and create branches, and list, add and remove worktrees.

Diffs are unified on phones and split at 1024 px and wider. Discard and push are destructive or outward-facing and are T3.

**Blocked by:** M0 #08 (Policy proxy, risk tiers, read-only mode and tiered confirmations), M3 #10 (Projects and spaces)

**Status:** resolved

- [x] The workspace picker lists Hermes projects/workspaces from M3 #10; a non-git folder shows an empty state explaining why, with a link to Files.
  The picker lists the owner's workspaces (M3 #10 registry) and the repositories of Hermes's projects.
- [x] Status refreshes after every operation and on focus; per-file diffs render unified below 1024 px and split at 1024 px and wider (Playwright at 390 and 1440).
  Deviation: checked in a real browser at 390 and 1440 (no new Playwright tests, per AGENTS.md). The split diff starts at 1024 px.
- [x] Stage/unstage are T0; discard and push are T3 with typed confirmation stating that discard cannot be undone; commit, fetch and pull are T1 (proxy tests).
  Deviation: Hermes has no fetch or pull route, so Caduceus offers neither (a rejected push says to pull in a terminal). A commit that also pushes is lifted to T3, as a push is. Proxy tests: `server/test/git-hermes.test.ts`.
- [x] AI commit message fills the message field from `commit-context` + `llm.oneshot` and is never committed without the owner pressing Commit.
- [x] Branches: list, switch, create; worktrees: list, add, remove (remove refuses a dirty worktree unless confirmed).
  Deviation: Hermes has no plain create-branch route; a new branch is made with Add worktree (new branch + folder), the one create path Hermes offers.
- [x] Git errors (conflicts, auth failures, rejected push) show Hermes's message and a next step, not a raw stack.
- [x] No git state is copied into the Caduceus store (Hermes as source).
- [x] Every new screen and sheet passes the M0 #05 gates (phone 390, small phone 320, tablet 820, desktop 1440: no overflow, axe clean, hit targets, tokens only).
- [x] All strings go through the message catalogues; the module registers its help page and glossary terms (Stage, Worktree, Discard), and the missing-help test passes.
  Catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `aabdee9` feat: Workspace Git: status, diffs, stage, commit with AI message, push, discard, branches and worktrees (M7 #03)
- **Tests added:**
  - `server/test/git-hermes.test.ts` (added in `aabdee9`): 8 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `server/test/git-message-hermes.test.ts` (added in `aabdee9`): 1 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `web/test/git-model.test.ts` (added in `aabdee9`): 10 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. The ticket says the page was checked in a real browser at 390 and 1440 (no new Playwright tests, per AGENTS.md); the split diff starts at 1024 px. Proxy tests are in `server/test/git-hermes.test.ts`. 320 and 820 are not recorded as checked.
- **Deviations:**
  - Checked in a real browser at 390 and 1440, with no new Playwright tests (per AGENTS.md).
  - Hermes has no fetch or pull route, so Caduceus offers neither. A rejected push says to pull in a terminal. A commit that also pushes is lifted to T3, as a push is.
  - Hermes has no plain create-branch route. A new branch is made with Add worktree (new branch + folder), the one create path Hermes offers.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - Fetch and pull are not offered until Hermes has routes for them.
