# 02: Move, rename and Office editing

**What to build:** Within Files, the owner can rename a file or folder and move it to another folder, and can open Office documents (at least .docx; .xlsx/.pptx where the editor supports them) in an in-browser editor and save them back. Hermes has no API for these, so they are the R11 guarded file operations the Caduceus server performs on disk itself.

Every R11 operation stays inside the roots Hermes's file API exposes (the managed files root or the profile's workspace), never touches `.env`, `auth.json`, `caduceus/` or anything outside those roots, is tier-gated through the policy proxy and is written to the audit log. Before building the Office save, verify whether Hermes's `/api/files/upload` can overwrite in place; if it can, save through Hermes instead and record which path was chosen.

**Blocked by:** 01 (Files)

**Status:** resolved

- [x] Rename is T0 with an undo toast that renames back; move is T1 naming source, destination and profile.
- [x] Source and destination are canonicalised (symlinks resolved) and must both lie inside an allowed root; `.env`, `auth.json`, `caduceus/` and out-of-root paths are refused with a clear reason (tests, including traversal and symlink escape).
- [x] Name collisions are refused, never silently overwritten (test).
- [x] Office documents open in an in-browser editor; save overwrites the original only after a snapshot of the prior bytes, and is T3 inside protected areas (same rule as text edits in 01).
  Deviation: the editor changes the text and values of a document (a Word or PowerPoint document as its paragraphs, an Excel workbook as its cells, formulas shown as `=…`) and leaves layout, pictures and charts as they are; it is not a page-layout editor. Excel formulas are calculated when the workbook is next opened.
- [x] Each R11 operation writes an audit entry with actor, action, source, target and profile (test).
- [x] All R11 operations are blocked in read-only mode (test).
- [x] The Office save path decision (Hermes upload overwrite vs R11 write) is recorded in the ticket's PR notes.
  Decision: Hermes’s `/api/files/upload-stream` overwrites in place (`overwrite` defaults to true; it writes beside the file and renames), so the save goes through Hermes after Caduceus has kept the prior bytes (`file_byte_snapshots`, five per file). Rename and move are R11 on-disk operations.
- [x] Phone: rename and Move to… are in the ⋮ menu with a folder picker sheet; Office editing on phones opens read-only preview with an explicit "Edit anyway" for larger screens' editor.
- [x] Every new screen and sheet passes the M0 #05 gates (phone 390, small phone 320, tablet 820, desktop 1440: no overflow, axe clean, hit targets, tokens only).
- [x] All strings go through the message catalogues; the module registers its help page and glossary terms (Guarded file operation), and the missing-help test passes.
  Catalogue part deferred (owner). The Guarded file operation glossary term and the Files help page are updated.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `907b97a` feat: Files: rename, move and Office editing as guarded file operations (M7 #02)
- **Tests added:**
  - `server/test/file-operations.test.ts` (added in `907b97a`): 10 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `web/test/files-model.test.ts` (changed in `907b97a`): 13 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/office-documents.test.ts` (added in `907b97a`): 9 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/office-xml.test.ts` (added in `907b97a`): 1 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. The ticket names tests for canonicalisation (traversal, symlink escape), no overwrite on collision, audit entries and read-only blocking. Decision recorded in the ticket: Hermes's `/api/files/upload-stream` overwrites in place, so the Office save goes through Hermes after Caduceus keeps the prior bytes (`file_byte_snapshots`, five per file); rename and move are R11 on-disk operations. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded). The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - The Office editor changes the text and values of a document (a Word or PowerPoint document as its paragraphs, an Excel workbook as its cells, formulas shown as `=…`). It leaves layout, pictures and charts as they are. It is not a page-layout editor.
  - Excel formulas are calculated when the workbook is next opened.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
