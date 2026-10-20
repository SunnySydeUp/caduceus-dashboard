# 13: Mixture-of-Agents, fallback chain and usage cards

**What to build:** This ticket completes Agents › Models with three tabs.

- **Mixture-of-Agents:** view, edit and save Hermes's MoA presets (Hermes's MoA endpoint): reference models, aggregator, and which preset is the default.
- **Fallback chain:** an ordered list editor over the profile's `fallback_providers` config. It covers add from the catalogue or a custom provider, enable/disable, reorder, and base-URL override, plus the retry and restore-primary settings Hermes supports. This is PatterStage's fallback editor, written straight to Hermes's config, with no Caduceus copy.
- **Usage:** per-model cards from Hermes's model analytics for 7, 30 or 90 days. Each card shows requests, tokens, cost, context window and capabilities, and has "Use as…" to put the model in the main slot or any auxiliary slot.

All three use ticket 03's shared model picker.

**Blocked by:** 03 (Model picker, main model and auxiliary slots)

**Status:** resolved

- [x] MoA presets can be listed, edited, saved, deleted and set as default, and a reload shows Hermes's stored presets.
  Deviation: Delete turns the preset off. Hermes 0.21.4's `PUT /api/model/moa` merges what it is sent over the saved presets, so no REST or gateway call can remove one (a test pins this). The preset stays listed as Off, and the confirmation names `hermes moa delete <name>` for a real removal.
- [x] The fallback chain supports add, remove, enable/disable and reorder, with ↑/↓ buttons as the alternative to drag. Saving writes `fallback_providers` through Hermes config at the config-write tier (T3), and is blocked in read-only mode.
  Deviation: Hermes has no per-entry enabled flag, so a disabled entry moves to `fallback_providers_disabled`, a key Hermes keeps and never reads. The retry settings are the ones Hermes has (`agent.api_max_retries`, `agent.auto_recovery_cycles`, `fallback.min_switch_reset_seconds`); it has no restore-primary setting (it restores at every turn), and the screen says so.
- [x] Usage cards show Hermes's numbers for the selected period. Cost appears only where Hermes provides it and is marked as estimated where Hermes estimates it.
- [x] "Use as…" applies the model to the chosen slot after a T1 confirmation naming the slot and profile.
- [x] Phone: cards stack in one column, and the chain editor uses reorder buttons, not drag.
- [x] Every new screen passes the M0 #05 gates. All strings come from the catalogues (catalogue part deferred (owner)). Help and glossary cover Mixture-of-Agents, fallback chain and aggregator.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `9981457 feat: Agents › Models › Mixture of Agents, fallback chain and usage cards (M4 #13)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `9981457` `server/test/fixtures/seed-session.ts`: 0 cases; seam: fixture (test support, no cases).
  - `9981457` `server/test/models-hermes.test.ts`: 20 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `9981457` `web/test/models-model.test.ts`: 7 cases; seam: pure web module (model/render).
- **Verification recorded:** Criteria ticked; a test pins that Hermes's `PUT /api/model/moa` cannot remove a preset. Gate widths and results: not recorded.
- **Deviations:**
  - Delete turns the preset off. Hermes 0.21.4's `PUT /api/model/moa` merges what it is sent over the saved presets, so no REST or gateway call can remove one. The preset stays listed as Off, and the confirmation names `hermes moa delete <name>` for a real removal.
  - Hermes has no per-entry enabled flag, so a disabled fallback entry moves to `fallback_providers_disabled`, a key Hermes keeps and never reads. Retry settings are the ones Hermes has (`agent.api_max_retries`, `agent.auto_recovery_cycles`, `fallback.min_switch_reset_seconds`). Hermes has no restore-primary setting (it restores at every turn), and the screen says so.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
