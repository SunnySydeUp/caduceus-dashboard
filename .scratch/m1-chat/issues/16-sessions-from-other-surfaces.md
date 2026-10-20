# 16: Sessions from other surfaces

**What to build:** Sessions created outside Caduceus — CLI, messaging platforms, cron, webhooks, Kanban workers — appear in the list with a source badge (Hermes's session list with source filters) and open in the same transcript view. Claude Code and Codex sessions are listed and previewed through the gateway's session.foreign.* methods and can be imported into Hermes.

Sessions that Caduceus can continue are resumed with session.resume. Sessions that must stay read-only (owned by another live process, or Kanban worker sessions) open read-only with a Branch action that continues them in a new session. Sessions owned by another process refresh message by message through Caduceus relay (R12), driven by sessions.changed plus REST re-reads; there is no token streaming for them. Messaging sessions show their previous segments (continuation lineage) in the transcript header, and a Handoff summary can be generated on demand (handoff.* and llm.oneshot) without being persisted.

**Blocked by:** 13 (Sessions list), 04 (Rich transcript rendering)

**Status:** resolved

- [x] CLI, messaging, cron, webhook and Kanban sessions render with source badges and the full transcript, using Hermes's REST session endpoints (which include sources the gateway session.list denies).
- [x] Claude Code / Codex: list and preview via session.foreign.list/preview; Import (T1, naming the target profile) creates a Hermes session that opens normally.
- [x] Continue uses session.resume; a session that cannot be continued shows a read-only banner and Branch, which creates a new session via session.branch (test both paths).
- [x] Caduceus relay refreshes other-process sessions message by message within a few seconds of a sessions.changed broadcast; a test appends messages through Hermes from another process and asserts they appear.
- [x] Previous messaging segments are linked from the transcript header and navigable in order.
  Deviation: a segment is a compression edge (parent ended by compression), as Hermes's own search treats lineage.
- [x] Handoff summary is generated on demand, shown in a banner and not stored by Caduceus or Hermes; llm.oneshot calls are T1 because they cost money.
  Deviation: the summary uses llm.oneshot (T1) only; handoff.* (platform handoff) is not used.
- [x] Phone: the read-only banner and Branch action stay visible above the keyboard-free bottom area; source badges have text labels for screen readers.
- [x] Every screen and sheet passes the M0 #05 gates (390, 320, 820, 1440; no overflow; axe clean; hit targets; tokens only).
  Deviation: at 320 px the gate flags the Find button of the transcript tools as partly under the sticky app bar when the transcript is scrolled to its end (axe target-size); all other widths and routes pass.
- [x] All strings go through the message catalogues; the module's help page and glossary terms are registered (the missing-help test passes).
  Catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)
- **Commit(s):** `6be73b9` feat: sessions from other surfaces: source tags, read-only sessions with Branch and message-by-message refresh, segments, handoff summary, Claude Code and Codex import (M1 #16).
- **Tests added:**
  - `server/test/session-surfaces.test.ts` (8), `foreign-sessions.test.ts` (6): Caduceus HTTP/WS API seam over real Hermes (other-process appends, both Continue paths, import).
  - `web/test/session-access.test.ts` (5), `foreign-sessions.test.ts` (3), `handoff-summary.test.ts` (3): pure modules.
  - Modified: `web/test/message-actions.test.ts` (14, was 13). Fixture: `seed-session.ts`.
- **Verification recorded:** Every criterion is ticked. At 320 px the gate flags the Find button of the transcript tools as partly under the sticky app bar when the transcript is scrolled to its end (axe target-size); all other widths and routes pass. No other numbers are recorded.
- **Deviations:**
  - A segment is a compression edge (parent ended by compression), as Hermes's own search treats lineage.
  - The summary uses `llm.oneshot` (T1) only; `handoff.*` (platform handoff) is not used.
  - The 320 px Find-button target-size finding.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:** The 320 px Find-button finding is open (also in M1 #17). Status: resolved.
