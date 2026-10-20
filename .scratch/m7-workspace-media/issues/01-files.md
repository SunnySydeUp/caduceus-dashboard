# 01: Files

**What to build:** Workspace › Files lets the owner browse the roots Hermes's own file API exposes (the managed files root, or the scoped profile's workspace) at `/workspace/files/*path`. Folders list with name, size and modified time; selecting a file opens a preview: highlighted code, rendered Markdown, CSV as a sortable table, images, audio/video, PDF, and HTML in a sandboxed frame with no script access to the Caduceus origin. Previews use Hermes's `fs/read-text`, `fs/read-data-url` and `fs/download` endpoints; listing, upload, new folder and delete use Hermes's `/api/files` routes.

Text files can be edited and saved through Hermes's `fs/write-text` endpoint. Caduceus keeps the prior text as a snapshot before every write, detects staleness, and refuses writes to `.env`, `auth.json`, `caduceus/` or anything outside the scoped roots. Saves into protected areas (profile home, config and behaviour files) are T3.

On phones the listing becomes a card list (name, size, modified, ⋮) and previews open full screen.

**Blocked by:** M0 #08 (Policy proxy, risk tiers, read-only mode and tiered confirmations), M1 #02 (Contextual help framework)

**Status:** resolved

- [x] Browsing is limited to the roots Hermes exposes; a path outside them (including `..` traversal and symlinks resolving outside) is rejected at the proxy (test).
- [x] Previews render code, Markdown, CSV, images, audio/video, PDF and sandboxed HTML; files over Hermes's 1 MiB text limit show size and a Download action instead.
  Deviation: previews read through `/api/files/read` (and `/api/files/stream`, `/api/files/download`), which the proxy confines to the managed roots, not `fs/read-text`, `fs/read-data-url` and `fs/download`, which other screens use for paths anywhere. The 1 MiB text limit is applied by the page from the listing's size.
- [x] Sandboxed HTML preview cannot read Caduceus cookies, storage or call Caduceus APIs (test).
- [x] Text edit: unsaved-changes guard; save snapshots the previous text in the Caduceus store first and fails with a reload prompt if the file changed on disk since it was opened (test).
- [x] Tiers follow architecture §5 (tests):
  - saves inside the active workspace are T1, with a snapshot taken first;
  - saves elsewhere inside Hermes's allowed roots, such as the profile home and behaviour files, need T3 typed confirmation and are blocked in read-only mode and offline;
  - the proxy denies writes to `.env`, `auth.json`, `caduceus/` or outside the scoped roots.
- [x] Upload (drop or picker), new folder, download and delete work; delete is T1 naming the path and profile; all writes are audited.
- [x] Phone: card list with ⋮ menu offering every action; full-screen preview; desktop shows tree + preview side by side.
  Deviation: desktop shows the folder as a list with breadcrumbs beside the preview, not an expandable tree.
- [x] Empty folder state offers Upload and New folder.
- [x] Every new screen and sheet passes the M0 #05 gates (phone 390, small phone 320, tablet 820, desktop 1440: no overflow, axe clean, hit targets, tokens only).
- [x] All strings go through the message catalogues; the module registers its help page and glossary terms (Managed root, Protected area, Snapshot), and the missing-help test passes.
  Catalogue part deferred (owner). The Snapshot glossary term already exists from M4 #02 and is reused.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `dbcdf58` feat: Workspace Files: browse within managed roots, previews, text edit with snapshot, upload, new folder, download, delete (M7 #01)
- **Tests added:**
  - `server/test/files-hermes.test.ts` (added in `dbcdf58`): 5 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `web/test/files-model.test.ts` (added in `dbcdf58`): 11 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/tiered-fetch.test.ts` (changed in `dbcdf58`): 15 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. The ticket names tests for path rejection at the proxy (including `..` and symlink escape), sandboxed HTML isolation, the stale-file reload prompt and the tier rules. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded). The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - Previews read through `/api/files/read` (and `/api/files/stream`, `/api/files/download`), which the proxy confines to the managed roots. They do not use `fs/read-text`, `fs/read-data-url` and `fs/download`, which other screens use for paths anywhere. The page applies the 1 MiB text limit from the listing's size.
  - Desktop shows the folder as a list with breadcrumbs beside the preview, not an expandable tree.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - The Snapshot glossary term already exists from M4 #02 and is reused.
