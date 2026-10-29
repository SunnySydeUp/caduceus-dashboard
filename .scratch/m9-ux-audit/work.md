I walked every flow in your list at 390 and 1440, and spot-checked 820 and 320. Step-up was never triggered, so I have no step-up prompt to report. Every T1 action showed a confirm sheet (a bottom sheet headed "TIER 1 · CONFIRM"). Nothing needed a passkey.

I did not click "Assign…" in the card menu or "Reassign…" in Notices. The assign flow I did walk is "Reassign" on the task page, which worked.

**Test setup.** Tabs in the shared Chromium stalled on `127.0.0.1:9231` with endless "Loading…" because of the per-host connection limit. I ran my own Chrome process from `/tmp/cad-ux/chrome-work`. That is a test-setup effect, not a product bug.

## 1. Flows walked

| Flow | Verdict |
|---|---|
| Work overview groups and agent chips (390/820/1440) | natural, but rows truncate |
| Overview "Decide" → task page | **awkward**: no decision controls |
| Overview pause/resume schedule | natural |
| Board: switch boards, create a board, list/columns, lane tabs | natural |
| Board: move task via menu, block with reason, drag on desktop (with Undo) | natural |
| Board: archive | awkward (no confirm, no Undo) |
| Board: open card, card peek | awkward (no decision controls) |
| Task page: comment, reassign, Runs/Activity tabs | natural |
| Task: request review | not found. No control exists. Review is requested by workers. |
| Review: approve and reject (+ note) on Today | natural |
| Needs-input: answer "Pick a database" on Today | natural |
| Needs-input: answer from Work | **broken**: dead end |
| New task (`/work/tasks/new`) | awkward on phone |
| New task from the home board | natural: lands on the home board, Back returns there |
| Template picker: "Use" → fill brief | natural |
| Tasks list: All / Mine / Waiting for me / Failed filters, saved-filter sheet | natural |
| Tasks list: By playbook | natural: empty-state sheet is clear |
| Schedules: list, builder, create, run now, history | natural, with two bugs below |
| Schedules: edit, pause, resume, delete | natural; delete has Undo |
| Blueprints | natural |
| Playbooks: library, detail, Run, new template, delete confirm | natural |
| Projects: create, detail, Add workspace | awkward: unclear model |
| Notices: Details, snooze 1h (Undo, "Bring back"), dismiss (Undo), Retry confirm | natural |
| Notices: Activity feed | natural, noisy titles |
| Work → Today/Talk links, `?profile=` and `?agent=` | mostly right; one wrong-profile link |

## 2. Findings

| # | Severity | Where | What happens | Why it hurts the user | Suggested fix | Code pointer |
|---|---|---|---|---|---|---|
| 1 | Major | `/work` "Decide" on "Pick a database" or "Review the onboarding copy", 390 and 1440. Also the board card peek's "Open task" and Today's "Open task". | "Decide" opens the task page. It shows only Retry, Reassign, Estimate and the tabs. There is no Answer, Approve or Reject. The only place to decide is Today. | The label promises a decision and the screen can't make it. A blocked task sits there with no hint to go to Today. | Show the shared decision card at the top of the task page when the task needs the owner. Or make "Decide" link to the decision. | `web/src/modules/work/Task.tsx` (actions at ~351); `work-desk-model.ts:93,102` |
| 2 | Major | `/work/schedules/new` and `/edit`, 390. The Back/Next bar is covered by the tab bar. | Mid-form, the sticky bar sits at y 788–832 and the tab bar at 787–844. `elementFromPoint` on "Next" returns the tab-bar link. The first screenshot of step 2 shows Back/Next half-hidden. | The primary action is overlapped and mis-tappable until you scroll to the end. | Offset the bar by `--shell-bottom`, as `.bo-bulk` already does. | `web/src/modules/work/work.css:253` (`.sb__bar` uses `inset-block-end: 0`) |
| 3 | Major | `/work/tasks/new`, 390 | The page is about 7,200 px tall. 12 template cards come first. "Title" sits about 1,400 px down, with Brief and six more sections expanded. | The most common action starts with a very long scroll. | Collapse the template list to a one-line "Start from a template" row. Or put Title and Assign first. Collapse advanced sections. | `web/src/modules/work/BriefEditor.tsx` |
| 4 | Minor | `/work/tasks/new`, 390, first screen | On first paint, clicking "Queue" is blocked: "covered by a.tab". It only works after you scroll and the tab bar hides. | Same overlap as #2. | Same fix. | `BriefEditor.tsx` action bar CSS |
| 5 | Minor | Work → "Review" on a finished schedule run (`/work`, 390) | It opens `/chat/local-…` with the raw cron system prompt, "[IMPORTANT: You are running as a scheduled cron job…", as the first user bubble. The row title is "Audit nightly check · Oct…". | A routine's output reads like a chat that starts with internal text. | Open the run with the prompt collapsed, or link to the schedule's run history. | `work-desk-model.ts:190`, chat session view |
| 6 | Minor | Work → Today: approving a review task | After "Approve", Today lists the same task under "Ready for review" ("Approved by the owner from Caduceus"). | The user reviews the same item twice. | Mark an approved or rejected task as opened. | `web/src/modules/work/work-review.ts` |
| 7 | Minor | Board "Move to… → Blocked", then Work overview | The typed reason ("Waiting on design") does not show on the card (the blocked card has no reason line, 1440). Overview shows "Blocked, and waiting for you" and lists the task in "Waiting on you" with "Decide". | The user's own block is shown as needing them, with their reason missing. | Use the block reason as the row and card line. Put a user-typed block in Scheduled, not Waiting. | `Board.tsx:77,117`; `work-desk-model.ts:99-103` |
| 8 | Minor | Work overview at 820: "Draft the release notes" under Running | The line reads "Waiting on design", the old block reason, while the task is Running. | A stale reason looks like a live status. | Use `summary` only for review or blocked states. | `work-desk-model.ts:106` |
| 9 | Minor | `/work` rows, 390 and 320 | Titles and lines truncate to one line. "Review the onb…", "Started 2 min a…". At 320 the time is not visible at all. The "when" is the sort key. | The user can't tell how old a waiting item is. | Allow two lines, or show the time as its own right-hand element. | `web/src/modules/work/work-desk.css` (`.wd-when-inline`) |
| 10 | Minor | Board → Move to… → Archive, 390 | It archives at once. The toast says "Hermes cannot put this back." and offers no Undo. Other moves have Undo. | A one-tap irreversible action with no confirm. | Add a T1 confirm, as Delete schedule has. | `CardSheets.tsx` / `board-ops` |
| 11 | Minor | Schedule page, "Run now" and "Pause" | After the confirm sheet, all buttons grey out for about 8 s (the trigger call took 8.4 s) with no spinner or toast. State changes on a later refetch. Hermes was slow under shared load. | It looks frozen. | Show a busy label ("Running…") on the clicked button and a toast on start. | `web/src/modules/work/Schedule.tsx` |
| 12 | Minor | Every T1 action: queue task, create/pause/resume/run schedule | A review step or button is followed by a second confirm sheet with the same label. "Create schedule" on the Review step, then "Create schedule" in the sheet. | Two taps for reversible actions like Pause. | Skip the sheet when the user already pressed an explicit Create or Save on a review step. | policy map, `schedules-actions.ts` |
| 13 | Minor | `/work/projects`, 390 | The page shows Projects, "Found by Hermes" and Workspaces, which all ask for a folder. There is no way to link a workspace to a project. Copy says "Rename and Make active are offered for the profile in use, default" while scope reads "All profiles". | The user can't tell a project from a workspace or how they connect. | Say in one line what each is for. Show the profile in use on the page. Offer "Add as workspace" on a project. | `Projects.tsx`, `projects-help.ts` |
| 14 | Minor | Notices "Kanban tasks have problems" (390, 1440) | Details has only "Open Board", and the text says "Open the stalled tasks". It goes to the plain board. | The user still has to hunt for the tasks. | Link to Tasks filtered to failed (`/work/tasks?filter=failed`). | `server/src/inbox*.ts`, notice link |
| 15 | Minor | Failed workers appear in Notices (with "Retry…"), in Work "Waiting on you" (with "Decide") and in the crew line. | The same failure is shown in three places with different verbs. The raw text, "worker exited cleanly (rc=0) without kanban_complete…", is protocol jargon. | Which one is the place to act? | Use one verb ("Retry") and a short human line. | `work-desk-model.ts:103`; notice builder |
| 16 | Polish | Touch targets, 390 | Most controls are 36 px tall. Examples: "Decide" 61×36, Pause icon 36×36, overview row titles 32 px, Tasks row links 24 px, Schedules row links 18 px, "1 item needs a decision" 16 px. The task tabs and the move buttons are 44 px. | Below 44 px, and inconsistent with the tab bar. | Raise `--cd-control-h` to the target minimum on touch. Pad the row links. | `work.css`, `work-desk.css` |
| 17 | Polish | Notices intro, 390 and 320 | The explainer paragraph is 6–8 lines. The first notice is below the fold at 390. | The first notice starts below the fold. | Move the text into the help panel. | `Notices.tsx` header |
| 18 | Polish | Notices "Snooze until" in the ⋮ sheet, 390 | The `dd/mm/yyyy, --:--` input is narrow. The Snooze button is grey next to it. | Fiddly. | Put the picker on its own row. | `Notices.tsx` `ItemMenu` |
| 19 | Polish | Notices → Activity | Eight of ten rows are "Stub conversation #2" (kanban worker sessions). | They can't be told apart. | Label them with the task title. | notices feed titles |
| 20 | Polish | Board at 1440 | Eight lanes at 248 px each. Done and Review are off the right edge until you scroll sideways. | The user may not see the Review lane. | Collapse empty lanes. | `work.css:25` |

## 3. What works well

- **Work overview grouping**: the counts line, the group order, and the agent chips with `?agent=` state kept on Back.
- **Board phone list** opens on the lane that needs you. The card menu (Move to…, Assign…, Priority…) is a clear alternative to drag.
- **Desktop drag** shows a drop outline and a "Moved … to Ready" toast with Undo.
- **Today decisions**: Answer, Approve and Reject + note use small sheets. Reject needs a note. Approve and answer land in the right state.
- **New task validation** scrolls to the Title field and says "Give the task a title." Templates ("Use" → questions → "Fill in the brief") say that nothing was sent to Hermes.
- **Schedule builder**: the four-step bar, the "Next three runs" preview, and plain-language review text. Delete has Undo.
- **Notices**: snooze and dismiss have Undo. "Snoozed on this device" with "Bring back" works. The Activity links open the right chat with `?profile=`.
- **Overview "Pause/Resume"** gives the confirm sheet and a "Resumed" toast. The "Open task" links keep `?board=` and the Back link goes to the right board.
- **No console errors** and no failed requests, apart from aborted presence POSTs when navigating away. No horizontal overflow at 320, 390 or 820.

## What's next

1. Fix #1 first (decision controls on the task page). It is the one real dead end between Work and Today.
2. Fix #2 and #4 together: apply the `--shell-bottom` offset to `.sb__bar` and the New-task action bar.
3. Decide whether T1 confirms should still follow an explicit Create/Save button (#12). It touches the policy map, so it needs a product decision.