## Control › Workspace, Observe, System, Settings, onboarding: UX audit

Screenshots are in `/tmp/cad-ux/shots/wssys/`. I checked every module at 390 and 1440 and spot-checked 820. I did not test 320. I did not edit any repo file.

Side effects on the shared server:
- I made a temp folder `ux-ws` and registered it as a workspace. It lives under `…/caduceus-home-smoke-0J38Ik/` (the fake home), with `ux-out` beside it.
- I created three artifacts from session `seed_rich`.
- I committed once in `ux-ws`.
- I ran Doctor.
- I switched the theme to Light and Large, then back to System and Default.

Other auditors may see these.

### 1. Flows walked

| Flow | Verdict |
|---|---|
| Files: browse, breadcrumbs, row ⋮ sheet | natural |
| Files: preview text, image and binary | natural |
| Files: edit and save (T1 confirm) | awkward, see #6 |
| Files: upload, new folder, rename | natural (rename refuses a taken name inline) |
| Files: move (picker) | natural |
| Files: delete inside a workspace (T1) | natural |
| Files: delete outside a workspace (T3, typed full path) | natural, but heavy |
| Files: add workspace (T1) | natural |
| Files: open an unregistered folder or `.env` path | awkward, see #1 and #2 |
| Files: open a path that does not exist | awkward, see #2 |
| Git: status, diff, stage, commit, branches, worktrees | natural |
| Git: Push… | awkward, no remote in the seeded repo (see #11) |
| Git: Discard changes | natural, wording is proportionate |
| Checkpoints | natural (empty state only) |
| Terminal on 390 | awkward, see #7 |
| Terminal step-up | awkward, see #7 |
| Artifacts: list, view, pin, delete sheet | natural |
| Artifacts: share | not reachable here (see #14) |
| Insights: range, charts, tables, budgets, budget guard | natural |
| Logs: filters, search, pause/resume, tail | natural |
| Logs: Truncate (T3 typed) | natural |
| Health | awkward, see #4 |
| Config: Form view and edit | awkward, see #9 |
| Config: YAML | broken, see #3 |
| Keys: add key, step-up | natural |
| Keys: reveal | not testable here, because there are 0 keys set |
| Plugins: installed, install sheet, catalogue | natural |
| Maintenance: updates, diagnostics, Doctor | awkward, see #10 |
| Maintenance: backup and restore sheets, prune | natural |
| Maintenance: console, API reference | natural |
| Settings: index, Appearance, Chat, Voice, Keyboard, Install | natural |
| Settings: Notifications | awkward, see #8 |
| Settings: Security, Audit log | awkward, see #5 and #12 |
| Onboarding: all four steps | natural |

### 2. Findings

Ordered by severity.

| # | Severity | Where | What happens | Why it hurts | Suggested fix | Code pointer |
|---|---|---|---|---|---|---|
| 1 | Major | `/workspace/files` (390, 1440) | The first screen lists the whole real home folder, dotfiles included. It says "This folder is not in a workspace… Add it as a workspace". But registering the home folder is refused, so the offer is a dead end. | A first-time user sees `.ssh` and `.zsh_history` next to a call to action that cannot work. | Hide dotfiles by default, with a "Show hidden" toggle. Show the "Add as workspace" button only when the guard would accept the folder. `/etc` is refused with a good inline message, but the home folder gets none. | `web/src/modules/files/Files.tsx`, `server/src/workspaces.ts`, `server/src/file-guard.ts` |
| 2 | Major | `/workspace/files/<path>` (390) | A folder outside the roots shows only "This path is outside the folders Caduceus lets Hermes write to." with "Back to the top". A `.env` path and a missing file both show "There is nothing at this address". | The first message says "write" for a read-only browse. The `.env` case hides that the file is protected on purpose. The API does return `protected-path` with a clear message. Users cannot tell "protected" from "missing". | Use the server `message` for browse refusals, with a "Back to the folder" link. Say "protected" for `.env` instead of "nothing here". | `web/src/modules/files/files-data.ts` (`openPath`, `reasonOf`) |
| 3 | Major | `/system/config/yaml` (390, 1440) | The YAML screen opens with "1 problem. Saving is blocked… Line 1: model is a single setting, not a section." The text is untouched ("No changes"). | The config file Hermes wrote is flagged as invalid before the user types anything, so the editor looks broken. The profile's `model:` is a section but the form schema treats it as one setting. The checker should not flag Hermes's own file. | Skip checks until the text is edited, or fix `kindProblem` for sections Hermes writes as maps. | `web/src/modules/config/config-yaml.ts:42` |
| 4 | Major | `/observe/health` (390) | The page shows "Checking…" for about 10 seconds, with a disabled "Checking…" button and no result. Two "Checking…" labels appear together. On first load the summary line is missing. | The screen looks hung, and the user cannot tell whether it is stuck. | Show the last cached result at once. Add per-subsystem skeletons. Show elapsed time or a timeout message. | `web/src/modules/health/Health.tsx`, `server/src/health.ts` |
| 5 | Major | `/system/security` (390) | The page has no passkey, so "Change password", "Turn off password sign-in" and "Turn on read-only mode" are disabled. Hints say "Add a passkey first" in small text under each. | A user who just finished onboarding still has no passkey. The dead buttons have little explanation, and the passkey form is far above them. | Add a link from each hint that scrolls to the "Add a passkey" form. | `web/src/modules/settings/Security.tsx`, `SignInMethods.tsx` |
| 6 | Minor | `/workspace/files/<file>` (390, editor) | After "Save…" and "Save", the footer shows "No changes" and the file is saved. But a "Leave without saving?" panel may still appear. The "Back to the folder" button also stays disabled. | The user thinks the save failed. The code comment says this was fixed. I saw the stale prompt once, with the toast hidden by the dialog. | Confirm the toast is visible after save. Clear the blocker as soon as the save succeeds. | `web/src/modules/files/FilePreview.tsx` (lines 58-98) |
| 7 | Minor | `/workspace/terminal` (390) | The screen says the terminal is not designed for small screens. "Open anyway" opens a passkey prompt. After Cancel it says "Not connected" and "Opening the terminal needs your passkey." Both "Reconnect" and "Restart…" stay active. | On a phone it is a dead end with extra steps, and Restart is meaningless without a connection. | Disable Restart while not connected. Skip the "open anyway" gate on tablets. | `web/src/modules/terminal/Terminal.tsx` |
| 8 | Minor | `/settings/notifications` (390) | The page shows one blocked card and two cards that say "turn them on above first". There is nothing to turn on, because the browser blocks notifications and Caduceus cannot change that. | Three cards for one blocked state, with no next step. | Collapse into one blocked card. Show the site-settings steps for the browser, and add a "Check again" button. | `web/src/modules/settings/Notifications.tsx` |
| 9 | Minor | `/system/config/general` (390) | One "General" section is a 27-field page with 906 settings in total. A sticky bar shows "1 unsaved change: Review, Discard, Save…". There is no confirmation for Discard. | The bar covers the tab bar's area and the last field. Discard undoes work with no undo. | Add a toast with Undo for Discard. | `web/src/modules/config/Config.tsx` |
| 10 | Minor | `/system/maintenance/diagnostics` (390) | After "Run doctor" the sheet shows the full output. It ends with a red "Hermes ended with an error (exit code 1)". The doctor reports found issues this way, so an install with issues looks like a crash. | A normal result reads as a failure. | Show "Found 6 issues" with a warning tone when the output says so. | `web/src/modules/maintenance/Diagnostics.tsx` |
| 11 | Minor | `/workspace/git` (1440) | The workspace picker lists a second entry "Audit project · caduceus-ux-work-5oWCb8" that does not exist at the start. The status line "In step with its remote" shows even when there is no remote. | Misleading: a repo with no remote is not "in step". | Say "No remote" when none is set. Disable Push… with an explanation. | `web/src/modules/git/Git.tsx:425` |
| 12 | Minor | `/settings/security`, `/settings/audit`, `/settings/repairs` | The Settings index links go to `/system/security` and `/system/security/audit`. The tidy paths `/settings/security`, `/settings/audit` and `/settings/repairs` give "Page not found". | Deep links typed or shared from Settings fail. The breadcrumb says Settings, but the URL says System. | Add redirects, or use one scheme. | `web/src/modules/settings/index.ts`, `settings-search.ts` |
| 13 | Minor | `/workspace/files` (390) | The row ⋮ buttons are 36 px, below the 44 px target. Sub-44 px targets also appear in the breadcrumbs (24 px) and the Stage buttons (54×36). | Hard to tap on a phone. | Raise to 44 px at coarse pointer. | `web/src/modules/files/files.css`, `git.css` |
| 14 | Minor | `/workspace/artifacts` (390) | There is no Share action on an artifact (Download, Pin, Delete only). Sharing exists only for sessions, in Chat. The module list did not offer one, so I could not test it. | The brief lists "artifacts view/share"; users may expect a share link. | Say so in the help text, or add an "Open the chat" link. | `web/src/modules/artifacts/`, `web/src/modules/shares/ShareSheet.tsx` |
| 15 | Polish | `/workspace/files` (390) | The PageHeader description says "The managed root and what is in it." The jargon terms "managed root", "protected area" and "guarded file operations" are dotted-underline glossary links. | New users do not know these terms. | Use plain words first: "Your files. Some folders are protected." | `web/src/modules/files/Files.tsx` |
| 16 | Polish | Insights (390) | The "Loading usage from Hermes…" line stays for about 4 seconds above empty cards. Two profile requests returned 503 on the first load and were retried. | A flash of empty state, then numbers. | Show skeleton cards. | `web/src/modules/insights/Insights.tsx` |
| 17 | Polish | any page (console) | `POST /_caduceus/api/presence` shows `net::ERR_ABORTED` every 30 s in the console log. It is likely a tab-freeze artefact [INFERENCE]. | Noise in the console. | Ignore, or use `sendBeacon`/keepalive. | `web/src/shell/` |

### 3. What works well

- **Row ⋮ sheets, confirm sheets and the tier chip.** The chip says what a change costs ("TIER 1 · CONFIRM", "TIER 3 · STEP-UP + TYPE TO CONFIRM"). The sheet explains the effect, and the delete-outside-a-workspace case asks for the full path. Confirmations match the risk.
- **Step-up prompts.** The passkey prompt says what it covers: the next 5 minutes on this device.
- **Rename and new-folder checks.** They say a name that is taken is never overwritten, and they reject `a/b` inline.
- **Files and Git on a phone.** They work, with no horizontal overflow at 390, 820 or 1440.
- **Logs.** Search with an empty state, Filters with a count, Pause/Resume and the live tail all work. The "Truncate file" action is separated and red.
- **Config.** `@modified`, `@restart-required` and the Restart badges help. The sticky unsaved bar is good. The YAML hand-off ("Continue on a larger screen", "Copy link") is a clear idea.
- **Keys.** Add key has a picker with search, a field check and "Check before saving". The passkey requirement is stated before you start.
- **Onboarding.** Four steps, a resume point, "Skip setup", and every check says how to fix it. Invalid workspace paths show a clear inline error.
- **Appearance.** Theme switches live. Light and Large cause no overflow.
- **API reference.** It lists every tier and is searchable.

## What's next

1. Fix #3 (the false YAML error) and #1/#2 (Files home listing and refusal messages). They are the most visible to a first-time user.
2. Decide on #4 (Health skeleton) and #12 (the `/settings/*` redirects). Both are small changes.
3. If wanted, ask me to re-walk Keys › Reveal on a profile that has a key set, and to check width 320.