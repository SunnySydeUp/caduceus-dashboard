# 05: Skills hub, learn-a-skill and curator

**What to build:** Agents › Skills › Hub searches across Hermes's skill hub sources (Hermes's hub search endpoints, including the official list) with a Featured section. Hub detail shows the skill's description, source and the security-scan verdict before Install. Install and Update all stream live logs from Hermes.

Learn-a-skill starts a chat in the scoped profile that runs Hermes's `/learn` command, so the owner watches it in Chat. Curator shows Hermes's curator status with Pause / Resume and Run now (Hermes's curator endpoint).

**Blocked by:** 04 (Installed skills and editor), M1 #03 (Chat tracer bullet: new chat, streamed reply, resume)

**Status:** resolved

- [x] Hub search covers every source Hermes exposes, filterable by source, with results paginated and the query in the URL.
  Deviation: Hermes's official source search fails closed once a second profile is served, so the official source is matched here from Hermes's local `hub/official` list; every other source is searched by Hermes. Search runs on submit, not per keystroke (each search can take up to 30 s).
- [x] Detail always shows the security-scan verdict before the Install button becomes active; a failing verdict requires an explicit override inside the T3 confirmation.
  Deviation: Hermes's install endpoint takes no `force`, so a verdict its policy blocks (community or trusted source) cannot be overridden from Caduceus: Install stays off, the reason shows, and the terminal command (`hermes -p <profile> skills install <id> --force`) is given where Hermes allows forcing. The explicit override (typing `override <name>` in the T3 confirmation) applies to verdicts that are not safe but that Hermes allows (for example an official skill with a dangerous verdict). The community-blocked case was read from real Hermes but not installed in tests (Hermes retries the network for half a minute per resolve).
- [x] Install and Update all are T3 (step-up + typed confirmation), blocked in read-only mode and offline, and show a live log until completion or failure; the Installed list refreshes afterwards.
- [x] Learn-a-skill opens a new chat that issues `/learn` with the owner's topic; it is reached through the slash-command path, not a denied exec dispatch (proxy test).
- [x] Curator shows status and last run; Pause/Resume and Run now use their proxy tiers and reflect Hermes's state after the call.
- [x] Phone: hub is a searchable list → detail sheet with verdict above Install; logs open in a full-screen sheet.
- [x] Every new screen passes the M0 #05 gates (390, 320, 820, 1440; no overflow; axe clean; hit targets; tokens only). All strings come from the catalogues, and the module registers its help page and glossary terms (skills hub, security scan, curator, learn-a-skill).
  Deviation: catalogue part deferred (owner). Skills named `hub`, `learn` or `curator` cannot be edited by address (static routes win). The phone log sheet was not seen in a screenshot (the virtual passkey needed for the T3 step-up would not register at the phone size); the sheet is the shared `Sheet` with the full detent, and the four widths passed the gates on every route with no sheet open. Hub detail sheet at 390 was checked by eye.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `ddb0d19 feat: skills hub, learn-a-skill and curator (M4 #05)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `ddb0d19` `server/test/fixtures/hub-fixture.ts`: 0 cases; seam: fixture (test support, no cases).
  - `ddb0d19` `server/test/gateway-policy.test.ts`: 16 cases; seam: Caduceus server module / HTTP API (no Hermes launcher imported).
  - `ddb0d19` `server/test/learn-skill.test.ts`: 2 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `ddb0d19` `server/test/skills-hub-hermes.test.ts`: 9 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `ddb0d19` `web/test/hub-model.test.ts`: 12 cases; seam: pure web module (model/render).
- **Verification recorded:** Hub detail sheet at 390 was checked by eye. The phone log sheet was not seen in a screenshot (the virtual passkey for the T3 step-up would not register at phone size). The four widths passed the gates on every route with no sheet open. The community-blocked case was read from real Hermes but not installed in tests (Hermes retries the network for half a minute per resolve).
- **Deviations:**
  - Hermes's official source search fails closed once a second profile is served, so the official source is matched from Hermes's local `hub/official` list. Other sources are searched by Hermes. Search runs on submit (each search can take up to 30 s).
  - Hermes's install endpoint takes no `force`. A verdict its policy blocks (community or trusted source) cannot be overridden from Caduceus: Install stays off, the reason shows, and the terminal command `hermes -p <profile> skills install <id> --force` is given. The `override <name>` typed confirmation applies only to non-safe verdicts that Hermes allows (for example an official skill with a dangerous verdict).
  - Skills named `hub`, `learn` or `curator` cannot be edited by address (static routes win).
  - The phone log sheet was not seen in a screenshot.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - The phone log sheet and the T3 step-up at phone size have no screenshot check recorded.
