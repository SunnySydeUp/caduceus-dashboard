# Information Architecture & Navigation

Scope: every capability in the research feature matrix (`../research/README.md` §2) has exactly one home. Gamification and Story Weaver are excluded (decision 8). Feature areas are **modules** in an internal registry (decision 7): each module declares its nav entry, routes, command-palette actions, Inbox sources and settings panel. Adding a module later means adding one registry entry.

## 1. Destinations and modules

| Group | Module / screen | Contains (merged from Dash · WebUI · PatterStage) |
|---|---|---|
| Desk | **Today** (`/today`) | The opening screen. **Needs you**: one card per open approval, question or choice, answerable in place. **Ready for review**: work that is done and not opened since (Kanban tasks, finished background runs). Crew tiles (phone). **Today's schedule**: a 24-hour bar with a Now marker. **While you were away**: runs and routine results since the last visit |
| Desk | **Talk** (`/chat`) | An agent's thread with its sessions kept (§4): session list, transcript, composer with the intents Ask, Delegate and Repeat, Details (Right now, workspace preview with Take over, Work, About), and the decide-anywhere tray for decisions of other agents |
| Desk | **Work** › Overview (`/work`) | Everything with a lifecycle, by state: Waiting on you, Running, Ready for review, Scheduled. An agent filter narrows it. Board, Tasks, Schedules, Playbooks and Projects are views from here (below) |
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
| Primary nav | **Bottom tab bar, 4 tabs:** Today (badge counts only items that need the owner, per Apple HIG) · Talk · Work · More. Talk has a bridge row of sigils to switch agent | Navigation rail: Today, Talk, Work, one sigil per agent, Search, Control. Its menu button opens the full Desk as a drawer | Persistent sidebar: Today, Talk, Work, then the crew (one row per profile: sigil, name, live line, time), then Search and Control. It collapses to the rail (remembered per device) |
| Control | **More** opens `/control`: every other module, in groups, with search | The rail's Control item opens the same list | Control in the sidebar opens the same list |
| List / detail | Push navigation (list → detail); detail sheets for quick views. Talk's Details and session list are sheets | Two panes when ≥ 720 px | Two or three panes. Talk shows its session column and a Details panel |
| Search / palette | App-bar search button opens a full-screen palette | ⌘K / search button | ⌘K, `/` in the composer, `?` shortcut sheet |
| Chat composer settings | Single config sheet (WebUI pattern) | Chips | Chips in the composer footer |
| Back | Hardware/gesture back pops the route; sheets close first | same | Browser back |
| Shortcuts | — | Hardware keyboard: same as desktop | ⌘K palette (session search lives inside it), ⇧⌘O new chat, `g`+letter, `j/k`. Single-letter shortcuts can be turned off (WCAG 2.1.4) |

The tab bar hides while scrolling down in long lists, and while the keyboard is open in Talk. It reappears on scroll up. Its tap targets are ≥ 48 px and it respects `safe-area-inset-bottom`.

Navigation is data, not code. Every module declares a Desk placement (`today`, `talk`, `work` or `control`) in the registry; `deskNavigation` (`web/src/shell/nav-order.ts`) turns the registry and the crew into the tab bar, rail, sidebar and Control. The crew is ordered waiting (longest wait first), blocked, working, finished, idle.

## 3. Global chrome
- **App bar**, from left to right:
  - the context title or breadcrumb;
  - a **profile chip** (decision 6: sigil + name; tapping it opens a profile switcher sheet);
  - a realtime status dot (connected / reconnecting / offline);
  - search / palette.
  
  On desktop the profile chip also shows "All profiles" on cross-profile views.
- **Banner stack.** At most one banner is visible at a time, ordered by priority; the rest collapse into a "+N" pill. Banners cover: offline / reconnecting, resource pressure, gateway down, budget exceeded, update available.
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
| Terminal mode | Toggle in the app bar: the embedded TUI over `/api/pty` for power users. Details › Take over opens it after a T2 confirmation (passkey) | Opens through Details › Take over only (touch-hostile otherwise, upstream bugs #81119 / #76002) |

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
- **Always All profiles:** Today. The tab's profile never filters it, also when the address names one, and its profile chip says All profiles and opens no switcher. The tab keeps its profile for the other screens.
- **Cross-profile by default:** Work (its state view), Notices, Board (kanban.db is shared across profiles), Schedules, the session history search, and Insights.
- These views show a profile column or badge and a filter (Today shows each item's profile, with no filter). Profile-only screens (Memory, Skills, Model, Config, Keys) show the scoped profile in the page header.

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
