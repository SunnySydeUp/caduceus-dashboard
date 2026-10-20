# 10: Attachments

**What to build:** The owner attaches up to 20 items to a message: images by paste, drag-and-drop or picker; files; PDFs; and archives, which are unpacked in the browser so each contained file is attached individually. Attachments show as chips with thumbnails, size and a remove button, and upload with progress. They reach Hermes through the gateway's image.attach_bytes, file.attach and pdf.attach.

Pasting a large block of text (above a set threshold) turns it into a Markdown file attachment instead of flooding the composer, with an option to keep it inline. On a phone, the attach button opens the system picker including the camera.

**Blocked by:** 08 (Composer chips, config sheet and context ring)

**Status:** resolved

- [x] Paste, drop and picker each attach images; files and PDFs attach through the matching Hermes method (tests against a stub gateway).
  Deviation: tests run the real Hermes with the stub LLM (project rule), not a stub gateway; Hermes renders a PDF with `pdftoppm`, which this Mac lacks, so the PDF test puts a stand-in `pdftoppm` on Hermes's PATH. A file is named in the message as `[User attached file: <path>]` (Hermes's own drop wording), not `ref_text`: Hermes's `@file:` expansion refuses a path outside the chat's workspace, where `file.attach` stages an upload (`path is outside the allowed workspace`), so the agent reads it with its tools. Upload progress is per attachment (uploading, uploaded, failed), since the gateway takes each file as one frame.
- [x] A zip archive is unpacked in the browser and its files are attached individually; unsupported or oversized entries are reported, not silently dropped.
  Deviation: tar, tar.gz and tgz are unpacked too; macOS litter (`__MACOSX`, `.DS_Store`) is skipped without a report, folders and directories are not files.
- [x] More than 20 attachments are refused with a clear message.
- [x] A large paste becomes a `.md` attachment with an undo to keep it inline.
  Deviation: the threshold is 4,000 characters; the undo is the toast's Undo and a Keep inline button on the chip.
- [x] Attachments appear in the sent message and in the transcript after reload.
  Deviation: while Hermes is answering, Steer and Queue refuse attachments with a message (Hermes queues images for the next prompt it runs, which a steer is not).
- [x] On a phone the attach control offers camera and files and attachment chips fit 320 px.
  Deviation: the attach control is a small menu (photos and files, Take a photo, a file of the workspace) so the camera is a named choice on phones.
- [x] Passes the M0 #05 gates; strings via catalogues; help page updated (attachment limits).
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)
- **Commit(s):** `7579821` feat: attachments: images, files, PDFs and unpacked archives with chips, large paste to Markdown, transcript thumbnails (M1 #10).
- **Tests added:**
  - `server/test/chat-attachments.test.ts` (4): Caduceus HTTP/WS API seam over real Hermes with the stub LLM (a stand-in `pdftoppm` on Hermes's PATH for the PDF test).
  - `web/test/archive.test.ts` (8), `attachments.test.ts` (7), `message-attachments.test.ts` (4): pure modules.
- **Verification recorded:** Every criterion is ticked, including 320 px chips and the M0 #05 gates. Smoke scripts are committed in `.scratch/m1-chat/m1-10-smoke/` (`serve.ts`, `gates-extra.mjs`, `states.mjs`); the ticket records no widths or results: not recorded.
- **Deviations:**
  - Tests run the real Hermes with the stub LLM, not a stub gateway; the PDF test needs a stand-in `pdftoppm` because this Mac lacks it.
  - A file is named in the message as `[User attached file: <path>]` (Hermes's drop wording), not `ref_text` (Hermes's `@file:` expansion refuses paths outside the chat's workspace; `file.attach` stages an upload). Upload progress is per attachment (uploading, uploaded, failed).
  - tar, tar.gz and tgz are unpacked too; macOS litter (`__MACOSX`, `.DS_Store`) is skipped without a report.
  - The large-paste threshold is 4,000 characters; the undo is the toast's Undo and a Keep inline button.
  - While Hermes is answering, Steer and Queue refuse attachments with a message.
  - The attach control is a small menu (photos and files, Take a photo, a workspace file) so the camera is a named choice.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:** The real PDF path (with Hermes's own `pdftoppm`) was not run on this Mac. Status: resolved.
