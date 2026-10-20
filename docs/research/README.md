# Hermes Unified Dashboard — Research Synthesis

Research date: 2026-10-06. This file merges the three dashboard reports into one feature matrix, a mobile assessment and the design decisions that come next. Each claim is cited in the per-dashboard reports below. This file only aggregates them.

| Report | Subject | Version inspected | Live evidence |
|---|---|---|---|
| [hermes-dashboard.md](hermes-dashboard.md) | **Hermes Dashboard**: the first-party dashboard that ships with hermes-agent (`hermes dashboard`) | hermes-agent v0.21.4 (`d337b736`), compared against upstream v0.21.5 | Live at `100.64.0.10:9119`, read-only. 21 screenshots |
| [hermes-webui.md](hermes-webui.md) | **Hermes WebUI** (nesquena/hermes-webui) | exp-v0.52.316 (`77323c31`, local, plus your uncommitted edits), compared against upstream exp-v0.52.422 | Live at `127.0.0.1:8787`, read-only. 18 screenshots |
| [patterstage.md](patterstage.md) | **PatterStage**, formerly "Control Hub (Hermes)". It is the same repo renamed; the `dev` branch is canonical | `dev` @ `6dc4ce1` (2026-10-04); `main` @ `7b9d6d6` (old Control Hub) | Isolated run with a fake `HERMES_HOME`. 44 screenshots |

The screenshots of these third-party products are kept locally in `images/<slug>/` and are not published in this repository, so image links in these reports do not resolve on GitHub.

---

## 1. At a glance

| | Hermes Dashboard | Hermes WebUI | PatterStage |
|---|---|---|---|
| **Character** | Admin console. Covers almost every `hermes` CLI capability | Chat-first workspace. The deepest run-control features | Orchestration and governance console. Missions, workflows, spend |
| **Owner / maturity** | Nous Research, first-party. Ships with every agent release, about every 5.5 days | Community project: 18.8k★, 326+ contributors, mostly maintained by an agent. About 5 experimental releases a day; stable frozen since 2026-08-14 | One maintainer, 66★. No releases; `dev` is unmerged (PR #157) |
| **Stack** | React 19, Vite, Tailwind 4, `@nous-research/ui`; FastAPI backend | Vanilla JS with no build step (ui.js is about 22k lines); Python stdlib HTTP server | Next.js 16, React 19, Tailwind 4, TanStack Query; SQLite |
| **How it reaches Hermes** | It *is* Hermes: in-process modules. 336 REST operations plus 7 WebSockets, with an OpenAPI spec | Imports `AIAgent` in-process and changes `os.environ` on each turn. 278 routes. Gateway or runner backends are opt-in | HTTP to the Hermes API server (`/v1/runs` + SSE). Its own SQLite is the source of truth and is mirrored into `~/.hermes` with drift detection |
| **Chat** | The real TUI inside xterm over a PTY WebSocket | Native rich chat | Native chat in Agent mode (tools) or Fast mode (raw model) |
| **Real-time** | WebSocket for chat and kanban; everything else is polled. No SSE | SSE only (10 streams). Journaled and resumable with `Last-Event-ID` | SSE for runs; everything else is polled. Server-side reconcile is authoritative |
| **Auth default** | Loopback token. Any non-loopback bind gets a login gate that fails closed (basic, Nous OAuth or OIDC) | **Off by default.** Options: password, passkeys, OIDC, proxy-header SSO | Operator token is required and swapped for a session cookie. CSRF, nonce CSP and a read-only mode |
| **Mobile** | Drawer below 1024 px. No PWA, small touch targets | Drawer at ≤900/640 px. PWA, gestures, and the best phone composer | Drawer below 768 px, icon rail at 768–1023 px, bottom sheets, a phone e2e suite. No PWA |
| **Biggest strength** | Breadth of admin and ops features, plus a plugin SDK | Run control, durable streaming, session bridge | Missions, the Composer workflow graph, spend governance, help and onboarding |
| **Biggest weakness** | Chat is a terminal, which is unusable on touch | Coupled to agent internals; performance at scale; insecure defaults | Unreleased. No gateway, MCP, cron or hub management. Dark theme only, no i18n |

---

## 2. Unified feature matrix

Legend: ● full · ◐ partial or limited · ○ absent · TUI = available only through the embedded terminal UI · API = the backend supports it but the UI does not use it. The **Adopt from** column names the best existing pattern; it is a recommendation.

### 2.1 Chat & run control
| Capability | Dash | WebUI | PS | Adopt from |
|---|---|---|---|---|
| Native message UI (bubbles, markdown, tool cards) | ○ | ● | ● | WebUI |
| Terminal / TUI chat mode | ● | ◐ (shell PTY, not the TUI) | ○ | Dash (optional "terminal mode") |
| Streamed reasoning / thinking | TUI | ● | ● | WebUI |
| Tool approvals | TUI | ● (once / session / always / deny, YOLO) | ● (approve / deny) | WebUI |
| Clarify prompts | TUI | ● (choices, free text, countdown) | ◐ (Composer only) | WebUI |
| Queue / Interrupt / **Steer**, `/btw`, `/background`, `/goal` | TUI | ● | ○ | WebUI |
| Activity display modes (Worklog / Stream / Final only) | ○ | ● | ○ | WebUI |
| Attachments | ◐ (image paste) | ● (20 files: docs, PDF, archives) | ○ | WebUI |
| Voice: dictation, hands-free, TTS (4 engines) | ○ | ● | ○ | WebUI |
| Message actions: edit, fork, regenerate, copy | ◐ (copy last) | ● | ◐ (retry failed) | WebUI |
| Model + reasoning-effort pickers | ● | ● (composer chips) | ◐ (Fast mode only) | WebUI chips + Dash picker |
| Context ring: usage, cost, cache %, Compress | TUI | ● | ○ | WebUI |
| Rich rendering (KaTeX, Mermaid, tables, PDF, HTML) | ○ | ● | not documented | WebUI |
| Durable / resumable streams | ◐ (PTY keep-alive 30 min) | ● (run journal, survives server restart) | ◐ (reconcile after drop) | WebUI |
| Drafts saved server-side, across devices | ○ | ● | ○ | WebUI |
| Saved prompts | ○ | ● | ○ | WebUI |
| Image paste / drag-drop | ● | ● | ○ | either |
| Fast (raw-model) chat | ○ | ○ | ● | PS |

### 2.2 Sessions & history
| Capability | Dash | WebUI | PS | Adopt from |
|---|---|---|---|---|
| Full-text search of message bodies | ● (FTS5) | ● | ○ (titles and ids only) | Dash FTS + WebUI UX |
| Cross-source sessions (CLI, messaging, cron, webhook, kanban) | ● (source filter, category tabs) | ● (+ Claude Code) | ◐ (read-only) | WebUI |
| Resume / continue external sessions | ● (resume in the TUI) | ● (import and continue) | ○ | WebUI |
| Handoff summary for messaging sessions | ○ | ● | ○ | WebUI |
| Rename / delete / bulk select | ● (shift-range, prune, delete empty) | ● | ○ | Dash + WebUI |
| Projects, pins, archive | ◐ (archive) | ● | ◐ (group by mission) | WebUI |
| Fork / branch / duplicate / git-worktree sessions | ○ | ● | ○ | WebUI |
| Export / import | ● (JSON/JSONL) | ● (MD / JSON / themed HTML) | ◐ (chat JSON/CSV) | WebUI |
| Public share links | ○ | ● | ○ | WebUI |
| Transcript viewer with tool-call accordions | ● | ● | ● (role filters, search, copy) | PS filters + Dash accordions |
| Session ↔ mission linkage | ○ | ○ | ● | PS |
| Touch gestures (swipe archive/delete, long-press) | ○ | ● | ○ | WebUI |

### 2.3 Agents / profiles
| Capability | Dash | WebUI | PS | Adopt from |
|---|---|---|---|---|
| Profile cards with gateway status | ● | ● | ● (table + sync state) | Dash |
| Create / clone | ● (+ 5-step **Profile Builder**) | ● | ● | Dash builder |
| SOUL.md editor | ● | ● (Memory → Agent Soul) | ● (Identity tab) | any |
| All behaviour files (AGENTS, USER, MEMORY, config.yaml, HERMES.md) | ○ | ◐ (MEMORY / USER / SOUL) | ● (preview, edit, backup) | PS |
| LLM auto-describe | ● | ○ | ○ | Dash |
| Profile scope model | global `?profile=` + banner | per browser (cookie) | localStorage pick; settings only edit the active home | **decision (§4)** |
| Profile export / import | API | ○ | ○ | Dash API |
| DB ↔ disk push/pull with drift detection | ○ | ○ | ● | PS (only if PS's own DB is kept, §4) |
| Seed persona catalogue + restore | ○ | ○ | ● (7 personas, 12 templates) | PS |
| Per-agent performance and XP | ○ | ○ | ● | PS |
| Multiplexed-gateway migration | ● | ○ | ○ | Dash |

### 2.4 Models & providers
| Capability | Dash | WebUI | PS | Adopt from |
|---|---|---|---|---|
| Auxiliary task slots | ● (11) | ● (11) | ● (12, adds delegation) | union |
| Mixture-of-Agents presets | ● | ○ | ○ | Dash |
| Fallback chain editor | ○ | ○ | ● | PS |
| Provider keys | ● (audited reveal) | ● (40+ providers, test connection) | ● (rotate key, orphan check) | union |
| OAuth device-code logins | ● | ● | ○ | Dash / WebUI |
| Credential pool | ● | ◐ (availability) | ○ | Dash |
| Per-model usage cards with "Use as…" | ● | ○ | ○ | Dash |
| Quota, spend, budget | ◐ (cost hidden by default) | ● (7-day spend, monthly pace, budget) | ● (spend by source, **hard stop for unattended work**) | PS rules + WebUI provider quota |
| Live model catalogue refresh | ● | ● | ○ | either |

### 2.5 Skills, tools, MCP, plugins
| Capability | Dash | WebUI | PS | Adopt from |
|---|---|---|---|---|
| Browse / search / toggle / categories | ● | ● | ● | any |
| Create / edit SKILL.md | ● | ● | ◐ (drops frontmatter) | Dash / WebUI |
| Delete / uninstall | API | ● | ○ | WebUI |
| **Skills hub** (9 sources) + security scan | ● | ○ | ○ | Dash |
| Learn-a-skill, curator controls | ● | ○ | ○ | Dash |
| Skill usage stats | ◐ | ● | ○ | WebUI |
| Toolset config (provider, keys, setup) | ● (drawer) | ◐ (per-session override) | ● (per-profile grid + JSON) | Dash + PS |
| MCP servers CRUD + OAuth + test | ● (no edit) | ◐ (list, toggle; edit via API) | ○ | Dash, plus edit |
| MCP catalogue (65) | ● | ○ | ○ | Dash |
| MCP tool inventory | ◐ (Test) | ● | ○ | WebUI |
| Shell hooks | ● | ○ | ○ | Dash |
| Hermes plugin install / update / remove + catalogue | ● | ◐ (read-only list) | ○ | Dash |
| UI extension system | ● (SDK: tabs, overrides, 30+ slots, backend routers) | ● (gallery, JS API, sidecars, skins; also renders Dash plugins in iframes) | ○ | **decision (§4)** |
| Dashboard exposed as an MCP server | ○ | ● | ○ | WebUI |

### 2.6 Memory & knowledge
| Capability | Dash | WebUI | PS | Adopt from |
|---|---|---|---|---|
| Edit MEMORY.md / USER.md | ◐ (size and reset only) | ● | ● | WebUI |
| Memory-provider selection + dynamic config form | ● | ○ | ◐ (Hindsight / holographic) | Dash |
| Hindsight browser (recall, reflect, directives, mental models) | ○ | ○ | ● | PS |
| Project context, external notes (MCP), LLM Wiki | ○ | ● | ○ | WebUI |
| Context-engine selection | ● | ○ | ○ | Dash |
| Learning graph | API | ○ | ○ | Dash API |

### 2.7 Scheduling & automation
| Capability | Dash | WebUI | PS | Adopt from |
|---|---|---|---|---|
| Hermes cron CRUD (`jobs.json`) | ● | ● | ○ (dropped on `dev`) | Dash / WebUI |
| Schedule builder with preview | ● | ● (presets) | ● (shows the next 3 fire times) | PS preview + Dash builder |
| Run history and output | API | ● | ● | WebUI |
| Automation Blueprints (16 templates) | ● | ○ | ○ | Dash |
| Script-mode jobs | ● (`no_agent` + script) | ● | ● (Scripts page + host crontab) | union |
| Cross-profile job list | ● | ● | ○ | either |
| Run-completion toasts / badges | ○ | ● | ○ | WebUI |
| Dashboard's own scheduler (exactly-once, catch-up) | ○ | ○ (relies on the gateway ticking) | ● | **decision (§4)** |
| Spend gate on unattended runs | ○ | ○ | ● | PS |

### 2.8 Orchestration
| Capability | Dash | WebUI | PS | Adopt from |
|---|---|---|---|---|
| Hermes Kanban (`kanban.db`): boards, lanes, comments, links | ● (plugin, 44 routes, WebSocket) | ● (multi-board, task modal, SSE) | ○ | Dash API + WebUI UI |
| Dispatcher (preview / run, per-profile workers) | ● (nudge, orchestration settings) | ● (dry-run + run) | ○ | WebUI |
| Missions: structured brief, 4 dispatch modes, templates, queue | ○ | ○ | ● | PS |
| **Composer** workflow graph (loops, verdicts, human gates, clarify) | ○ | ○ | ● | PS |
| Deep Research → Artifacts store | ○ | ○ | ● | PS |
| Agent todo list, subagent cards, goals | ○ | ● | ○ | WebUI |

### 2.9 Gateway & messaging
| Capability | Dash | WebUI | PS | Adopt from |
|---|---|---|---|---|
| Gateway start / stop / restart | ● | ● | ○ | either |
| Channel configuration (23+ platforms, Test) | ● | ○ | ◐ (read-only status for 7) | Dash |
| **QR onboarding** (Telegram bot creation, WhatsApp pairing) | ● | ○ | ○ | Dash |
| DM pairing approvals | ● | ○ | ○ | Dash |
| Webhook subscriptions (one-time secret) | ● | ○ | ○ | Dash |
| Per-profile gateway status dot | ● | ● | ○ | either |

### 2.10 Files, workspace, terminal, git
| Capability | Dash | WebUI | PS | Adopt from |
|---|---|---|---|---|
| File browser | ◐ (list, upload, mkdir, delete; no preview) | ● (tree, preview / editor incl. Office, move, rename) | ○ | WebUI |
| Workspaces / spaces | ◐ (v0.21.5 chat cwd picker) | ● | ◐ (mission working dirs) | WebUI |
| Checkpoint rollback (diff / restore) | ◐ (count / prune) | ● | ○ | WebUI |
| Git (diff, stage, commit, push, AI commit message) | API (Desktop only) | ◐ (badge only; full API hidden) | ◐ (branch picker) | WebUI API, needs a UI |
| Artifacts | ○ | ● (files changed this session) | ● (artifact store) | union |
| Terminal | ◐ (restricted `hermes>` console) | ● (PTY shell over SSE, multi-viewer) | ◐ (script runner) | WebUI |

### 2.11 Config, observability, maintenance
| Capability | Dash | WebUI | PS | Adopt from |
|---|---|---|---|---|
| Schema-driven config form + search | ● (30+ categories) | ◐ (WebUI settings + parts of config) | ● (27 sections, 7 groups, per-section save) | Dash coverage + PS UX |
| Raw YAML editor | ● | ○ | ○ (deferred) | Dash, with validation |
| Config import / export / reset | ● | ○ | ○ | Dash |
| First-run onboarding | not documented | ● (5-step wizard) | ● (32 quests) | WebUI wizard + PS quests |
| Logs viewer | ● (level / component filters) | ● (severity, copy all) | ● (download, newest-first) | union, plus server search and streaming |
| Token / cost analytics | ◐ (hidden by default) | ● (7–365 days, cache %) | ● (heatmap, hour-of-day, by model / mission) | PS charts + WebUI data |
| Host stats + resource-pressure banner | ● | ● (live snapshot) | ◐ | Dash |
| Subsystems health panel with actionable reasons | ◐ (status strip) | ◐ (agent-health banner) | ● | PS |
| Doctor, security audit, debug share, support dump | ● | ○ | ◐ ("copy for bug report") | Dash |
| Backup / restore | ● (zip) | ◐ (session `.bak` recovery) | ● (DB snapshots) | Dash |
| Update Hermes agent | ● | ● (+ WebUI self-update, AI "What's New") | ○ | WebUI |

### 2.12 Platform, UX & security
| Capability | Dash | WebUI | PS | Adopt from |
|---|---|---|---|---|
| Themes | 8 + YAML user themes + 15 fonts | 21 skins × light / dark / system + 4 font sizes | dark only | WebUI model + Dash YAML |
| Locales | 17 (RTL broken) | 15 (chat-only RTL) | none | union, with logical CSS |
| Command palette | ○ | ○ (⌘K = new chat) | ○ (deferred) | **new** |
| Customisable nav / composer chips | ○ | ● | ○ | WebUI |
| In-app help | ◐ (docs iframe) | ◐ (links) | ● (help for every screen, `?` hotkey, glossary pop-ups) | PS |
| Achievements / gamification | ● (60 badges, plugin) | ○ | ● (40 badges + 32 quests + XP) | **decision (§4)** |
| Story Weaver (creative writing) | ○ | ○ | ● | PS (optional module) |
| Auth methods | basic, Nous OAuth, OIDC | password, passkeys, OIDC, proxy SSO | operator token | union |
| Session list / revoke, read-only mode | ○ | ○ | ● | PS |
| Accessibility rigour | ◐ (no focus traps, drawer not inert) | ◐ (zoom locked, rows not focusable) | ● (lint-enforced, skip link, focus traps, reduced motion) | PS |

---

## 3. Mobile assessment

None of the three is mobile-first. Each solved a different part of the problem:

| Concern | Dash | WebUI | PS | Best practice for the new design |
|---|---|---|---|---|
| Shell | Hamburger → left drawer below 1024 px | Hamburger → **full-width** drawer at ≤900 px; edge swipe | Drawer below 768 px; **icon rail at 768–1023 px**; sheets | Bottom tab bar on phones, rail on tablets, sidebar on desktop |
| Bottom nav | ○ | ○ (README calls this deliberate; ROADMAP contradicts it) | ○ | **Needed** (no one has it) |
| PWA | ○ | ● manifest + service worker. No install prompt UI, no Web Push | ○ | Manifest, SW, install prompt, **Web Push** for approvals, runs and cron |
| Secure context | Plain-HTTP tailnet bind breaks SW and clipboard | Recommends `tailscale serve` (HTTPS) | Network start needs a proxy or explicit insecure LAN flag | HTTPS by default via Tailscale Serve / `ts.net` cert |
| Viewport / safe area | `viewport-fit=cover`, bottom inset only | **Zoom locked**, no `viewport-fit`, no bottom inset | No insets, uses `vh` | `viewport-fit=cover`, all 4 insets, `dvh`, zoom allowed |
| Touch targets | ~28–30 px; hover-only Skills edit | 44 px on phones for core controls; ⋮ buttons 26 px, chips ~20 px | 24 px floor gate; hamburger 44 px | 44 px everywhere, `pointer:coarse` styles, no hover-only actions |
| Soft keyboard | ● visualViewport inset, IME fixes (chat) | ● visualViewport inset, 16 px inputs | not documented | Both techniques |
| Composer on phone | xterm: touch scroll broken, IME duplicates | **Collapses into a config sheet** (best pattern found) | Basic composer, ≥270 px test | WebUI pattern |
| Lists / tables | Files actions clipped; kanban scrolls sideways | Kanban 82 vw snap columns; swipe gestures | `DataList` restacks into cards; split panes → bottom sheets | PS restacking + WebUI gestures |
| Drag-and-drop | Kanban has touch handlers | HTML5 DnD (probably fails on touch) | Composer canvas fails on touch | Long-press drag + "Move to…" menu fallback |
| Complex editors | Config 500+ fields; long System page | Settings 60+ toggles in one column | Composer graph unusable at 390 px | Search-first settings; linear stage list on phone, canvas ≥1024 px |
| Phone tests | ○ | ○ | ● Playwright 390×844 project | Adopt PS's phone e2e and hit-target gates |
| Native apps | Native mobile app is the top request (#11911) | iOS / Android / Tauri shells exist (README / ROADMAP) | ○ | PWA first; leave room for native shells |

Open mobile bugs worth designing around: xterm touch scrolling (#81119, #76002), Android IME duplicates (#125517), iOS PWA resume storms (WebUI #7891), keyboard closing dropdowns (#7471), iPad keyboard offset (#6368). Upstream asks for a session-delta SSE feed for mobile mirrors (hermes-agent #95573).

---

## 4. Conflicts that needed a decision before design

> **Resolved 2026-10-06.** See the decision log (D1–D10) in [../design/README.md](../design/README.md). The text below is kept as the original framing.

The three products overlap with incompatible models. These are product decisions, not research findings.

1. **Source of truth.** Dash and WebUI treat `~/.hermes` (files plus `state.db` / `kanban.db`) as the truth. PatterStage keeps its own SQLite and mirrors to `~/.hermes` with push/pull and drift detection. Keeping both creates drift by design. *Recommendation:* Hermes is the source of truth for everything Hermes owns. A dashboard-owned store holds only new concepts: missions, workflows, artifacts, budgets, drafts and preferences.
2. **Backend contract.** The options:
   - (a) Dash's FastAPI: 336 operations, WebSockets, OpenAPI, multi-profile auth.
   - (b) The Hermes API server `/v1/runs` + SSE, as PatterStage uses.
   - (c) WebUI-style in-process imports, which cause stale-agent 409s, `os.environ` mutation and crash loops after updates.
   
   *Recommendation:* (a) for admin plus native chat over `/api/ws` JSON-RPC, or `/v1/runs`, for runs. Avoid (c).
3. **Chat paradigm.** Dash uses the TUI in a terminal; the others are native. *Recommendation:* native chat as the default, with the TUI as an optional "terminal mode" for power users on desktop.
4. **Task substrate.** Three overlapping concepts: Hermes Kanban (Dash and WebUI), PatterStage Missions (structured briefs plus queue) and Composer workflows. These need one mental model. One option: Kanban tasks as the unit, Missions as task templates with dispatch modes, Composer workflows as multi-stage tasks.
5. **Schedulers.** Hermes cron (ticked by the gateway), PatterStage's own exactly-once scheduler, and host crontab scripts. *Recommendation:* Hermes cron is primary, scripts become a job type, and no third scheduler.
6. **Profile scope.** Dash uses a global `?profile=` with a banner; WebUI uses a per-browser cookie; PatterStage uses a localStorage pick but writes only the active home. This matters for multi-device use: phone and desktop on different profiles.
7. **Extension model.** Dash plugin SDK (tabs, slots, backend routers) versus WebUI extensions (gallery, JS API, sidecars, skins). WebUI already embeds Dash plugins as iframes. Pick one SDK and bridge the other.
8. **Gamification and Rec Room.** Achievements exist in Dash (plugin) and PatterStage (with quests and XP). Story Weaver is PatterStage-only. Decide: core, optional module, or dropped.

## 5. Gaps none of the three fill (where the new design can lead)

- Command palette (⌘K) and global, configurable shortcuts. All three lack them; Dash issue #4256.
- Bottom-tab mobile navigation, Web Push notifications (approvals, finished runs, cron), an install prompt, and an offline action queue.
- Push-based real time everywhere. Logs, cron, gateway and session events are still polled in at least two of the three products.
- Server-side log search and streaming. The Dash backend already supports `search=`.
- A git panel. The WebUI and Dash backends both have git APIs and neither has a UI.
- A cron run-history viewer in Dash, a memory-contents viewer, the learning graph, MCP server editing, profile export/import. These are all backend-only today.
- Multi-agent "bot mode" rooms with @mention handoffs (WebUI #7174, Dash #89995), a thread-centric control UI (Dash #105257), and multi-surface access to the same session (Dash #112028).
- Real accessibility parity: PatterStage-grade lint gates applied to a far larger surface, logical (RTL-safe) CSS, no zoom lock.
- Secure defaults: auth on whenever the bind is off loopback, POST-only mutations, gates on shutdown, update and exec, and a permission model for extensions.

## 6. Inputs for the design phase

- **Feature-parity checklist:** every ● and ◐ row in §2 is a requirement. "API" rows are free wins.
- **Proposed IA starting point (for validation):**
  - Phone bottom tabs: Chat · Inbox (sessions plus approvals) · Work (Kanban, Missions, Cron) · Agents (profiles, skills, memory, models) · More (gateway, config, system, logs, insights).
  - Tablet: icon rail. Desktop: grouped sidebar plus ⌘K.
- **Patterns to reuse:** WebUI composer chips and phone config sheet; WebUI journaled SSE; PatterStage `DataList` restacking, `SplitPane`→sheet, subsystem reasons, honest copy, design-lint gates; Dash schema-driven config, QR onboarding, global profile banner, plugin slots.
- **Mobile-hostile surfaces needing a phone-specific design:**
  - Kanban board, Composer graph, Config (500+ fields), Providers (40+), Files table, Model picker.
  - Destructive operations: restore, prune, delete profile, update.
