# 12: Script jobs and advanced job options

**What to build:** This ticket adds the fourth job type, **Script**, and the advanced cron options. It replaces PatterStage's Scripts page.

**Script jobs** come in two forms:
- `script` + `no_agent`: stdout is delivered as-is.
- A script whose output becomes context for an agent prompt.

A code editor writes the script into the job profile's `scripts/` folder through Hermes's file-write endpoint. Hermes only runs scripts from that folder.

**Advanced options** expose Hermes cron fields no existing dashboard shows in full:
- `monitor_script` / `monitor_url`: a cheap check runs first, and unchanged output skips the agent run;
- `context_from`: chain another job's output;
- deliver-to targets from the messaging platforms list;
- `failure_deliver`;
- `attach_to_session`;
- `workdir`.

**Blocked by:** 06 (Schedule builder and job types)

**Status:** resolved

- [x] Creating or editing a Script job, and saving its script file, is T3 with the script name typed.
  Deviation: a `monitor_script` is T3 too (the scheduler runs it), and Hermes's create route ignores monitor, `failure_deliver` and `attach_to_session`, so a new job gets them in an update that follows (one more confirmation).
- [x] The file guard refuses any path outside the profile's `scripts/` folder, including traversal and symlinks (test).
- [x] Both script forms run end to end: the delivered output matches the script's stdout, and context mode injects the output into the prompt (test against a stub or real Hermes).
- [x] Monitor, chaining, delivery, failure delivery, attach-to-session and workdir options round-trip through Hermes unchanged (contract test per field).
- [x] Hermes's rule that monitor options can't be combined with `no_agent`, and that `no_agent` needs a script, shows as a field error before submit.
- [x] Script jobs show a Script badge in the list. Job detail shows the script with a read-only preview on phones and an editor on larger screens.
- [x] Every screen passes the M0 #05 gates (390, 320, 820, 1440). All strings come from the catalogues. The module's help covers Script jobs and glossary terms (Script job, monitor, context_from).
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `d5f6e77 feat: Script jobs and advanced job options: script editor with a guarded T3 save, monitor, chaining, delivery targets, failure delivery, attach to session, workdir (M3 #12)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `d5f6e77` `server/test/policy-map.test.ts`: 17 cases; seam: Caduceus server module / HTTP API (no Hermes launcher imported).
  - `d5f6e77` `server/test/script-files-hermes.test.ts`: 8 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `d5f6e77` `server/test/script-jobs-hermes.test.ts`: 6 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `d5f6e77` `web/test/script-jobs.test.ts`: 21 cases; seam: pure web module (model/render).
  - `d5f6e77` `web/test/work-module.test.ts`: 5 cases; seam: pure web module (model/render).
- **Verification recorded:** Criteria ticked: file-guard test (traversal and symlinks); both script forms end to end; a contract test per option. Gate widths and results: not recorded.
- **Deviations:**
  - A `monitor_script` is T3 too, because the scheduler runs it. Hermes's create route ignores monitor, `failure_deliver` and `attach_to_session`, so a new job gets them in an update that follows (one more confirmation).
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
