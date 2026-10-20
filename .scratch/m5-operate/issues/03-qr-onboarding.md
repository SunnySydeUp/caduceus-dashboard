# 03: QR onboarding

**What to build:** From Channels, the owner can choose "Create with QR" for Telegram or "Pair with QR" for WhatsApp. Caduceus drives Hermes's Telegram and WhatsApp onboarding endpoints step by step. It shows the QR code, keeps polling until Hermes reports the bot or device linked, and finishes by asking which users are allowed to talk to the agent. The QR fits the screen on phones; because the owner may be scanning from the same phone, a copyable link or code is offered too.

**Blocked by:** 02 (Channels)

**Status:** blocked-on-owner

- [x] It is registered through the module registry and passes the M0 #05 gates at phone 390, small phone 320, tablet 820 and desktop 1440.
- [ ] The Telegram and WhatsApp flows run end to end against a stub upstream: start, QR shown, linked, allowed users saved.
  - Blocked on the owner: Telegram runs end to end in tests and in a browser against a stand-in for Nous's setup service (real Hermes), and a WhatsApp device found already linked runs through apply. The live WhatsApp QR comes from Hermes's Node bridge and needs a real phone, and Telegram's real QR needs the owner to scan it in Telegram: the owner must do one real pairing of each to close this criterion.
- [x] The QR refreshes or explains when it has expired. Cancelling leaves no half-configured platform behind (or says clearly what was left).
  - Deviation: the QR does not refresh by itself: when it expires (countdown, or Hermes says so) the sheet says so and offers Start again. A WhatsApp phone that linked stays linked in Hermes's session folder; the sheet says so.
- [x] Saving the allowed users uses the same tier as platform configuration (T2) and is audited.
- [x] On phones the QR is sized for scanning from another device, and a copy-link alternative is always visible.
- [x] The platform card reflects the new connection without a reload.
- [x] Every string goes through the message catalogues (catalogue part deferred (owner)); the module registers its help page and glossary terms (QR pairing, allowed users), and the help test passes.

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `6e4e573` feat: QR onboarding: Create with QR for Telegram and Pair with QR for WhatsApp, polled until linked, then the allowed users (M5 #03)
- **Tests added:**
  - `server/test/fixtures/stub-telegram-setup.ts` (added in `6e4e573`): fixture, no cases
  - `server/test/qr-onboarding-hermes.test.ts` (added in `6e4e573`): 4 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `web/test/qr-onboarding.test.ts` (added in `6e4e573`): 5 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** Criterion 2 (both flows end to end against a stub upstream) is NOT ticked. The ticket says: Telegram runs end to end in tests and in a browser against a stand-in for Nous's setup service (real Hermes); a WhatsApp device found already linked runs through apply. The live WhatsApp QR and a real Telegram QR were not exercised. The other criteria are ticked. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded).
- **Deviations:**
  - The QR does not refresh by itself. When it expires (countdown, or Hermes says so) the sheet says so and offers Start again.
  - A WhatsApp phone that linked stays linked in Hermes's session folder after a cancel; the sheet says so.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - **blocked-on-owner.** The owner must do one real pairing for each platform to close criterion 2.
  - Telegram: the owner starts "Create with QR" in Channels, then scans the real QR in their own Telegram account. The Telegram QR needs the owner to scan it in Telegram.
  - WhatsApp: the owner starts "Pair with QR" in Channels, then scans the live QR with a real phone on their own WhatsApp account. The live WhatsApp QR comes from Hermes's Node bridge and needs a real phone.
  - After both pairings the owner (or a later pass) can tick criterion 2 and set the status to resolved. This was not done and not verified.
