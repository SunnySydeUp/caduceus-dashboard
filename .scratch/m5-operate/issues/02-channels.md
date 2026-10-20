# 02: Channels

**What to build:** Connect › Channels lists every messaging platform Hermes supports (23+) as a card with its status, read from Hermes's messaging platforms endpoint and kept live by the `platforms.changed` broadcast. The owner can enable or disable a platform, test it through the platform test endpoint, and open a configure drawer. The drawer validates fields before saving and shows secret values only redacted; it saves through the platform update endpoint (T2).

Each channel also has a settings tab for platform behaviour stored in Hermes config, such as Discord auto-thread, streaming and human delay, which saves through Hermes's config endpoint. Saving anything that needs a gateway restart raises the restart-to-apply banner from ticket 01.

**Blocked by:** 01 (Gateway control)

**Status:** resolved

- [x] It is registered through the module registry and passes the M0 #05 gates at phone 390, small phone 320, tablet 820 and desktop 1440.
- [x] Platform cards and their status come from Hermes and update live from `platforms.changed`.
- [x] Configuring a platform validates required fields inline. Secret values are never returned to the browser unredacted, and never cached by the service worker (test).
- [x] Saving platform configuration is T2 and audited. Test reports success or failure with Hermes's own message.
- [x] Platform behaviour settings read and write the matching Hermes config keys and take their field types from the config schema.
- [x] Changes that need a restart raise ticket 01's banner for that profile.
- [x] Phone: the cards form a single-column list, and configuration opens as a full-height sheet with a sticky Save.
- [x] Empty or unconfigured platforms carry a primary Configure action.
- [x] Every string goes through the message catalogues; the module registers its help page and glossary terms (channel, platform, test message), and the help test passes.
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `8bcefdd` feat: Connect › Channels with platform cards, configure drawer, test and behaviour settings (M5 #02)
- **Tests added:**
  - `server/test/channels-hermes.test.ts` (added in `8bcefdd`): 6 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `server/test/channels.test.ts` (added in `8bcefdd`): 1 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API with the fake Hermes launcher
  - `web/test/channels-model.test.ts` (added in `8bcefdd`): 19 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/shortcuts.test.ts` (changed in `8bcefdd`): 12 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/sw-cache-rules.test.ts` (changed in `8bcefdd`): 6 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. The ticket names tests for secret values never returned unredacted and never cached by the service worker, and for T2 save reporting Hermes's own message. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded). The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
