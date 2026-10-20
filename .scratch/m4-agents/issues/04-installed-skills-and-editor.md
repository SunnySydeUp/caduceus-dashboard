# 04: Installed skills and editor

**What to build:** Agents › Skills › Installed lists the scoped profile's skills from Hermes's skills endpoint with search, category filter, enabled state and usage count. Toggling a skill uses Hermes's skill toggle endpoint.

Skill detail renders SKILL.md and lists its linked files (Hermes's skill content endpoint). The owner can create a skill (Hermes's create-skill endpoint) and edit SKILL.md, keeping its frontmatter intact, and can uninstall hub skills (Hermes's hub uninstall) or delete local ones (Hermes's learning node delete).

**Blocked by:** M0 #08 (Policy proxy, risk tiers, read-only mode and tiered confirmations), M1 #02 (Contextual help framework)

**Status:** resolved

- [x] The list reflects Hermes's skills for the scoped profile with search and categories kept in the URL; empty state offers Create skill and Browse hub.
  Deviation: Browse hub is shown only once the hub route `/agents/skills/hub` exists (M4 #05 adds it); until then the empty state offers Create skill alone. Every real profile also has Hermes's bundled skills, so the no-skills empty state was checked in code only; the no-match state was checked in the browser.
- [x] Toggle is T0 with an undo toast and reflects Hermes's state after the call.
- [x] Detail renders SKILL.md Markdown and opens linked files read-only.
- [x] Create and edit round-trip SKILL.md without losing or reordering frontmatter (test with a fixture containing unknown frontmatter keys); invalid frontmatter blocks save with the reason.
- [x] Uninstall is T1 naming skill and profile; delete of a local skill uses its proxy tier and is blocked in read-only mode.
- [x] Usage shows Hermes's usage count only, labelled as such (no invented views/patches metrics).
- [x] Phone: searchable list → detail sheet; editor full-screen with Preview/Edit; ⋮ menu offers toggle, edit, uninstall/delete.
- [x] Every new screen passes the M0 #05 gates (390, 320, 820, 1440; no overflow; axe clean; hit targets; tokens only). All strings come from the catalogues, and the module registers its help page and glossary terms (skill, SKILL.md, frontmatter, toolset vs skill).
  Deviation: catalogue part deferred (owner). A skill named `new` cannot be edited by address (`/agents/skills/new` is the create screen).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `8e5f8f3 feat: installed skills list, detail and SKILL.md editor (M4 #04)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `8e5f8f3` `server/test/skills-hermes.test.ts`: 14 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `8e5f8f3` `web/test/skill-document.test.ts`: 13 cases; seam: pure web module (model/render).
  - `8e5f8f3` `web/test/skills-model.test.ts`: 6 cases; seam: pure web module (model/render).
- **Verification recorded:** The no-match state was checked in the browser; the no-skills empty state was checked in code only (every real profile has Hermes's bundled skills). Frontmatter round-trip is tested with a fixture holding unknown keys. The criterion "passes the M0 #05 gates" (390, 320, 820, 1440; overflow, axe, hit targets, tokens) is ticked; widths and results not recorded.
- **Deviations:**
  - Browse hub shows only once `/agents/skills/hub` exists (M4 #05). Until then the empty state offers Create skill alone.
  - A skill named `new` cannot be edited by address, because `/agents/skills/new` is the create screen.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - Browse hub was added by M4 #05 (resolved).
