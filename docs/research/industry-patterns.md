# Industry Patterns: what "industry-leading" means for Caduceus Dashboard

Research date: 2026-10-06. This benchmarks leading agent, chat, dev-tool and self-hosted products against the ten pattern families an AI-agent control dashboard needs, with a phone-first lens. It ends with a **ranked list of 25 requirements** (§12).

**Method and evidence rules**
- Primary sources only: official docs, changelogs, product blogs, the W3C, Apple HIG, Material 3 / Android Developers, web.dev, WebKit, MDN.
- Every pattern links at least one source. Claims about Hermes cite `file:line` in the local read-only checkout `~/.hermes/hermes-agent` (v0.21.4).
- `[INFERENCE]` marks a design judgement or an extrapolation that no source states directly.
- **Source access caveats:**
  - `m3.material.io`, `help.openai.com`, `openai.com/index/*` and `support.google.com` pages render with JavaScript or sit behind bot protection (HTTP 403), so they could not be fetched. Those citations quote the publisher's own text as returned in search excerpts. Where possible a fetchable mirror from the same publisher is cited too (for example, Android Developers for M3 breakpoints). The ChatGPT branching date comes from secondary press, and is labelled as such where used.
  - Browser-support facts come from MDN `@mdn/browser-compat-data` **v8.1.4 (2026-10-01)**, queried locally. They are cited below as "BCD".

Companion reports: [README.md](README.md) (feature matrix and gaps), [hermes-dashboard.md](hermes-dashboard.md), [hermes-webui.md](hermes-webui.md), [patterstage.md](patterstage.md).

---

## 0. The bar in one paragraph

The leading agent products (Codex, Claude Code, Copilot agent, Cursor agents, Devin) have converged on one model:
- **Agents run in the background.** You delegate and walk away. Sessions survive device switches and network drops.
- **The phone is a control surface.** It is used to *monitor, answer, approve, steer and review diffs*, not to author big configurations.
- **One inbox collects everything that needs you.** It is fed by push notifications that open directly on the decision.
- **Every run has an inspectable worklog**, with per-step tools, tokens and cost.
- **Steer, queue and stop are distinct verbs.**
- **Dangerous operations get friction proportional to risk**, including re-authentication with a passkey.

On top of this sit table stakes: an adaptive shell (bottom bar → rail → sidebar by window size), a ⌘K palette that holds every command, WCAG 2.2 AA, and Core Web Vitals at p75 on mobile.

For a *self-hosted* PWA, three more things are required: HTTPS (Tailscale Serve), installability that respects iOS limits, and Web Push designed around what iOS Home Screen apps can and cannot do. The Hermes gateway contract already supplies most of the run-control primitives (approval, clarify, steer, interrupt, background, branch, projects, event replay; §3). The gap is the UX layer and push delivery.

---

## 1. App shell & navigation (phone / tablet / desktop)

### 1.1 Switch navigation at window-size breakpoints, not by device type
- **Who:**
  - Android Developers defines the M3 width classes:
    - Compact: < 600dp (99.96% of phones in portrait)
    - Medium: 600–839dp (tablets in portrait)
    - Expanded: 840–1199dp (tablets in landscape)
    - Large: 1200–1599dp
    - Extra-large: ≥ 1600dp (desktop)
    
    It also defines height classes, where Compact height is < 480dp (phones in landscape). It states that the classes are "explicitly not determined by the size of the device screen… not intended for *isTablet*-type logic" and "can change throughout the lifetime of your app" ([Android: Use window size classes](https://developer.android.com/develop/ui/views/layout/use-window-size-classes)).
  - M3: "a bottom navigation bar in a compact layout can be swapped with a navigation rail in a medium layout, and a navigation drawer in an expanded layout" ([M3 Applying layout](https://m3.material.io/foundations/layout/applying-layout/window-size-classes)).
  - M3 navigation bar guidance: "Compact: use a navigation bar or modal navigation rail. Medium: use a navigation bar or navigation rail… Expanded and extra-large: use a navigation rail" ([M3 Navigation bar guidelines](https://m3.material.io/components/navigation-bar/guidelines)).
  - The M3 rail is for medium and wider and holds "3–7 destinations plus an optional FAB" ([M3 Navigation rail](https://m3.material.io/components/navigation-rail/overview)).
- **Why it works:** iPad Split View, Stage Manager, foldables and desktop windows mean device ≠ window. Breakpoints keep navigation reachable by thumb on phones and use horizontal space on wide screens.
- **Caduceus Dashboard:**
  - Bottom tab bar below 600 px.
  - Icon rail from 600 to 1199 px, expandable to labelled.
  - Grouped sidebar at 1200 px and above.
  - Drive this from container or width media queries, never user-agent sniffing. The 5-tab IA proposed in [README §6](README.md) (Chat · Inbox · Work · Agents · More) fits the bar.
- **Mobile notes:** In compact *height* (phone landscape, or the soft keyboard open), collapse or hide the bottom bar so the composer keeps its space `[INFERENCE]`.

### 1.2 Tab bar discipline: navigation only, ≤ 5 tabs, badges only for critical items
- **Who:** Apple HIG Tab bars:
  - "Use a tab bar to support navigation, not to provide actions."
  - "Don't disable or hide tab bar buttons, even when their content is unavailable."
  - "If you hide the tab bar, people can forget which area of the app they're in."
  - "aim for a default list of five or fewer."
  - Badges: "Reserve badges for critical information so you don't dilute their impact."
  
  ([HIG Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)). For complex information structures, HIG recommends "a sidebar or a tab bar that adapts to a sidebar" (same page). GitHub Mobile is reported to use five bottom tabs (Home, Notifications, Explore, Pull Requests, Profile). That comes from a third-party guide ([community-access.org appendix](https://community-access.org/git-going-with-github/docs/appendix-v-github-mobile.html)); GitHub's own docs only confirm a Profile tab ([GitHub Mobile docs](https://docs.github.com/en/get-started/using-github/github-mobile)).
- **Why:** Consistent, always-visible location; a badge on the tab bar is the cheapest way to say "something needs you".
- **Caduceus Dashboard:**
  - Put no "New chat" or "Run" *action* in the tab bar. Actions belong in the screen header or a FAB.
  - Badge only the Inbox tab, and count only *action-required* items (approvals, clarifications, failures). "Run finished" is FYI and is not badged.
- **Mobile notes:** The tab bar stays visible on all top-level screens. It hides only inside a full-screen transcript while the keyboard is up `[INFERENCE]`.

### 1.3 Canonical layouts: list-detail, supporting pane, feed
- **Who:**
  - M3 defines three canonical layouts: feed, list-detail and supporting pane, "each [with] configurations for compact, medium, and expanded" ([M3 Canonical layouts](https://m3.material.io/foundations/adaptive-design/canonical-layouts); [Android canonical layouts](https://developer.android.com/develop/adaptive-apps/guides/canonical-layouts)).
  - Claude shows artifacts "in a dedicated window to the right of the main chat" ([Claude Help: Artifacts](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)).
  - The Claude Code mobile client has a diff pane for the session's changes ([Remote Control: what connected devices see](https://code.claude.com/docs/en/remote-control)).
- **Why:** Three layouts cover nearly every screen and degrade predictably.
- **Caduceus Dashboard:**
  - **List-detail:** Sessions, Inbox, Kanban task, cron job, skills, profiles.
  - **Supporting pane:** Chat plus run inspector, artifacts, diff or files.
  - **Feed:** Insights, health.
  - On compact width, list-detail becomes push navigation and the supporting pane becomes a bottom sheet or a full-screen route.

### 1.4 Sheets with detents for contextual work on phones
- **Who:** HIG Sheets:
  - "The system defines two detents: large is the height of a fully expanded sheet and medium is about half."
  - A nonmodal sheet lets people "affect the parent view without dismissing the sheet."
  - "If you provide a Done button, always pair it with a Cancel button."
  
  ([HIG Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets)).
- **Why:** Keeps the run visible behind the decision. Half-height sheets are reachable with one thumb.
- **Caduceus Dashboard:**
  - The approval or clarify sheet opens at medium height over the live transcript.
  - The composer config sheet (model, effort, toolsets, workspace) reuses WebUI's phone pattern ([README §3](README.md)).
  - Filters and "Move to…" also use sheets.

### 1.5 Always-visible *target* context in the composer (environment, repo, profile)
- **Who:**
  - Codex cloud: "choose Work in > Cloud and open Select environment" before starting a task ([Codex Cloud](https://learn.chatgpt.com/docs/cloud)).
  - Claude Code mobile: "select a repository and branch, describe the task, and submit" ([Claude Code on mobile](https://code.claude.com/docs/en/mobile)).
  - Remote Control sessions "show a computer icon with a green status dot when online" ([Remote Control](https://code.claude.com/docs/en/remote-control)).
- **Why:** On a phone, the costliest mistake is running something on the wrong target.
- **Caduceus Dashboard:**
  - The profile chip (decision 6) sits in the app header *and* in the composer.
  - It shows the profile name, gateway status dot and workspace, and tapping it opens a picker sheet.
  - "Make default" is a separate, explicit action inside that sheet.

### 1.6 Viewport, safe areas and keyboard handling
- **Who (BCD):**
  - Dynamic viewport units (`dvh`/`svh`/`lvh`): Safari/iOS 15.4+, Chrome 108+.
  - `interactive-widget` viewport key: Chrome Android 108 and Firefox Android 133 only, **not iOS**.
  - VirtualKeyboard API: Chromium only.
  
  WebKit's own blog ships `viewport-fit=cover, user-scalable=yes` ([webkit.org page meta](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)).
- **Caduceus Dashboard:**
  - Use `viewport-fit=cover`, all four `env(safe-area-inset-*)`, `dvh`, and zoom allowed.
  - On iOS, fall back to `visualViewport` resize to keep the composer above the keyboard. Both Dash and WebUI already do this ([README §3](README.md)).

---

## 2. Command palette & keyboard model

### 2.1 One palette, everywhere, holding every command
- **Who:** Superhuman's engineering guide ([How to build a remarkable command palette](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/)):
  - Rule 1: the same shortcut works everywhere, toggles open and closed, and restores the previously focused element.
  - Rule 2: "Putting everything in one place simplifies the mental model… you shouldn't use Cmd+K for some types of actions, and Cmd+P for others."
  - Implementation: "decouple execution of commands from the UI" and let commands register "from any part of your codebase."
  - Rule 3: every action is "a UI element, a keyboard shortcut, and a command."
  - Rule 4: fuzzy matching, **aliases** (typing "archive" finds "Mark Done"), default scores and boost/dampen scales for ranking.
  - Showing the shortcut in the palette teaches it: "instantly do any action — and also learn the shortcut for next time."
- **Also:**
  - Raycast: "press ⌘K whenever you're unsure what actions are available. Each action shows its keyboard shortcut on the right" ([Raycast Action Panel](https://manual.raycast.com/action-panel)).
  - Linear's command menu "gives you access to all actions applicable to your view or selection" ([Linear: Contextual command menu](https://linear.app/changelog/2019-10-07-contextual-command-menu)). Cmd/Ctrl while executing opens the referenced entity in a new tab ([Linear changelog 2024-09-19](https://linear.app/changelog/2024-09-19-introducing-linear-mobile)).
- **Why:** It replaces 300+ buttons. With 336 REST operations and 60+ pages, Hermes cannot surface everything visually.
- **Caduceus Dashboard:**
  - A command registry in the internal module registry (decision 7). Each module registers commands with: id, title, aliases, icon, scope (global / page / selection), default shortcut, a `canRun(ctx)` check, and a danger tier.
  - ⌘K results are grouped: Commands (contextual first) · Sessions (FTS) · Profiles · Skills · Settings (deep links) · Docs.
- **Conflict to resolve:**
  - ChatGPT binds Ctrl+K to "Search chats" and Ctrl+Shift+O to "New chat" ([chatgpt.com UI labels](https://chatgpt.com/chat)). Hermes WebUI binds ⌘K to new chat ([README §2.12](README.md)).
  - Superhuman's rule 2 says one palette, so session search lives *inside* the palette.
  - Keep a dedicated "new chat" chord: ⌘⇧O (ChatGPT's), or `C` as in Linear `[INFERENCE]`.

### 2.2 Sequence shortcuts and list navigation, with a cheat-sheet
- **Who:** Linear Inbox ([Linear Inbox docs](https://linear.app/docs/inbox)):
  - `G` then `I` goes to Inbox from any page.
  - `J`/`K` move up and down.
  - `U` toggles read/unread and `H` snoozes.
  - `Backspace` deletes; `Shift+Backspace` deletes all read.
  - `Cmd/Ctrl+F` opens quick search.
- **Accessibility constraint:** WCAG 2.1.4 Character Key Shortcuts (Level A). Single-key shortcuts must be possible to turn off or remap, or be active only when their component has focus ([Understanding 2.1.4](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html)).
- **Caduceus Dashboard:**
  - `G`-prefixed navigation (G C chat, G I inbox, G W work, G A agents, G S settings) and `J`/`K` in every list.
  - `?` opens a searchable shortcut sheet, as PatterStage already has ([README §2.12](README.md)).
  - Settings → Keyboard can disable single-key shortcuts and remap any binding.

### 2.3 User aliases and hotkeys
- **Who:** Raycast: "An alias is a short keyword you type into Root Search"; hotkeys launch any command ([Raycast Aliases & Hotkeys](https://manual.raycast.com/command-aliases-and-hotkeys)).
- **Caduceus Dashboard:** Users can alias commands such as `gw` → "Restart gateway (current profile)". This closes Dash issue #4256 ([README §5](README.md)).

### 2.4 Mobile equivalent: search sheet and slash commands
- **Who:**
  - Superhuman: per-command icons teach "what to look out for on mobile, where there's only room to show the icon" ([Superhuman guide](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/)).
  - ChatGPT: "select it from the tools menu or type /agent in the composer" ([ChatGPT agent help](https://help.openai.com/en/articles/11752874-agent)).
  - Claude Code lists which slash commands work from mobile ([Remote Control limitations](https://code.claude.com/docs/en/remote-control)).
- **Caduceus Dashboard:**
  - A search button in every phone header opens the same registry as a full-height sheet.
  - `/` in the composer uses Hermes's own server-side slash completion (`tui_gateway/slash_fuzzy.py`, `tui_gateway/methods_slash.py`, `tui_gateway/methods_complete.py`), so TUI and Caduceus commands stay identical.

---

## 3. Agent run UX

### 3.1 Durable, resumable streams that follow you across devices
- **Who:**
  - Claude Code Remote Control: "the conversation and the progress of subagents… stay in sync across all connected devices, so you can send messages from your terminal, browser, and phone interchangeably." It survives interruptions: "reconnects automatically when your machine comes back online." The stored transcript "lets the session reconnect after a network drop" ([Remote Control](https://code.claude.com/docs/en/remote-control)).
  - Codex changelog: "Unsent queued messages now resume after reconnection once uncertain submissions are resolved, avoiding duplicate sends" ([Codex changelog](https://developers.openai.com/codex/changelog)).
  - Claude Code cloud sessions: "a task you start on your laptop is ready to review from your phone" ([Claude Code on mobile](https://code.claude.com/docs/en/mobile)).
  - LibreChat lists "Resumable Streams" as a feature ([LibreChat docs nav](https://www.librechat.ai/docs/features/fork)); only the title was verified.
- **Hermes already has the primitive:**
  - `session.events.since` (`apps/shared/src/gateway-contract.openrpc.json:2854`) is called after reconnect (`apps/shared/src/json-rpc-gateway.ts:487-488`).
  - The server ring buffer `events_since(sid, last_seen)` and `is_truncated()` mean "the client must refetch history instead of trusting the replay" (`tui_gateway/event_replay.py:100-115`).
  - Reconnect backoff is in `apps/shared/src/reconnect-backoff.ts`.
- **Caduceus Dashboard:**
  - Every run view tracks `last_seen` seq. On reconnect or resume it replays; when the replay is truncated it refetches.
  - Outgoing messages carry client idempotency keys.
  - Resuming a PWA on iOS must coalesce reconnects. WebUI has open "iOS PWA resume storms" (#7891, [README §3](README.md)).

### 3.2 One worklog per run: steps, tools, reasoning, drill-down
- **Who:**
  - Devin's Progress tab: "All shell commands, code edits, and browser activity will be logged in one unified view"; click any step for details ([Devin Session Tools](https://docs.devin.ai/work-with-devin/devin-session-tools)).
  - Copilot "Session logs show Copilot's internal reasoning and the tools it used". The session overview shows "progress, token usage, and session length" ([Copilot: Managing agent sessions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents)). Setup steps are now visible as they start and finish ([GitHub changelog 2026-03-19](https://github.blog/changelog/2026-03-19-more-visibility-into-copilot-coding-agent-sessions)).
  - Temporal offers three views of the same history: **Timeline**, **Compact** ("logical grouping of Activities, Signals and Timers") and **JSON**, plus a Pending Activities summary ([Temporal Web UI](https://docs.temporal.io/web-ui)).
- **Why:** The trust problem with agents is "what did it actually do?" Several densities serve both the glance on a phone and the forensic read.
- **Caduceus Dashboard:**
  - Three densities, matching WebUI's Worklog / Stream / Final-only ([README §2.1](README.md)) and Temporal's Timeline / Compact / Raw:
    - **Stream:** live tokens plus tool chips.
    - **Worklog:** collapsed step rows with duration, tool and status.
    - **Raw:** event JSON.
  - Source data: `tui_gateway/tool_progress.py` and the gateway events.
- **Mobile notes:** One line per step (≥ 44 px rows). Tapping a step opens a sheet with arguments and output. Long outputs are virtualized (§10).

### 3.3 Typed human-in-the-loop decisions
- **Who:**
  - LangChain HITL defines four decisions:
    - `approve`: run as proposed.
    - `edit`: modify the arguments first.
    - `reject`: skip, with feedback to the agent.
    - `respond`: a human answer, for ask-user tools.
    
    Each tool sets `allowed_decisions`, for example `execute_sql` allows only approve/reject. "Do not use `respond` to deny side-effecting tools" ([LangChain Human-in-the-loop](https://docs.langchain.com/oss/python/langchain/human-in-the-loop)).
  - LangGraph interrupts pause "indefinitely — for minutes, hours, or even days" with persisted state ([LangGraph Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)).
  - ChatGPT agent "requests permission before taking actions of consequence, and you can easily interrupt, take over the browser, or stop tasks at any point" ([Introducing ChatGPT agent](https://openai.com/index/introducing-chatgpt-agent)). It "will pause for clarification or confirmation when needed" ([ChatGPT agent help](https://help.openai.com/en/articles/11752874-agent)).
  - Claude Code keeps "permission prompts and `AskUserQuestion` questions open until you answer them." Other forwarded dialogs expire after 5 minutes to a no-action default.
  - From the phone, Claude "can't select Bypass permissions from the app" ([Remote Control limitations](https://code.claude.com/docs/en/remote-control); [Claude Code on mobile](https://code.claude.com/docs/en/mobile)).
- **Hermes contract:**
  - `approval.pending`, `approval.received` and `approval.respond` (`gateway-contract.openrpc.json:28,46,64`).
  - `clarify` (`:33810`) and `clarify.lock`.
  - WebUI already models once / session / always / deny / YOLO ([README §2.1](README.md)).
- **Caduceus Dashboard:**
  - The approval card shows:
    - the exact command or diff
    - the tool and target profile/workspace
    - the risk tier
    - **Approve once · Approve for session · Always (desktop-only or step-up auth) · Deny with reason · Edit args** (only where the tool allows).
  - Approvals never expire silently.
  - From a phone, escalating to "always" or YOLO needs passkey step-up (§7.3) `[INFERENCE, modelled on Claude's mobile restriction]`.
  - Clarify prompts reuse the same card with choices and free text.

### 3.4 Steer, queue, stop and side-question are separate verbs
- **Who:**
  - Copilot: "you can redirect it without stopping the session… Copilot implements your input after it finishes its current tool call." Stop "preserves any commits already pushed" ([Copilot: Managing agent sessions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents)).
  - Codex: opt-in `instant_interrupt` "lets new input steer Codex during model responses." "Canceling a queued prompt returns recoverable text and attachments to the composer" ([Codex changelog](https://developers.openai.com/codex/changelog)).
  - Devin side chats: start with "`/btw your question`"; they are read-only and "the main session keeps running" ([Devin Session Tools](https://docs.devin.ai/work-with-devin/devin-session-tools)).
- **Hermes contract:** `session.steer` (`:3106`), `session.interrupt` (`:2962`), `prompt.background` (`:2494`), `subagent.steer` (`:3394`) and `background.complete` (`:34022`).
- **Caduceus Dashboard:** When a run is active, the send button becomes a split control:
  - **Steer** (default)
  - **Queue** (shows queued chips you can cancel, which returns the text to the composer)
  - **Stop**
  - `/btw` side question
  - `/background`
  
  It mirrors the WebUI queue/interrupt/steer feature set ([README §2.1](README.md)).

### 3.5 Background tasks with a global "agents" panel
- **Who:**
  - Copilot: "the agents panel (available from any page on GitHub)"; sessions can be archived but not deleted ([Copilot docs](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents)).
  - Codex: "Each task has its own workspace and can keep working while your computer is asleep"; review from web, mobile or desktop ([Codex Cloud](https://learn.chatgpt.com/docs/cloud)).
  - Codex "is now in the ChatGPT mobile app so you can stay in the loop from anywhere" ([OpenAI: Work with Codex from anywhere](https://openai.com/index/work-with-codex-from-anywhere)).
  - Cursor: agents on "any desktop, tablet, or mobile browser… install the app as a Progressive Web App". The post shows a "Kanban view of Cursor Agents" and Slack notifications on completion ([Cursor on web and mobile](https://cursor.com/blog/agent-web)).
  - Claude Code projects show "which threads finished or need you" ([Claude Code on mobile](https://code.claude.com/docs/en/mobile)).
- **Caduceus Dashboard:**
  - A persistent activity indicator in the header opens an "Active runs" panel.
  - The panel covers all profiles (decision 6 "All profiles" view) and includes chat turns, background prompts, cron runs, Kanban workers and subagents.
  - Each row shows its status dot, elapsed time, cost so far, and Steer/Stop.
  - Source: `session.active_list` (`:2674`).

### 3.6 Review diffs and artifacts on the phone
- **Who:**
  - Claude Code connected devices get a diff pane showing "the changes since the branch split… including your uncommitted edits" ([Remote Control](https://code.claude.com/docs/en/remote-control)).
  - Codex: "Inspect changed files and check results, request follow-up changes, and commit or open a pull request" ([Codex Cloud](https://learn.chatgpt.com/docs/cloud)).
  - Cursor: review agent diffs and create PRs from the web ([Cursor blog](https://cursor.com/blog/agent-web)).
  - GitHub Mobile made starting and submitting reviews on the go easier ([GitHub changelog 2024-04-09](https://github.blog/changelog/2024-04-09-introducing-enhanced-code-review-on-github-mobile)).
- **Caduceus Dashboard:**
  - A "Changes" supporting pane: files changed this session plus checkpoint diff/restore (WebUI) and git status/commit (backend APIs exist; [README §2.10](README.md)).
  - On compact width it uses a unified (not side-by-side) diff, wraps long lines, and lets you jump between files `[INFERENCE]`.

### 3.7 Voice inside the conversation, not a separate mode
- **Who:** ChatGPT: "Voice works within a chat, so you can listen while following the response in text, type when you cannot speak, and review earlier messages without starting over" ([ChatGPT Voice help](https://help.openai.com/en/articles/20001274-voice-mode-faq)).
- **Caduceus Dashboard:**
  - Dictation and hands-free TTS from the composer, using Hermes `tui_gateway/methods_voice.py` (event `voice.interrupted`). The transcript stays visible throughout.
  - Screen Wake Lock (iOS 18.4+ Home Screen, BCD `WakeLock` safari_ios 18.4) keeps the screen on during hands-free mode.

### 3.8 Traceability from outputs back to the run
- **Who:** Copilot: "Each commit message includes a link to the session logs, so you can trace why a change was made" ([Copilot docs](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents)).
- **Caduceus Dashboard:** Every cron output, Kanban comment, artifact and memory edit deep-links to `session/turn`. Read-only share links (§5.6) reuse the same route.

---

## 4. Inbox, notifications and Web Push

### 4.1 One triage inbox with explicit item states
- **Who:**
  - GitHub inbox actions are **Done** (kept 3 months), **Save** (kept indefinitely), **Read** and **Unsubscribe**. It allows up to 15 custom filters and syncs across web, mobile and email ([GitHub: Managing notifications from your inbox](https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/managing-notifications-from-your-inbox)).
  - Linear has a **Priority** tab for items "that need your attention" and snooze (`H`) that "reappears in Inbox" at the chosen time, plus reminders ([Linear Inbox](https://linear.app/docs/inbox)).
  - Linear Mobile is "purpose-designed for 'away from keyboard' workflows". Its bottom bar has archive and snooze for Inbox notifications ([Introducing Linear Mobile](https://linear.app/changelog/2024-09-19-introducing-linear-mobile)).
- **Caduceus Dashboard:** The Inbox tab has two sections:
  - **Needs you:** approvals, clarify, failed runs, cron failures, gateway down, DM pairing requests, budget hard-stops.
  - **Updates:** runs done, cron success digests, skill updates.
  
  Actions are Done / Snooze / Open, with swipe gestures that have button equivalents (§10). Items are derived from Hermes events. Only read and snooze state is dashboard-owned, stored under `HERMES_HOME` (decision 1).

### 4.2 Push opens straight onto the decision
- **Who:**
  - GitHub Mobile deployment reviews: "approve or reject jobs awaiting review… receive push notifications for requests for your review… Deployments awaiting your approval will also appear within the Notifications tab" ([GitHub changelog 2021-04-01](https://github.blog/changelog/2021-04-01-reviewing-deployments-on-github-mobile)).
  - Home Assistant actionable notifications ([HA Actionable Notifications](https://companion.home-assistant.io/docs/notifications/actionable-notifications/)):
    - action buttons
    - a `REPLY` text-input action
    - `destructive: true` to "color the action's title red"
    - `activationMode: foreground` to open the app
    - "Android allows 3 notification actions"
  - Claude Code: push "when a long-running task finishes or when it needs a decision from you" ([Remote Control: mobile push](https://code.claude.com/docs/en/remote-control)).
- **Platform reality (BCD):** `showNotification` `actions` and `Notification.actions` are **not supported on Safari or iOS** (Chrome 48+/53+, Firefox 152+). `requireInteraction` and `tag` are also unsupported on Safari. WebKit bug [319860](https://bugs.webkit.org/show_bug.cgi?id=319860) reports tag coalescing failing with Declarative Web Push on iOS 18.4.
- **Caduceus Dashboard:**
  - Every push carries a deep link (`/inbox/<id>`) that opens the approval sheet.
  - On Chromium/Android, also add up to 2 inline actions ("Approve once", "Deny"). Even then, approve-type actions should open the app to show the full command `[INFERENCE]`.
  - Don't design iOS flows that depend on replace-by-tag. Collapse duplicates server-side instead.

### 4.3 iOS / iPadOS Home Screen web push: hard requirements
- **Requirements** (from [WebKit: Web Push for Web Apps on iOS and iPadOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) and [Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/)):
  1. iOS/iPadOS 16.4+, and the app must be **added to the Home Screen** with a manifest `display` of `standalone` or `fullscreen`.
  2. Permission may be requested only "in response to direct user interaction — such as tapping on a 'subscribe' button."
  3. Uses standard Push API + Notifications API + Service Worker. Delivery is via APNs: "allow URLs from `*.push.apple.com`". No Apple Developer Program membership is needed.
  4. Subscriptions must be `userVisibleOnly: true`. "If an event handler doesn't show the user visible notification for any reason we revoke its push subscription."
  5. Notifications integrate with Focus. The manifest `id` (16.4) plus the user-chosen name identify the app, so "a user can install multiple copies of the web app… 'Shiny (personal)' … 'Shiny (work)'."
  6. Badging API: `setAppBadge`/`clearAppBadge` work in the foreground or while handling push.
  7. **Declarative Web Push** (iOS/iPadOS 18.4, macOS Safari 18.5):
     - `window.pushManager.subscribe()` works without a service worker.
     - The push payload itself describes the notification. Optional SW JavaScript can modify it, and "the declarative push message itself is used as a fallback in case the optional JavaScript processing step fails."
     - This removes the silent-revocation risk ([Safari 18.4 features](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/)).
     - BCD: `Window.pushManager` Safari / safari_ios 18.4 only.
- **Caduceus Dashboard:**
  - Show a "Turn on notifications" button, and only after install. Detect install with the `display-mode: standalone` media query ([web.dev customize install](https://web.dev/articles/customize-install)).
  - Send declarative payloads with a classic-SW fallback.
  - Keep the VAPID key and subscriptions server-side under `HERMES_HOME`.
  - Hermes has no Web Push code today: a grep for `vapid|webpush|pywebpush|pushManager` across the checkout finds nothing. So push delivery is a Caduceus-owned concept, which decision 1 permits.
  - Event sources are `tui_gateway/session_notifications.py` (per-session notification poller for kanban/loop/delegation events) and `background.complete`.

### 4.4 Presence-aware delivery and user-controlled categories
- **Who:**
  - Claude Code "skips mobile push notifications while you are typing in or focused on the connected terminal". It has two toggles, "Push when Claude decides" and "Push when actions required" ([Remote Control](https://code.claude.com/docs/en/remote-control)).
  - ChatGPT scheduled tasks let users enable "Push notifications, Email, or both" ([ChatGPT Scheduled tasks](https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt)).
  - Linear routes alerts to desktop, mobile, Slack or email from one settings page ([Linear Notifications](https://linear.app/docs/notifications)).
  - Gemini scheduled actions push "when your scheduled action is ready" ([Google: scheduled actions](https://blog.google/products-and-platforms/products/gemini/scheduled-actions-gemini-app/)).
- **Caduceus Dashboard:**
  - Per-device categories: Action required (default on) · Run finished · Failures · Daily digest.
  - Suppress push to a device while any Caduceus client for the same user is visible and focused. The service worker checks `clients.matchAll()` visibility, and the server tracks presence `[INFERENCE]`.
  - Quiet hours defer to the OS Focus mode on iOS.

### 4.5 Badges only for things that need you
- **Who:** HIG ("Reserve badges for critical information") ([Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars)). WebKit Badging API ([Badging for Home Screen Web Apps](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/)). BCD `setAppBadge`: Safari 17, iOS 16.4, Chrome desktop 81; **not Chrome Android**.
- **Caduceus Dashboard:** The app icon badge and the Inbox tab badge both equal the "Needs you" count.

---

## 5. Session and history organisation

### 5.1 Projects as context containers
- **Who:**
  - ChatGPT Projects "group together chats, upload reference files, and add custom instructions." You can "Start on one device and continue on another" ([ChatGPT Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt)).
  - Open WebUI folders become "full-featured project workspaces" with "contexts, system prompts, and knowledge bases that apply to all chats within them". Folders nest, and **unread badges** are pushed to other open sessions immediately ([Open WebUI Folders & Projects](https://docs.openwebui.com/features/chat-conversations/chat-features/conversation-organization/)).
- **Hermes contract:** Hermes already has projects as "per-profile multi-folder workspaces" (`tui_gateway/methods_projects.py:1`). Methods include `projects.create/list/get/archive/delete/add_folder/discover_repos/for_cwd` (`gateway-contract.openrpc.json:2224-2350`).
- **Caduceus Dashboard:** Use Hermes projects. Do not invent a Caduceus-side folder model (decision 1).

### 5.2 Search everything, archived included
- **Who:**
  - ChatGPT searches "past ChatGPT conversations on the web and mobile, including older chats and archived conversations" ([ChatGPT: search chat history](https://help.openai.com/en/articles/10056348)).
  - LibreChat uses Meilisearch for "full-text search, typo tolerance, and instant results" ([LibreChat Meilisearch](https://www.librechat.ai/docs/configuration/meilisearch)).
  - Copilot answers natural-language questions about past sessions, such as "Find the session where I refactored authentication" ([Copilot docs](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents)).
- **Caduceus Dashboard:**
  - Dash's FTS5 message search, exposed in ⌘K and on the Sessions screen.
  - Filters: source (CLI, Telegram, cron, webhook, kanban), profile, project, date, has-approvals and failed.
  - Optionally, "ask about my sessions" through a Hermes agent turn `[INFERENCE]`.

### 5.3 Branch or fork from any message, with explicit scope
- **Who:**
  - LibreChat fork options:
    - "Visible messages only"
    - "Include related branches"
    - "Include all to/from here" (the default)
    
    It also offers "Start fork here" and a "Remember" choice ([LibreChat Forking](https://www.librechat.ai/docs/features/fork)).
  - ChatGPT added conversation branching in September 2025 (secondary report: [Ars Technica](https://arstechnica.com/ai/2025/09/chatgpts-new-branching-feature-is-a-good-reminder-that-ai-chatbots-arent-people/)).
- **Hermes contract:** `session.branch` (`gateway-contract.openrpc.json:2692`).
- **Caduceus Dashboard:** "Fork from here" sits in the message overflow menu, which opens on long-press on touch. The new session records its parent link.

### 5.4 Unread state, pins, archive (not delete) for agent sessions
- **Who:**
  - Open WebUI's unread rules: a chat "whose reply is still being generated is not counted until the response has finished"; "A title generated automatically… does not make it unread again" (same OWUI page).
  - Copilot cloud-agent sessions "can be archived but not deleted" ([Copilot docs](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents)).
- **Caduceus Dashboard:**
  - Show an unread dot when a run finished since you last viewed it.
  - Pins are per user.
  - Archive is a one-tap action with undo. Delete is a tier-3 action (§7.3).

### 5.5 Saved views and filters
- **Who:** Temporal Saved Views ("save them once and apply them with a single click", [Temporal Web UI](https://docs.temporal.io/web-ui)); GitHub custom inbox filters, up to 15 ([GitHub docs](https://docs.github.com/en/subscriptions-and-notifications/how-tos/viewing-and-triaging-notifications/managing-notifications-from-your-inbox)).
- **Caduceus Dashboard:** Saved session, log and task views live in the URL, so they can be bookmarked and shared, and are stored as dashboard preferences.

### 5.6 Read-only sharing
- **Who:**
  - Copilot shared sessions let recipients "view the session's prompts, responses, and file changes, but cannot steer or modify" ([Copilot docs](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents)).
  - LibreChat share links include QR codes ([LibreChat Forking page, related links](https://www.librechat.ai/docs/features/fork)).
- **Caduceus Dashboard:** Keep WebUI's public share links ([README §2.2](README.md)) as explicit, revocable, read-only snapshots.

---

## 6. Workflow and orchestration UIs, and how they degrade on phones

### 6.1 Boards of agent tasks, with a move action that doesn't need dragging
- **Who:**
  - Cursor shows a "Kanban view of Cursor Agents performing coding and research tasks" ([Cursor blog](https://cursor.com/blog/agent-web)).
  - Linear supports multi-select actions through "keyboard shortcuts, the command menu, or right-click" ([Linear Select issues](https://linear.app/docs/select-issues)).
  - Linear's 2024 changelog lists "PWA: Fixed drag and drop not working on mobile" ([Linear changelog](https://linear.app/changelog/2024-09-19-introducing-linear-mobile)). This is evidence that touch drag-and-drop breaks even for the best teams.
  - WCAG 2.5.7 Dragging Movements (AA): "For any action that involves dragging, provide a simple pointer alternative" ([Understanding 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html)).
- **Caduceus Dashboard:**
  - Kanban (the unified Task model: decision 4) on ≥ 840 px: columns with drag.
  - Below 840 px: a list grouped by status, or one column per screen with snap scrolling (WebUI's 82 vw).
  - Every card has "Move to…" and "Assign…" sheets. Long-press drag is a bonus, not the only path.

### 6.2 A live DAG graph on desktop, an ordered list on phone
- **Who:**
  - GitHub Actions: "Every workflow run generates a real-time graph… An icon to the left of the job name indicates the status… Lines between jobs indicate dependencies… To view a job's log, click the job" ([GitHub: visualization graph](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph)).
  - GitHub Mobile shows the same run as run → jobs → step logs. It can re-run "single jobs, failed jobs as well as entire workflows" and cancel running checks ([GitHub changelog 2022-10-04](https://github.blog/changelog/2022-10-04-introducing-actions-on-github-mobile)).
- **Why:** A graph is the right overview when there is room. On a phone, the same information is a status-ordered list with drill-down.
- **Caduceus Dashboard:**
  - Composer workflows and mission runs: a graph canvas at ≥ 1024 px, read-only at 840–1023 px.
  - On compact width, a linear stage list with gate badges. Editing is desktop-first ([README §3](README.md)).

### 6.3 Several views of one run history, plus schedules with past *and* upcoming runs
- **Who:**
  - Temporal views: Timeline, Compact, JSON.
  - It flags a workflow automatically "when a Workflow experiences five consecutive task failures or timeouts… The moment the Workflow recovers… the flag clears."
  - Schedules show "recent and upcoming runs" ([Temporal Web UI](https://docs.temporal.io/web-ui)).
- **Caduceus Dashboard:**
  - Cron job pages show the last N runs with output links and the next 3 fire times (PatterStage preview; [README §2.7](README.md)).
  - A "flapping" or "failing" badge appears after K consecutive failures and clears automatically on success.

### 6.4 Re-run with the same inputs
- **Who:**
  - n8n "Debug in editor" loads data from a failed execution so you can "make changes to your workflow to fix it, then re-run it with the previous execution data" ([n8n Debug executions](https://docs.n8n.io/build/understand-workflows/understand-executions/debug-executions)).
  - GitHub can re-run failed jobs (above).
- **Caduceus Dashboard:** "Run now" for cron; "Re-run from stage N" for workflows; "Retry turn" for chat. All show the inputs they will reuse.

### 6.5 Human gates as first-class, durable nodes
- **Who:** GitHub Actions deployment review ("approve or reject jobs awaiting review", [GitHub: Reviewing deployments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments)); LangGraph interrupts persist and resume on the same thread ([LangGraph Interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts)).
- **Caduceus Dashboard:** A Composer human gate or verdict creates a "Needs you" Inbox item and a push, and resumes through Hermes's approval/clarify primitives. It is never a Caduceus-side timer.

---

## 7. Admin and settings at scale

### 7.1 Search-first settings with filters and deep links
- **Who:** VS Code Settings editor:
  - Search filters the list as you type.
  - "`@modified` filter… shows up if its value differs from the default."
  - Typing `@` discovers filters such as `@haspolicy`.
  - The gear menu can "reset a setting to its default value… copy the setting ID… copy the settings URL."
  
  ([VS Code: User and workspace settings](https://code.visualstudio.com/docs/configure/settings)).
- **Why:** Hermes config has 500+ fields in 30+ categories ([README §2.11](README.md)). Browsing doesn't scale. Search and "what did I change" do.
- **Caduceus Dashboard:**
  - One settings search across labels, keys, descriptions and enum values.
  - Filters: `@modified`, `@profile:<name>`, `@restart-required`, `@secret`.
  - Every field has a copyable deep link, reachable from ⌘K, and a reset-to-default action.
  - The raw YAML editor stays as an expert path with validation.

### 7.2 "Repairs": issues the system found, each with a fix
- **Who:**
  - Home Assistant Repairs lists issues "that should be fixed". It lives under "Settings > System > Repairs" and "the settings menu item shows the number of pending updates and repairable issues" ([HA Repairs](https://www.home-assistant.io/integrations/repairs)).
  - Issues can carry a fix flow or be ignored ([HA dev docs: Repairs](https://developers.home-assistant.io/docs/core/platform/repairs/)).
- **Caduceus Dashboard:**
  - A Health screen merges PatterStage's subsystem reasons with Dash's doctor/security audit ([README §2.11](README.md)).
  - Each issue has a severity, a human cause and a one-tap fix (re-auth provider, restart gateway, migrate config), or "Ignore".
  - The More/Settings tab shows the count.

### 7.3 Friction proportional to risk, plus step-up re-authentication
- **Who:**
  - GitHub repository deletion is in a "Danger Zone" and requires you to "type the name of the repository". Some deletions "can be restored within 90 days" ([GitHub: Deleting a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/deleting-a-repository)).
  - GitHub **sudo mode**: re-authenticate, optionally with a passkey, for sensitive actions. There is a "two-hour session timeout" and "any sensitive action… will reset the timer" ([GitHub Sudo mode](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/sudo-mode)).
  - Claude Trusted Devices require "a recent sign-in… no more than 18 hours old". Members "confirm presence with Face ID, Touch ID, Windows Hello, or a passkey". Each enrolled device can be revoked ([Remote Control: Trusted Devices](https://code.claude.com/docs/en/remote-control)).
  - HA marks destructive notification actions in red ([HA Actionable](https://companion.home-assistant.io/docs/notifications/actionable-notifications/)).
- **Caduceus Dashboard:** Four danger tiers, attached to each registered command:
  - **T0** reversible: act, then show an undo toast.
  - **T1** costly: a confirm sheet naming the object and the profile.
  - **T2** destructive: type the name to confirm, and show what is lost and whether it can be restored (backup).
  - **T3** security or exec: passkey step-up with a sudo window.
  
  Example targets: profile delete, restore, prune, update, YOLO/always-approve, credential reveal, shell/exec methods.

### 7.4 Honest per-surface limits (progressive disclosure by device)
- **Who:**
  - Claude mobile: "commands that only run in the terminal interface… don't work from the app"; Bypass permissions cannot be selected from the app ([Claude Code on mobile](https://code.claude.com/docs/en/mobile)).
  - Codex: on mobile you select an existing environment. Creating one is "on the web or in the desktop app" ([Codex Cloud](https://learn.chatgpt.com/docs/cloud)).
  - Superhuman deliberately leaves Cmd+K inactive in rarely used Settings dialogs ([Superhuman guide](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/)).
- **Caduceus Dashboard:**
  - On phone: monitor, approve, steer, chat, triage, quick toggles.
  - Desktop-first: Composer graph editing, raw YAML, the 40+ provider matrix and bulk operations. These show "Continue on desktop" with a link or QR, not a broken layout.

---

## 8. Observability

### 8.1 A live log tail with structured filters and server-side search
- **Who:**
  - Vercel Runtime Logs:
    - "**Live mode** option to follow the logs in real-time"
    - filters for level (Warning/Error/Fatal), time range, status code, route, environment and branch
    - a filter that shows only "requests made from your current browser"
    - full-text search with newest first
    - log sharing
    
    ([Vercel Runtime Logs](https://vercel.com/docs/logs/runtime)).
  - Railway's filter syntax supports `"key phrase"`, `@attribute:value` and numeric comparisons. It offers both per-deployment logs and an environment-wide Log Explorer ([Railway Logs](https://docs.railway.com/observability/logs)).
- **Caduceus Dashboard:**
  - Logs stream over WebSocket with a pause-on-scroll tail.
  - The query bar uses `level:error @profile:work @component:gateway "rate limit"` and maps to Dash's existing `search=` backend ([README §5](README.md)).
  - Every run, cron job and gateway event offers a "View logs" deep link pre-filtered to that entity.
- **Mobile notes:** Monospace with soft wrap, level colour plus an icon (not colour alone), copy-line, and a sticky "jump to live" button.

### 8.2 Cost and tokens per step, per session and in aggregate
- **Who:**
  - LangSmith shows cost "as a breakdown within individual traces, as aggregated metrics in project stats, and in dashboards". The trace tree shows "aggregated values for each parent run and token and cost breakdowns for each child run". Cache-read token details are tracked ([LangSmith Cost tracking](https://docs.langchain.com/langsmith/cost-tracking)).
  - Copilot shows token usage and session length per session ([Copilot docs](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents)).
  - Devin sizes sessions XS–XL by ACU (XS ≤ 2 … L ≤ 20) ([Devin Session Insights](https://docs.devin.ai/product-guides/session-insights)).
- **Hermes contract:** `session.usage` (`gateway-contract.openrpc.json:3160`).
- **Caduceus Dashboard:**
  - A cost chip on each turn and run row.
  - Session totals including cache %.
  - Insights by profile, model, source (chat, cron, kanban, mission) and hour.
  - Budgets with a hard stop for unattended work (PatterStage, [README §2.4](README.md)).

### 8.3 Connection and health status with *reasons*
- **Who:**
  - When a Claude Code Remote Control connection drops, it gives an explicit reason: "Another connection took over this session", "This session was ended or archived from another device", "The server no longer reports this session" ([Remote Control](https://code.claude.com/docs/en/remote-control)).
  - HA Repairs and the Temporal failure flags (above).
- **Caduceus Dashboard:**
  - A thin global connection bar: Live · Reconnecting (n) · Offline (showing the cached time) · Server restarted (replay truncated, so reloaded).
  - Per-profile gateway dots. A health-check summary sits on the Agents tab.

---

## 9. Self-hosted PWA specifics

### 9.1 HTTPS by default through Tailscale Serve
- **Who:** Tailscale:
  - "Tailscale Serve requires you to enable HTTPS certificates in your tailnet."
  - Serve adds **identity headers** (for example `Tailscale-User-Login`) to tailnet traffic and "will remove them" if a client sends its own. "It's best practice to only have the service listen on localhost."
  - Funnel traffic is public and carries no identity headers.
  
  ([Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)). Certificates are logged in **Certificate Transparency**: "machine names are still published in the public ledger. Do not enable the HTTPS feature if any of your machine names contain sensitive information" ([Tailscale: Enabling HTTPS](https://tailscale.com/docs/how-to/set-up-https-certificates)).
- **Why:** Service workers, push, clipboard and WebAuthn need a secure context. Dash's plain-HTTP tailnet bind breaks the service worker and clipboard today ([README §3](README.md)).
- **Caduceus Dashboard:**
  - Bind to `127.0.0.1`. Setup recommends `tailscale serve` and shows the CT-log warning.
  - Optional "trust Tailscale identity headers" SSO is allowed only when bound to localhost.
  - Never use Funnel for the admin console.

### 9.2 Installability and install promotion that respect each platform
- **Who:**
  - BCD: `beforeinstallprompt` is **Chromium only** (Chrome 61+; not Safari or Firefox).
  - web.dev: save the event and call `prompt()` from your own UI; listen for `appinstalled`; detect standalone with the `display-mode` media query ([web.dev customize install](https://web.dev/articles/customize-install)).
  - "Include the ability to dismiss or decline the promotion. Remember the user's preference… only re-prompt if there's a change" ([web.dev promote install](https://web.dev/articles/promote-install)).
  - On iOS 16.4+, third-party browsers can also offer "Add to Home Screen" ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)). This contradicts Open WebUI's claim that "Safari is the only browser that supports PWA installation on iOS" ([Open WebUI as an App](https://docs.openwebui.com/getting-started/open-webui-as-app/)). The WebKit source is authoritative.
  - Cursor tells users to install its agents web app as a PWA on iOS and Android ([Cursor blog](https://cursor.com/blog/agent-web)).
- **Caduceus Dashboard:**
  - On Chromium, a one-tap "Install" button.
  - On iOS, an illustrated "Share → Add to Home Screen" sheet, shown after a meaningful action such as the first approval, not on first load.
  - A dismissal is remembered.
  - The manifest `id` allows **separate installs per profile**, for example "Hermes (work)" and "Hermes (personal)", each with its own start URL and Focus settings. This fits decision 6 `[INFERENCE]`.
  - A desktop "Open on phone" QR, as Claude Code's `/mobile` does ([Claude Code on mobile](https://code.claude.com/docs/en/mobile)), carries the URL and profile scope only, never a credential.

### 9.3 Offline shell, durable storage, an outbox without Background Sync
- **Who:**
  - web.dev app-shell model: "the app shell is cached, then served, and content is loaded on the client side" ([web.dev PWA architecture](https://web.dev/learn/pwa/architecture)).
  - "The first-party domain of home screen web applications is exempt from ITP's 7-day cap on all script-writeable storage" ([WebKit Tracking Prevention](https://webkit.org/tracking-prevention)).
  - Safari 17 origin quota is up to 15% of disk for non-browser apps and up to 60% for browser apps ([WebKit: Updates to Storage Policy](https://www.webkit.org/blog/14403/updates-to-storage-policy)).
  - `navigator.storage.persist()` exists for critical data ([MDN storage quotas](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)).
  - BCD: `SyncManager` (Background Sync) is Chromium only. Safari has none.
- **Caduceus Dashboard:**
  - Precache the shell.
  - Cache the last-seen lists (sessions, inbox, jobs) read-only, showing staleness.
  - Persist composer drafts locally and mirror them server-side (WebUI has cross-device drafts).
  - Keep an IndexedDB outbox for low-risk writes (drafts, inbox done or snooze), flushed on `online` or `visibilitychange`.
  - **Approvals, steer and stop are never queued offline.** They act on live state and must fail visibly `[INFERENCE]`. Hermes stays the source of truth (decision 1).

### 9.4 Passkeys as the primary sign-in, with step-up and device management
- **Who:**
  - web.dev: support passkeys through **form autofill (conditional UI)**, and give users a passkey management page showing each passkey's name and details ([web.dev passkey checklist](https://web.dev/articles/passkey-checklist); [Passkey form autofill](https://web.dev/articles/passkey-form-autofill); [Passkey management](https://web.dev/articles/passkey-management)).
  - BCD: `PublicKeyCredential.isConditionalMediationAvailable` in Safari/iOS 16+, Chrome 108+ and Firefox 119+.
  - WCAG 3.3.8 Accessible Authentication (AA): no cognitive-function test (remembering or transcribing) without an alternative or assistance ([Understanding 3.3.8](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html)).
  - Linear added "the ability to rename passkeys" ([Linear changelog](https://linear.app/changelog/2024-09-19-introducing-linear-mobile)).
  - GitHub sudo mode and Claude Trusted Devices (§7.3).
- **Caduceus Dashboard:**
  - Passkey login with conditional UI. Passwords stay a fallback, with paste allowed.
  - Passkey step-up for T3 actions.
  - A devices and sessions list with revoke (PatterStage has session revoke, [README §2.12](README.md)).
- **Constraint:** A WebAuthn credential is scoped to an RP ID derived from the origin's domain ([MDN Web Authentication API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API)). Renaming the tailnet or host invalidates the passkeys, so the setup flow should pin a stable hostname `[INFERENCE from the RP-ID rule]`.

### 9.5 Capability matrix for the PWA (BCD v8.1.4)

| Capability | iOS / iPadOS Home Screen | Chrome Android | Desktop Chromium | Design consequence |
|---|---|---|---|---|
| Web Push (SW) | 16.4+ | 42+ | 42+ | Push only after install on iOS |
| Declarative push (`window.pushManager`) | 18.4+ | — | — | Prefer on iOS, with a SW fallback |
| Notification action buttons | ✗ | 48+ | 48+ | Deep-link to sheet; buttons are extra |
| `Notification.tag` / `requireInteraction` | ✗ / ✗ | ✓ / ✓ | ✓ / ✓ | Dedupe server-side |
| App badge `setAppBadge` | 16.4+ | ✗ | 81+ | Badge is best-effort |
| `beforeinstallprompt` | ✗ | 61+ | 61+ | Instructional sheet on iOS |
| Manifest `id` | 16.4+ | 96+ | 96+ | Per-profile installs |
| Manifest `shortcuts` | ✗ (Safari macOS 17.4) | 84+ | 96+ | Long-press shortcuts on Android only |
| Share target | ✗ | 76+ | 89+ | "Send to Hermes" on Android only |
| Background Sync | ✗ | 49+ | 49+ | Foreground outbox flush |
| Screen Wake Lock | 18.4+ | 84+ | 84+ | Hands-free voice |
| `dvh` units | 15.4+ | 108+ | 108+ | Use with a `visualViewport` fallback |
| `interactive-widget` / VirtualKeyboard | ✗ / ✗ | 108+ / 94+ | — / 94+ | iOS keyboard via `visualViewport` |
| View Transitions | 18+ | 111+ | 111+ | Shell transitions; honour reduced motion |

---

## 10. Accessibility and performance bars

### 10.1 WCAG 2.2 AA items that bite an agent dashboard
([WCAG 2.2](https://www.w3.org/TR/WCAG22/), [What's new in 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/))

- **2.4.11 Focus Not Obscured (Minimum), AA:** a focused component must not be "entirely hidden due to author-created content". The understanding doc names "sticky footers, sticky headers, and non-modal dialogs". Failure F110 covers sticky headers and footers ([Understanding 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html); [F110](https://www.w3.org/WAI/WCAG22/Techniques/failures/F110)).
  - *Hermes:* the bottom tab bar, sticky composer, toasts and connection bar are all sticky. Use `scroll-padding-block` equal to their heights, and keep toasts out of the tab order unless they are modal.
- **2.5.8 Target Size (Minimum), AA:** 24 × 24 CSS px, or enough spacing ([Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)). This is a floor, not the product bar:
  - Apple HIG iOS default control size is 44 × 44 pt, with a 28 × 28 pt minimum ([HIG Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)).
  - Apple: "Create controls that measure at least 44 points x 44 points" ([Apple UI Design Dos and Don'ts](https://developer.apple.com/design/tips/)).
  - M3: 48 × 48 dp ([Android Compose a11y defaults](https://developer.android.com/develop/ui/compose/accessibility/api-defaults); [M3 button groups a11y](https://m3.material.io/components/button-groups/accessibility)).
  - The WCAG AAA level (2.5.5) is 44 × 44 ([Understanding 2.5.5](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)).
  - *Hermes:* 44 px on `pointer: coarse`, a 24 px hard floor everywhere, enforced by a lint/e2e gate as PatterStage does ([README §3](README.md)).
- **2.5.7 Dragging Movements, AA:** every drag needs a single-pointer alternative. This affects Kanban, Composer canvas, sheet resizing and list reordering (§6.1).
- **3.3.8 Accessible Authentication (Minimum), AA:** passkeys and paste allowed (§9.4).
- **3.2.6 Consistent Help, A:** help is in the same place on every screen. This is PatterStage's `?` and help pattern ([README §2.12](README.md)).
- **4.1.3 Status Messages, AA:** use `role="status"` for run state and toasts ([ARIA22](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22.html)). Use `role="log"` for sequential updates such as the transcript and the logs tail ([ARIA23](https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA23)). Announce turn completion and approval requests, not every token `[INFERENCE]`.
- **2.1.4 Character Key Shortcuts, A:** single-key shortcuts can be turned off or remapped (§2.2).
- **HIG extras:**
  - "Give people the option to enlarge text by at least 200 percent."
  - "If you use a swipe gesture to dismiss a view, also make a button available."
  
  ([HIG Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)). This applies to swipe-to-archive in Sessions and Inbox.

### 10.2 Core Web Vitals at p75 on mobile
- **Who:**
  - LCP ≤ 2.5 s.
  - INP ≤ 200 ms.
  - CLS ≤ 0.1.
  
  Measure "at the 75th percentile of page loads, segmented across mobile and desktop devices" ([web.dev Web Vitals](https://web.dev/articles/vitals); [INP](https://web.dev/articles/inp)).
- **Caduceus Dashboard:**
  - Budgets are measured on a mid-range phone over the tailnet.
  - Streaming must not hurt INP: batch token appends per animation frame, and keep markdown/KaTeX/Mermaid rendering off the critical path, for example by rendering on completion or in a worker `[INFERENCE]`.
  - Reserve space for tool cards and images to protect CLS.

### 10.3 Virtualize transcripts, logs and lists with end anchoring
- **Who:** TanStack Virtual's chat contract ([TanStack Virtual: Chat](https://tanstack.com/virtual/v3/docs/chat)):
  - "the viewport should only follow new output when the user is already reading the latest item."
  - Use `anchorTo: 'end'`, `followOnAppend`, `scrollEndThreshold`.
  - Keep "older-history prepends stable".
  - "Do not use index keys for chat history."
- **Caduceus Dashboard:** Virtualize the transcript, logs tail, sessions list, skills, the cron run history and the 500-field settings search results. Use stable message or event IDs as keys. Show a "Jump to latest (n new)" pill when the user has scrolled up.

---

## 11. Gaps where none of the benchmarked products set a bar

These are areas where Caduceus Dashboard can lead rather than follow:
- **Cross-profile agent control with a per-tab profile scope.** Every benchmarked product has a single account or workspace context. Decision 6 has no direct precedent. The nearest analogue is iOS multi-install by manifest `id` plus name ([WebKit](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)).
- **Self-hosted Web Push for agent approvals.** Open WebUI notifications "fire only while the app is open; there is no push service" ([Open WebUI as an App](https://docs.openwebui.com/getting-started/open-webui-as-app/)). None of the three Hermes dashboards has push ([README §3](README.md)).
- **One inbox across chat, cron, Kanban, missions and messaging gateways.** Commercial products scope their inbox to one product surface `[INFERENCE]`.

---

## 12. Ranked requirements: what "industry-leading" means for Caduceus Dashboard

Ranked by impact on the phone-first agent-control job, then by how firmly the industry has converged on it. "Must" items define parity with the leaders; the rest set the lead.

1. **Durable, resumable runs across devices.** Use seq-based replay (`session.events.since`) with a truncation → refetch fallback, idempotent sends, a queue that resumes without duplicates, and coalesced reconnects on PWA resume.
   - Sources: [Claude Remote Control](https://code.claude.com/docs/en/remote-control) · [Codex changelog](https://developers.openai.com/codex/changelog) · `tui_gateway/event_replay.py:100-115`, `apps/shared/src/json-rpc-gateway.ts:487`.
2. **"Needs you" Inbox fed by Web Push that opens straight onto the decision.** Push deep-links to the approval or clarify sheet. Inline actions are added only where supported. Badges count only actionable items.
   - Sources: [GitHub Mobile deployment reviews](https://github.blog/changelog/2021-04-01-reviewing-deployments-on-github-mobile) · [Linear Inbox](https://linear.app/docs/inbox) · [HA actionable](https://companion.home-assistant.io/docs/notifications/actionable-notifications/) · BCD (no actions on Safari).
3. **iOS-correct push.** Request permission after Home Screen install from a user gesture, use `userVisibleOnly`, send declarative payloads (18.4+) with a SW fallback, allow `*.push.apple.com`, and dedupe server-side (no `tag` on iOS).
   - Sources: [WebKit Web Push on iOS](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) · [Meet Declarative Web Push](https://webkit.org/blog/16535/meet-declarative-web-push/) · [WebKit bug 319860](https://bugs.webkit.org/show_bug.cgi?id=319860).
4. **Typed approvals with exact previews.** Offer once / session / always / deny with reason / edit (per-tool allowed set). Never expire them silently. Escalating to always or YOLO from a phone needs step-up.
   - Sources: [LangChain HITL](https://docs.langchain.com/oss/python/langchain/human-in-the-loop) · [ChatGPT agent](https://openai.com/index/introducing-chatgpt-agent) · [Claude Code mobile limits](https://code.claude.com/docs/en/mobile) · `gateway-contract.openrpc.json:28,64,33810`.
5. **Steer / Queue / Stop / side-question as distinct composer verbs.** A cancelled queue item returns its text to the composer.
   - Sources: [Copilot steering](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents) · [Codex changelog](https://developers.openai.com/codex/changelog) · [Devin side chats](https://docs.devin.ai/work-with-devin/devin-session-tools) · `gateway-contract.openrpc.json:2962,3106,2494`.
6. **Adaptive shell by window size class.** Bottom bar below 600 px, rail from 600 to 1199, sidebar from 1200. At most 5 tabs, and the tab bar is navigation only. No device sniffing.
   - Sources: [Android window size classes](https://developer.android.com/develop/ui/views/layout/use-window-size-classes) · [M3 nav bar](https://m3.material.io/components/navigation-bar/guidelines) · [HIG Tab bars](https://developer.apple.com/design/human-interface-guidelines/tab-bars).
7. **Unified run worklog** with Stream / Worklog / Raw densities, step drill-down sheets, per-step tool, duration, tokens and cost, and visible setup phases.
   - Sources: [Devin Progress](https://docs.devin.ai/work-with-devin/devin-session-tools) · [Copilot session logs](https://github.blog/changelog/2026-03-19-more-visibility-into-copilot-coding-agent-sessions) · [Temporal views](https://docs.temporal.io/web-ui) · [LangSmith cost](https://docs.langchain.com/langsmith/cost-tracking).
8. **Global active-runs panel across all profiles**, reachable from every screen, with Steer/Stop per row.
   - Sources: [Copilot agents panel](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents) · [Cursor agents](https://cursor.com/blog/agent-web) · [Claude projects threads](https://code.claude.com/docs/en/mobile) · `session.active_list` (`:2674`).
9. **Global ⌘K command palette** fed by a module command registry. It is contextual, uses fuzzy matching and aliases, shows each shortcut, includes session FTS and settings deep links, and has a phone search-sheet equivalent.
   - Sources: [Superhuman](https://blog.superhuman.com/how-to-build-a-remarkable-command-palette/) · [Raycast Action Panel](https://manual.raycast.com/action-panel) · [Linear contextual menu](https://linear.app/changelog/2019-10-07-contextual-command-menu).
10. **HTTPS by default through Tailscale Serve** with a localhost bind. Optional identity-header SSO only when bound to localhost. Show the CT-log hostname warning. No Funnel.
    - Sources: [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve) · [Tailscale HTTPS](https://tailscale.com/docs/how-to/set-up-https-certificates).
11. **Passkey-first auth** with conditional UI, passkey management, a revocable device list, and sudo-style step-up for T3 actions. WCAG 3.3.8 compliant.
    - Sources: [web.dev passkey checklist](https://web.dev/articles/passkey-checklist) · [GitHub sudo mode](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/sudo-mode) · [Claude Trusted Devices](https://code.claude.com/docs/en/remote-control) · [WCAG 3.3.8](https://www.w3.org/WAI/WCAG22/Understanding/accessible-authentication-minimum.html).
12. **Risk-tiered friction on every command:**
    - T0: undo toast.
    - T1: confirm naming the object and profile.
    - T2: type the name, and state recoverability.
    - T3: passkey step-up.
    - Sources: [GitHub Danger Zone](https://docs.github.com/en/repositories/creating-and-managing-repositories/deleting-a-repository) · [HIG Sheets (Done paired with Cancel)](https://developer.apple.com/design/human-interface-guidelines/sheets).
13. **WCAG 2.2 AA as a release gate:**
    - 44 px targets on coarse pointers (24 px floor)
    - focus not obscured by the tab bar or composer (scroll-padding)
    - a drag alternative everywhere
    - `role=log` and `role=status` regions
    - remappable single-key shortcuts
    - text scaling to 200%
    - Sources: [WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [F110](https://www.w3.org/WAI/WCAG22/Techniques/failures/F110) · [HIG Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility).
14. **Performance budget at p75 on a mid-range phone:** LCP ≤ 2.5 s, INP ≤ 200 ms, CLS ≤ 0.1. Batch streaming per frame, and use end-anchored virtualization with stable keys for transcripts, logs and long lists.
    - Sources: [web.dev Web Vitals](https://web.dev/articles/vitals) · [TanStack Virtual Chat](https://tanstack.com/virtual/v3/docs/chat).
15. **Search-first settings** with `@modified`, `@profile`, `@restart-required`, per-field deep links and reset-to-default. Raw YAML stays as the expert path.
    - Sources: [VS Code settings](https://code.visualstudio.com/docs/configure/settings).
16. **Repairs-style health:** detected issues with severity, cause, a one-tap fix or ignore, and a count badge on Settings. The connection bar shows explicit reasons. Recurring failures are flagged automatically and clear on recovery.
    - Sources: [HA Repairs](https://www.home-assistant.io/integrations/repairs) · [Temporal task-failure flag](https://docs.temporal.io/web-ui) · [Claude RC connection reasons](https://code.claude.com/docs/en/remote-control).
17. **Workflow views that degrade gracefully:**
    - a live DAG at ≥ 1024 px; a stage list with gate badges on phone
    - Timeline / Compact / Raw run views
    - re-run from stage with the same inputs
    - human gates create Inbox items
    - Sources: [GitHub visualization graph](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-the-visualization-graph) · [GitHub Actions on Mobile](https://github.blog/changelog/2022-10-04-introducing-actions-on-github-mobile) · [n8n debug](https://docs.n8n.io/build/understand-workflows/understand-executions/debug-executions) · [LangGraph interrupts](https://docs.langchain.com/oss/python/langgraph/interrupts).
18. **A touch-native Kanban:** grouped list or snap columns on phone, "Move to…" / "Assign…" sheets, multi-select, and drag only as an enhancement.
    - Sources: [WCAG 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html) · [Linear PWA DnD fix](https://linear.app/changelog/2024-09-19-introducing-linear-mobile) · [Cursor Kanban](https://cursor.com/blog/agent-web).
19. **Live logs** with a structured query (`level:` `@profile:` and phrases), server-side search, pause-on-scroll, "jump to live" and entity-scoped deep links.
    - Sources: [Vercel Runtime Logs](https://vercel.com/docs/logs/runtime) · [Railway Logs](https://docs.railway.com/observability/logs).
20. **Cost and usage at every level:** turn chip → session total (cache %) → profile, model and source dashboards, plus budgets with a hard stop for unattended runs.
    - Sources: [LangSmith cost tracking](https://docs.langchain.com/langsmith/cost-tracking) · [Devin ACU sizing](https://docs.devin.ai/product-guides/session-insights) · `session.usage` (`:3160`).
21. **Session organisation on Hermes primitives:**
    - Hermes projects
    - pins and unread state
    - archive before delete
    - saved views in the URL
    - FTS including archived sessions
    - fork from any message with explicit scope
    - read-only share links
    - Sources: [ChatGPT Projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt) · [Open WebUI folders](https://docs.openwebui.com/features/chat-conversations/chat-features/conversation-organization/) · [LibreChat fork](https://www.librechat.ai/docs/features/fork) · `projects.*` (`:2224-2350`), `session.branch` (`:2692`).
22. **Presence-aware, user-categorised notifications.** Suppress push while a Caduceus client is visible. Per-device categories, a digest option, and OS Focus respected.
    - Sources: [Claude RC push](https://code.claude.com/docs/en/remote-control) · [Linear Notifications](https://linear.app/docs/notifications) · [ChatGPT tasks](https://help.openai.com/en/articles/10291617-scheduled-tasks-in-chatgpt).
23. **Platform-honest installability:**
    - a Chromium install button
    - an iOS "Add to Home Screen" guide after a meaningful action, with dismissal remembered
    - manifest `id`, with per-profile installs allowed
    - a desktop → phone QR handoff that carries no secret
    - Sources: [web.dev customize install](https://web.dev/articles/customize-install) · [web.dev promote install](https://web.dev/articles/promote-install) · [WebKit manifest id](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) · [Claude `/mobile` QR](https://code.claude.com/docs/en/mobile).
24. **Offline shell with honest staleness:**
    - precached shell
    - read-only cached lists with timestamps
    - local and server drafts
    - an IndexedDB outbox for low-risk writes, flushed in the foreground (no Background Sync on iOS)
    - live-only approvals, steer and stop
    - Sources: [web.dev PWA architecture](https://web.dev/learn/pwa/architecture) · [WebKit tracking prevention (Home Screen exemption)](https://webkit.org/tracking-prevention) · [WebKit storage policy](https://www.webkit.org/blog/14403/updates-to-storage-policy) · BCD `SyncManager`.
25. **Traceability and phone-grade review:**
    - every agent output links to its session and turn
    - a Changes pane with a unified diff on compact width
    - commit or PR from the phone where git APIs exist
    - voice inside the chat with the transcript visible
    - Sources: [Copilot commit → session log](https://docs.github.com/en/copilot/how-tos/copilot-on-github/use-copilot-agents/manage-and-track-agents) · [Claude RC diff pane](https://code.claude.com/docs/en/remote-control) · [Codex review & PR](https://learn.chatgpt.com/docs/cloud) · [ChatGPT Voice](https://help.openai.com/en/articles/20001274-voice-mode-faq).
