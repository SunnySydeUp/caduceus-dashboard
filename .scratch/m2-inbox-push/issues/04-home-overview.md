# 04: Home overview

**What to build:** Home becomes the at-a-glance page. It has these blocks, in order on a phone and as a grid on wider screens:
- **Waiting for you:** the top Inbox items that need a decision, answerable inline, with a link to the Inbox.
- **Running now:** live chat runs across profiles (from `session.active_list.status`), each with Steer and Stop.
- **Health chips:** gateway, scheduler heartbeat, dispatcher, providers and processes, each linking to Health.
- **Spend tile:** today and this month from Hermes's usage analytics.
- **Recent sessions:** the last five across profiles.
- **Connected platforms:** from Hermes status.
- **Quick launch:** new chat, open Inbox and the other quick actions that exist.

Every block links into its module, loads independently and degrades on its own: one failing source shows an inline error, not a broken page. Everything is read live from Hermes. Home stores nothing.

**Blocked by:** 01 (Inbox tracer bullet: live approvals and questions), M1 #07 (Run control: steer, queue, interrupt, side tasks, goals), M1 #13 (Sessions list)

**Status:** resolved

- [x] Waiting for you shows up to three Needs-decision items with the same inline actions and tiers as the Inbox and updates live.
- [x] Running now lists live runs across profiles with profile and elapsed time; Steer sends a steer message, and Stop interrupts the run after a T1 confirmation naming the session and profile.
- [x] Health chips, spend, recent sessions and connected platforms come from Hermes's status, sessions and usage-analytics endpoints, with no Caduceus copies (test the Home API makes no Caduceus-store writes).
  Deviation: Spend counts days in UTC because Hermes's usage analytics groups sessions by UTC day.
- [x] Each block fails independently with a retry, and an empty block carries its primary action (for example "Start a chat").
- [x] Phone: single column in the order Waiting → Running → Health → Spend → Recent; tablet and desktop: a responsive grid.
- [x] Home meets the performance budget in mobile-and-interaction §10 (LCP, initial JS) and stays in the Lighthouse CI run.
- [x] Passes the M0 #05 gates; strings via catalogues; Home help page and glossary terms (Running now, Spend).
  Deviation: catalogue part deferred (owner); Playwright gates run as the throwaway smoke check, not as tests (AGENTS.md).

## Comments

### Evidence (documentation pass)

- **Commit(s):**
  - `21395f8 feat: Home overview with Waiting for you, Running now (Steer, Stop), health, spend, recent sessions, platforms and quick launch (M2 #04)`
- **Tests added:** counts are the `test(`/`it(` cases in the file as committed, not the number added by the commit.
  - `21395f8` `server/test/home.test.ts`: 6 cases; seam: Caduceus HTTP/WS API over a real Hermes launched by `fixtures/real-hermes`.
  - `21395f8` `server/test/inbox-sources.test.ts`: 16 cases; seam: Caduceus server module / HTTP API (no Hermes launcher imported).
  - `21395f8` `web/test/home-model.test.ts`: 9 cases; seam: pure web module (model/render).
  - `21395f8` `web/test/inbox-feed.test.ts`: 7 cases; seam: pure web module (model/render).
- **Verification recorded:** Criteria ticked; Home API makes no Caduceus-store writes (criterion; `server/test/home.test.ts`). The performance-budget criterion (LCP, initial JS, Lighthouse CI) is ticked; no numbers recorded. Playwright gates ran as the throwaway smoke check. Widths and results: not recorded.
- **Deviations:**
  - Spend counts days in UTC, because Hermes's usage analytics groups sessions by UTC day.
  - Playwright gates ran as the throwaway smoke check, not as tests (AGENTS.md).
  - Catalogue part deferred (owner).
- **Follow-ups / open items:**
  - None recorded in the ticket.
