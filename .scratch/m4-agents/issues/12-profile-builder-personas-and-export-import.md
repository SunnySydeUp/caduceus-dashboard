# 12: Profile builder, personas and export/import

**What to build:** `/agents/profiles/new` is a 5-step builder: Identity (name, colour, display name, SOUL), Model (shared picker), Skills (installed/hub selection), MCPs (servers from the catalogue or existing ones), Review. It can start blank, from a seeded persona (a static catalogue shipped with the app, aligned with Hermes's personalities) or as a clone of an existing profile. Finishing creates the profile with Hermes's create-profile endpoint and then applies SOUL, model, skills and MCPs through the same Hermes calls the other tickets use.

Danger zone gains Export (Hermes's profile export) and Import (Hermes's profile import) of a profile archive.

**Blocked by:** 01 (Profiles list and overview), 03 (Model picker, main model and auxiliary slots), 04 (Installed skills and editor), 07 (MCP servers and catalogue)

**Status:** resolved

- [x] Builder steps are resumable within the tab, validate each step, and Back preserves entries; progress is shown as step n of 5.
- [x] Persona catalogue is static app content (no Caduceus storage); choosing a persona pre-fills identity and SOUL; restoring a persona re-creates it via Hermes.
  Deviation: the Identity step's colour is the avatar colour drawn from the name (Hermes has no colour field and D1 forbids a Caduceus copy). The MCP step copies only servers with no keys/variables and installs only catalogue entries that need no value (Hermes keeps secrets masked; those are added on Tools & MCP).
- [x] Clone pre-fills from the source profile and creates a new profile; the source is unchanged (test).
- [x] Finish creates the profile and applies each step; a partial failure lists what succeeded and offers Retry for the rest, never leaving a silent half-built profile.
- [x] Export is T3 and downloads Hermes's archive; Import is T3, blocked in read-only mode, previews name and conflicts before applying.
- [x] Phone: each step is a full-screen sheet with sticky Next/Back above the keyboard.
- [x] Every new screen passes the M0 #05 gates (390, 320, 820, 1440; no overflow; axe clean; hit targets; tokens only). All strings come from the catalogues, and the module registers its help page and glossary terms (profile builder, persona, clone, profile export).
  Deviation: catalogue part deferred (owner); help pages `profile-builder`, `profile-export` and glossary terms persona, profile-clone, profile-builder, profile-export are written.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `e5ffa84 feat: profile builder with personas and clone, export and import of profiles with archive preview (M4 #12)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `e5ffa84` `server/test/profile-builder-hermes.test.ts`: 13 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `e5ffa84` `server/test/profile-transfer-hermes.test.ts`: 6 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `e5ffa84` `web/test/profile-archive.test.ts`: 10 cases; seam: pure web module (model/render).
  - `e5ffa84` `web/test/profile-builder.test.ts`: 24 cases; seam: pure web module (model/render).
- **Verification recorded:** The criterion "passes the M0 #05 gates" (390, 320, 820, 1440; overflow, axe, hit targets, tokens) is ticked; widths and results not recorded. Clone leaves the source unchanged (test).
- **Deviations:**
  - The Identity step's colour is the avatar colour drawn from the name (Hermes has no colour field and D1 forbids a Caduceus copy).
  - The MCP step copies only servers with no keys or variables and installs only catalogue entries that need no value (Hermes keeps secrets masked). Others are added on Tools & MCP.
  - Help pages `profile-builder` and `profile-export` and glossary terms persona, profile-clone, profile-builder, profile-export are written.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
