# 01: Playbook definitions and library

**What to build:** M3 #08 already provides the templates library, its categories and its storage: Caduceus-owned YAML files in the one-stage playbook format from work-model §2.3. This ticket **extends** that library and that storage. It does not re-implement templates and does not migrate them. Work › Playbooks becomes the same library, now holding multi-stage Playbooks next to the existing one-stage Templates, as cards with category and search.

This ticket adds the following to the existing format and store:
- multi-stage definitions;
- versioning;
- validation against a published schema;
- a stage list and stage inspector;
- a YAML view;
- the seeds.

A full definition contains:
- an inputs schema;
- stages, each with key, title, a brief template with `{{inputs}}`, assignee profile, skills, model, goal mode, completion contract, gate type and `max_attempts`;
- edges with conditions `on_done`, `on_fail`, `on_approve`, `on_reject` and `always`.

A playbook's detail page shows its inputs and the stage list. Selecting a stage opens an inspector. A YAML view lets the owner edit the definition; saving validates it and writes a new version. Earlier versions stay readable, so runs tagged with an older version keep working. Seeds ship read-only and can be duplicated:
- Software Delivery (16 stages, ported from PatterStage);
- Research → summarise;
- Draft → review.

Bug hunt and Code review already ship as one-stage templates in M3 #08, and Deep Research is seeded by 05.

Running a playbook comes in 02.

**Blocked by:** M3 #08 (Task templates and categories)

**Status:** resolved

- [x] The YAML schema covers every field above; invalid definitions are rejected with line-level errors (unknown stage in an edge, unreachable stage, missing `max_attempts` on a loop, unknown profile/skill reported as a warning). Schema tests include every seed.
- [x] Saving writes a new immutable version (`<id>@<version>`); older versions stay loadable; editing is T1 and deleting a playbook is T1 with an undo toast. Seeds cannot be edited, only duplicated.
  Deviation: the three seeds are kept in code (read-only, version 1) and listed beside the owner's files, not written as files; the library API is now `/_caduceus/api/work/playbooks` (the `/work/templates` routes were replaced, one store and one code path).
- [x] This ticket builds on M3 #08's library, categories and YAML storage. Existing templates keep loading unchanged as one-stage playbooks, and the ticket adds no second store, template code path or migration step (test: a template saved by M3 #08 opens, validates and versions here).
- [x] The three seeds load, validate and show their stage lists; Software Delivery has 16 stages.
  Deviation: Software Delivery is written fresh as a 16-stage pipeline (the PatterStage source is not in this repo).
- [x] Detail shows inputs, stages in order and a stage inspector (brief template, assignee, model, skills, goal mode, contract, gate, attempts, outgoing edges).
- [x] Phone: card library and a vertical stage list; the YAML editor is read-only on phones with an "edit on a larger screen" handoff.
- [x] No Hermes data is copied; profiles and skills referenced by a definition are only validated live against Hermes.
- [x] Passes the M0 #05 gates; strings via catalogues; Playbooks help page and glossary terms (Playbook, Template, Stage, Gate); library and playbooks are searchable in the palette.
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `1fb3be9` feat: playbook definitions and library: multi-stage definitions with edges and gates, validation with line-level errors, immutable versions, three read-only seeds, stage inspector and YAML view, palette search, run form, run page and Board/Tasks playbook filter (M6 #01)
- **Tests added:**
  - `server/test/kanban-task-filters.test.ts` (changed in `1fb3be9`): 4 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `server/test/playbook-definition.test.ts` (added in `1fb3be9`): 9 `test(`/`it(` cases (whole file); seam: server pure module
  - `server/test/playbooks.test.ts` (changed in `1fb3be9`): 13 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `web/test/board-operations.test.ts` (changed in `1fb3be9`): 9 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/playbook-model.test.ts` (added in `1fb3be9`): 17 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/playbook-runs-model.test.ts` (added in `1fb3be9`): 10 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/task-playbook.test.ts` (added in `1fb3be9`): 10 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/tasks-model.test.ts` (changed in `1fb3be9`): 11 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/template-model.test.ts` (changed in `1fb3be9`): 14 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/work-module.test.ts` (changed in `1fb3be9`): 5 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. Per the ticket: schema tests include every seed; a test checks that a template saved by M3 #08 opens, validates and versions here. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded). The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - The three seeds are kept in code (read-only, version 1) and listed beside the owner's files, not written as files. The library API is now `/_caduceus/api/work/playbooks`; the `/work/templates` routes were replaced (one store, one code path).
  - Software Delivery is written fresh as a 16-stage pipeline, because the PatterStage source is not in this repo.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - Running a playbook is ticket 02 (ticket text).
