# 03: Web Push notifications

**What to build:** When Caduceus is closed, the owner's devices get a push notification for anything that needs them. The notification's title is the decision ("Approve `git push` on coder?") and its body is the exact preview. Tapping it opens the decision at `/inbox/:id`. The installed app's badge shows the number of items that need a decision.

The Caduceus server generates and keeps a VAPID keypair and sends standard Web Push itself. Its push watcher listens to the same sources as the Inbox: the observer connection, the proxied chat sockets and the change broadcasts. A device subscribes only after a meaningful action the owner taps (on iOS, only after the app is installed to the Home Screen, with a guide that explains why).

In Settings › Notifications, each device chooses its categories:
- Approvals & questions;
- Failures;
- Finished runs;
- Pairing;
- Budget;
- Updates.

Each device also sets quiet hours, a digest for FYI categories, and per-source overrides (for example notifications for one cron job on or off). It can send itself a test notification. Settings › Security lists subscribed devices with revoke.

**Blocked by:** 02 (Inbox sources, grouping and activity feed), M0 #12 (Installable PWA and offline shell), M0 #13 (Tailnet production run)

**Status:** blocked-on-owner

- [x] The VAPID keypair is created on first start in the Caduceus data folder with `0600` permissions and is stable across restarts; subscriptions are stored per device with categories, quiet hours and overrides.
- [ ] Permission is requested only from a user tap; on iOS the prompt is offered only when running as an installed app, otherwise the install guide is shown, and its dismissal is remembered.
  Blocked on owner: built and checked against a local stand-in push service and a real Chromium, but a real iPhone and a real push service (APNs/FCM) can only be tried by the owner. After `npm run caduceus -- restart`, open the installed phone app, go to Settings › Notifications, tap Turn on notifications, then Send a test notification, and then have an agent ask for an approval with the app closed.
- [x] Presence-aware: no push is sent while any Caduceus client for the owner is visible (test with a visible and a hidden client).
- [x] Server-side dedupe: one Hermes state change produces at most one notification per device, even across reconnects and Caduceus restarts (test).
- [x] Payloads are declarative where supported (iOS 18.4+) with a service-worker fallback; every notification deep-links to the decision, and an answered item shows its resolved state when opened late.
- [x] `navigator.setAppBadge` reflects the Needs-decision count and clears at zero.
- [x] Categories, quiet hours, digest and per-source overrides (including per cron job) are honoured (tests); a test notification is sent from Settings.
  Deviation: the digest is hourly or daily (09:00 on the device's clock), and a quiet window holds a notification back rather than dropping it. Budget has its category and switch, but no source raises budget notices until the budget guard exists (it matches any Inbox notice whose reference starts `budget:`).
- [x] Revoking a device's subscription, or an endpoint returning 404/410, removes it; subscriptions appear in Settings › Security.
- [x] Passes the M0 #05 gates; strings via catalogues; Notifications help page and glossary (Push subscription, Presence, Quiet hours).
  Deviation: catalogue part deferred (owner); Playwright gates run as the throwaway smoke check, not as tests (AGENTS.md).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `4b0f5ea feat: Web Push notifications with VAPID keys, per-device subscriptions, categories, quiet hours, digest, presence and dedupe, service-worker fallback, app badge and Settings › Notifications (M2 #03)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `4b0f5ea` `server/test/fixtures/push-stub.ts`: 0 cases; seam: fixture (test support, no cases).
  - `4b0f5ea` `server/test/owner-auth.test.ts`: 12 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `4b0f5ea` `server/test/push-rules.test.ts`: 7 cases; seam: Caduceus server module / HTTP API (no Hermes launcher imported).
  - `4b0f5ea` `server/test/push.test.ts`: 16 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `4b0f5ea` `server/test/web-push.test.ts`: 3 cases; seam: Caduceus server module / HTTP API (no Hermes launcher imported).
  - `4b0f5ea` `web/test/push-client.test.ts`: 8 cases; seam: pure web module (model/render).
- **Verification recorded:** Built and checked against a local stand-in push service (`push-stub`) and a real Chromium, per the ticket. Not verified: a real iPhone, a real push service (APNs/FCM), and the iOS install-guide path. The Playwright gates ran as the throwaway smoke check, not as tests. Result details and perf numbers: not recorded.
- **Deviations:**
  - The digest is hourly or daily (09:00 on the device's clock). A quiet window holds a notification back; it does not drop it.
  - Budget has its category and switch, but no source raises budget notices until the budget guard exists. It matches any Inbox notice whose reference starts `budget:`.
  - Playwright gates ran as the throwaway smoke check, not as tests (AGENTS.md).
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - **Status is `blocked-on-owner`** and stays so: one criterion is unticked (permission only from a tap; on iOS only as an installed app, otherwise the install guide, dismissal remembered).
  - Owner must check on a real phone: run `npm run caduceus -- restart`; open the installed phone app; go to Settings › Notifications; tap Turn on notifications; tap Send a test notification; then have an agent ask for an approval with the app closed and confirm the notification arrives and opens `/inbox/:id`. On iOS, also check that the prompt appears only in the installed app and that the install guide shows in Safari.
  - No source raises budget notices yet.
