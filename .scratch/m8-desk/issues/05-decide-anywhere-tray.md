# 05: The decide-anywhere tray

**What to build:** In every Talk thread, a tray above the composer says "N more need you elsewhere" with the sigils of the other agents that wait. Opening it lists their open decisions as compact cards that can be answered in place, with the same tiers as Today. It is hidden when nothing else waits. The same list backs the Today count.

**Blocked by:** 03, 04

**Status:** resolved

- [x] The tray lists only decisions from other agents; the open thread's own decision stays inline in the transcript.
  - `trayView` (`web/src/modules/chat/decide-tray.ts`, tested in `web/test/decide-tray.test.ts`) drops a decision of the open thread's agent or of the open session. Deviation: the owner's profile scope is not applied: a Talk screen is always scoped to its own agent, so applying it would hide every other agent (found by the smoke: the pill never showed). It lists the same decisions Today counts under All profiles (`decisionsFor`).
- [x] Answering from the tray uses the same code path and tiers as Today (one decision component).
  - `DecisionCard` (moved out of `TodayBlocks.tsx` into `today/DecisionCard.tsx`, with its styles in `decision-card.css`) is rendered by Today and by the tray, and wraps `InboxDecision`. Deviation: the tray hides the card's "Why Hermes asks" line to stay compact; the command, session link and every answer are there.
- [x] It updates live and disappears when the last decision is answered.
  - It reads the Inbox's live stream. Real-click smoke (throwaway, deleted): allowing the first of two decisions from the tray ran the command and the pill went to "1 more needs you elsewhere" with the list still open; denying the last removed the tray and gave the focus to the message box.
- [x] Tray button reports `aria-expanded`; a real click test at 390 and 1440.
  - Smoke at 390, 320, 820 and 1440: `aria-expanded` false then true on a real click; no overflow, targets at least 44 px (touch), no console errors; axe has no serious or critical issue (one moderate `landmark-unique`: two decisions with the same title are two regions of the same name, in Today's Needs you too).

- [x] Follow-up from ticket 03: opening a session that is in Today's Ready for review in Talk calls `POST /_caduceus/api/today/ready/opened`.
  - `readyToOpen` (`talk-review.ts`, tested) decides; `useReviewOpened` (`use-review-opened.ts`) is called by `Conversation`. Smoke: a finished run in Ready left the list after its chat was opened by address. The finish of a run while its chat is already open is not marked.

**Commits:** 2 feat commits "decide-anywhere tray ... (M8 #05)" and the fixes after them.
**Tests:** `web/test/decide-tray.test.ts` (9: tray list, faces, count words, hidden, when to mark opened).
**Mount:** the tray rides inside `PendingRequests` (`Requests.tsx`, new `children`), the sticky stack above the composer, and in a `cx-cards` of its own above the read-only bar.
