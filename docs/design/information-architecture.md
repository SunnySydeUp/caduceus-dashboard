# Information Architecture & Navigation

Scope: every capability in the research feature matrix (`../research/README.md` §2) has exactly one home. Gamification and Story Weaver are excluded (decision 8). Feature areas are **modules** in an internal registry (decision 7): each module declares its nav entry, routes, command-palette actions, Inbox sources and settings panel. Adding a module later means adding one registry entry.

## 1. Destinations and modules

| Group | Module / screen | Contains (merged from Dash · WebUI · PatterStage) |
|---|---|---|
| Desk | **Today** (`/today`) | The opening screen. **Needs you**: one card per open approval, question or choice, answerable in place. **Ready for review**: work that is done and not opened since (Kanban tasks, finished background runs). Crew tiles (phone). **Today's schedule**: a 24-hour bar with a Now marker. **While you were away**: runs and routine results since the last visit |
| Desk | **Talk** (`/chat`) | An agent's thread with its sessions kept (§4): session list, transcript, composer with the intents Ask, Delegate and Repeat, Details (Right now, workspace preview with Take over, Work, About), and the decide-anywhere tray for decisions of other agents |
| Desk | **Work** › Overview (`/work`) | Everything with a lifecycle, by state: Waiting on you, Running, Ready for review, Scheduled. The agent scope (the card head; the app bar's chip on a phone) narrows it. Board, Tasks, Schedules, Playbooks and Projects are views from here (below) |
| Desk | **Crew** (in the sidebar, rail and Today) | One row per profile: sigil, name, live line, time. It opens that agent's thread |
| Control › Main | **Notices** (`/notices`) | What is not a decision: failed notices, FYI notices and items without a decision, with their actions, snooze and dismiss, and the Activity feed (runs that finished). Decisions are on Today and in the Talk tray (`work-model.md` §2.5) |
| Work | **Board** | Kanban boards, lanes by status or profile, filters, dispatcher controls, orchestration settings |
| Work | **Tasks** | Saved-filter list of tasks, and the task detail view |
| Work | **Playbooks** | Library, graph or stage-list view, run form, runs grouped by playbook |
| Work | **Schedules** | Hermes cron (agent, script, create-task and blueprint job types), run history, blueprints gallery |
| Work | **Projects** | `projects.db` projects, the repo and docs overview ("Project OS"), and the boards linked to each |
| Agents | **Profiles** | Cards, Profile Builder wizard, per-profile tabs. Detail in §5 |
| Agents | **Skills** | Installed (toggle, edit, delete, usage stats), Hub (9 sources, security scan, install, update all), Learn-a-skill, curator |
| Agents | **Memory** | MEMORY.md / USER.md editors, memory provider and context engine settings, Hindsight browser, external notes, LLM Wiki, learning graph |
| Agents | **Models** | Main model; every `auxiliary.*` slot in Hermes's config schema (each existing UI shows only a subset of 11–12; the union across them is 15); Mixture-of-Agents presets, fallback chain, live catalogue, per-model usage cards with "Use as…" |
| Agents | **Tools & MCP** | Toolsets (provider, keys, setup), MCP servers (add, edit, OAuth, test, toggle, tool inventory), MCP catalogue, shell hooks, tool gateway routing |
| Connect | **Gateway** | Start / stop / restart, per-profile status, multiplex migration, health |
| Connect | **Channels** | 23+ platforms: configure, test, QR onboarding (Telegram, WhatsApp), allowed users |
| Connect | **Pairing** | Pending and approved DM users |
| Connect | **Webhooks** | Receiver, subscriptions, one-time secrets |
| Workspace | **Files** | Tree, preview and editor (code, markdown, office, PDF, media), upload, move, rename |
| Workspace | **Git** | Status, diff, stage, AI commit message, commit, pull / push, branches, worktrees |
| Workspace | **Checkpoints** | Shadow-git checkpoints: diff, restore, prune |
| Workspace | **Terminal** | Real PTY shell, plus an optional TUI mode for chat |
| Workspace | **Artifacts** | Files produced by sessions, runs and playbooks (reports, deliverables) |
| Observe | **Insights** | Token, cost and cache analytics with charts, per model, per source and per playbook; activity heatmap; provider quota; budgets |
| Observe | **Logs** | Streaming tail, server-side search, filters, download |
| Observe | **Health** | Subsystems (each with an actionable reason), host stats, resource pressure, diagnostics |
| System | **Config** | Schema-driven form with search, raw YAML with validation, import / export / reset |
| System | **Keys & Auth** | Provider keys (audited reveal), OAuth logins, credential pool, custom endpoints |
| System | **Plugins** | Hermes plugin install / update / enable, curated catalogue |
| System | **Maintenance** | Update Hermes (and Caduceus), backup / restore, doctor, security audit, debug share, support dump, `hermes>` console |
| System | **Security** | Dashboard auth (password, passkeys, OIDC), signed-in devices and sessions with revoke, Web Push subscriptions, read-only mode |
| — | **Settings** | Appearance (theme, skin, density, font size), notifications, composer chips, keyboard, accessibility |

**Where the old modules went (M8, the Desk).** Home and the Inbox decision list are retired. Home's waiting-for-you and running-now blocks are on Today (Needs you, the crew, While you were away) and Work (Running). Its health strip and spend are no longer on a front screen: Health and Insights (Control › Observe) hold them. The Inbox's decisions (approvals, questions, task reviews) are on Today and in the Talk tray. What the Inbox kept that is not a decision, and its Activity feed, are in Notices. The Inbox's data layer (live stream, model, decision component) stays as code and feeds Today, the tray, Work and the crew. The old addresses `/`, `/home`, `/inbox` and `/inbox/:itemId` redirect to `/today`, and `/more` to `/control`. Settings › Navigation (reordering the tab bar) is gone: the three places are fixed.

## 2. Navigation by window size

Nav switches on **window width**, never device detection. It uses Material 3 / Android adaptive breakpoints: navigation bar < 600, navigation rail 600–1199, persistent sidebar ≥ 1200 (`../research/industry-patterns.md` §1). Breakpoints are tokens in `tokens.css`.

| | Compact < 600 (phone) | Medium 600–1199 (tablet, foldable, small laptop) | Large ≥ 1200 (desktop) |
|---|---|---|---|
| Primary nav | **Bottom tab bar (a floating dock), 4 tabs:** Today (badge counts only items that need the owner, per Apple HIG) · Talk · Work · More. Only the current tab shows its label. Talk has a bridge row of sigils to switch agent | Navigation rail: the scope, Search, Today, Talk, Work, one sigil per agent, then Help and Control in a fixed foot. Its menu button opens the full Desk as a drawer | Persistent sidebar: the scope (head), Search, Today, Talk, Work, the crew (one row per profile: sigil, name, live line, time; the only part that scrolls), then Help and Control in a fixed foot. It collapses to the rail (remembered per device) |
| Control | **More** opens `/control`: every other module, in groups, with search | The rail's Control item opens the same list | Control in the sidebar opens the same list |
| List / detail | Push navigation (list → detail); detail sheets for quick views. Talk's Details and session list are sheets | Two panes when ≥ 720 px | Two or three panes. Talk shows its session column and a Details panel |
| Search / palette | App-bar search button opens a full-screen palette | ⌘K / the Search item in the rail | ⌘K / the search field in the sidebar, `/` in the composer, `?` shortcut sheet |
| Chat composer settings | Single config sheet (WebUI pattern) | Chips | Chips in the composer footer |
| Back | Hardware/gesture back pops the route; sheets close first | same | Browser back |
| Shortcuts | — | Hardware keyboard: same as desktop | ⌘K palette (session search lives inside it), ⇧⌘O new chat, `g`+letter, `j/k`. Single-letter shortcuts can be turned off (WCAG 2.1.4) |

The tab bar is a floating dock above the safe area. It shrinks while scrolling down in long lists and returns on scroll up; it hides while the keyboard is open in Talk. Its tap targets are ≥ 48 px. Moving between places animates (design-system §4.7, "Moving across the Desk").

Navigation is data, not code. Every module declares a Desk placement (`today`, `talk`, `work` or `control`) in the registry; `deskNavigation` (`web/src/shell/nav-order.ts`) turns the registry and the crew into the tab bar, rail, sidebar and Control. The crew is ordered waiting (longest wait first), blocked, working, finished, idle.

## 3. Global chrome
- **App bar: phones only (< 600 px).** Back or the mark, the title once the heading has scrolled away, an **agent chip** (decision 6: sigil + name; tapping it opens the agent switcher as a bottom sheet), a realtime status dot (connected / reconnecting / offline), search / palette and help. A screen can put one button in the bar's slot (`#appbar-slot`).
- **From 600 px there is no app bar.** Everything it held moved:
  - the **scope** is the head of the side card: the scope's sigil, with the connection as a ring round it (the heartbeat: steady success ring connected, steady warning ring reconnecting, dashed neutral ring offline), and the scope's name, opening the agent switcher: from 600 px a popover anchored under the head (beside the button in the rail) that moves between agents with the arrow keys and gives focus back to the head on close, and a bottom sheet on a phone. It is the only agent control on a page: a screen that follows the scope (Work, Schedules) has no agent filter of its own. On Talk it shows the open agent; on a screen locked to All agents (Today) it is plain text, nothing to switch. In the rail it is a 44 px sigil button with a label. Its accessible name says the connection in words;
  - **search** is one slim field under the card head ("Search or jump to…", ⌘K), a Search item in the rail;
  - **Help** (route-aware) and Control are the card's foot, which never scrolls away; only the crew scrolls inside the card;
  - the **breadcrumb** of a deep page (a task, Health under Observe) is linked text above the title in the page header;
  - Work's **views** are canvas tabs at the top of the page column;
  - the page starts at the top of the window, level with the card's top edge.
- **Banner stack.** At most one banner is visible at a time, ordered by priority; the rest collapse into a "+N" pill. Banners cover: offline / reconnecting, resource pressure, gateway down, budget exceeded, update available. From 600 px the connection banner is sticky at the top of the page column; on a phone it is a sticky one-line strip under the app bar ("Offline since 9:57"); a tap opens the full words in a bottom sheet. Either way an unhealthy connection stays said in words while the page scrolls.
- **No false reassurance.** Nothing says "nothing" when it cannot look. **Before Hermes answers**, the crew's live line is a skeleton (screen readers hear "Reading…"), then "Still reading Hermes…", and "Nothing going on" appears only once the Inbox stream is live, the ready list has answered and Hermes is up (`modules/crew/knowledge.ts`); "Needs you" is a skeleton until its reads answer, never "Nothing needs you right now" before. **While the device is offline**, Today is a reading mode (owner decision: Today only; Work and Talk keep their own offline words): what was loaded stays, marked "As of 9:57", the time that block last answered (the decisions and the crew, which are a live stream, are as of the drop); a block whose last answer was empty says what it found and when ("Nothing here as of 9:57."), never "right now"; a crew tile keeps what it knew with the time ("Waiting on you · As of 9:57"), and one whose state was never known says only "Can't check", with no time; a block with nothing loaded steps out of the way, and one line at the top of Today names those blocks ("Today shows what was loaded. Needs you and Reminders load when you are back online."); no per-block failure panel, no Retry, no cached cause; Today's actions that need the network are switched off and named "… Needs a connection" (`NetworkAction`), while navigation, Help and the palette stay live; Talk's latest conversation says "Waiting for a connection". When the link comes back, a brief "Back online" toast says so and the blocks read again. **When Hermes is up but a read failed**: Work's header says "Can't check right now" (visibly) and its "Nothing is going on" is not shown while the list is flagged incomplete; Today's "Needs you" says "Can't check right now."; an idle agent's line reads "Can't check" (state words "State unknown"). A failed read says its cause in plain words from one table (`failure-words.ts`): "You are offline", "Can't reach your Mac", "Hermes isn't answering", "Hermes doesn't offer this yet" and a few more; the raw code is behind Details. "Hermes doesn't offer this yet" is the one cause asking again cannot help: Today's blocks and Talk's session list show "Update Hermes to get it." in its place, in the info tone, with no Retry. The heartbeat's words are about the connection only (owner decision).
- **Today's one voice** (`modules/today/today-voice.ts`). One cause is said once. When two or more of Today's blocks failed with the same cause, one banner at the top of Today says it ("Hermes isn't answering. Today couldn't read Ready for review and Today's schedule.") with one Retry for all of them and Open Health; the blocks then say only "Can't check right now.". When two or more blocks are slow at once, one line says "Still reading Hermes…" for them, and the blocks drop their own note. One block alone still says its own. **Needs a look** lists failures in danger red and Health's warnings (`InboxNotice.warning`: something needs a look and has not failed, such as a check that could not be made) in the warning tone, with the tone's glyph for a row that belongs to no agent; the line (the cause and what happens next) is never cut, and the time sits on the title row.
- **Slow first read, one ladder** (`read-ladder.ts`, used by the crew, Today's blocks, Talk's skeleton and the agent switcher's list). A skeleton with no words; after about 8 s "Still reading Hermes…" (no alarm, nothing to press; on Today it sits at the top of the block, on the title row); only when the read has failed, or passed about 30 s, "Couldn't be read" with a Retry. **While the device is offline the ladder is not climbed** (`offline`, owner decision): a read on its way or one that failed says at once that it loads when the device is back online, with nothing to press, and the crew's lines say "Can't check"; the wait is timed only while the device has a network, so a read that waited through a drop starts from no time. The wait counts from when the read was asked, not from when the block was drawn (`isReading`): a block from `useBlock` says whether it has asked (`asked`, kept by `mapBlock`), and Today's hand-built schedule and away blocks set it from the same conditions that hold them back (the review state answered; the visit recorded after the first paint), so a block below the first screen never calls its wait slow. A slow read never says "couldn't be read" and then heals. The last known crew is remembered on the device (`caduceus.crew`): the crew's skeleton rows and the switcher's list open from those names at once, and if the fresh read fails the switcher says "Couldn't read the agents" with Retry inside the list. The scope is pending until Hermes has answered: a cross-agent screen (Work) shows All agents from the start; a screen that names one agent (Talk) shows the remembered name dimmed, with "Checking…" as its accessible text, never a confident wrong name.
- **Toasts** go in a live region placed above the tab bar or composer. They never cover primary actions.

## 4. Talk screen anatomy (the chat thread)

| Region | Desktop | Phone |
|---|---|---|
| Sessions pane | **Sessions are kept** (owner decision). A column beside the thread: the agent's own sessions (All profiles widens the list), latest one open. Source filter (WebUI / CLI / Telegram / Discord / … / cron / kanban / Claude Code), projects, pins, archive, fork, FTS search | A **Sessions** button in the thread header opens the list as a sheet; swipe actions on rows |
| Transcript | Centre, max measure about 78ch. Message actions; tool, reasoning and subagent cards; activity mode (Worklog / Stream / Final only) | Full screen; the jump button sits above the composer |
| Composer | One composer with three intents, per message, back to Ask after sending: **Ask** sends; **Delegate** starts a Hermes background run and notifies when it needs the owner or finishes; **Repeat** opens the schedule builder with the message and the agent. A hint says what the chosen intent does. Footer chips: profile, model, reasoning, workspace, context ring, attach, voice, saved prompts, toolsets; busy modes Queue / Interrupt / Steer | Collapsed into icons plus one config sheet. Voice is a large hold-to-talk control |
| Live run controls | Approval and clarify cards inline above the composer (keyboard: ↵ = allow once) | Same cards as bottom sheets; also delivered as push notifications with actions |
| Details (context panel) | Right panel: Right now, workspace preview (Terminal, Files, Browser; Take over), Plan and run (Todo, Run: subagents, goal, usage), Work, About (model, folder, cost, context) | A sheet, opened from the thread header's Details button |
| Decide-anywhere tray | Above the composer: "N more need you elsewhere" with the sigils of the other agents that wait, and the decisions of other agents and of other sessions of the same agent (labelled with the session title), answerable in place. Hidden when nothing else waits. The open session's own decision stays inline | Same, above the composer |
| Terminal mode | Entered from the thread's More menu. While it is open, its toggle ("Terminal mode", pressed, returns to the chat) is in the page header's actions on a tablet or desktop (an icon in the app bar's slot on a phone): the embedded TUI over `/api/pty` for power users. Details › Take over opens it after a T2 confirmation (passkey) | Opens through Details › Take over only (touch-hostile otherwise, upstream bugs #81119 / #76002) |

## 5. Profile detail tabs
Overview (gateway status, model, counts, performance: runs and success rate) · Identity (SOUL.md) · Instructions (AGENTS.md / HERMES.md) · Memory (MEMORY.md / USER.md) · Skills · Tools & MCP · Model · Gateway & channels · Files (config.yaml raw) · Danger zone (rename, export / import, delete).

All editors write Hermes files directly through the Hermes API (decision 1). There is no push/pull and no drift layer: PatterStage's drift UI is unnecessary when there is only one copy.

## 6. Profile scope (decision 6)
- **Effective profile**, in priority order:
  1. the `?profile=` URL parameter;
  2. this device's last-used profile;
  3. Hermes's active / default profile.
- Every profile-scoped request carries it. This matches how the Hermes REST API is already scoped.
- Switching the profile in one tab never affects other tabs or devices. **Make default** in Profiles is the only action that writes Hermes's sticky `active_profile`.
- **Always All agents:** Today, and the screens whose data is Hermes-wide (the Control list, Health, Gateway, Maintenance, Plugins, Profiles, Artifacts). The tab's agent never filters them, also when the address names one, and the scope there is plain text, "All agents", with no switcher. The tab keeps its agent for the other screens.
- **One switcher on phone Talk:** the bridge row of sigils switches agent there, so the app bar's agent chip is not shown on Talk.
- **Cross-profile by default:** Work (its state view), Notices, Board (kanban.db is shared across profiles), Schedules, the session history search, and Insights.
- These views show a profile column or badge; the agent scope narrows them, with no filter of their own (Today shows each item's profile and cannot be narrowed). Profile-only screens (Memory, Skills, Model, Config, Keys) show the scoped profile in the page header.

## 7. URL scheme (deep-linkable, shareable to notifications)
```
/today  /chat  /chat/:sessionId  /chat/new?prompt=&profile=
/notices  /control
/work  (the Work screens below hang off it)  (/, /home, /inbox and /inbox/:itemId redirect to /today; /more redirects to /control)
/work/board/:board?  /work/tasks?filter=  /work/tasks/:taskId  /work/runs/:runId
/work/playbooks  /work/playbooks/:id  /work/playbooks/:id/runs/:rootTaskId
/work/schedules  /work/schedules/:jobId  /work/projects/:projectId
/agents/profiles  /agents/profiles/new  /agents/profiles/:name/:tab
/agents/skills  /agents/skills/hub  /agents/skills/:path*
/agents/memory/:tab  /agents/models/:tab  /agents/tools/:tab
/connect/gateway  /connect/channels/:platform?  /connect/pairing  /connect/webhooks
/workspace/files/*path  /workspace/git  /workspace/checkpoints  /workspace/terminal  /workspace/artifacts
/observe/insights  /observe/logs?file=&q=  /observe/health
/system/config/:category?  /system/keys  /system/plugins  /system/maintenance  /system/security
/settings/:section
```
All list state (filters, sort, tab, search) lives in the URL. `?profile=` is valid everywhere.

## 8. Command palette (⌘K; search button on phone)
- **Navigate:** every route above, fuzzy matched using Hermes's shared `fuzzy.ts`.
- **Act** (the action set changes with the current screen):
  - global: new chat, new task, run playbook…, run cron job now…, restart gateway, switch profile / model / theme;
  - context: the actions of the current screen, for example retry a run.
- **Search:** sessions (FTS), tasks, skills, playbooks, config keys, settings, docs.
- **Ask Hermes:** sends the query as a new chat.
- **Keyboard:** `g` then a letter jumps to a destination (Linear-style); `j/k` moves through lists; `?` opens the shortcut sheet. All shortcuts can be remapped in Settings › Keyboard.
