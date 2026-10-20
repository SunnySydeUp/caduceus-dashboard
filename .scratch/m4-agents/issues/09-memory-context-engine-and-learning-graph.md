# 09: Memory, context engine and learning graph

**What to build:** Agents › Memory brings the profile's memory settings together. Provider lists Hermes's memory providers and their dynamic config forms (Hermes's memory provider endpoints), including provider OAuth start/status. Context engine selects the engine through Hermes's plugin-providers endpoint. Built-in memory shows MEMORY/USER sizes and reset and links to the editors from ticket 02.

Learning graph renders Hermes's learning graph with node detail and chunk editing/deletion (Hermes's learning node endpoints). Context shows project context (the gateway's project.facts) and Wiki shows LLM Wiki pages read via Hermes's fs read-text.

**Blocked by:** 02 (Profile file editors)

**Status:** resolved

- [x] Provider forms are generated from Hermes's provider schema (no hard-coded fields); secrets are masked; saving uses its proxy tier.
- [x] Provider OAuth start/status completes and shows connected state; failure shows Hermes's reason.
  Deviation: Hermes's start answer carries no sign-in address (it opens the provider's page in the browser of the computer it runs on and waits there), so the page says so and shows Connected or Hermes's reason; there is no link or paste-back for a phone.
- [x] Context engine selection saves through Hermes and reflects Hermes's value on reload.
- [x] Built-in memory overview shows sizes against limits; reset is T3 and reuses ticket 02's confirmation.
- [x] Learning graph renders with keyboard-navigable list alternative; node edits/deletes use their proxy tiers and are blocked in read-only mode.
  Addition: an edit or delete of a memory chunk is also snapshotted by the server first (R1), so History can put the old MEMORY.md / USER.md text back.
- [x] Project context and LLM Wiki display read-only content from Hermes; empty states explain how to populate them.
- [x] Phone: tabs as segmented header; graph replaced by the list alternative under 600 px; forms full-screen.
  Deviation: the tabs are the scrolling pill tabs every Agents screen uses (not a segmented control).
- [x] Every new screen passes the M0 #05 gates (390, 320, 820, 1440; no overflow; axe clean; hit targets; tokens only). All strings come from the catalogues, and the module registers its help page and glossary terms (memory provider, context engine, learning graph, LLM Wiki).
  Catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `5dda23b feat: Agents › Memory: provider forms and sign-in, context engine, built-in memory, learning graph, project context and LLM Wiki (M4 #09)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `5dda23b` `server/test/fixtures/honcho-oauth-server.ts`: 0 cases; seam: fixture (test support, no cases).
  - `5dda23b` `server/test/memory-hermes.test.ts`: 14 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `5dda23b` `web/test/memory-model.test.ts`: 6 cases; seam: pure web module (model/render).
- **Verification recorded:** The criterion "passes the M0 #05 gates" (390, 320, 820, 1440; overflow, axe, hit targets, tokens) is ticked; widths and results not recorded. Fixture `honcho-oauth-server.ts` stands in for the provider sign-in.
- **Deviations:**
  - Hermes's OAuth start answer carries no sign-in address (it opens the provider page in a browser on the computer Hermes runs on). The page says so and shows Connected or Hermes's reason. There is no link or paste-back for a phone.
  - The tabs are the scrolling pill tabs every Agents screen uses, not a segmented control.
  - Addition: an edit or delete of a memory chunk is snapshotted by the server first (R1), so History can restore the old MEMORY.md / USER.md text.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
