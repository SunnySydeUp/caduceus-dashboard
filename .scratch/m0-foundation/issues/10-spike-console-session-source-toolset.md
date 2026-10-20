# 10: Spike — Caduceus sessions get Hermes's normal toolset

**What to build:** Confirm the second early check before M1 builds Chat on top of it.

A session Caduceus creates with source "caduceus" must get Hermes's normal toolset. It must not get the Desktop-only bridges: preview, terminal read, tour and window read. Those appear for source "desktop", which Caduceus cannot answer.

Check this from Hermes source and live, over the ticket 09 connection:
- create a session;
- inspect its tools through an inspection method, without sending a prompt;
- close it.

Confirm that no session row is left in Hermes's history. Record the verified source value, with evidence, in the architecture doc. If the result differs, propose the fix.

**Blocked by:** 09 (live gateway connection with reconnect and epoch detection).

**Status:** resolved

- [x] The evidence includes Hermes source references and a live result. No prompt was sent, and no session row was left behind (verified).
- [x] The architecture doc states the verified source value and which tools it yields. The "verify in M0" note is removed.
- [x] If "caduceus" is wrong, a follow-up ticket describing the fix is added to this folder. (It is not wrong, so none was needed.)

## Comments

**2026-10-07: RESOLVED.** `source: "caduceus"` is right: Hermes 0.21.4 gives it its normal toolset and none of the Desktop-only bridges. Architecture §3 ("Session `source`") now states the value, the tool difference and the evidence; the "verify in M0" note is gone.

- **Source (read-only, `~/.hermes/hermes-agent`).**
  - `session.create` keeps an explicit `source`; an empty one becomes the backend's platform (`tui`, or `desktop` under `HERMES_DESKTOP=1`): `tui_gateway/methods_session.py:65-67`, `server.py:1418-1428`.
  - The agent's toolsets are the configured CLI toolsets plus `_gui_surface_toolsets(source)` = `{"project","desktop_ui"}` for `"desktop"` and `{"project"}` for anything else: `server.py:1827-1831`, `1880-1914`, used at `2416`.
  - `desktop_ui` is `toolsets.py:137-143` (tools register into it from `tools/`): live it is `desktop_preview`, `drive_preview`, `annotate_preview`, `read_terminal`, `close_terminal`, `read_window_below`, `focus_pane`, `gui_tour`, `show_tip` and `apply_layout`; `react_to_message` joins when the Desktop reactions setting is on. The reads (`read_terminal`, `read_window_below`, preview read, `drive_preview`) are request/respond with the renderer (`tools/read_terminal_tool.py`, `read_window_tool.py`, `read_preview_tool.py`, `drive_preview_tool.py`).
  - `"caduceus"` is not a gateway platform, so `session.close` ends its rows as for the TUI: `session_lifecycle.py:314-330`, checked with `_is_gateway_owned_source("caduceus") == False` in Hermes's own venv.
  - `session.create` writes no row; the row comes with the first prompt (`methods_session.py:369-388`). `session.close` only tears the runtime down (`1968-1972`).
- **Live (new test `server/test/session-source.test.ts`, real `hermes serve` in a temp home behind a Caduceus server, driven through the page's gateway client).**
  - `session.create {source:"caduceus"}` → wait for the built agent's `session.info` → `tools.show` and `toolsets.list` for that session → `session.close`.
  - Tools, bare temp home: `"caduceus"` 27, no source 27 (identical lists), `"desktop"` 37 = the same 27 + exactly the ten `desktop_ui` tools. `desktop_ui` is enabled only for `"desktop"`; `project` (`desktop_project`, which writes Hermes's own `projects.db`) is enabled for all three.
  - No prompt: the stub LLM saw only metadata probes (`GET /v1/models`, `/api/v1/models`, `/api/tags`, `/v1/props`, `/props`, `/version`, `/v1/models/stub-model`, `POST /api/show`) and no completion. No row: Hermes's `state.db` has none and `GET /api/sessions?archived=include` through Caduceus answers `total: 0`, after `close` (the probe also saw an empty store before it). `session.active_list` is empty after `close`.
  - `info.desktop_contract` is **7** in the `session.create` result and in the built session's `session.info`, equal to the pin (`pin.json` markers); the test asserts both against the pin and runs `markerMismatches` with the live number (no mismatch).
- **Tests added** (Caduceus WS seam, real Hermes), all in `server/test/session-source.test.ts`:
  - source "caduceus" gets Hermes's normal tools and none of the Desktop-only bridges; no prompt is sent and no session row is left;
  - what source "desktop" adds is the Desktop-only bridges, and a session with no source gets the same tools as "caduceus";
  - Hermes reports the desktop contract number its pins were taken from, in `session.create` and in the built session's `session.info`.

  New fixture `server/test/fixtures/stub-llm.ts` (`startStubLlm()`, `connect(hermes)`): the stub OpenAI-compatible server AGENTS.md already promised for chat tests. It serves the model list and records every request. Hermes builds no agent without a provider, and the inspection methods lie without an agent (below). The temp home is pointed at it with `hermes config set`.
- **They passed at once (the behaviour already existed), so each was mutation-checked and each mutation failed as it should.**
  - Source `"desktop"` in the first test: failed on the ten `desktop_ui` tools being present.
  - A `prompt.submit` added to the first test: failed on `POST /v1/chat/completions` reaching the stub (so the regexp does catch a prompt), and, with that assertion skipped, on `state.db` then holding a row `{source: "caduceus"}`. This also shows the stored source value.
  - `tools.show` before the agent is built: failed (the bridges listed for a "caduceus" session).
  - The "no source" session given `"desktop"`: the second test failed on the lists differing.
  - The expected contract number set to 8: the third test failed.
  - A flat green run three times in a row (about 5 s each).
- **Findings the architecture doc now records, for M1 #03 and later:**
  - **Inspect only a built agent.** `session.create` answers `lazy: true` with empty `tools` and builds the agent about 50 ms later; the `session.info` with tools marks it. Before that, `tools.show` lists every tool there is (41 in the probe's home, bridges included) and `toolsets.list` has everything enabled.
  - **`session.info.tools` does not tell sources apart.** Hermes defers the GUI tools behind `tool_search` by default, for `"desktop"` too (`hermes_cli/config_defaults.py:1972-1978`); `tools.show` includes deferred tools.
  - **A provider is needed to build an agent.** Without one the build fails with an `error` event ("Hermes is not connected to any AI provider yet…").
  - **`session.resume` takes `source` too**, and the runtime's tools follow the request's source, not the stored row's.
  - **Source-only, not exercised:** a `"desktop"` session's launch directory is not a workspace and stores no `cwd`, while any other source stores the session's own `cwd`, so Chat must pass the chosen workspace as `cwd` on `session.create`. Hermes's startup orphan sweep closes only `tui`, `desktop`, `subagent` and `unknown` rows, so it leaves a stale `caduceus` row open (`session_workdir.py:76-91`, `session_reaper.py:337`).
- **Deviations.**
  - The ticket text says source "console"; the project was renamed and the value verified is `"caduceus"`.
  - **`desktop_contract` into the compatibility markers: not done, deliberately.** The live number is only reachable by creating a session (or by reading frames the proxy relays), and the startup check (ticket 02) must not create one: that builds an agent and changes Home's active-session count. Reading frames in the proxy and updating the served report is plumbing with a design choice in it, so it is an acceptance criterion of M1 #03 (added there) and described in architecture §6. What M0 #10 gives it: the live value (7), a test that asserts it against the pin, and `markerMismatches` already handling a live number (ticket 02).
  - No web code changed, so no browser smoke check.
- **Checks:** `npm test` 226 passed, 1 skipped (the opt-in real smoke; 223 before, plus these 3); `npx tsc -p server --noEmit` and `npx tsc -p web --noEmit` clean; `npm run lint:ui` clean; `npm run test:e2e` 6 passed. The temporary probe test was deleted; no temp homes or stray processes remain (the owner's own Hermes processes, there before and untouched, are the only ones).
- **Follow-ups:** M1 #03 (criterion added): one constant for the source, passed on `session.create` and `session.resume` together with the chosen `cwd`; feed the first `desktop_contract` into the compatibility report; wait for the built agent before reading a session's tools; handle the no-provider `error`. M1 #08 (toolsets chip) should read `tools.show` / `toolsets.list` only after the build. Hermes's startup sweep does not touch a `caduceus` row left open by a crash (M1 #13/#14 may want a "stale" marker).

### Evidence (documentation pass)
- **Commit(s):** `92aa907` feat: spike confirms caduceus sessions get Hermes's normal toolset (M0 #10).
- **Tests added:**
  - `server/test/session-source.test.ts` (3): Caduceus WS seam over real Hermes with a stub LLM (source "caduceus" vs "desktop" vs none; `desktop_contract` 7 against the pin).
  - Fixture: `fixtures/stub-llm.ts` (`startStubLlm()`, `connect(hermes)`).
- **Verification recorded:** Hermes source references and a live result are in the ticket comment: "caduceus" 27 tools, no source 27, "desktop" 37 (the same 27 plus ten `desktop_ui` tools). The stub LLM saw only metadata probes, no completion; Hermes's `state.db` and `GET /api/sessions?archived=include` showed no row. Five mutation checks failed as intended; three green runs of about 5 s. `npm test` 226 passed, 1 skipped; both typechecks, `lint:ui` clean; `npm run test:e2e` 6 pass. No web code changed, so no browser check.
- **Deviations:**
  - The ticket text said source "console"; the project was renamed and the verified value is "caduceus".
  - Feeding `desktop_contract` into the compatibility markers was not done here (the startup check must not create a session); it moved to M1 #03 as a criterion.
- **Follow-ups / open items:** Done in M1 #03: one source constant with `cwd`, live `desktop_contract`, waiting for the built agent, the no-provider error. M1 #08 reads `tools.show` / `toolsets.list` only after the build. Hermes's startup sweep leaves a `caduceus` row open after a crash (M1 #13/#14 may want a "stale" marker). Status: resolved.
