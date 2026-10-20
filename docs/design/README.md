# Caduceus Dashboard — Design Package

A standalone, mobile-first PWA that manages everything in Hermes Agent. It includes every feature of the Hermes default dashboard, Hermes WebUI and PatterStage, with Hermes as the single source of truth.

## Documents

| Doc | What it settles |
|---|---|
| [architecture.md](architecture.md) | System shape (Caduceus server BFF + spawned `hermes serve` + Tailscale Serve), data ownership, Hermes interfaces, realtime/resume/push, security tiers, stack, operations |
| [information-architecture.md](information-architecture.md) | Modules, adaptive navigation (bar / rail / sidebar), chat anatomy, profile scope, URL scheme, command palette |
| [work-model.md](work-model.md) | Unified Tasks · Playbooks · Schedules · Inbox · Budgets on Hermes Kanban and cron |
| [mobile-and-interaction.md](mobile-and-interaction.md) | Phone patterns, gestures, notifications, offline, accessibility and performance gates |
| [feature-traceability.md](feature-traceability.md) | Every feature from the three dashboards, mapped to its screen, the Hermes interface or Caduceus requirement that backs it, and its milestone |
| [design-system.md](design-system.md) · [tokens.css](tokens.css) · [specimen.html](specimen.html) | Visual language, tokens, components |
| [prototype/](prototype/) | Clickable prototype of the pre-Desk design (mock data, throwaway). Screens: Home, Chat, Inbox, Board, Tasks + brief editor + runs, Schedules, Playbooks (graph + run gate), Profiles + builder, Config, Keys, Health. The Desk's own mocks are in [mocks/desk/](mocks/desk/). Other routes show a summary of the module. Run: `cd ~/hermes-dashboard/docs/design && python3 -m http.server 8091 --bind 127.0.0.1`, then open http://127.0.0.1:8091/prototype/ (port 8090 is taken by OrbStack on this Mac) |

Research behind it: [../research/README.md](../research/README.md) (feature matrix), [hermes-protocol.md](../research/hermes-protocol.md), [hermes-api-coverage.md](../research/hermes-api-coverage.md), [industry-patterns.md](../research/industry-patterns.md).

## Decision log

| # | Decision | Source | Consequence |
|---|---|---|---|
| D1 | **Hermes is the source of truth** | user | No shadow copies of Hermes data and no push/pull drift layer. Caduceus state is limited to things Hermes lacks, stored in `HERMES_ROOT/caduceus/` (included in `hermes backup`) |
| D2 | **Standalone full solution that manages everything through Hermes's own interfaces** | user | Caduceus server (BFF) + spawned loopback `hermes serve` (Hermes Desktop's launcher contract). Hermes REST + OpenRPC gateway; no in-process imports (architecture §1) |
| D3 | Native chat by default; TUI terminal is optional | user (accepted recommendation) | Chat on `/api/ws` with vendored `@hermes/shared`; `/api/pty` terminal mode on desktop only |
| D4 | **The best unified work model** | user ("build the best version") | Tasks = Hermes Kanban tasks; Templates and Playbooks use Kanban's reserved `workflow_template_id`/`current_step_key`; gates = `review`; clarify = `needs_input`; Deep Research = a Playbook; one Inbox (work-model.md) |
| D5 | Hermes cron is the only scheduler; scripts are a job type | user (accepted recommendation) | Four cron job types incl. "create task / run playbook"; no Caduceus scheduler, no host crontab |
| D6 | Profile scope per tab in the URL; "Make default" is explicit | defaulted (no answer given), conservative | `?profile=` > device's last profile > Hermes active. Today, Notices, Board, Schedules, History and Insights are cross-profile |
| D7 | No third-party UI plugin SDK in v1; internal module registry | defaulted, matches "I'll build the dashboard as I need it" | Each module registers nav, routes, palette commands, Inbox sources, settings and risk-tier policy. Hermes plugin *management* stays an admin feature |
| D8 | No gamification and no Story Weaver | user | Achievements, quests, XP and the Rec Room are dropped |
| D9 | Tailnet-only HTTPS on `:9443` via Tailscale Serve | evidence | `:443` on this node is already a public Funnel; Serve and Funnel cannot share a port; a secure context is needed for SW, push, passkeys and mic |
| D10 | Passkey-first Caduceus auth with step-up for T2/T3 actions | evidence + industry bar | Hermes has no per-method authorisation; the policy proxy enforces tiers, denies exec/vault/billing in v1, and supports read-only mode |

## Milestones ("build as you need it")

Each milestone ships on its own and leaves Caduceus usable. M0 is required first; after that the order can follow what you need.

| M | Name | Delivers |
|---|---|---|
| **M0** | Foundation | Caduceus server (spawned `hermes serve`, policy proxy, auth with passkeys/password, Caduceus API, `caduceus.db`); Tailscale Serve setup; PWA shell with adaptive nav, command-palette skeleton, themes/density, module registry; pinned contracts and codegen; gateway client with resume; Health basics |
| **M1** | Chat | Sessions pane (sources, projects, pins, archive, FTS, cross-profile), transcript (tool/reasoning/subagent cards, three activity modes), composer (chips, config sheet, attachments, slash commands, saved prompts, drafts), approvals and clarify, Steer/Queue/Interrupt/`/btw`/`/background`/`/goal`, model and reasoning per session, context ring and compress, fork/edit/regenerate, todos, desktop terminal mode |
| **M2** | Inbox + Push | Inbox (all sources in work-model §2.5), Web Push (VAPID, iOS-correct, presence-aware, deduped), install flow, notification settings, the Home overview. As shipped in M2: M8 replaced the Home overview and the Inbox screen with Today and Notices; the Inbox's data layer stays |
| **M3** | Work | Board, Tasks, Task detail, Runs, Brief editor, Templates, Schedules (4 job types, run history, blueprints, monitor options), Projects |
| **M4** | Agents | Profiles (builder, SOUL/AGENTS/memory editors, export/import), Skills (+ hub, scan, curator), Memory (providers, Hindsight, learning graph), Models (all aux slots, MoA, fallback chain, usage cards), Tools & MCP (+ catalogue, hooks) |
| **M5** | Operate | Connect (gateway, channels with QR, pairing, webhooks), Observe (Insights with cost, Logs streaming + search, Health "Repairs"), System (Config schema + YAML, Keys/OAuth/credential pool, Plugins, Maintenance, Security) |
| **M6** | Orchestrate | Playbook engine (graph ≥1024 px, stage list on phone, gates, loops), Deep Research playbook, Artifacts, budget guard with hard stop for unattended work |
| **M7** | Workspace & media | Files (preview/edit), Git panel, Checkpoints, PTY shell, share links, voice (dictation, hands-free, TTS) |
| **M8** | The Desk | Today, Talk (an agent's thread, sessions kept), Work by state, the crew and sigils, the decide-anywhere tray, composer intents (Ask, Delegate, Repeat), the Desk skin; Home and the Inbox decision list retired, Notices in Control (mocks in [mocks/desk/](mocks/desk/)) |
