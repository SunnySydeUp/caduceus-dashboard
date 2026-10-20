# 18: Fast chat mode

**What to build:** A Fast mode toggle in the composer sends prompts straight to a model, without tools or agent loop, through the gateway's llm.oneshot method. The owner picks the model with the shared model picker. Replies stream or arrive whole depending on Hermes's support and render with the rich transcript renderer.

The fast-chat surface is clearly labelled "Not saved in Hermes history": the conversation lives only in the browser tab (Hermes is the source of truth and has no record of it). The owner can copy a reply or promote the conversation into a normal chat, which starts a real Hermes session seeded with the text.

**Blocked by:** 08 (Composer chips, config sheet and context ring)

**Status:** resolved

- [x] The Fast toggle is available in the composer and the phone config sheet, and is visibly distinct (label + colour token + icon) while active.
- [x] Prompts in fast mode call llm.oneshot through the policy proxy with the chosen model; no tools, approvals or session are created (test asserts no session.create).
  Deviation: Hermes v0.21.4's `llm.oneshot` takes no model (`LlmOneshotParams`: profile, template, instructions, input, variables, task, temperature, max_tokens, session_id). The model that answers is the model of the chat's own Hermes session when it has one (sent as `session_id`, which lends it; the shared picker's "Change model" is offered then), else the profile's model. A fast chat never creates a session to have one. Streaming is not available: the reply arrives whole.
- [x] Because each call spends money without an agent session, the first fast call of a tab is T1, naming model and profile; later calls in the same tab are not re-confirmed.
  The question is asked once per tab (a reload asks again); the text names the model and the dialog names the profile.
- [x] A persistent banner states the conversation is not saved in Hermes history; leaving or reloading warns that it will be lost.
- [x] Caduceus does not persist fast-chat content (test that the Caduceus store is unchanged).
- [x] "Continue as chat" creates a normal Hermes session with the conversation as context and opens it.
- [x] Errors (model unavailable, rate limit) render inline with Retry.
- [x] Every screen and sheet passes the M0 #05 gates (390, 320, 820, 1440; no overflow; axe clean; hit targets; tokens only).
- [x] All strings go through the message catalogues; the module's help page and glossary terms are registered (the missing-help test passes).
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)
- **Commit(s):** `68478e7` feat: fast chat mode: prompts straight to Hermes's one-shot model with no agent or session, held only in the tab with a leave warning, T1 once per tab, inline errors with Retry, Continue as chat (M1 #18).
- **Tests added:**
  - `server/test/fast-chat.test.ts` (11): Caduceus HTTP/WS API seam (real Hermes; no `session.create`, store unchanged, T1 once per tab, Retry, Continue as chat). Fixture: `stub-llm.ts`.
- **Verification recorded:** Every criterion is ticked, including the gates at 390/320/820/1440. The ticket records no widths or results: not recorded.
- **Deviations:**
  - Hermes v0.21.4's `llm.oneshot` takes no model (`LlmOneshotParams` has profile, template, instructions, input, variables, task, temperature, max_tokens, session_id). The answering model is that of the chat's own Hermes session when it has one (sent as `session_id`; the shared picker's "Change model" is offered), else the profile's model. A fast chat never creates a session to have one. Streaming is not available; the reply arrives whole.
  - The T1 question is asked once per tab (a reload asks again); the text names the model and the dialog names the profile.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:** None recorded. Status: resolved.
