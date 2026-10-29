# UX audit — every flow, 2026-10-29

Hands-on walk of every screen and control at 390, 820 and 1440 (320 spot checks). It ran against a throwaway, seeded server (`ux-server.ts`: real `hermes serve` on a temp `HERMES_HOME`, stub model, 3 profiles, sessions, Kanban tasks, schedules). The owner's data and `web/dist` were not touched. Full per-area findings: `today-shell.md`, `talk.md`, `work.md`, `agents-connect.md`, `workspace-system.md`.

Verified by hand (reproduced or confirmed in code): P1, P2, P3, P5 and P6 below.

## Fix first (broken or losing data)
| # | Finding | Where | Pointer |
|---|---|---|---|
| P1 | **Edits lost.** In the SOUL/MEMORY/USER/AGENTS editor, Save… → Cancel on the confirm opens "Leave without saving?", and **Keep editing** closes the editor and throws the text away. Reproduced. | Profile › Identity/Memory/Instructions | `profiles/FileEditor.tsx` (blocker / `onClose`) |
| P2 | **Primary button under the tab bar.** Schedule builder: tapping **Next** at 390 hits the tab bar's **More** link and leaves the form. New task's **Queue** does the same on first paint. Reproduced. | `/work/schedules/new`, `/work/tasks/new` | `work/work.css:253` `.sb__bar` (needs `--shell-bottom` offset like `.bo-bulk`) |
| P3 | **YAML editor says Hermes's own config is invalid.** "Line 1: model is a single setting, not a section". Saving is blocked before any edit. Confirmed in code. | `/system/config/yaml` | `config/config-yaml.ts:42` |
| P4 | **Fork from here** fails on sessions with a stopped turn or a denied command, and leaves a stray session behind each time. | Talk | `chat/MessageActions.tsx`, `chat-session.ts` |
| P5 | **"<" goes nowhere in Talk.** On a phone, "<" in a thread goes to `/chat`, which redirects back to the same thread. Elsewhere "<" goes up the tree, not back: Today → Open task → "<" lands on the Board, not Today. Confirmed in code. | Shell, phone | `shell/AppBar.tsx:44` `backTarget` |
| P6 | **"Decide" has no decision.** Work's Decide and every Open task link land on the task page, which has no Answer, Approve or Reject. Decisions are possible only on Today. | `/work` → task | `work/Task.tsx`, `work-desk-model.ts:93` |

## Flows that feel unnatural
- **Answering takes too many steps, with no context.** Answer… → type → Answer → confirm again. The sheets do not show the question or the task title (Today #3).
- **Global search is not global.** The palette on Today searches only the remembered profile, and never tasks or decisions (Today #4). Control search for "telegram" finds nothing (Agents #4).
- **Confirm fatigue.** An explicit Create/Save button is followed by a second sheet with the same label (Work #12). Saving SOUL.md is T3 (passkey + typed name), while the same sheet says "This can be undone" in a red banner (Agents #8). Installing an official skill asks you to type a 30-character name on a phone.
- **Passkey dead ends.** With no passkey, T2/T3 actions fail at the last step. "Add one in Security" is plain text, not a link (Today #12, Agents #6, Workspace #5).
- **Talk deep links.** A session link without `?profile=` flashes "session not found" under the wrong agent. An unknown id looks like a hang for about 14 s (Talk #3, #4). Back/forward adds an entry for each automatic redirect (Talk #5).
- **Hidden phone actions.** The session row ⋮ is invisible on touch: pin, archive and share are reachable only by long-press (Talk #7).
- **Duplicate surfaces with different verbs.** A failed worker shows in Notices (Retry), Work (Decide) and the crew line, with protocol text such as "rc=0 without kanban_complete" (Work #15). An approved review comes back in Ready for review (Today #14, Work #6).
- **Opening screen noise.** The Reminders error is a permanent red card with Mac-terminal text cut mid-sentence. The Hermes update banner arrives late and pushes Needs you down. Install and Set up stack at the bottom, so setup is below the fold (Today #7, #8, #11).
- **Channels.** 32 platforms listed A–Z, so Telegram, Discord and Slack are 5–8 screens down. The Enable switch is disabled with a tooltip-only reason, and the Test message tells you to enable it (Agents #4, #5).
- **Gateway vs Migrate** use "one gateway for every profile" with opposite meanings (Agents #3).
- **Files home** lists dotfiles (`.ssh`, `.zsh_history`) and offers "Add as workspace", which the guard then refuses. A protected `.env` reads "There is nothing at this address" (Workspace #1, #2).

## Sweeps (one change, many screens)
- Touch targets under 44 px: switches, segmented filters, `--cd-control-h` buttons (36 px), row ⋮, composer Send halves, message actions.
- Tier jargon ("TIER 3 · STEP-UP + TYPE TO CONFIRM") in user copy. Replace it with "Needs your passkey".
- Long "Loading…" with no skeleton and no "taking longer · Retry" state: Health, Gateway, Tool gateway, Insights, session search.
- A toast covers the app bar or the palette input on phone.
- Profile file editors: an 80 px textarea with `white-space: pre` for prose (`profiles.css:98` loses to `textarea.input`).

## Not reproduced / caveats
- Talk #2 (Repeat duplicates the prompt in the schedule builder) happened once in two tries. It may be an automation typing race. Re-check by hand.
- Slow loads were partly caused by five auditors sharing one Hermes (load 6–12).
- Shared headless Chromium stalls at 6 connections per host with SSE/WS. Use a separate Chrome process for smoke runs.
