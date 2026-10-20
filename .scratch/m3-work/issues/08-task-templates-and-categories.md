# 08: Task templates and categories

**What to build:** Templates let the owner start a task from a prepared brief. A template is a Caduceus-owned one-stage playbook definition (work-model §2.3) holding the brief sections with `{{inputs}}` placeholders, default structured fields and a category; definitions live with Caduceus's playbook files, not in Hermes. Categories group templates (they never use Kanban's `tenant`).

Caduceus ships twelve seeded templates across categories (ported from PatterStage's mission templates). New task shows category pills and template cards; choosing one asks for its inputs and opens the prefilled Brief editor. From any task the owner can Save as template; templates can be edited, duplicated and deleted, and categories created, renamed and reordered. The definition format is the one M6 #01 extends to multi-stage playbooks.

**Blocked by:** 07 (Brief editor and dispatch modes)

**Status:** resolved

- [x] Twelve seeded templates exist on first run in their categories and validate against the one-stage playbook schema (test).
- [x] Start from template: inputs form → prefilled Brief editor with placeholders substituted; nothing reaches Hermes until a dispatch mode is chosen.
- [x] Save as template captures the task's sections and fields (excluding run state) as a new definition.
- [x] Edit, duplicate, delete templates (delete is T0 with undo); create, rename and reorder categories with ↑/↓ alternatives to drag.
- [x] Templates and categories are stored only in the Caduceus store / playbook files; no Hermes field is repurposed (test asserts `tenant` untouched).
  Deviation: the twelve seeded briefs are written fresh from the PatterStage template names (its source is not in this repo); the eight categories are General, Engineering, Operations, Data, Research, Content, Support and Maintenance.
- [x] Template pills and cards work at 320 px without overflow.
- [x] Every screen passes the M0 #05 gates (390, 320, 820, 1440); all strings come from the catalogues; the module registers its help page and glossary terms (Template, category).
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `5914f88 feat: task templates and categories: twelve seeded one-stage playbooks, start from template, save as template, library and category management (M3 #08)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `5914f88` `server/test/owner-auth.test.ts`: 12 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `5914f88` `server/test/templates.test.ts`: 8 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `5914f88` `web/test/template-model.test.ts`: 11 cases; seam: pure web module (model/render).
  - `5914f88` `web/test/work-module.test.ts`: 4 cases; seam: pure web module (model/render).
- **Verification recorded:** Criteria ticked: twelve seeded templates validate against the one-stage playbook schema (test); a test asserts `tenant` is untouched. Gate widths and results (including 320 px pills and cards): not recorded.
- **Deviations:**
  - The twelve seeded briefs are written fresh from the PatterStage template names (its source is not in this repo). The eight categories are General, Engineering, Operations, Data, Research, Content, Support and Maintenance.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
