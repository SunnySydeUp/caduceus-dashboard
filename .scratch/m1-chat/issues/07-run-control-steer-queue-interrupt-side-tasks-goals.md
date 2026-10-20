# 07: Run control: steer, queue, interrupt, side tasks, goals

**What to build:** While a turn is running, the send button becomes a split control: Steer (the gateway's session.steer, redirecting the running turn), Queue (run after the current turn) and Stop (session.interrupt). Queued messages appear as a list above the composer; each can be edited or cancelled, and a cancelled item returns its text to the composer.

`/btw` asks a side question without disturbing the main turn (prompt.btw). `/background` starts a background prompt (prompt.background); when it finishes, a completion badge appears and opens its result. `/goal` sets a goal for the session through session.control; the goal panel in the context panel's Run tab shows it with its status and lets the owner edit or clear it.

**Blocked by:** 03 (Chat tracer bullet: new chat, streamed reply, resume)

**Status:** resolved

- [x] While busy, the split control offers Steer, Queue and Stop, each calling the matching Hermes method (tests against a stub gateway).
- [x] Queued messages can be edited and cancelled; cancelling returns the text to the composer; the queue runs in order after the turn.
- [x] The queue survives a reload while the turn is still running.
- [x] `/btw` answers appear apart from the main thread and do not interrupt it.
- [x] `/background` shows a running indicator and a completion badge that opens the result.
- [x] `/goal` sets, edits and clears the goal; the goal panel updates live from session.control.
- [x] On a phone the split control fits 320 px and every option is reachable without hover.
- [x] Passes the M0 #05 gates; strings via catalogues; help page and glossary terms (steer, queue, side task, goal).
Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)
- **Commit(s):** `8d1b328` feat: run control with steer, queue, stop, side tasks and goals (M1 #07).
- **Tests added:**
  - `server/test/run-control.test.ts` (10): Caduceus WS seam over a real Hermes with the stub LLM (the file starts both).
  - `web/test/run-command.test.ts` (4): pure module.
  - Modified: `server/test/policy-map.test.ts` (14, was 13).
- **Verification recorded:** The ticket ticks every criterion, including 320 px and the M0 #05 gates; it records no widths, axe or perf numbers and the commit has no message body: not recorded.
- **Deviations:**
  - Catalogue part deferred (owner).
  - The criterion says "tests against a stub gateway" and the ticket has no Deviation line for it; the test file runs the real Hermes with the stub LLM (as the project rule asks).
- **Follow-ups / open items:** None recorded in the ticket. Status: resolved.
