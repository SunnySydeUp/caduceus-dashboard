# 04: Pairing and webhooks

**What to build:** Connect › Pairing lists pending and approved direct-message pairing requests from Hermes's pairing endpoint, kept live by `pairing.changed`. The owner can approve (T2), revoke (T2) or clear pending requests. The Inbox item for pending requests is M2 #02's; this screen is where the full list lives, and the Inbox item links here.

Connect › Webhooks manages Hermes's webhook receiver and subscriptions through its webhooks endpoints: create, enable/disable and delete. When a subscription is created, its secret is shown exactly once with a copy button, and Caduceus never stores or caches it.

**Blocked by:** 01 (Gateway control)

**Status:** resolved

- [x] It is registered through the module registry and passes the M0 #05 gates at phone 390, small phone 320, tablet 820 and desktop 1440.
- [x] The pending and approved lists come from Hermes and update live on `pairing.changed`.
- [x] Approve and revoke are T2 with the platform, user and profile named. Clear-pending is T1. All are audited.
- [x] Creating a webhook shows its secret once. After the dialog closes, the secret cannot be fetched again from Caduceus, and it is excluded from logs, audit detail and service-worker caches (tests).
- [x] Deleting a webhook is T1 with the subscription named. Enable/disable reflects Hermes state.
- [x] Phone: lists use cards with actions in a menu. Approval is never swipe-only.
- [x] Empty states explain pairing and offer Create webhook respectively.
  Deviation: with the receiver off, Create webhook is shown but disabled ("Switch the receiver on first") beside a "Switch on the receiver…" button, because Hermes refuses a create until the webhook platform is on.
- [x] Every string goes through the message catalogues; the module registers its help page and glossary terms (pairing, webhook, one-time secret), and the help test passes.
  Deviation: catalogue part deferred (owner).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `4623e05` feat: Connect › Pairing and Webhooks with approve, revoke, one-time webhook secrets (M5 #04)
- **Tests added:**
  - `server/test/fixtures/seed-pairing.ts` (added in `4623e05`): fixture, no cases
  - `server/test/fixtures/seed-session.ts` (changed in `4623e05`): fixture, no cases
  - `server/test/pairing-hermes.test.ts` (added in `4623e05`): 8 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `server/test/webhooks-hermes.test.ts` (added in `4623e05`): 7 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API against real Hermes in a throwaway HERMES_HOME
  - `server/test/webhooks.test.ts` (added in `4623e05`): 1 `test(`/`it(` cases (whole file); seam: Caduceus HTTP/WS API with the fake Hermes launcher
  - `web/test/pairing-model.test.ts` (added in `4623e05`): 3 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/sw-cache-rules.test.ts` (changed in `4623e05`): 6 `test(`/`it(` cases (whole file); seam: web pure module
  - `web/test/webhooks-model.test.ts` (added in `4623e05`): 4 `test(`/`it(` cases (whole file); seam: web pure module
- **Verification recorded:** All criteria are ticked `[x]`. The ticket names tests that a webhook secret is shown once, cannot be fetched again, and is absent from logs, audit detail and service-worker caches. The M0 #05 gate criterion is ticked; the ticket records no gate output (not recorded). The commit messages have no body, so git records nothing beyond the subject.
- **Deviations:**
  - With the receiver off, Create webhook is shown but disabled ("Switch the receiver on first") beside a "Switch on the receiver…" button, because Hermes refuses a create until the webhook platform is on.
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
