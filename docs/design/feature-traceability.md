# Feature Traceability — every dashboard feature in the Caduceus Dashboard

Proof that Caduceus incorporates every capability of the Hermes Dashboard (**D**), Hermes WebUI (**W**) and PatterStage (**P**). Sources: research `README.md` §2.1–§2.12 (the unified matrix: all 117 rows), the per-dashboard §4 inventories (`hermes-dashboard.md`, `hermes-webui.md`, `patterstage.md`; extra features the matrix collapsed are marked `+`), backing from `hermes-api-coverage.md` (**cov**) §2/§3 and `hermes-protocol.md` (**proto**) §0/§6, placement from `information-architecture.md` (**IA**) §1/§4/§7, `work-model.md` and `architecture.md`. Decisions D1–D10 and milestones M0–M7 are in [README.md](README.md).

> **Screen names after the Desk (M8).** The "Screen" column was written for the first design. Home and the Inbox screen no longer exist. Read **Home** as Today (Needs you, the crew, While you were away) and Work (Running); Home's health strip is gone from the landing screen (Health, in Control, stays), and Home's spend is in Talk's Details and Insights. Read **Inbox** as Today (decisions), the Talk tray and Notices (Control › Main). Chat is Talk. The map is in `information-architecture.md` §1.

## Legend

| Column | Meaning |
|---|---|
| Ref | `2.x.n` = row *n* of research README §2.x (counted top to bottom); `+` = from a §4 inventory, not a separate matrix row |
| From | Which dashboards have it (◐ = partial, API = backend only) |
| Backing | Hermes REST / RPC / WS / file, Caduceus requirement **Rn** (cov §3), or `CLIENT` |
| Status | **USED**: Hermes backs it and a first-party Hermes UI uses it (stock Dash, its kanban UI, or the TUI it embeds — cov §1 rule, extended to TUI for chat rows per proto §6). **UNUSED**: Hermes backs it, no stock Dash UI uses it → free win. **PARTIAL**: Hermes backs part; remainder in Notes. **Caduceus-owned**: Hermes has nothing (cov GAP) → Caduceus requirement Rn. **CLIENT**: pure UI. **Replaced**: intentionally superseded by a better design (replacement in Notes). **Dropped (D8)**: removed by decision 8. **Not carried**: deliberately not built, with reason |
| Milestone | M0–M7 per README; `—` for Replaced/Dropped/Not carried rows that need no build of their own |

## Summary

**207 rows**: 118 matrix rows (all of §2.1–§2.12, each exactly once) + 89 `+` rows from the §4 inventories.

### Count per status

| Status | All rows | Matrix rows | `+` rows |
|---|---|---|---|
| USED | 94 | 59 | 35 |
| UNUSED | 22 | 12 | 10 |
| PARTIAL | 24 | 22 | 2 |
| Caduceus-owned | 18 | 11 | 7 |
| CLIENT | 18 | 9 | 9 |
| Replaced | 26 | 3 | 23 |
| Dropped (D8) | 4 | 2 | 2 |
| Not carried | 1 | 0 | 1 |
| **Total** | **207** | **118** | **89** |

### Count per milestone

| Milestone | Rows |
|---|---|
| M0 | 19 |
| M1 | 51 |
| M2 | 4 |
| M3 | 25 |
| M4 | 41 |
| M5 | 34 |
| M6 | 5 |
| M7 | 7 |
| — | 21 |
| **Total** | **207** |

### Count per module

| Module | Rows |
|---|---|
| Shell / Platform | 17 |
| Home | 2 |
| Chat | 54 |
| Inbox | 4 |
| Work › Board | 5 |
| Work › Tasks | 6 |
| Work › Playbooks | 4 |
| Work › Schedules | 12 |
| Work › Projects | 2 |
| Agents › Profiles | 14 |
| Agents › Skills | 8 |
| Agents › Memory | 7 |
| Agents › Models | 8 |
| Agents › Tools & MCP | 8 |
| Connect › Gateway | 6 |
| Connect › Channels | 3 |
| Connect › Pairing | 1 |
| Connect › Webhooks | 1 |
| Workspace › Files | 3 |
| Workspace › Git | 1 |
| Workspace › Checkpoints | 1 |
| Workspace › Terminal | 1 |
| Workspace › Artifacts | 1 |
| Observe › Insights | 5 |
| Observe › Logs | 2 |
| Observe › Health | 3 |
| System › Config | 3 |
| System › Keys & Auth | 5 |
| System › Plugins | 1 |
| System › Maintenance | 7 |
| System › Security | 5 |
| Settings | 7 |

### GAPs → Caduceus requirements (R1–R12)

Every row where Hermes has no backing (cov GAP, or proto §6 GAP) and Caduceus fills it:

| R | Rows (ref · feature · module · milestone) |
|---|---|
| R1 Preferences & sync, file snapshots | + Per-job badge notifications toggle · Inbox · M2; 2.3.4 All behaviour files · Agents › Profiles · M4; 2.12.4 Customisable nav / composer chips · Settings · M1; + Behaviour toggles · Settings · M1; 2.11.4 Onboarding wizard · Settings · M5 |
| R2 Web Push | 2.7.7 Run-completion toasts / badges · Inbox · M2; + Background notifications · Inbox · M2; + Per-job badge notifications toggle · Inbox · M2 |
| R3 Caduceus auth | 2.12.8 Auth methods · System › Security · M0; 2.12.9 Session list / revoke, read-only mode · System › Security · M5; + CSRF/Origin, CSP, auth throttle, step-up, audit log · System › Security · M0 |
| R4 Share links | 2.2.9 Public share links · Chat · M7 |
| R5 Drafts, saved prompts, templates | 2.1.15 Drafts saved server-side, across devices · Chat · M1; 2.1.16 Saved prompts · Chat · M1; 2.8.3 Missions: structured brief, 4 dispatch modes, queue · Work › Tasks · M3; + Mission templates & categories · Work › Playbooks · M3 |
| R6 Workflow engine | 2.8.4 Composer workflow graph · Work › Playbooks · M6; + Seeded workflows · Work › Playbooks · M6 |
| R7 Artifacts store | 2.8.5 Deep Research → Artifacts store · Work › Playbooks · M6; 2.10.5 Artifacts · Workspace › Artifacts · M6 |
| R8 Completion feed | 2.7.7 Run-completion toasts / badges · Inbox · M2 |
| R9 Spend budget + hard stop | 2.4.8 Quota, spend, budget · Observe › Insights · M5; 2.7.9 Spend gate on unattended runs · Observe › Insights · M6 |
| R10 Hindsight browser (optional) | 2.6.3 Hindsight browser · Agents › Memory · M4 |
| R11 Guarded file ops (move, rename, Office save, log truncate), external notes, Caduceus MCP server, raw shell | 2.6.4 Project context, external notes · Agents › Memory · M4; 2.5.14 Dashboard exposed as an MCP server · Agents › Tools & MCP · M4; 2.10.1 File browser incl. move/rename/Office edit · Workspace › Files · M7; 2.10.6 Terminal · Workspace › Terminal · M7; + Truncate log file · Observe › Logs · M5 |
| R12 Live relays (architecture §4) | 2.11.5 Log streaming · Observe › Logs · M5; 2.2.2 Live refresh of sessions owned by other processes · Chat · M1 |

Every GAP has a Caduceus requirement, so nothing is silently narrowed. The one row that is not carried is the third-party WebUI `/pet` extension: it is not a dashboard feature, and D7 means there is no extension SDK.

### Research disagreements found

1. **Pins** — proto §6/§7.4 say GAP; cov §0.3/§2.2 say Hermes-owned. Spot-check: `hermes_cli/web_routers/sessions.py` `_RENAME_FLAG_SETTERS` sets `pinned` via `PATCH /api/sessions/{id}`. Resolution: REST-backed; the GAP is RPC-only.
2. **Fork from an earlier message** — proto §6 backs edit/regenerate via `prompt.submit truncate_before_row_id`; cov §2.2 finds no backing for forking at an arbitrary message. Resolution: PARTIAL; verify `session.branch` + truncate in M1.
3. **Git-worktree sessions** — proto §6 marks GAP for a remote host (`/worktree` is `cli_only`); cov §2.2 cites `POST /api/git/worktree/add|remove`. Resolution: use the REST routes.
4. **Seed personas** — cov §2.3 labels GAP but notes content-only, no storage. Classified CLIENT here.

## Traceability by module

### Shell / Platform

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.3.6 | Profile scope model | D W P | App bar › profile chip + switcher sheet (IA §3, §6) | `?profile=` on REST; `GET/POST /api/profiles/active` (cov §2.3) | USED | M0 | D6: URL > device last > Hermes active. Replaces Dash global select, WebUI cookie, PS localStorage pick |
| 2.12.3 | Command palette | — | ⌘K palette / phone search (IA §8) | CLIENT; `RPC commands.catalog`/`complete.slash` for slash data (cov §2.12) | CLIENT | M0 | None of the three has one; skeleton in M0, actions grow per module |
| 2.12.5 | In-app help (per-screen `?`, glossary pop-ups, docs) | D W P | `?` sheet + help links per screen; palette doc search (IA §8) | CLIENT, bundled docs (cov §2.12) | CLIENT | M0 | PS pattern. Milestone assigned here (not in README M-list) |
| 2.12.10 | Accessibility rigour (focus traps, skip link, reduced motion, lint gates) | D W P | All screens | CLIENT (cov §2.12) | CLIENT | M0 | PS gates applied to the whole surface; zoom never locked |
| + | Connection lifecycle UI (reconnect overlay, close-code banners, gateway-offline banners) | D P | App bar realtime dot + banner stack (IA §3) | `session.events.since`, `gateway.ready` (proto §0, §1); architecture §4 resume | USED | M0 | Merges Dash PTY overlays and PS `GatewayBanner` copy |
| + | Resource-pressure / gateway-down / update-available / agent-health banners | D W P | Banner stack (IA §3) | `GET /api/system/stats` pressure, `GET /api/status`, `GET /api/hermes/update/check` (cov §2.11) | USED | M0 | `update/check` is UNUSED in Dash; banner restart → `POST /api/gateway/restart` |
| + | Toast stack (memory/skill-saved toasts, success/error) | W P | Toast live region (IA §3) | CLIENT over `tool.complete` events (proto §6) | CLIENT | M1 |  |
| + | Empty-state primary actions | P | All list screens | CLIENT | CLIENT | M0 |  |
| + | Pull-to-refresh (standalone PWA), native-wrapper theme-color hooks | W | PWA shell | CLIENT | CLIENT | M0 |  |
| + | Stale-client banner / SW update (hard refresh) | W | PWA shell | CLIENT (service worker) | CLIENT | M0 |  |
| + | Internal module seam (PS ProductModule, feature flags) | P | Module registry (IA preamble, D7) | CLIENT | Replaced | M0 | Replaced by the Caduceus module registry (D7) |
| 2.5.13 | UI extension system (Dash SDK tabs/slots/backend routers; WebUI gallery, JS API, sidecars, skins, Dash-plugin iframes) | D W | — | Hermes `/api/dashboard/plugins` (cov §2.5, N/A) | Replaced | M0 | D7: internal module registry, no third-party UI SDK in v1. Hermes *plugin management* stays (System › Plugins) |
| + | WebUI `/pet` Desktop Companion extension | W | — | — | Not carried | — | Third-party extension; no SDK under D7 |
| + | Client telemetry / CSP reports | W | — | Caduceus server error log (architecture §8) | Replaced | — | Browser errors and CSP reports go to the Caduceus server log and surface in Health |
| + | Swagger / OpenAPI pages (`/docs`, `/redoc`) | D | Help › API reference | Pinned `/openapi.json` + `gateway-contract.openrpc.json` (architecture §6) | Replaced | M5 | Rendered read-only from the pinned contracts; also avoids Dash's `/docs` route clash |
| 2.12.6 | Achievements / gamification (Dash 60 badges; PS 40 badges, streaks) | D P | — | `/api/plugins/hermes-achievements/*` (cov §2.12 N/A) | Dropped (D8) | — |  |
| 2.12.7 | Story Weaver (Rec Room) + reader settings | P | — | — | Dropped (D8) | — |  |

### Home

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| + | Overview: connected platforms, 5 recent sessions, stat pills (scheduler heartbeat, spend, processes) | D P | Home (IA §1) | `GET /api/status`, `GET /api/sessions`, `GET /api/analytics/usage` (cov §2.2, §2.11) | USED | M2 | Dash Sessions overview + PS dashboard merged into Home |
| + | Errors panel (ERROR/CRITICAL dedupe) | P | Home › health strip → Observe › Logs | `GET /api/logs?level=` (cov §2.11) | USED | M5 |  |

### Chat

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.1.1 | Native message UI (bubbles, markdown, tool cards) | W P | Transcript (IA §4) | RPC `prompt.submit` → `message.*`, `tool.*` (proto §6) | UNUSED | M1 | Dash shows chat only through the TUI |
| 2.1.2 | Terminal / TUI chat mode | D (W shell PTY) | App-bar toggle, desktop only (IA §4) | WS `/api/pty` (cov §2.10) | USED | M1 | D3 optional; hidden on phone (#81119/#76002) |
| 2.1.3 | Streamed reasoning / thinking | W P (D TUI) | Transcript reasoning cards | `reasoning.delta`, `thinking.delta` (proto §6) | USED | M1 |  |
| 2.1.4 | Tool approvals (once/session/always/deny, YOLO) | W P (D TUI) | Inline cards above composer; mirrored in Inbox | srq `approval`, `approval.respond`, `config.set yolo` (proto §6) | USED | M1 | Push delivery is R2 (M2) |
| 2.1.5 | Clarify prompts (choices, free text, countdown) | W P (D TUI) | Inline cards; Inbox | srq `clarify`, `request.answer` (proto §6) | USED | M1 | Countdown is client-side from deadline |
| 2.1.6 | Queue / Interrupt / Steer, `/btw`, `/background`, `/goal` | W (D TUI) | Composer busy modes (IA §4) | `session.interrupt/steer/redirect`, `prompt.btw/background`, `session.control` (proto §6) | USED | M1 |  |
| 2.1.7 | Activity display modes (Worklog / Stream / Final only) | W | Transcript activity mode | `config.set details_mode\|tool_progress` + client (proto §6) | UNUSED | M1 |  |
| 2.1.8 | Attachments (20 files: docs, PDF, archives) | W (D image) | Composer › attach chip | `image.attach_bytes`, `file.attach`, `pdf.attach` (proto §6) | UNUSED | M1 | Archive extraction (WebUI `/api/upload/extract`): unzip in the browser (e.g. fflate), then attach each file over the same RPCs |
| 2.1.9 | Voice: dictation, hands-free, TTS (4 engines) | W | Composer voice control; per-message speaker | REST `/api/audio/transcribe\|speak\|speak-stream\|voice-live` (proto §6; cov §2.x) | UNUSED | M7 | RPC voice is host-side; browser must use REST/WS audio |
| 2.1.10 | Message actions: edit, fork, regenerate, copy | W (D copy, P retry) | Message action menu | `prompt.submit {truncate_before_row_id}`, `session.branch` (proto §6) | UNUSED | M1 | **Disagreement:** proto §6 backs edit/regenerate via truncate; cov §2.2 finds no backing for fork-from-any-earlier-message (suggests branch+undo [INFERENCE]). Fork-at-tip is backed |
| 2.1.11 | Model + reasoning-effort pickers | D W (P fast only) | Composer chips / phone config sheet | `model.options`, `config.set model\|reasoning` (proto §6); `GET /api/model/options` (cov §2.4) | USED | M1 |  |
| 2.1.12 | Context ring: usage, cost, cache %, Compress | W (D TUI) | Composer context ring | `session.usage`, `session.context_breakdown`, `session.compress` (proto §6) | USED | M1 |  |
| 2.1.13 | Rich rendering (KaTeX, Mermaid, tables, PDF, HTML) | W | Transcript | CLIENT | CLIENT | M1 | Incl. sortable/filterable tables, media players, lightbox |
| 2.1.14 | Durable / resumable streams | W (D ◐, P ◐) | Gateway client (M0) + Chat | `session.events.since`, `session.activate/resume`, turn-marker auto-continue (proto §0, §6); Caduceus upstream grace hold (architecture §4) | PARTIAL | M0 | Hermes ring is in-memory: mid-turn deltas lost on backend restart; persisted turn + auto-continue cover recovery (proto §7.5) |
| 2.1.15 | Drafts saved server-side, across devices | W | Composer | Caduceus R5 `drafts` (cov §3) | Caduceus-owned | M1 | GAP → R5 (proto §6, §7.1) |
| 2.1.16 | Saved prompts | W | Composer › saved-prompts chip | Caduceus R5 `prompts` (cov §3) | Caduceus-owned | M1 | GAP → R5 |
| 2.1.17 | Image paste / drag-drop | D W | Composer | `image.attach_bytes` (proto §6); `/api/chat/image-upload` (dash §4) | USED | M1 |  |
| 2.1.18 | Fast (raw-model) chat | P | Composer mode toggle | `RPC llm.oneshot` (proto §6) | PARTIAL | M1 | Stateless; no transcript persistence in Hermes |
| 2.8.6 | Agent todo list, subagent cards, goals | W | Context panel › Todo / Run tabs (IA §4) | `todo.updated`, `subagent.*`, `session.control` (cov §2.8; proto §6) | UNUSED | M1 | Dash sees these only inside the TUI |
| + | Slash commands (agent, skill, quick, plugin commands; `/skills`, `/use`) | W (D TUI) | Composer `/` menu | `commands.catalog`, `complete.slash`, `slash.exec`, `command.dispatch` (proto §6) | USED | M1 | Not a §2 row; WebUI §4.6/§4.7, Dash TUI |
| + | Retry / undo | W P (D TUI) | Message actions | `slash.exec /retry`, `session.undo` (proto §6) | USED | M1 | PS failed-turn Retry folds in |
| + | Interrupted-turn recovery, failed-turn bubble | P | Transcript | turn-marker auto-continue (proto §0) | USED | M1 |  |
| + | Personalities (`/personality`) | W | Composer slash | `cfg:personalities` (cov §2.3) via `slash.exec` | USED | M1 |  |
| + | Large paste → .md attachment | W | Composer | `file.attach` (proto §6) | UNUSED | M1 |  |
| + | `@path` references and `~/` path autocomplete | W | Composer | `GET /api/fs/list` (cov §2.x Files) | UNUSED | M1 |  |
| + | Selection actions (Reply with selection, Refine chips) | W | Transcript selection menu | CLIENT | CLIENT | M1 |  |
| + | Raw audio messages | W | Composer voice | `file.attach` data_url (proto §6) | UNUSED | M7 |  |
| + | Tokens/sec and per-reply usage | W | Message footer | usage in `message.complete`, `session.usage` tick (proto §6) | USED | M1 |  |
| + | Conversation outline, jump/auto-follow, load earlier, virtualisation | W | Transcript | `session.history`; `GET /api/sessions/{id}/messages/around` (cov §2.2) | PARTIAL | M1 | `around` is UNUSED in Dash (Desktop uses it) |
| + | Deep links (`/chat/new?prompt=&profile=`) | W | URL scheme (IA §7) | CLIENT | CLIENT | M1 |  |
| + | Credential warning (Add key / Switch model) | D P | Chat banner | `GET /api/env` (cov §2.4) | USED | M1 | PS `model-missing` advisory merges in |
| + | Workspace / cwd picker for a chat | D (v0.21.5) W | Composer workspace chip | `RPC session.cwd.set`, `GET /api/fs/default-cwd` (cov §2.10) | UNUSED | M1 |  |
| + | Session toolsets chip | W | Composer toolsets chip | `RPC tools.configure` / `toolsets.list` (cov §2.5) | USED | M1 | [INFERENCE] per-session scope unverified; work-model §2.1 says toolsets are per profile — fall back to read-only display |
| + | Mobile composer config sheet | W | Phone composer (IA §2, §4) | CLIENT | CLIENT | M1 |  |
| + | PTY keep-alive reattach, persistent terminal, terminal shortcuts, copy-last, theme-aware xterm | D | Terminal mode | WS `/api/pty` (cov §2.10) | USED | M1 | Desktop only |
| + | Auto-title / regenerate title | W P | Sessions pane row menu | `session.title`; `title_generation` aux slot (proto §6, cov §2.4) | USED | M1 |  |
| 2.2.1 | Full-text search of message bodies | D W | Sessions pane FTS; palette | `GET /api/sessions/search` (cov §2.2) | USED | M1 | REST-only; no RPC search (proto §6) |
| 2.2.2 | Cross-source sessions (CLI, messaging, cron, webhook, kanban, Claude Code) | D W (P ◐) | Sessions pane source filter | `GET /api/sessions?source=`; `/api/profiles/sessions` (UNUSED); `session.foreign.*` (UNUSED) (cov §2.2) | USED | M1 | Sessions owned by other processes refresh message by message on `sessions.changed` + REST, through Caduceus R12. That matches WebUI's state.db watcher. Token-level tail is impossible for those sessions (proto §0.5) |
| 2.2.3 | Resume / continue external sessions | D W | Sessions pane → Chat | `RPC session.resume` (cov §2.2) | USED | M1 |  |
| 2.2.4 | Handoff summary for messaging sessions | W | Transcript banner | `RPC handoff.*`, `llm.oneshot` (cov §2.2) | PARTIAL | M1 | Summary generated on demand, not persisted |
| 2.2.5 | Rename / delete / bulk select, prune, delete empty | D W | Sessions pane | `PATCH/DELETE /api/sessions/{id}`, `bulk-delete`, `prune`, `empty` (cov §2.2) | USED | M1 | Destructive ops need explicit `profile` |
| 2.2.6 | Projects, pins, archive | W (D archive, P group-by-mission) | Sessions pane | `PATCH /api/sessions/{id}` pinned/archived/hidden/unread; `RPC projects.*` (cov §2.2) | PARTIAL | M1 | **Disagreement:** proto §6/§7.4 lists pins as GAP (RPC only); cov §0.3 finds REST `pinned`. Spot-checked `wr/sessions.py` `_RENAME_FLAG_SETTERS`: `pinned` exists → Hermes-owned, not a GAP |
| 2.2.7 | Fork / branch / duplicate / git-worktree sessions | W | Row menu; message actions | `session.branch`, `session.undo`, `POST /api/git/worktree/add\|remove` (cov §2.2) | PARTIAL | M1 | proto §6: worktree sessions GAP for remote host (`/worktree` cli_only); cov §2.2 cites REST worktree routes — use REST |
| 2.2.8 | Export / import (MD / JSON / themed HTML) | D W (P ◐) | Row menu; Sessions toolbar | `GET /api/sessions/{id}/export`, `POST /api/sessions/import` (cov §2.2) | USED | M1 | MD/HTML is client rendering of JSON |
| 2.2.10 | Transcript viewer with tool-call accordions, role filters, search, copy | D W P | Transcript | `GET /api/sessions/{id}/messages`, `/timeline`, `RPC session.history` (cov §2.2) | USED | M1 |  |
| 2.2.12 | Touch gestures (swipe archive/delete, long-press) | W | Phone sessions list | CLIENT over `PATCH /api/sessions/{id}` (cov §2.2) | CLIENT | M1 |  |
| + | Sessions stats strip / insights donut | D P | Sessions pane header | `GET /api/sessions` stats (dash §4 `wr/sessions.py:467`) | USED | M1 |  |
| + | Date groups, unread dots, density, live indicator, failed badge | W P D | Sessions pane | `PATCH` unread (cov §0.3); `RPC session.active_list` (proto §0) | UNUSED | M1 | Unread is UNUSED in Dash |
| + | Live session-list updates | W | Sessions pane | RPC broadcast `sessions.changed` (cov §0.2) | UNUSED | M1 |  |
| + | Filters: failed-only, hide API noise, category tabs (Chats/Automation) | P D | Sessions pane filter | CLIENT over `GET /api/sessions?sources=` (cov §2.2) | CLIENT | M1 |  |
| + | Previous messaging segments / continuation lineage | W D | Transcript header | `GET /api/sessions` continuation follow (dash §4 Resume) | USED | M1 |  |
| + | Session recovery (`.bak`, audit, repair-safe) | W | — | Hermes `state.db` + `hermes backup` (cov §2.11) | Replaced | — | D1: sessions live only in Hermes; WebUI's own store is gone |
| + | Sync-on-read, orphan sweep, backfill-status | P | — | — | Replaced | — | D1: no mirror to keep in sync |
| 2.2.9 | Public share links | W | Row menu › Share; `/share/:token` renderer | Caduceus R4 (cov §3) | Caduceus-owned | M7 | GAP → R4. Under D9, share links are reachable only by people on your tailnet, not the public internet |

### Inbox

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.7.7 | Run-completion toasts / badges | W | Inbox activity feed + toasts + nav badges | `cron.changed` + `/api/cron/jobs/{id}/runs` diff (cov §2.7); Caduceus R8 + R2 | PARTIAL | M2 | Completed/failed derived; push while closed = R2 |
| + | Background notifications (response done, approval needed) | W | Web Push (work-model §2.5) | Caduceus R2 (cov §3) | Caduceus-owned | M2 | GAP → R2 (proto §0.4) |
| + | Review gates and `needs_input` clarify (Composer HITL gate / clarify) | P | Inbox items with Approve / Reject+note / Answer | kanban `review`, `blocked needs_input` (cov §2.8; work-model §2.3) | USED | M3 | Replaces PS composer gate endpoints |
| + | Per-job badge notifications toggle | W | Settings › Notifications | Caduceus R1/R2 prefs (cov §3) | Caduceus-owned | M2 |  |

### Work › Board

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.8.1 | Hermes Kanban: boards, lanes, comments, links | D W | Work › Board | `/api/plugins/kanban/*` + WS `/events` (cov §2.8) | USED | M3 | Lanes by status or profile; phone segmented control |
| 2.8.2 | Dispatcher (preview / run, per-profile workers, orchestration settings) | D W | Board toolbar | `POST …/dispatch?dry_run=`; `…/orchestration` (cov §2.8) | USED | M3 | `dry_run` preview UNUSED in Dash |
| + | Multiple boards (switch, create/edit, archive, export/import) | W D | Board switcher | kanban board routes; `export/import/switch` UNUSED (cov §2.8) | USED | M3 |  |
| + | Board diagnostics, stats chips, active workers | D W | Board sidebar | kanban `diagnostics`, `stats`, `workers/active` (cov §2.8, UNUSED) | UNUSED | M3 |  |
| + | PS Mission board (draft/queued/dispatched/successful/failed) | P | Board lanes | kanban statuses `triage/ready/running/done` (cov §0.4) | Replaced | M3 | Replaced by Kanban board (D4) |

### Work › Tasks

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.8.3 | Missions: structured brief, 4 dispatch modes, queue | P | Task create + Brief editor (work-model §2.1) | kanban task fields + statuses (cov §2.8) | PARTIAL | M3 | Brief/queue/run-now/schedule backed; mission map R5 not needed under D4 |
| 2.2.11 | Session ↔ mission linkage | P | Task detail › Runs (transcript) | kanban `session_id`, `runs/{id}`, `/inspect` (cov §2.2) | PARTIAL | M3 | Mission concept = Kanban task (D4), so no Caduceus link table |
| + | Task modal/detail: comments, events, links, attachments, runs, worker log, decompose/specify/reassign/reclaim/terminate | D W | Task detail (work-model §3) | kanban REST (cov §2.8) | USED | M3 | `runs/*` + `terminate` UNUSED in Dash |
| + | Mission composer prompt assembly (`<hermes_mission>` XML) + preview | P | Brief editor → Markdown body | kanban task `body` (work-model §2.1) | Replaced | M3 | Replaced by Brief editor sections |
| + | Mission queue single-flight, cancellation finalise, reconcile/deadlines | P | Dispatcher caps; Terminate | `cfg:kanban.max_in_progress`, `max_runtime_seconds` (cov §2.8) | Replaced | M3 | Replaced by Hermes dispatcher (D4) |
| + | Directory picker + git branch for working dir | P | Brief editor › Workspace | `GET /api/fs/list`, `/api/git/*` (cov §2.x) | UNUSED | M3 |  |

### Work › Playbooks

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.8.4 | Composer workflow graph (loops, verdicts, human gates, clarify) | P | Playbooks: graph ≥1024 px, stage list on phone | Caduceus R6 engine over kanban `workflow_template_id`/`current_step_key` (cov §2.8, §3) | Caduceus-owned | M6 | GAP → R6 |
| 2.8.5 | Deep Research → Artifacts store | P | Seeded Deep Research playbook (work-model §2.3) | Kanban task + research skills; Caduceus R7 (cov §2.8, §3) | Caduceus-owned | M6 | GAP → R7; depth/breadth become inputs |
| + | Mission templates & categories (12 seeded, quick-load pills) | P | Playbook library (one-stage = Template) | Caduceus `playbooks/*.yaml`, R5 (cov §3; work-model §2.3) | Caduceus-owned | M3 | GAP → R5 |
| + | Seeded workflows (Software Delivery, Research→summarise, Draft→review) | P | Playbook seeds | Caduceus R6 | Caduceus-owned | M6 |  |

### Work › Schedules

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.7.1 | Hermes cron CRUD (`jobs.json`) | D W | Schedules list + editor | `/api/cron/jobs…` (cov §2.7) | USED | M3 |  |
| 2.7.2 | Schedule builder with preview (next 3 fire times) | D W P | Schedule editor | CLIENT (cov §2.7) | CLIENT | M3 |  |
| 2.7.3 | Run history and output | W P | Job detail › Runs | `GET /api/cron/jobs/{id}/runs` (cov §2.7) | UNUSED | M3 | Free win |
| 2.7.4 | Automation Blueprints (16 templates) | D | Blueprints gallery | `/api/cron/blueprints` (cov §2.7) | USED | M3 |  |
| 2.7.5 | Script-mode jobs | D W P | Job type: Script | `POST /api/cron/jobs` with `script`, `no_agent` (cov §2.7) | USED | M3 | Scripts edited via `/api/fs/write-text` under profile `scripts/` (work-model §2.4) |
| 2.7.6 | Cross-profile job list | D W | Schedules (cross-profile) | `GET /api/cron/jobs?profile=all` (cov §2.7) | USED | M3 |  |
| 2.7.8 | Dashboard's own scheduler (exactly-once, catch-up) | P | — | Hermes cron (cov §2.7 N/A) | Replaced | — | D5: Hermes cron is the only scheduler |
| + | PS Scripts page (editor, run now, logs, examples) | P | Job type: Script | Hermes cron script jobs (work-model §2.4) | Replaced | M3 | Replaced by cron script job type |
| + | Host crontab writer | P | — | Hermes cron script jobs | Replaced | — | D5: no host crontab |
| + | Schedule a mission / recurring mission | P | Job type: Create task / run playbook | cron script job running `hermes kanban create` (work-model §2.4) | Replaced | M3 | Replaced |
| + | Stale-scheduler warning / scheduler heartbeat | D P | Schedules header; Home health strip | cron job last-tick fields (dash §4) | USED | M3 |  |
| + | Job actions: run now, pause/resume, duplicate, copy diagnostics, deliver-to targets | D W P | Job menu | `/api/cron/jobs/{id}/…`, `/api/messaging/platforms` (cov §2.7, §2.9) | USED | M3 | Duplicate/diagnostics are CLIENT |

### Work › Projects

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.10.2 | Workspaces / spaces | W (D ◐, P ◐) | Projects; composer workspace chip | `RPC projects.*`, `projects.discover_repos` (cov §2.10) | UNUSED | M3 | Hermes projects = WebUI spaces |
| + | Project OS dashboard (repo, git, docs overview); projects tree | W D | Project detail | `GET /api/profiles/projects/tree` (UNUSED), `/api/git/*` (cov §2.x) | UNUSED | M3 |  |

### Agents › Profiles

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.3.1 | Profile cards with gateway status | D W P | Profiles list | `GET /api/profiles`, `GET /api/status` (cov §2.3) | USED | M4 |  |
| 2.3.2 | Create / clone (+ 5-step Profile Builder) | D W P | `/agents/profiles/new` | `POST /api/profiles` (cov §2.3) | USED | M4 | Builder is a client flow |
| 2.3.3 | SOUL.md editor | D W P | Tab Identity (IA §5) | `GET/PUT /api/profiles/{name}/soul` (cov §2.3) | USED | M4 |  |
| 2.3.4 | All behaviour files (AGENTS, USER, MEMORY, config.yaml, HERMES.md) | P (W ◐) | Tabs Instructions / Memory / Files | `/api/fs/read-text\|write-text`, `/api/config/raw?profile=` (cov §2.3); Caduceus R1 snapshots | PARTIAL | M4 | No file endpoints; `.bak` snapshots → R1 |
| 2.3.5 | LLM auto-describe | D | Overview › description | `POST /api/profiles/{name}/describe-auto` (cov §2.3) | USED | M4 |  |
| 2.3.7 | Profile export / import | D (API) | Danger zone | `POST /api/profiles/{name}/export`, `/import` (cov §2.3) | UNUSED | M4 | Free win |
| 2.3.8 | DB ↔ disk push/pull with drift detection | P | — | — | Replaced | — | D1: one copy, no drift layer (IA §5) |
| 2.3.9 | Seed persona catalogue + restore | P | Profile Builder › start from persona | Static catalogue + `POST /api/profiles`, `PUT …/soul` (cov §2.3) | CLIENT | M4 | cov marks GAP but content-only; no Caduceus storage |
| 2.3.10 | Per-agent performance (runs, success rate, tokens) | P | Overview tab | `GET /api/analytics/usage?profile=`, kanban `stats`/`assignees` (cov §2.3) | PARTIAL | M4 | XP part is a separate Dropped row |
| + | Set active / Make default, rename, delete, copy CLI command | D W P | Overview; Danger zone | `POST /api/profiles/active`, profile REST (cov §2.3) | USED | M4 | Make default is the only sticky write (IA §6) |
| + | Edit profile model | W | Tab Model | `POST /api/model/set?profile=` (cov §2.4) | USED | M4 |  |
| + | Isolated single-profile mode | W | — | `?profile=` scope (cov §2.3) | Replaced | — | Replaced by D6 per-tab scope + read-only mode |
| + | Assistant display name | W | Tab Identity | CLIENT | CLIENT | M4 |  |
| + | Agent XP / levels / Growth panel / progression snapshots | P | — | — | Dropped (D8) | — | D8 |

### Agents › Skills

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.5.1 | Browse / search / toggle / categories | D W P | Installed | `GET /api/skills`, `PUT /api/skills/toggle` (cov §2.5) | USED | M4 |  |
| 2.5.2 | Create / edit SKILL.md | D W (P ◐) | Skill editor | `POST /api/skills`, `GET/PUT /api/skills/content` (cov §2.5) | USED | M4 | Keeps frontmatter (PS bug avoided) |
| 2.5.3 | Delete / uninstall | W (D API) | Skill menu | `POST /api/skills/hub/uninstall`, `DELETE /api/learning/node` (cov §2.5) | UNUSED | M4 |  |
| 2.5.4 | Skills hub (9 sources) + security scan | D | Hub | `/api/skills/hub/*` (cov §2.5) | USED | M4 | `hub/official` UNUSED |
| 2.5.5 | Learn-a-skill, curator controls | D | Learn; Curator | `/learn` via `command.dispatch`; `/api/curator` (cov §2.5) | USED | M4 |  |
| 2.5.6 | Skill usage stats | W (D ◐) | Installed › usage | `GET /api/skills` `usage` count (cov §2.5) | PARTIAL | M4 | Count only; WebUI uses/views/patches not exposed [INFERENCE per cov] |
| + | Skill detail (rendered, linked files) | W P | Skill detail | `GET /api/skills/content` (cov §2.5) | USED | M4 |  |
| + | PS seeded skills / import from Hermes | P | — | Hermes skills dir | Replaced | — | D1: Hermes is the catalogue; hub replaces seeds |

### Agents › Memory

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.6.1 | Edit MEMORY.md / USER.md | W P (D size/reset) | Memory editors | `/api/fs/*` on `memories/*.md`; `learning/node` (cov §2.6) | PARTIAL | M4 | No dedicated endpoint |
| 2.6.2 | Memory-provider selection + dynamic config form | D (P ◐) | Provider settings | `PUT /api/memory/provider`, `/api/memory/providers/*` (cov §2.6) | USED | M4 | Provider OAuth UNUSED |
| 2.6.3 | Hindsight browser (recall, reflect, directives, mental models) | P | Hindsight tab | Caduceus R10 proxy (cov §2.6, §3) | Caduceus-owned | M4 | GAP → R10 (optional) |
| 2.6.4 | Project context, external notes (MCP), LLM Wiki | W | Context / Notes / Wiki tabs | `RPC project.facts`, `/api/fs/*` (PARTIAL); notes = Caduceus R11 (cov §2.6) | PARTIAL | M4 | External notes GAP → R11 (high-risk MCP client) |
| 2.6.5 | Context-engine selection | D | Provider settings | `PUT /api/dashboard/plugin-providers` (cov §2.6) | USED | M4 |  |
| 2.6.6 | Learning graph | D (API) | Learning graph tab | `GET /api/learning/graph`, `learning/node` (cov §2.6) | UNUSED | M4 | Free win |
| + | Memory reset (MEMORY / USER / all) and sizes | D | Memory editors | `GET /api/memory`, `POST /api/memory/reset` (cov §2.6) | USED | M4 |  |

### Agents › Models

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.4.1 | Auxiliary task slots (union 15) | D W P | Aux slots | `GET /api/model/auxiliary`, `POST /api/model/set` (cov §2.4) | USED | M4 |  |
| 2.4.2 | Mixture-of-Agents presets | D | MoA | `GET/PUT /api/model/moa` (cov §2.4) | USED | M4 |  |
| 2.4.3 | Fallback chain editor | P | Fallback chain | `cfg:fallback_providers` via `PUT /api/config` (cov §2.4) | PARTIAL | M4 | Only a list editor is missing (client) |
| 2.4.7 | Per-model usage cards with "Use as…" | D | Usage cards | `GET /api/analytics/models` (cov §2.4) | USED | M4 |  |
| 2.4.9 | Live model catalogue refresh | D W | Model picker | `GET /api/model/options`, `RPC model.options` (cov §2.4) | USED | M4 |  |
| + | Main / default model (Agent default) | D W P | Main model | `POST /api/model/set` (cov §2.4) | USED | M4 |  |
| + | Max output tokens | W | Main model | `PUT /api/config` (cov §2.11 schema) | USED | M4 |  |
| + | PS model registry + per-model pull/push diff + drift banner + re-import | P | — | — | Replaced | — | D1: Hermes config is the registry |

### Agents › Tools & MCP

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.5.7 | Toolset config (provider, keys, setup) | D P (W ◐) | Toolsets | `/api/tools/toolsets/*`, `RPC tools.configure` (cov §2.5) | USED | M4 | Per-toolset model picker UNUSED |
| 2.5.8 | MCP servers CRUD + OAuth + test (+ edit) | D (W ◐) | MCP servers | `/api/mcp/servers*`; edit via `PUT /api/mcp/servers` (UNUSED) (cov §2.5) | USED | M4 |  |
| 2.5.9 | MCP catalogue (65) | D | MCP catalogue | `GET /api/mcp/catalog` (cov §2.5) | USED | M4 |  |
| 2.5.10 | MCP tool inventory | W (D ◐) | MCP › tools | `RPC mcp.servers.status`, `tools.list` (cov §2.5) | PARTIAL | M4 | Full inventory via RPC is UNUSED |
| 2.5.11 | Shell hooks | D | Hooks | `/api/ops/hooks` (cov §2.5) | USED | M4 | Privileged (T2/T3 step-up) |
| 2.5.14 | Dashboard exposed as an MCP server | W | Tools & MCP › info | `hermes mcp serve` (cov §2.5); Caduceus-specific server = R11 | PARTIAL | M4 | Caduceus MCP server deferred under R11 |
| + | Tool gateway routing (Nous Portal backends) | D | Tool gateway | `wr/status.py:707` (dash §4) | USED | M4 |  |
| + | Per-platform toolsets grid + advanced JSON | P | Toolsets › per platform | `platform_toolsets` via `PUT /api/config` (cov §2.11) | USED | M4 | PS push/pull dropped (D1) |

### Connect › Gateway

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.9.1 | Gateway start / stop / restart | D W | Gateway | `POST /api/gateway/start\|stop\|restart` (cov §2.9) | USED | M5 | `drain` UNUSED |
| 2.9.6 | Per-profile gateway status dot | D W | Gateway; profile cards | `GET /api/profiles`, `/api/status` (cov §2.9) | USED | M5 |  |
| 2.3.11 | Multiplexed-gateway migration | D | Gateway › migrate | `/api/gateway/migrate/plan`, `/migrate` (cov §2.3) | USED | M5 | Dangerous |
| + | Running gateway processes, gateway health badge | P | Gateway | `GET /api/status` (cov §2.11) | USED | M5 |  |
| + | PS gateway admission gate stats | P | — | — | Replaced | — | PS-owned limiter; Caduceus never fronts agent traffic (D2); Hermes dispatcher caps instead |
| + | WebUI gateway chat backend | W | — | — | Replaced | — | D3: chat over `/api/ws` |

### Connect › Channels

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.9.2 | Channel configuration (23+ platforms, Test) | D (P ◐) | Channels | `/api/messaging/platforms*` (cov §2.9) | USED | M5 |  |
| 2.9.3 | QR onboarding (Telegram bot, WhatsApp pairing) | D | Channels › Create with QR | `/api/messaging/{telegram,whatsapp}/onboarding/*` (cov §2.9) | USED | M5 |  |
| + | Platform behaviour settings (discord auto_thread, streaming, human_delay) | P | Channel › settings | `PUT /api/config` (cov §2.11) | USED | M5 |  |

### Connect › Pairing

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.9.4 | DM pairing approvals | D | Pairing; Inbox item | `/api/pairing*` (cov §2.9) | USED | M5 | `pairing.changed` triggers push |

### Connect › Webhooks

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.9.5 | Webhook subscriptions (one-time secret) | D | Webhooks | `/api/webhooks*` (cov §2.9) | USED | M5 |  |

### Workspace › Files

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.10.1 | File browser: tree, preview/editor, upload, mkdir, delete, move, rename | W (D ◐) | Files | `/api/files*` USED; `/api/fs/*` preview/edit UNUSED; move/rename/Office save = Caduceus R11 guarded file ops | PARTIAL | M7 | Office docx edit = in-browser editor + save through R11 (or `/api/files/upload` if it can overwrite; verify in M7). R11 ops stay inside Hermes's managed files root and are tier-gated (architecture §2) |
| + | Symlink escape grants | W | — | Hermes file policy (cov §2.10) | Replaced | — | Replaced by Hermes home/locked-root policy |
| + | Remote workspaces (ssh/docker terminal backend) | W | Profiles › Tools & MCP (terminal backend) + composer workspace chip | `terminal.backend` / `terminal.cwd` config (cov §2.x Tools); Hermes validates remote paths | PARTIAL | M4 | Remote-aware workspace paths per profile, as in WebUI. Remote file browsing is absent in WebUI too |

### Workspace › Git

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.10.4 | Git (diff, stage, commit, push, AI commit message, branches) | W API, D API, P ◐ | Git panel | 21 `/api/git/*` + `llm.oneshot` (cov §2.10) | UNUSED | M7 | Free win |

### Workspace › Checkpoints

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.10.3 | Checkpoint rollback (diff / restore, count / prune) | W (D ◐) | Checkpoints | `RPC rollback.*`; `/api/ops/checkpoints` (cov §2.10) | PARTIAL | M7 | Diff/restore need a live session; ANSI output [INFERENCE] |

### Workspace › Terminal

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.10.6 | Terminal (real PTY shell) | W (D `hermes>`, P script runner) | Terminal | `/api/pty` TUI, `RPC shell.exec`; raw `$SHELL` = Caduceus R11 (cov §2.10) | PARTIAL | M7 | cov recommends not building raw shell in v1; if built, step-up auth (D10) |

### Workspace › Artifacts

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.10.5 | Artifacts (files changed this session; artifact store) | W P | Artifacts; Chat context panel | `/api/git/review/*`, `rollback.diff` (PARTIAL); store = Caduceus R7 (cov §2.10) | Caduceus-owned | M6 | GAP → R7 |

### Observe › Insights

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.4.8 | Quota, spend, budget | W P (D ◐) | Insights › spend + budgets | `GET /api/analytics/usage` cost; `RPC session.usage` (cov §2.4); budgets R9 | PARTIAL | M5 | Budget definition + hard stop → R9 (M6) |
| 2.11.6 | Token / cost analytics (charts, heatmap, by model/source/playbook) | D W P | Insights | `GET /api/analytics/usage`, `/models`, `RPC insights.get` (cov §2.11) | USED | M5 | Cost hidden by default in Dash |
| 2.7.9 | Spend gate on unattended runs (hard stop) | P | Insights › budgets; Inbox alert | Caduceus R9 guard (cov §2.7, §3) | Caduceus-owned | M6 | GAP → R9 |
| + | Provider usage card (commandcode-usage plugin) | D | Insights › provider quota | `RPC session.usage` windows (cov §2.4) | Replaced | M5 | Replaced by built-in provider quota |
| + | WebUI sync of usage into `/insights` | W | — | Hermes `state.db` | Replaced | — | Caduceus chat runs inside Hermes; usage already recorded |

### Observe › Logs

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.11.5 | Logs viewer (filters, search, download, streaming) | D W P | Logs | `GET /api/logs?…&search=` (cov §2.11); streaming = Caduceus R12 relay | USED | M5 | Server search UNUSED in existing UIs. Streaming: the Caduceus server tails `/api/logs` and pushes deltas to subscribed clients |
| + | Logs delete-all (truncate) | P | Logs › ⋮ Truncate file | Caduceus R11 guarded file op | Caduceus-owned | M5 | T3 action (typed confirm) |

### Observe › Health

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.11.7 | Host stats + resource-pressure banner | D W (P ◐) | Health | `GET /api/system/stats` (cov §2.11) | USED | M0 | Health basics in M0 |
| 2.11.8 | Subsystems health panel with actionable reasons | P (D ◐, W ◐) | Health › subsystems | `/api/status`, `/api/health`, `/api/egress/status` (cov §2.11) | PARTIAL | M5 | Reason copy is CLIENT; `egress/status` UNUSED |
| + | Health endpoints / monitor snapshot / agent-not-installed notice | W P | Health | `/api/health`, `/api/status` (cov §2.11) | USED | M0 |  |

### System › Config

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.11.1 | Schema-driven config form + search | D P (W ◐) | Config | `/api/config`, `/schema`, `/defaults` (cov §2.11) | USED | M5 | PS per-section save + whose-settings card as UX |
| 2.11.2 | Raw YAML editor | D | Config › YAML | `GET/PUT /api/config/raw` (cov §2.11) | USED | M5 | Add validation; dangerous tier |
| 2.11.3 | Config import / export / reset | D | Config toolbar | CLIENT over `/api/config` + `/defaults`; `config-migrate` (cov §2.11) | USED | M5 |  |

### System › Keys & Auth

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.4.4 | Provider keys (audited reveal, test, rotate) | D W P | Keys | `/api/env*`, `/api/providers/validate` (UNUSED) (cov §2.4) | USED | M5 | Reveal = step-up |
| 2.4.5 | OAuth device-code logins | D W | Keys › OAuth | `/api/providers/oauth/*` (cov §2.4) | USED | M5 |  |
| 2.4.6 | Credential pool | D (W ◐) | Keys › pool | `/api/credentials/pool` (cov §2.4) | USED | M5 |  |
| + | Custom endpoint providers | D (API) P | Keys › custom endpoints | custom endpoints ×5 (cov §2.4, UNUSED) | UNUSED | M5 |  |
| + | Nous Portal subscription card | D | Keys › Nous | `wr/status.py:707` (dash §4); `RPC billing.*` denied (D10) | USED | M5 | Read-only; billing actions denied in v1 |

### System › Plugins

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.5.12 | Hermes plugin install / update / remove + catalogue | D (W ◐) | Plugins | `/api/dashboard/agent-plugins/*` (cov §2.5) | USED | M5 |  |

### System › Maintenance

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.11.9 | Doctor, security audit, debug share, support dump | D (P ◐) | Maintenance | `POST /api/ops/*` (cov §2.11) | USED | M5 |  |
| 2.11.10 | Backup / restore | D P (W ◐) | Maintenance | `/api/ops/backup\|import` (cov §2.11) | USED | M5 | Includes `caduceus/` |
| 2.11.11 | Update Hermes agent (+ Caduceus self-update, What's New) | D W | Maintenance | `POST /api/hermes/update`, `check`/`receipt` UNUSED (cov §2.11) | USED | M5 | Caduceus self-update is deployment (N/A to Hermes) |
| + | Restricted `hermes>` console | D | Maintenance | WS `/api/console` (cov §1) | USED | M5 |  |
| + | Install facts + Copy for bug report | P | Maintenance | `/api/status`; debug-share (cov §2.11) | USED | M5 |  |
| + | PS DB backups, migrations, ps-deploy, Restore seeds page | P | — | `hermes backup` (cov §3) | Replaced | — | D1: Caduceus data in `caduceus/`, covered by Hermes backup |
| + | WebUI Stop server / hot reload | W | Maintenance › Restart Hermes backend / Restart Caduceus | Caduceus server child supervision (architecture §8) | Replaced | M5 | T2; restarts are drained and clients resume |

### System › Security

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.12.8 | Auth methods (password, passkeys, OIDC, proxy SSO, Nous OAuth, operator token) | D W P | Security | Caduceus R3 (cov §2.12) | Caduceus-owned | M0 | Passkeys/proxy SSO GAP → R3 (D10) |
| 2.12.9 | Session list / revoke, read-only mode | P | Security › devices | Caduceus R3 (cov §2.12) | Caduceus-owned | M5 | GAP → R3 |
| + | CSRF/Origin, CSP, auth throttle, step-up, audit log | D W P | Policy proxy (architecture §5) | Caduceus R3 | Caduceus-owned | M0 |  |
| + | WebUI LAN-only gates, PS `?ps_token=` hand-off, PS HMAC request signing | W P | — | — | Replaced | — | Replaced by D9 tailnet-only + D10 tiers/step-up |
| + | Credential hygiene (0600, env scrub, redaction toggle) | W P D | — | Hermes `/api/env` masking + audited reveal (cov §2.4); Caduceus secrets 0600 (cov §3) | USED | M0 |  |

### Settings

| Ref | Feature | From | Caduceus screen | Backing | Status | M | Notes |
|---|---|---|---|---|---|---|---|
| 2.12.1 | Themes (skins × light/dark/system, YAML themes, fonts, font size) | D W | Settings › Appearance | CLIENT local copy + Caduceus R1 per-device prefs (cov §2.12) | CLIENT | M0 | M0 #07 built theme, skin, density, text size per device. YAML theme import and font choice are not built |
| 2.12.2 | Locales (union 17+15, RTL) | D W | Settings › Language | CLIENT; optional `display.language` mirror (cov §2.12) | CLIENT | M0 | Logical CSS from M0. Milestone assigned here |
| 2.12.4 | Customisable nav / composer chips | W | Settings › Composer, Nav order | Caduceus R1 (cov §2.12) | Caduceus-owned | M1 | GAP → R1 |
| + | Behaviour toggles (send key, sound, timestamps, density, pin limit…) + settings search | W P | Settings | Caduceus R1 prefs | Caduceus-owned | M1 |  |
| 2.11.4 | Onboarding wizard (system check, provider, workspace, password) | W | Settings › first-run | `RPC setup.status`, `providers/validate` (cov §2.11); progress R1 | PARTIAL | M5 | Matrix row 2.11.4; quests half dropped (D8) |
| + | WebUI dashboard-link setting | W | — | — | Replaced | — | Caduceus is the dashboard |
| + | Quests (32 quests / 7 chapters) | P | — | — | Dropped (D8) | — | Onboarding intent covered by 2.11.4 wizard |

## Hermes free wins

Backend capabilities that exist in Hermes today but that **no existing dashboard UI exposes** (Dash never calls them; WebUI/PatterStage either lack them or re-implement them in their own servers). Caduceus exposes them with no Caduceus-side storage.

| Capability | Hermes interface | Source | Caduceus screen | M |
|---|---|---|---|---|
| Git panel (status, diff, stage, commit, push, branches, worktrees, create-PR, AI commit message) | 21 `/api/git/*`, `review/commit-context` + `RPC llm.oneshot` | cov §2.10, §2.x | Workspace › Git | M7 |
| File preview / edit (code, images, PDF, download) | `/api/fs/read-text`, `read-data-url`, `download`, `write-text` | cov §2.10, §2.x | Workspace › Files | M7 |
| Checkpoint diff / restore | `RPC rollback.list/diff/restore` | cov §2.10; cov §0.2 | Workspace › Checkpoints | M7 |
| Cron run history and output | `GET /api/cron/jobs/{id}/runs` | cov §2.7 | Work › Schedules | M3 |
| Cron monitor options (`monitor_script`/`monitor_url`, `context_from`, `failure_deliver`, `attach_to_session`) | cron job fields | work-model §2.4 | Schedule editor | M3 |
| Learning graph + memory chunk editing | `GET /api/learning/graph`, `/api/learning/node` | cov §2.6 | Agents › Memory | M4 |
| Profile export / import | `POST /api/profiles/{name}/export`, `/import` | cov §2.3 | Profile › Danger zone | M4 |
| Skill uninstall / archive; official hub list | `POST /api/skills/hub/uninstall`, `DELETE /api/learning/node`, `GET /api/skills/hub/official` | cov §2.5 | Agents › Skills | M4 |
| MCP server edit; full tool inventory | `PUT /api/mcp/servers`; `RPC mcp.servers.status`, `tools.list/show` | cov §2.5 | Agents › Tools & MCP | M4 |
| Per-toolset model picker | `/api/tools/toolsets/*/model(s)` | cov §2.5, §2.x | Agents › Tools & MCP | M4 |
| Custom endpoint providers, provider "test connection", recommended default model | custom endpoints ×5, `POST /api/providers/validate`, `GET /api/model/recommended-default` | cov §2.4, §2.x | System › Keys; onboarding | M5 |
| Memory-provider OAuth | memory-provider OAuth start/status | cov §2.6 | Agents › Memory | M4 |
| Projects (folders, active project, discover repos, project tree) | `RPC projects.*`; `GET /api/profiles/projects/tree` | cov §0.2, §2.2, §2.10 | Work › Projects; Sessions pane | M3 |
| Session pins, hidden, unread | `PATCH /api/sessions/{id}` | cov §0.3, §2.2 | Chat › Sessions pane | M1 |
| Cross-profile session aggregate | `GET /api/profiles/sessions{,/sidebar}` | cov §2.2 | Chat "All profiles"; Home | M1 |
| Claude Code / Codex session import | `RPC session.foreign.list/preview/import` | cov §2.2; proto §6 | Chat › Sessions pane | M1 |
| Jump-to-message / timeline | `GET /api/sessions/{id}/timeline`, `/messages/around` | cov §2.2 | Transcript, FTS hits | M1 |
| Handoff to messaging | `RPC handoff.request/state/fail` | cov §2.2; proto §6 | Transcript menu | M1 |
| Session fork at tip, undo | `RPC session.branch`, `session.undo` | proto §6 | Message actions | M1 |
| Goals, loops, heartbeat; subagent tree, steer/interrupt subagent; todos | `RPC session.control*`, `subagent.*`, `delegation.*`, `spawn_tree.*`, `todo.updated` | cov §2.8; proto §6 | Chat › context panel | M1 |
| Context breakdown | `RPC session.context_breakdown` | proto §6 | Context ring detail | M1 |
| Global change signals for live lists and push | `cron.changed`, `sessions.changed`, `pairing.changed`, `platforms.changed` | cov §0.2; architecture §3 | Inbox, push watcher (R2) | M2 |
| Multi-device attach to the same session | `session.activate/resume` fan-out, first answer wins | proto §6 | Chat on phone + desktop | M1 |
| Kanban dispatcher dry-run, diagnostics, active workers, run inspect/terminate, estimate, stats/assignees, board export/import/switch | kanban routes listed in cov §2.8 | cov §2.8, §2.x | Work › Board / Tasks | M3 |
| Log server-side search | `GET /api/logs?search=` | cov §2.11 | Observe › Logs | M5 |
| Hidden cost data (estimated/actual cost, cache and reasoning tokens) | `GET /api/analytics/usage` | cov §2.11 | Observe › Insights | M5 |
| Update check + receipt; gateway drain | `GET /api/hermes/update/check|receipt`; `POST /api/gateway/drain` | cov §2.9, §2.11 | System › Maintenance; Connect › Gateway | M5 |
| Egress status, host identity, idle/retirement health | `/api/egress/status`, `/api/host/identity`, `/api/health/idle|retirement` | cov §2.11, §2.x | Observe › Health | M5 |
| Browser voice (transcribe, TTS stream, voice-live) | `/api/audio/*`, WS `speak-stream` | cov §2.x; proto §6 | Chat composer | M7 |
| Local models (llama.cpp: hardware, catalogue, download, server, activate) | 16 `/api/local-models/*` | cov §2.x | Agents › Models (new tab, not in any dashboard or the matrix) | M4 |
| Terminal backends, computer-use permissions | `/api/tools/terminal/backends|backend`, `computer-use/*` | cov §2.x | Agents › Tools & MCP | M4 |
