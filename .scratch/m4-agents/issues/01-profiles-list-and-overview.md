# 01: Profiles list and overview

**What to build:** Agents › Profiles shows one card per Hermes profile from Hermes's profile list, each with its avatar colour, description, model and live gateway status (from Hermes's status endpoint). Opening a card goes to the profile detail with its tabs (Overview, Identity, Instructions, Memory, Skills, Tools & MCP, Model, Gateway & channels, Files, Danger zone); tabs owned by later tickets appear as they land.

Overview shows counts (sessions, skills, MCP servers), runs, success rate and tokens for the profile, built from Hermes's usage analytics filtered by profile and the Kanban stats/assignees data. It offers "Use in this tab" (sets this tab's profile scope only), Make default (writes Hermes's active profile, the only sticky write), Copy CLI command, and an editable description with Auto-describe (Hermes's profile describe-auto endpoint). Identity holds the assistant display name, a Caduceus-owned preference. Danger zone offers rename and delete.

**Blocked by:** M0 #08 (Policy proxy, risk tiers, read-only mode and tiered confirmations), M1 #02 (Contextual help framework)

**Status:** resolved

- [x] Cards list every Hermes profile with gateway status that updates live; empty and error states carry their primary action (e.g. Create profile, Retry).
- [x] Overview metrics come from Hermes (usage analytics by profile, Kanban stats/assignees) and are never stored by Caduceus; a profile with no runs shows zeros, not an error.
- [x] Use in this tab changes only the tab's `?profile=` scope; Make default is T2 and is the only action that writes Hermes's active profile (test asserts no other path writes it).
- [x] Rename is T0 with undo; delete is T3 (typed profile name, states it cannot be undone) and is blocked in read-only mode; deleting the default or last profile is refused with a reason.
- [x] Auto-describe is T1, shows the proposed description for accept/edit before saving; manual description edits save through Hermes.
- [x] Copy CLI command copies the exact `hermes -p <name>` style command and confirms with a toast.
- [x] Assistant display name is stored in the Caduceus store as a per-profile preference and appears in chat headers; it never writes Hermes files.
- [x] Phone: card list → full-screen detail with tabs as a scrollable segmented header; Make default, rename and delete are also reachable from the card's ⋮ menu (long-press alternative).
- [x] Every new screen passes the M0 #05 gates (390, 320, 820, 1440; no overflow; axe clean; hit targets; tokens only). All strings come from the catalogues (catalogue part deferred (owner)), and the module registers its help page and glossary terms (profile, default profile, profile scope, gateway status).

## Comments

**2026-10-12, M4 #01 (lane `agents`).** All criteria ticked. Evidence:

- **Tests (TDD, red then green, one slice at a time).**
  - `server/test/profile-preferences.test.ts` (Caduceus HTTP seam, real Hermes behind it): the assistant name per profile (`GET/PUT/DELETE /_caduceus/api/preferences/profiles/:profile`), kept in the Caduceus store across a restart, blank clears it, over-long or non-text refused, owner only, and Hermes's profile list and every file of the profile unchanged by a save; plus the page's client moving the name on a rename and clearing it on a delete.
  - `server/test/profiles-hermes.test.ts` (Caduceus HTTP seam, real `hermes serve` in a temp HERMES_HOME with four profiles, the page's own `profiles-model.ts` run over what Hermes answers): cards and per-profile gateway status; Overview zeros for a profile with no runs and real Kanban counts (2 done + 1 blocked, 1 queued) for another; Make default T2 (refused without a step-up with `active_profile` untouched, then written; every other action of the screen run first leaves it alone); rename T0 with the undo by renaming back, the root profile taking a display name; delete T3 (confirmation-required without the typed token, then deleted), refused by read-only mode, root refused by Hermes; manual description save; Auto-describe through a stub model, with and without `overwrite`.
  - `web/test/profiles-model.test.ts` (pure): card parsing, `deleteRefusal` (root, default, only profile), `cliCommand`, `overviewMetrics`, `gatewayView`, `renameProblem`, tab order. `web/test/profiles-active-write.test.ts`: the policy map has one writer of `/api/profiles/active` (T2) and the web app has one caller of it (`make-default.ts`). `shortcuts.test.ts` gained `g p`.
  - Mutation checks: the model's `STARTED` statuses and the sticky-default test changed made 6 tests fail (reverted); removing the preference clean-up on rename made its test fail (reverted). Tests that pass at once because the proxy already existed (rename, delete, describe) assert real Hermes behaviour, not code written here.
- **Checks.** `npm test` 583 passed, 1 skipped; both typechecks clean; `npm run lint:ui` clean; `E2E_PORT=4402 npm run test:e2e` 6 passed. Temp dirs: my three test files leave no new `caduceus-*` / `fake-hermes-*` directory; the smoke server's were removed (two leaked homes from crashed throwaway probes were deleted by hand).
- **Browser smoke** (`.scratch/m4-agents/m4-01-smoke/`, `serve.ts` is the throwaway server; real Hermes in a temp home with `default`, `coder`, `writer`, `scratch` and a 64-character name). The M0 #05 gates (`ui-gates.mjs`: overflow, console errors, axe serious/critical, 44 px / 24 px targets) at 390, 320, 820 and 1440 passed on `/agents/profiles`, `/agents/profiles/writer`, `/agents/profiles/writer/identity`, `/agents/profiles/coder/danger`, and with the help panel open on the list, the overview and the danger zone. Two failures were found and fixed on the way (card name link below 24 px at 820; a glossary term in a heading below the touch target). Screenshots are in that folder. Driven by hand in the browser: the ⋮ menu and rename with undo, Copy CLI command (clipboard holds `hermes -p writer`), manual description edit, Auto-describe (T1 dialog, proposal sheet, Put the old text back), Make default (T2 dialog, cancelled), delete (T3 dialog: typed name, "cannot be undone", cancelled), the root profile's delete button disabled with its reason, Use in this tab (URL gains `?profile=`, Hermes's active profile unchanged), New profile sheet validation, assistant name saved and shown in the chat header (`with Wren`). The passkey step-up itself was not driven in the browser (needs a WebAuthn authenticator); it is covered over HTTP with the software authenticator.
- **Needs `npm run caduceus -- restart`** to reach the live service (new routes, a store migration and the new module).

**Deviations and decisions.**
- *Module id.* The module is `profiles` (folder `web/src/modules/profiles/`, nav entry Profiles in the Agents group), not `agents`: the registry gives each Agents screen (Skills, Memory, Models, Tools & MCP) its own module, as `module-registry.test.ts` models it. Its three routes are `/agents/profiles`, `/agents/profiles/:name` and `/agents/profiles/:name/:tab`.
- *Auto-describe saves first.* Hermes's `describe-auto` writes the description as it generates it; there is no way to ask for one without saving. The page confirms (T1, and says it will replace a description the owner wrote, sending `overwrite` only then), then shows the saved text in a sheet where the owner keeps it, edits it (saved as the owner's own text through `PUT …/description`) or puts the old text back (`PUT …/description` with the old text; a previously auto-written description loses its "auto" flag, since Hermes has no route to set that).
- *"Delete the default or last profile is refused".* Refused before asking, with a reason: the root profile `default` (Hermes refuses it too, HTTP 400), the profile that is Hermes's sticky default (make another default first) and the only profile. Hermes always keeps `default`, so "last" can only be reached on a stubbed Hermes.
- *Rename of the root profile.* Hermes keeps the id `default` and stores a presentation-only `display_name`; the page says so and its undo puts back the old display name (or `default`).
- *Create profile.* The empty state's primary action needs something to do before the builder (M4 #12): a small sheet (name, copy the default profile's settings) through `POST /api/profiles` (T1). The builder replaces it later.
- *Overview numbers.* Sessions and tokens are from `GET /api/analytics/usage?profile=` (30 days); runs are Kanban tasks assigned to the profile that have started (running, blocked, review, done) and the success rate is done ÷ (done + blocked), from the assignees counts (the stats' `by_assignee` when the assignees list does not name the profile); MCP servers from `GET /api/mcp/servers?profile=`; skills from the list's `skill_count`. A source that does not answer reads as zero and the page says which. Hermes has no per-profile run history route, so these are the closest honest measures; the help page states the definitions.
- *Gateway status* is `GET /api/status?profile=` per card (falling back to the list's `gateway_running`), reloaded at every `gateway.ready`, on `platforms.changed` and when the tab returns; there is no timer.
- *No policy-map change.* Every route used was already classified (create T1, active T2, rename T0, delete T3, description T0, describe-auto T1); no new Hermes route. The assistant name route is Caduceus's own and is not tiered, like the appearance preferences.
- *Shell.* `useProfileScope()` gained `reload()` (the chip's list and the default refresh after Make default, create, rename or delete); chat headers show `with <name>` when an assistant name is set.

**Findings for later tickets.**
- **Hermes 0.21.4 bug:** a profile-scoped read (`?profile=` on `/api/mcp/servers`, `/api/status`, `/api/analytics/usage`) made before the Hermes process's first model call leaves every later auxiliary-model call failing with `UnscopedSecretError` (Auto-describe returns `ok: false`) until Hermes restarts. After one model call has been made the same reads are harmless. Real use makes a model call long before anyone opens Profiles, so this is a hazard for fresh test homes only; `profiles-hermes.test.ts` makes the first call in `beforeAll` and notes why. Later tickets that mix `?profile=` reads with model calls in a fresh temp home (M4 #03, #07, #13) should do the same.
- Hermes's profile list counts skills lazily (a cached count, refreshed in the background), so a fresh or just-renamed profile may show 0 skills for a moment.
- M4 #02 adds its screens by registering them in `TAB_SCREENS` (`ProfileDetail.tsx`) and the tab appears; Identity already exists for the assistant name, and the SOUL editor should join it.

### Evidence (documentation pass)

- **Commit(s):**
  - `93d5d30 feat: Agents profiles list and overview with gateway status, tiered actions and assistant name (M4 #01)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `93d5d30` `server/test/profile-preferences.test.ts`: 7 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `93d5d30` `server/test/profiles-hermes.test.ts`: 11 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `93d5d30` `web/test/profiles-active-write.test.ts`: 1 cases; seam: pure web module (model/render).
  - `93d5d30` `web/test/profiles-model.test.ts`: 13 cases; seam: pure web module (model/render).
  - `93d5d30` `web/test/shortcuts.test.ts`: 12 cases; seam: pure web module (model/render).
- **Verification recorded:** Recorded in the ticket's existing comment: TDD slices; mutation checks (model `STARTED` statuses and sticky-default test changed made 6 tests fail; removing preference clean-up on rename made its test fail; both reverted); `npm test` 583 passed, 1 skipped; both typechecks clean; `npm run lint:ui` clean; `E2E_PORT=4402 npm run test:e2e` 6 passed. Browser smoke: the M0 #05 gates at 390, 320, 820 and 1440 passed on `/agents/profiles`, `/agents/profiles/writer`, `.../identity`, `/agents/profiles/coder/danger`, and with the help panel open; two failures found and fixed on the way. The passkey step-up was not driven in the browser (covered over HTTP with the software authenticator). Perf numbers: not recorded.
- **Deviations:**
  - The module is `profiles` (nav entry Profiles in the Agents group), not `agents`.
  - Hermes's `describe-auto` saves as it generates, so the page confirms first (T1), then shows the saved text with keep, edit or put-the-old-text-back.
  - Delete is refused up front for the root profile `default`, Hermes's sticky default and the only profile.
  - Renaming the root profile sets a presentation-only `display_name`; the id stays `default`.
  - The empty state's Create profile is a small sheet (`POST /api/profiles`, T1) until the builder in M4 #12.
  - Overview numbers are the closest honest measures Hermes allows (30-day usage analytics, Kanban assignee counts); Hermes has no per-profile run history route.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - The ticket's comment records: needs `npm run caduceus -- restart` to reach the live service.
  - Hermes 0.21.4 bug (from the ticket comment): a profile-scoped read before the process's first model call makes later auxiliary-model calls fail with `UnscopedSecretError` until Hermes restarts. Fresh test homes need a first model call in `beforeAll`.
  - Hermes's profile list counts skills lazily, so a fresh or renamed profile may show 0 skills briefly.
