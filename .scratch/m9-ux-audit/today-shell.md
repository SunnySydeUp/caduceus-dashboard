# Audit: Today (`/today`) and the shell

Screenshots are in `/tmp/cad-ux/shots/today-shell/`. Widths checked: 320, 390, 599/600, 820, 1024, 1199/1200 and 1440. There was no horizontal overflow at any width.

**Test-environment notes**
- The shared Chromium stalled on `127.0.0.1:9231`, so I used my own Chrome process. A second Chrome profile with no cookie was used to see sign-in.
- Under load, `/api/today/ready` took 7.5 s. Today then sat on "Loading…" for 8 s or more with no timeout message. I think this is contention from other auditors [INFERENCE].
- Siblings changed the seeded data while I worked: the research task was approved and a task was given up. The tasks and some crew states in my screenshots differ for that reason.

## 1. Flows walked

| Flow | Verdict |
|---|---|
| Today first paint and blocks, 320–1440 (Needs you, Ready, Crew, schedule, away, Reminders) | natural, apart from the findings below |
| Answer… (type → Answer → confirm) | awkward: three steps, no question text, no preview |
| Approve… (T1 dialog, cancelled) and Reject + note… (sheet only, not submitted) | natural, but the Reject sheet has no task context |
| Approve… on a Telegram pairing card (T2, cancelled) | natural and well explained |
| Open task, then the app-bar "<" | broken: "<" goes up, not back |
| Review on a Ready row | natural: the row clears and you return to Today |
| Give the crew work / Schedule a routine / See the schedule | awkward: they land on lists, not on the create action |
| Crew tile → Talk, then "<" | broken: no-op loop |
| Install and "Not now" | awkward: silent, no hint of where Install lives later |
| Set up Caduceus: Start setup and "Not now" | awkward: "<" from `/onboarding` lands on Settings |
| Reminders block and Retry | awkward: permanent red error, no feedback on Retry |
| Tab bar (<600), rail and drawer (600–1199), sidebar and collapse (≥1200) | natural, with Polish items |
| Profile chip (static on Today; switcher on Work/Talk/More) | awkward on Today; natural elsewhere |
| Search and palette (button, ⌘K; Ctrl+K does nothing on Mac, as designed) | natural UI; scope is hidden |
| Help panel, glossary popover, Shortcuts tab | natural, but very long |
| G-then-letter shortcuts (G H, G C, G W, G B, G ,) | natural |
| More (`/control`) at 390, 820 and 1440 | natural at 390; thin at 1440 |
| Toasts | natural, except one overlap |
| Banners: offline, Hermes update, Reconnecting | natural; update banner has a layout-shift problem |
| Redirects `/`, `/home`, `/inbox` → `/today` | natural |
| 404 pages | natural, with one wrong highlight |
| Sign-in (wrong password, empty field, Show, Help signing in, 320/390/1440, `next=` deep link) | natural |
| Step-up prompt with no passkey (palette → Restart gateway → Confirm) | natural, one dead end |
| Sign-out (UI only, not clicked) | awkward: buried |

**Not clicked, and why**
- Native Install prompt: headless Chrome has no visible dialog, so I only saw that the card stays.
- iOS "Add to Home Screen" guide: it needs a "meaningful action" first.
- Command Allow/Deny cards: no approval was seeded.
- Sign-out, Approve/Reject submit, and step-up completion: they would affect the shared session, or I cannot do a passkey.
- "Open Pairing": the pairing cards were resolved by a sibling before I could click it.

## 2. Findings

| # | Severity | Where | What happens | Why it hurts the user | Suggested fix | Code pointer |
|---|---|---|---|---|---|---|
| 1 | Major | `/chat/<id>`, 390 | After tapping a crew tile on Today, the app-bar "<" goes to `/chat?profile=research`, which redirects straight back to the same thread. It adds a history entry and leaves you on the same screen. Browser Back works. | The control that should take you back does nothing. | Use history-back when the user arrived from another screen. On a Talk thread, make "<" go to the previous page or Today. | `web/src/shell/AppBar.tsx` (`backTarget`, ~L44–56) |
| 2 | Major | Today → Open task / Start setup / Review → "<", 390 | "<" goes up the tree: the task page → `/work/board`, `/onboarding` → `/settings`. Neither is where you came from. | "<" reads as "back" on a phone. After a Needs-you action you lose your place on Today. | Prefer history-back for entries from Today, or fall back to "up" only on a direct load. | `web/src/shell/AppBar.tsx` |
| 3 | Major | Today → Answer…, 390 | Answering takes three steps: tap Answer…, type, tap Answer in the sheet, then confirm again in a T1 dialog. The dialog has a second grab handle. It does not repeat the typed text. The answer sheet, and the Reject + note sheet, do not show the question or task title. The Approve dialog also has no card context. | Answering your own agent is low risk, but it costs two taps. Nothing on screen reminds the user what they are answering. | Show the question as a quote in the sheet. Make the first submit the confirmation, or show the typed answer in the confirm step. Include the task title in the Reject sheet. | `web/src/modules/inbox/InboxDecision.tsx`, `web/src/modules/today/DecisionCard.tsx`, `web/src/shell/TierDialog.tsx` |
| 4 | Major | Palette on Today ("All profiles"), 390 and 1440 | Sessions are searched only in the remembered profile, which the chip does not show on Today. From Today with `research` remembered, "quarterly" and "flaky" return "No match". After switching to `default`, they are found. Task titles (e.g. "Pick a database") and decision text are never found. | Search on the all-profiles screen silently misses most work. It looks like a global search but is not. | On Today and other all-profile screens, search every profile. Show the scope in the palette footer. Index tasks and decisions. | `web/src/shell/Palette.tsx` (`.palette__scope`) |
| 5 | Major | Today → tap profile chip, 390 | On Today the chip is a static `span`. Tapping it does nothing, and it looks like the tappable chip on other screens. `?profile=research` is ignored. Today has no chevron and no hint on touch. Only a mouse hover shows the title text. | A user trying to filter Today to one profile finds a dead control. The help text explains it, but the screen does not. | Make the chip open the sheet with a note ("Today always shows every profile"), or visibly dim it and show a hint. | `web/src/shell/ProfileSwitcher.tsx` (`ProfileChip`, mode `all`) |
| 6 | Minor | Today, 390–1440 | A seeded "gave up" task for `default` and one for `research` show only as a red dashed sigil and a tile line ("Gave up: Book the plumber"). Nothing on Today lists them, and the tile opens Talk, not the task. More and Control show no count for Notices (4) or Repairs (2). Only Today has a badge. | Failures are easy to miss. The user sees a red ring but must find Notices through More to learn what failed. | Show a failed count on the More tab and the Notices row, or add a "Needs a look" row on Today. Link the tile to the task. | `web/src/modules/today/TodayBlocks.tsx` (`CrewBlock`), `web/src/modules/notices/index.ts` (no `badge`) |
| 7 | Minor | Today, 390 | The "Hermes update" banner (~135 px) arrives after load and pushes Needs you down. I saw it on Today and on Work/Talk. It says "A Hermes update is available. Version X is installed." Its "View update" opens the update page, which shows the same banner again. The update page also stays on "Checking…". | A late layout shift can cause mis-taps on the decision buttons. The banner text does not say what the newer version is. | Place quiet banners below Needs you, or reserve space. Hide the banner on the page it links to. Say "Update available: current X". | `web/src/shell/update-banners.ts`, `web/src/update-banners.ts` (`updateBanner`) |
| 8 | Minor | Today, 390 | The "Reminders could not be loaded" block is permanent red with no dismiss. Its text is cut mid-sentence ("run `osascript -") by a 200-character slice. It is Mac-terminal jargon shown on a phone. Retry gives no visible feedback. | An optional feature fills the opening screen with an error the phone user cannot fix. | Collapse it to one line with a "Details" link, and let the user hide it. Do not slice mid-word. Show a spinner on Retry. | `server/src/reminders.ts` (L83), `web/src/modules/today/RemindersBlock.tsx` |
| 9 | Minor | Today → Give the crew work / Schedule a routine, 390 | They land on `/work/board` or `/work/schedules`, not on New task or New schedule. The board opens with a large "Dispatcher: Stopped" panel first. The empty schedule block says "No routines run today. A routine you schedule shows here" while three schedules exist (next in 13 h, 23 h, 3 d). | The label promises an action. The user needs another tap and sees nothing about the routines they already have. | Link to `/work/tasks/new` and the new-schedule route. Show "Next: Morning briefing in 13 h" in the empty state. | `web/src/modules/today/today-model.ts` (`EMPTY`) |
| 10 | Minor | Palette on phone, 390 | A toast (e.g. "Finished: Stub conversation #2") shows over the search input and close button. Toasts move to the top while an overlay is open. | The field you are typing in is covered. | Keep toasts at the bottom under palettes, or hide them while a full-screen palette is open. | `web/src/styles/shell.css` (L352) |
| 11 | Minor | Today → Install → "Not now", 390 | "Not now" removes the card for good with no toast. It does not say that Settings › Install app keeps the button. After it goes, a ~170 px empty gap remains above the setup card. The Install card also shows while offline. | "Not now" reads as "later", but the card never returns. The gap looks like a rendering bug. | Add a toast ("Install is in Settings"). Collapse the reserved space once dismissed. | `web/src/modules/today/InstallCard.tsx`, `web/src/shell/install.ts` |
| 12 | Minor | Palette → Restart gateway → Confirm with no passkey, 390 | The error says "Add one in Security first" but "Security" is plain text. Confirm stays active, so you can fail again. | It is a dead end: close the sheet, then find Security yourself. | Make "Security" a link and disable Confirm, or replace it with an "Add a passkey" button. | `web/src/shell/StepUpDialog.tsx` |
| 13 | Minor | Sign-out, 390 | Sign out is More → Settings → Security → scroll to "Signed-in devices" → Sign out. It is not in the palette, More, or the app bar. A search in More for "sign out" or "help" finds nothing. | A security action is hard to find on a shared phone. | Add "Sign out" to the palette and to More. | `web/src/modules/settings/Security.tsx`, `web/src/shell/Control.tsx` |
| 14 | Minor | Ready for review, 390–1440 | A task you approved yourself ("Approved by the owner from Caduceus.") reappears in "Ready for review" with a Review button. | It looks as if the decision was not recorded. | Do not list your own approvals, or label them "Done". | `web/src/modules/today/today-model.ts` (`readyRows`) |
| 15 | Polish | Pairing card on Today, 390 | A Telegram pairing card offers only Approve…, not Decline. The T2 dialog reads "Changes Alex Stranger". | An unwanted stranger stays in "3 need you" until you use Pairing. | Add Decline. Reword "Changes". | `web/src/modules/inbox/InboxDecision.tsx` |
| 16 | Polish | Confirm dialogs, 390 | The dialogs show "TIER 1 · CONFIRM" and "TIER 2 · PASSKEY STEP-UP" as a heading. | Tier jargon reaches a user who only needs "Confirm" or "Passkey needed". | Hide the tier label behind "Details". | `web/src/shell/TierDialog.tsx` |
| 17 | Polish | Palette, all widths | An empty palette opens with Work actions first (New chat, Saved prompts, Open board…); Today, Talk and Control come far below. Phone rows show keyboard hints (⇧⌘O). Fuzzy matching is loose: "Hello" returns "Shell hooks", "log out" returns "Maintenance sweep". The shortcuts pane and the palette say "Chat" and "Overview" where the product says Talk and Work. | Noisy results and mixed names. | Show the primary destinations first. Tighten matching. Use Talk and Work. | `web/src/shell/Palette.tsx`, `web/src/shell/ShortcutsPane.tsx` |
| 18 | Polish | `/control`, 1440 | The list is a ~560 px column on the left with two thirds of the screen empty. Descriptions on a phone are cut to one line. | Wasted space; hard to scan. | Use a two-column grid ≥1200. Allow two lines on a phone. | `web/src/shell/Control.tsx` |
| 19 | Polish | Today, 820–1440 | The app bar shows "Today" and the page heading says "Today" again. The "1 needs you" pill repeats the sidebar badge, far from the Needs you heading. | Duplicate labels. | Hide the app-bar title when the page heading is visible. | `web/src/shell/AppBar.tsx`, `web/src/modules/today/Today.tsx` |
| 20 | Polish | Help, 390 and 1440 | The Today help is ~4000 px (about 5 screens). The glossary popover's "More" shows the same text again. The Shortcuts tab shows on touch devices. | Heavy for a quick answer. | Collapse sections. Make "More" link to the glossary entry. Hide Shortcuts on touch. | `web/src/modules/today/help.ts`, `web/src/shell/HelpPanel.tsx`, `web/src/shell/Term.tsx` |
| 21 | Polish | Toast after Answer, 390 | The toast says only "Answer: sent". It has no Undo and no word on what happens next. | The user is not told that the task went back to work. | "Sent to default. The task is back in work." | `web/src/modules/inbox/inbox-actions.ts` |
| 22 | Polish | `/nope`, 390 | The tab bar highlights More on the 404 page. The button says "Go home" but goes to Today. "No Caduceus route matches this address." is developer wording. | Wrong tab shown; slightly technical. | Show no active tab. Say "Go to Today". | `web/src/shell/NotFound.tsx` |
| 23 | Polish | `/chat/bad-id`, 390 | The page shows the raw lowercase "session not found" under all agents. | Unfriendly error. | "That conversation no longer exists." with a link to the latest one. | `web/src/modules/chat/` (Talk) |
| 24 | Polish | Sign-in, 320–1440 | The red "Passkeys only work at the address Caduceus is set up for" shows on load, before any action, while the passkey button stays enabled. It comes from the failed autofill check at an address that does not match the passkey [INFERENCE]. | A red error before the user does anything is alarming. | Show it only after a passkey attempt, or as a neutral note. | `web/src/SignIn.tsx` (L84–96) |
| 25 | Polish | Reconnecting banner, 390 | The app-bar status dot shows an orange count ("4", "7") with no label. | The number reads as unread count. | Show "Retry 4" or just the dot. | `web/src/shell/AppBar.tsx` (status) |

## 3. What works well (leave as is)

- Today opens with the right order: Needs you, Ready, Crew, schedule, away, Reminders. Each block loads and fails on its own.
- Decision cards use plain verbs. Approve… and Answer… show the right sheet and dialog. Empty required text keeps the primary button disabled.
- Needs-you cards clear live after an answer. The empty state then reads clearly.
- The 600/1200 breakpoints, the two-column Today at ≥1200 and the rail with its drawer all behave. Touch targets measured ≥44 px at 390.
- Review on a Ready row clears the row and returns you to Today.
- The tab bar hides on scroll down and returns on scroll up. The Today badge is accurate.
- Keyboard use works: ⌘K, `?` and the G sequences. Focus rings are visible, and there is a skip link.
- The offline banner is clear, and Answer is disabled.
- The T2 step-up dialog explains what a passkey covers and for how long.
- Sign-in: clear errors, focus stays in the field, the `next=` deep link keeps the profile, Help signing in is good, and there is no overflow at 320.
- `/`, `/home` and `/inbox` redirect to `/today`. The 404 page has two clear exits.
- Console and network were clean apart from the Reminders 503 and aborted presence beacons.

## What's next

1. Fix #1 and #2 first, in `AppBar.tsx`. Use history-back for entries from Today and for Talk threads.
2. Decide the Answer flow (#3) and the hidden palette scope (#4). Both affect every first-time user.
3. Review the chip and Reminders (#5, #8) together. Both make a quiet opening screen look broken.