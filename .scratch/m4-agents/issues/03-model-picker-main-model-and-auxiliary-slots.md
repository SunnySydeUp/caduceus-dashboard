# 03: Model picker, main model and auxiliary slots

**What to build:** Agents › Models lets the owner choose models for the scoped profile.

**Shared model picker.** Other screens reuse it: the composer, the brief editor and the profile builder. It lists Hermes's live model catalogue (Hermes's model options endpoint or the gateway's `model.options` method), with:
- search;
- grouping by provider;
- capability badges;
- a Refresh action;
- confirmation before switching to an expensive model.

**Main tab.** Sets the profile's main model (Hermes's model set endpoint), the reasoning default and the max output tokens (config). It shows Hermes's recommended default when nothing is set.

**Auxiliary slots tab.** Lists every slot Hermes reports (Hermes's auxiliary model endpoint), with a model choice per slot and "reset all to auto".

Mixture-of-Agents, the fallback chain and usage cards come in ticket 13. Local models come in ticket 14.

**Blocked by:** M0 #08 (Policy proxy, risk tiers, read-only mode and tiered confirmations), M1 #02 (Contextual help framework)

**Status:** resolved

- [x] The picker is a reusable component driven by Hermes's catalogue. Refresh re-fetches live options, and a stale or unreachable provider is labelled, not hidden.
- [x] Main model, reasoning default and max output tokens save per profile through Hermes, and the page header shows the scoped profile. A reload shows Hermes's values, with no Caduceus copy.
  Deviation: max output tokens are not saved. Hermes 0.21.4 removed its output-cap setting (it no longer reads `model.max_tokens`), so a saved value would do nothing; the screen says so and shows the model's own maximum for information.
- [x] Every auxiliary slot Hermes reports is listed, none hard-coded. Setting one updates only that slot, and "reset all to auto" clears every override (tests).
- [x] Config writes (max tokens, reasoning default) use the tier the proxy assigns to config writes (T3) and are blocked in read-only mode. Model set uses its mapped tier.
- [x] Phone: a search-first picker in a full-screen sheet, and tabs as a segmented header.
- [x] Every new screen passes the M0 #05 gates (390, 320, 820, 1440; no overflow; axe clean; hit targets; tokens only). All strings come from the catalogues (catalogue part deferred (owner)). The module registers its help page and glossary terms (main model, auxiliary slot).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `d78c53d feat: model picker, main model and auxiliary slots (M4 #03)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `d78c53d` `server/test/models-hermes.test.ts`: 12 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `d78c53d` `web/test/models-model.test.ts`: 5 cases; seam: pure web module (model/render).
- **Verification recorded:** The criterion "passes the M0 #05 gates" (390, 320, 820, 1440; overflow, axe, hit targets, tokens) is ticked; widths and results not recorded.
- **Deviations:**
  - Max output tokens are not saved. Hermes 0.21.4 removed its output-cap setting (it no longer reads `model.max_tokens`). The screen says so and shows the model's own maximum for information.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
