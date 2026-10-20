# 14: Backup and restore

**What to build:** System › Maintenance › Backup creates a backup through Hermes's backup operation and downloads it through the backup download endpoint. Downloading is T3 because the archive includes secrets. Restore takes an upload or a server path through Hermes's import operations at T3 with typed confirmation. It drains Caduceus first, and afterwards reconnects and reruns the contract drift check. The page also shows the agent checkpoint count with a prune action (T2). The backup includes Caduceus's own directory.

**Blocked by:** M0 #08 (Policy proxy, risk tiers, read-only mode and tiered confirmations), M1 #02 (Contextual help framework)

**Status:** resolved

- [x] It is registered through the module registry and passes the M0 #05 gates at phone 390, small phone 320, tablet 820 and desktop 1440.
- [x] Create is T1 and download is T3. The archive is never cached by the service worker.
- [x] Restore from upload and from path are T3, refused in read-only mode and offline, drain Caduceus, and are audited.
  - Deviation: a restore is refused (409) when Caduceus cannot restart itself (not the background service), because it replaces the store Caduceus holds open. The live service needs `npm run caduceus -- restart` once for this code to be live.
- [x] After restore, clients reconnect, the drift check runs, and Health reflects the outcome.
- [x] The backup contents include Caduceus directory (Caduceus store, VAPID keys), and restore brings them back (test).
  - Deviation: this tree has no VAPID keys yet (push is a later ticket); they will live in `<home>/caduceus/` and so travel in the backup. The test restores the Caduceus store (saved prompts) from both a path and an upload.
- [x] Checkpoint count is read from Hermes. Prune is T2 with the count named.
- [x] Phone: upload uses the native file picker, and progress stays visible.
  - Deviation: the browser's `fetch` gives no upload progress, so while the file is sent the page shows an indeterminate "Pausing new turns, then sending the file to Hermes…" line, and then Hermes's own import log streams. An upload is limited to 100 MB by the policy proxy; a larger backup is restored from its path.
- [x] Every string goes through the message catalogues; the module registers its help page and glossary terms (backup, restore, checkpoint), and the help test passes.
  - Deviation: catalogue part deferred (owner). The glossary term `checkpoint` is the Workspace Checkpoints module's (reused); this ticket adds `backup` and `backup-restore`.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `1faa3de` feat: System › Maintenance › Backup: backup and download, restore from file or path with a drain and restarts, checkpoint count and prune (M5 #14)
- **Tests added:**
  - `server/test/backup-hermes.test.ts` (added in `1faa3de`): 7 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `web/test/backup-model.test.ts` (added in `1faa3de`): 6 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/tiered-fetch.test.ts` (changed in `1faa3de`): 16 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. The ticket says the test restores the Caduceus store (saved prompts) from both a path and an upload. A real restore on the live service was not run. The help-page criterion says the help test passes. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded). The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - A restore is refused (409) when Caduceus cannot restart itself (not the background service), because it replaces the store Caduceus holds open.
  - This tree had no VAPID keys yet. They will live in `<home>/caduceus/` and travel in the backup. The test restores the Caduceus store (saved prompts) from both a path and an upload.
  - The browser `fetch` gives no upload progress. The page shows an indeterminate "Pausing new turns, then sending the file to Hermes…" line, then Hermes's own import log streams. The policy proxy limits an upload to 100 MB; a larger backup is restored from its path.
  - Glossary term `checkpoint` is the Workspace Checkpoints module's (reused); this ticket adds `backup` and `backup-restore`.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - The live service needs `npm run caduceus -- restart` once for this code to be live.
  - VAPID keys inside a backup are not verified: none existed when this ticket was done.
