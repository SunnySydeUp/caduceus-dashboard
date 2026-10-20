# 08: Composer chips, config sheet and context ring

**What to build:** Under the composer, chips show and change the chat's settings: profile, model (a picker over the gateway's model.options with search and providers), reasoning effort, workspace (session.cwd.set, defaulting to Hermes's default cwd) and toolsets (toolsets.list / tools.configure; shown read-only if toolsets turn out to be per profile rather than per session). On a phone, the chips collapse into one config sheet opened from the composer.

The context ring shows how full the context is, with cost and cache hit rate from session.usage; opening it shows the breakdown from session.context_breakdown and a Compress action (session.compress). When the chosen model's provider has no credential (Hermes's env endpoint), a banner offers Add key and Switch model. The owner can reorder and hide chips; the order is a Caduceus preference.

**Blocked by:** 03 (Chat tracer bullet: new chat, streamed reply, resume)

**Status:** resolved

- [x] Changing model, reasoning, workspace and toolsets sends the matching Hermes call through the policy proxy and the next turn uses it (tests against a stub gateway).
Deviation: tests run the real Hermes with the stub LLM (project rule), not a stub gateway. Toolsets are per profile, not per session: the list is Hermes's REST `/api/tools/toolsets?profile=` (the gateway's `toolsets.list` takes no profile and calls every toolset on for a session with no explicit list), changes go through `tools.configure`, and the sheet says a change applies to the whole profile.
- [x] The model picker lists Hermes's options with search and keyboard navigation.
Deviation: reuses the M4 `ModelPicker` (REST `model/options`), which gained ArrowUp/ArrowDown between the search box and the models.
- [x] Changing the profile chip on an existing chat starts a new chat in that profile rather than moving the session.
- [x] The context ring updates after each turn; Compress asks for T1 confirmation, then shows the reduced usage.
Deviation: `session.compress` moved from T0 to T1 in the policy map so the server audits it; after a Compress the ring shows Hermes's estimate of the smaller request (it reports no context fields until the next reply).
- [x] The credential warning appears when the provider has no key and its actions work; key values are never sent to the browser.
Deviation: the warning is judged from Hermes's `GET /api/env` (the `session.info` `credential_warning` is not emitted for these sessions); a provider with no key variable (custom endpoint) is not judged. Caduceus now strips Hermes's redacted previews from `GET /api/env`. Add key saves via `PUT /api/env` (T2 passkey, not exercised in the browser).
- [x] Chip order and visibility persist across devices as a Caduceus preference.
- [x] On a phone all settings are in one config sheet with detents that stays above the keyboard.
- [x] Passes the M0 #05 gates; strings via catalogues; help page and glossary terms (composer chips, context ring, config sheet).
Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)
- **Commit(s):** `b2b76be` feat: composer chips, config sheet and context ring (M1 #08).
- **Tests added:**
  - `server/test/chat-composer.test.ts` (7), `chat-credentials.test.ts` (1), `chat-preferences.test.ts` (4): Caduceus HTTP/WS API seam, real Hermes with the stub LLM (per the Deviation line).
  - `web/test/composer-model.test.ts` (14): pure module.
  - Modified: `server/test/gateway-policy.test.ts` (15, was 14). Fixture: `stub-llm.ts`.
- **Verification recorded:** Every criterion is ticked, including the M0 #05 gates and the phone config sheet. The ticket gives no widths or axe results. A throwaway server script is committed at `.scratch/m1-chat/m1-08-smoke/serve.ts` (no screenshots or results recorded). Saving a key through `PUT /api/env` (T2 passkey) was not exercised in the browser.
- **Deviations:**
  - Tests run the real Hermes with the stub LLM, not a stub gateway.
  - Toolsets are per profile, not per session: the list is REST `/api/tools/toolsets?profile=`, changes use `tools.configure`, and the sheet says a change applies to the whole profile.
  - The model picker reuses the M4 `ModelPicker` (REST `model/options`), which gained ArrowUp/ArrowDown.
  - `session.compress` moved from T0 to T1 in the policy map so the server audits it; after a Compress the ring shows Hermes's estimate of the smaller request.
  - The credential warning is judged from `GET /api/env` (`session.info` `credential_warning` is not emitted for these sessions); a provider with no key variable (custom endpoint) is not judged. Caduceus now strips Hermes's redacted previews from `GET /api/env`.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:** None recorded beyond the unverified key save above. Status: resolved.
