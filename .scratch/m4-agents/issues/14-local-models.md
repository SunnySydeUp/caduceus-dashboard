# 14: Local models

**What to build:** Agents › Models › Local manages the local models Hermes can run on this Mac, through Hermes's local-models endpoints. None of the three existing dashboards exposes this; only Hermes Desktop does.

**What it covers:**
- runtime status and hardware fit;
- the catalogue, plus search of Hugging Face models and their files;
- quick-start;
- download, with live progress from Hermes's job endpoints;
- sideload of a local file;
- starting and ejecting the local server;
- activating a model;
- deleting a model.

An activated local model then shows up in ticket 03's shared picker, so it can be used as the main model or in any auxiliary slot.

Downloads can be large and long, so the screen shows disk impact before starting. On phones it is read-mostly: status, active model and job progress.

**Blocked by:** 03 (Model picker, main model and auxiliary slots)

**Status:** resolved

- [x] Status and hardware load from Hermes and explain plainly when the runtime isn't installed. Installing the runtime is T1.
  Deviation: no real runtime or model was installed or loaded (owner rule); the runtime install, quick-start, activate and start paths are covered only up to Hermes's own refusal when the runtime is missing. Disk-impact is the size stated in each confirmation (Hermes reports no free-disk figure).
- [x] Catalogue and search results show size and fit for this hardware. Starting a download is T1 and states the disk space it needs.
- [x] Download and runtime jobs show live progress, survive a page reload, and can be followed from a phone.
  Deviation: progress is a bounded poll of Hermes's job list (Hermes has no job event), only while a job runs; Hermes advances byte counts in 4 MB steps.
- [x] Activate, eject and server start are T1. Delete is T1, names the model, and reports freed space.
- [x] Once activated, the model appears in the shared picker and can be assigned to main or auxiliary slots.
- [x] Phone: status, active model and job progress are available. Downloads and sideloads are offered on tablet and desktop only.
- [x] Every new screen passes the M0 #05 gates. All strings come from the catalogues (catalogue part deferred (owner)). The help page and glossary cover local model, runtime and GGUF.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `fede3e6 feat: Agents › Models › Local models: status, catalogue, Hugging Face search, downloads with job progress, sideload, activate, eject, delete (M4 #14)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `fede3e6` `server/test/fixtures/huggingface-fixture.ts`: 0 cases; seam: fixture (test support, no cases).
  - `fede3e6` `server/test/local-models-hermes.test.ts`: 8 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `fede3e6` `web/test/local-models-model.test.ts`: 2 cases; seam: pure web module (model/render).
- **Verification recorded:** No real runtime or model was installed or loaded (owner rule). Runtime install, quick-start, activate and start paths are covered only up to Hermes's own refusal when the runtime is missing. Hugging Face search uses a fixture (`huggingface-fixture.ts`). Gate widths and results: not recorded.
- **Deviations:**
  - No real runtime or model was installed or loaded (owner rule); those paths are covered only up to Hermes's refusal when the runtime is missing. Disk impact is the size stated in each confirmation, because Hermes reports no free-disk figure.
  - Progress is a bounded poll of Hermes's job list (Hermes has no job event), only while a job runs. Hermes advances byte counts in 4 MB steps.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - Real runtime install, model download and activation have not been verified against a live runtime.
