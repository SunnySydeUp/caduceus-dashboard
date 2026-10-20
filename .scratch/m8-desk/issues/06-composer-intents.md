# 06: Composer intents: Ask, Delegate, Repeat

**What to build:** One composer with three intents. **Ask** sends as today. **Delegate** starts the work in the background (`/background` semantics) and notifies when it needs the owner or finishes. **Repeat** opens the schedule builder prefilled with the message and the agent. A hint under the composer says what the chosen intent does.

**Blocked by:** 04

**Status:** resolved

- [x] Delegate uses Hermes's background run, not a Caduceus-side queue; a test shows the run appears in "Working" for that agent and in Work.
- [x] Repeat creates a cron job through the policy proxy at its existing tier, only after the owner confirms the schedule.
- [x] The intent is per message, resets to Ask after sending, and is keyboard reachable.
- [x] Real click tests for each intent at 390 and 1440.

Evidence: `web/test/composer-intent.test.ts` (what each intent does with a draft, hints, reset rule), `web/test/schedule-handoff.test.ts` (the builder's starting draft), `server/test/delegate-hermes.test.ts` (real Hermes: a delegated message is a `bg_` session `is_active` for that profile; Caduceus lists it as a running, background run for that agent and says when it finishes; Steer/Stop say not-running), `web/test/work-desk-model.test.ts`, `web/test/talk-sessions.test.ts`. Real-click smoke at 390 and 1440 (throwaway, deleted): each intent switches with `aria-pressed` and its hint, keyboard Tab+Space works, Delegate shows the run in Side tasks, Talk's header/crew as Working and Work › Running, then Ready for review; Repeat opened the builder prefilled (name, agent, prompt), `GET /api/cron/jobs` was empty until Create schedule was confirmed in the Tier 1 dialog. UI gates (390, 320, 820, 1440) on `/chat/new`: no problems.
Commits: 5bc8252, 85e0a09, and the Talk fix after them.
Deviations:
- Hermes lists a background run nowhere but as its own `bg_` session in the profile's store, so Caduceus now reads those (`is_active`) beside `session.active_list` for Working and Work (`HomeRun.background`), and tells the activity feed when one ends. Home's Steer and Stop are hidden for them.
- Talk no longer opens an agent's `bg_` session as its latest conversation.
- Under Delegate or Repeat, slash commands and attachments are refused with a toast (they stay in the box); Repeat leaves the words in the box, since nothing was sent.

