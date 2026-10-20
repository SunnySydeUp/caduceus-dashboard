# Hermes Default Dashboard (`hermes dashboard`) — Research
> Inspected: https://github.com/NousResearch/hermes-agent (`web/` + `hermes_cli/` web server), local checkout tag `v2026.9.21` = v0.21.4, commit `d337b736` (2026-09-21); upstream `main` @ `74306c1d` and release `v2026.9.24` (v0.21.5) checked for newer changes. Date 2026-10-06. Live instance: http://100.64.0.10:9119 (Tailscale IP bind, gated/basic-auth, v0.21.4). It was browsed read-only. **`/chat` was not opened live**: opening it spawns a PTY + TUI + agent process that auto-resumes the most recent active session, which was live in another client at the time. Chat is documented from code only.

File paths are relative to `~/.hermes/hermes-agent/`. `wr/` = `hermes_cli/web_routers/`. "R/W" = read / write (side effect).

---

## 1. Identity

| Aspect | Finding | Evidence |
|---|---|---|
| Frontend | Vite SPA with React 19, react-router, Tailwind 4 and the React Compiler. Design system is `@nous-research/ui` 0.18.2 (radix-based); icons are lucide-react. Terminal is xterm 6 with fit, unicode11, web-links and webgl addons. `@hermes/shared` (apps/shared) supplies i18n, theme palettes, the JSON-RPC gateway client and fuzzy search. `@observablehq/plot`, three, @react-three/fiber, gsap, motion and leva are in package.json, but **web/src imports none of them**. They are DS peer dependencies; gsap and leva reach the bundle through the DS `Badge`. | `web/package.json`; `web/vite.config.ts:79-131`; `web/src/main.tsx` |
| Backend | One FastAPI app run directly by uvicorn: `FastAPI(title="Hermes Agent")`. Handlers live in 21 routers under `hermes_cli/web_routers/` plus `dashboard_auth`. **336 REST operations** in OpenAPI (taken from the live `/openapi.json`) plus 7 WebSockets. | `hermes_cli/web_server.py:307, 963-999`; live `/openapi.json` |
| Build | `web/` builds to `hermes_cli/web_dist`. `hermes dashboard` builds automatically when npm is present (`--skip-build` turns this off). `hermes update` rebuilds. Dev server is Vite on :5173, proxying `/api` to :9119. | `hermes_cli/main_dashboard.py:947-985`; [docs web-dashboard](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard) |
| License / maturity | MIT. About 252k stars and 54k forks. 24 releases in about 131 days (roughly one every 5.5 days); minor versions every 2-3 weeks. Last commit on main 2026-10-06. 511 open issues labelled `comp/dashboard`. | GitHub API `repos/NousResearch/hermes-agent`; [releases](https://github.com/NousResearch/hermes-agent/releases) |
| Install / deploy | Ships inside the `hermes-agent` Python package; no separate install. `hermes dashboard [--host --port 9119 --no-open --skip-build --isolated --stop --status]`. `hermes serve` runs the same server without the UI. `hermes dashboard register` creates a Nous OAuth client. | `hermes_cli/subcommands/dashboard.py:15-95` |
| Process model | **One machine-level process for all profiles.** It serves the SPA, REST, WebSockets **and an in-process `tui_gateway`** (agent JSON-RPC). It also runs a PTY reaper, a self-test, session auto-archive, the managed llama runtime and the Nous free-tier bootstrap. The messaging gateway (`hermes gateway`) is a **separate** process that the dashboard starts, stops and restarts. The cron ticker runs in-process only when `HERMES_DESKTOP=1`. A second `hermes -p X dashboard` attaches to the running host instead of binding a new port (`--isolated` opts out). | `hermes_cli/web_server.py:143-259, 1496`; `hermes_cli/main_dashboard.py:813-930` |
| Auth model | **Loopback bind:** a per-process session token is injected into index.html and sent as header `X-Hermes-Session-Token`. **Any non-loopback bind** (RFC1918, CGNAT and Tailscale 100.x count) or a `public_url`: a login gate that fails closed. Providers: `basic` (scrypt hash, HMAC tokens, 12 h access / 30 d refresh), `nous` (Portal OAuth with PKCE), `self_hosted` OIDC, and `drain` bearer. Cookies are HttpOnly + SameSite=Lax. WebSockets use single-use 30 s tickets. Login is rate-limited (10/60 s per IP); env-secret reveal is limited to 5/30 s and audited. Host-header check, Origin check on WebSockets, and CORS restricted to localhost. Auth events go to an audit log at `logs/dashboard-auth.log`. | `hermes_cli/web_server.py:319-322, 400-490, 548-591, 1128-1137`; `hermes_cli/dashboard_auth/*`; `plugins/dashboard_auth/basic/__init__.py` |
| Remote access | No Tailscale integration in the code: no `--tailscale` flag, no Serve/Funnel. The docs recommend `--host <tailscale-ip>` + auth, or Tailscale Serve → loopback with `dashboard.public_url`. The live instance is a user launchd job, `dashboard --host 100.64.0.10 --port 9119 --no-open --skip-build`, with basic auth set through env. It is **plain HTTP**, so the page is not a secure context (no service worker, restricted clipboard API). | `hermes_cli/web_server.py:1126`; `~/Library/LaunchAgents/com.sunny.hermes-dashboard-tailscale.plist`; [docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard); live probe |

## 2. How it talks to Hermes

The dashboard *is* Hermes: it imports Hermes modules in-process (SessionDB, config loader, cron, skills, tui_gateway) and spawns `hermes …` subprocesses for long-running operations. REST calls that touch profile data take a `?profile=` scope. The server swaps `HERMES_HOME` through a contextvar (`hermes_cli/web_server_profiles.py:243-277`), and the client adds the parameter automatically (`web/src/lib/api.ts:87-152`).

| Data domain | Mechanism | R/W | Evidence |
|---|---|---|---|
| Config | `HH/config.yaml`: deep-merge PUT, raw YAML GET/PUT, schema and defaults auto-derived from `DEFAULT_CONFIG` | R/W | `wr/config_env.py:78-115`; `wr/analytics.py:33-52`; `hermes_cli/web_server_config.py:221-385` |
| Secrets | `HH/.env` (masked list, reveal, set, delete); `auth.json` (OAuth tokens, credential pool) | R/W | `wr/config_env.py:227-986`; `wr/oauth.py:619-775`; `wr/ops.py:334-421` |
| Sessions / messages | `HH/state.db` via SessionDB, opened read-only first. FTS5 search; import/export JSON(L) | R/W | `wr/sessions.py:165-762` |
| Usage analytics | SQL over `state.db` sessions + `session_model_usage`, plus `InsightsEngine` for skills | R | `wr/analytics.py:100-330` |
| Profiles | `~/.hermes/profiles/<name>/`, the `active_profile` sticky file, `SOUL.md` | R/W | `wr/profiles.py:685-1023` |
| Memory | `HH/memories/MEMORY.md`, `USER.md`; `memory.provider` + provider config/OAuth | R/W | `wr/ops.py:481-518`; `wr/memory_providers.py:516-559` |
| Skills | `HH/skills/**/SKILL.md`, `skills.disabled` in config, hub installs via spawned `hermes skills …`, `.curator_state` | R/W | `wr/skills.py:97-427`; `wr/status.py:608-647` |
| Cron | `HH/cron/jobs.json`, `cron/output/`, `cron/executions.db`; blueprint catalog | R/W | `wr/cron.py:232-413`; `cron/blueprint_catalog.py:103-530` |
| Messaging platforms | `.env` + `config.yaml`; WhatsApp bridge QR; Telegram managed-bot QR through a Nous service | R/W | `wr/messaging.py:549-916` |
| Pairing | `HH/platforms/pairing/{platform}-{pending,approved}.json` | R/W | `wr/ops.py:84-129`; `gateway/pairing.py:344-354` |
| Webhooks | `HH/webhook_subscriptions.json` (mode 0600) | R/W | `wr/ops.py:154-264`; `hermes_cli/webhook.py:18-41` |
| MCP / toolsets / hooks | `config.yaml` (`mcp_servers`, `platform_toolsets`, `hooks`), `.env`, `shell-hooks-allowlist.json` | R/W | `wr/mcp.py:94-443`; `wr/tools.py:230-700`; `wr/ops.py:656-756` |
| Gateway lifecycle | Spawns `hermes gateway start/stop/restart`; reads `gateway_state.json` + health URL | R/W | `wr/ops.py:282-295`; `wr/actions.py:139-165`; `wr/status.py:451` |
| Logs | Polled tail of `HH/logs/{agent,errors,gateway}.log` (backend also has gui/desktop/mcp-stderr) | R | `wr/status.py:794-830`; `hermes_cli/logs.py:17-27` |
| Ops | Spawned `hermes doctor/security-audit/dump/backup/import/update…`; progress read by tailing `logs/<action>.log` | W | `wr/ops.py:546-631`; `wr/actions.py:219-413` |
| Chat | **WS `/api/pty`** → POSIX PTY running `node ui-tui/dist/entry.js` (Ink TUI). The TUI talks back over **WS `/api/ws`** (JSON-RPC, in-process tui_gateway, or a per-profile `tui_gateway.entry` for other profiles). Sidebar events arrive on `/api/pub` → `/api/events` | R/W | `wr/chat_ws.py:433-625`; `hermes_cli/web_server_chat.py:48, 298-428` |
| Console | WS `/api/console`: restricted in-process `hermes>` command engine | W | `wr/chat_ws.py:272`; `hermes_cli/console_engine.py:353-376` |
| Files | `/api/files*`: root `HERMES_DASHBOARD_FILES_ROOT`, else `/opt/data`, else **$HOME unlocked**. `/api/fs/*` (used by Desktop) reaches any absolute path | R/W | `hermes_cli/web_server_files.py:13-138`; `wr/files.py:359-748` |
| Kanban / projects | Bundled plugin API `/api/plugins/kanban/*` (44 routes + WS `/events`) over `~/.hermes/kanban.db`, which **all profiles share**. Per-profile `projects.db` through `/api/profiles/projects/tree` | R/W | `plugins/kanban/dashboard/plugin_api.py:327-1717`; `hermes_cli/kanban_db.py:399-510`; `hermes_cli/projects_db.py:23-25` |
| Themes / plugins | `~/.hermes/dashboard-themes/*.yaml`; `dashboard.theme`/`font` in config; `<plugins>/*/dashboard/manifest.json` | R/W | `hermes_cli/web_server_dashboard.py:414-859`; `wr/dashboard_ui.py:51-344` |
| Not present | No SSE anywhere. No "missions" concept. `/api/git/*`, `/api/audio/*` and `/api/local-models/*` exist but the web dashboard does not use them (they are for Desktop) | — | BackendApi grep of `hermes_cli` and `web/src` |

## 3. Information architecture

Routes come from `web/src/App.tsx:157-225`. Every page is lazy-loaded. The nav has one flat list in this order:

```
/                → redirect /sessions
/chat            Chat — xterm-hosted TUI. Persistent host, mounted on first visit and kept alive across tabs
/sessions        Sessions — landing page. Overview / History, search, bulk actions, import
/files           Files — managed file browser
/analytics       Analytics — nav entry HIDDEN unless dashboard.show_token_analytics; URL still works (App.tsx:413-468)
/achievements    [bundled plugin, after:analytics] gamified badges
/models          Models — main / auxiliary / MoA assignment + per-model usage cards
/logs            Logs
/cron            Cron — Jobs | Blueprints
/skills          Skills — All | Toolsets | Browse hub
/kanban          [bundled plugin, after:skills] multi-agent board
/plugins         Plugins — memory provider, context engine, git install, curated catalog, installed list
/mcp             MCP — your servers + catalog (65 entries live)
/channels        Channels — 23+ messaging platforms, QR onboarding (Telegram, WhatsApp)
/webhooks        Webhooks — receiver enable + subscriptions
/pairing         Pairing — DM user approvals
/profiles        Profiles — cards + ⋮ menu; /profiles/new = 5-step Profile Builder (no nav entry)
/config          Config — schema form or raw YAML
/env             Keys — OAuth logins, provider / tool / gateway / settings / custom keys
/system          System — host, update, portal, curator, gateway, memory, credential pool, ops, backup, debug share, checkpoints, shell hooks
/docs            Documentation — iframe of the official docs. Hard reload serves FastAPI Swagger instead (§9)
*                → /sessions after plugins load
```

Plugins appear in their own sidebar group under "Plugins" (`App.tsx:670-700`). On the live instance Kanban and Achievements render in that group, and `commandcode-usage` is a hidden-tab plugin that adds a card to Analytics.

**Persistent chrome** (`App.tsx:515-1113`):
- Sidebar, top to bottom:
  - wordmark + collapse toggle
  - ProfileSwitcher (hidden when there are fewer than 2 profiles)
  - nav
  - "System" block: gateway status + active-session count (links to Sessions), **Restart Gateway**, **Update Hermes** (with a "N commits behind" confirm)
  - Theme switcher, Language switcher
  - AuthWidget (user + provider + logout)
  - footer with version
- Banner stack above the content: plugin `header-banner`, amber **ProfileScopeBanner** ("Managing profile X"), **MemoryPressureBanner** (disk / memory / OOM).
- Page header: per-route h1 plus `afterTitle` / `end` action slots (`contexts/PageHeaderProvider.tsx`).

**Modals and drawers** (all from code):
- Global: Restart/Update confirms.
- Models and Profiles: ModelPickerDialog, ModelReloadConfirm, Aux tasks modal, MoA modal; Profile quick-create, model / description / SOUL editors.
- Cron, MCP, Webhooks: Cron create/edit; MCP add server, MCP env-install; Webhook create (+ one-time secret view).
- Skills: SkillEditorDialog, Learn-a-skill, ToolsetConfigDrawer, Hub detail (preview + security scan).
- Keys and Channels: OAuthLoginModal (device code / PKCE); Channel configure.
- System: HermesConsoleModal, Hook create.
- Sessions: Prune sessions, Delete confirms.
- Chat: mobile "Model & tools" drawer.

## 4. Feature inventory (exhaustive)

### Chat & conversation
| Feature | What it does | R/W | Evidence |
|---|---|---|---|
| Embedded TUI chat | Chat is the real `hermes --tui` (Ink) running in xterm.js over WS `/api/pty`. It is **not a native chat UI**: streaming, tool calls, approvals and slash-command autocomplete are all drawn by the TUI as terminal output | R/W | `web/src/pages/ChatPage.tsx:1-16, 1226-1545`; `wr/chat_ws.py:433-569` |
| Persistent terminal | ChatPage stays mounted (`display:none`) after first activation, so the PTY, WebSocket and xterm survive tab switches. It does not spawn until /chat is first visited | — | `web/src/App.tsx:146-156, 401-411`; `ChatPage.tsx:194-200, 535-539` |
| Keep-alive reattach | A per-tab attach token (sessionStorage + Web Lock) keys a server PTY registry: 30 min TTL, 16 sessions max, 1 MiB replay buffer. Refreshes and network drops reattach; duplicating a tab gets a new PTY | — | `web/src/lib/pty-attach-token.ts:1-87`; `hermes_cli/web_server_chat.py:48` |
| Resume session | `/chat?resume=<id>` (from Sessions ▶ or the session rail) follows to the newest continuation of that session. Without `resume`, the server sends `{type:"resume"}` and replays the last active session. A loading overlay masks the replay | R | `ChatPage.tsx:408-451, 1100-1141, 1360-1374`; `web/src/lib/pty-resume-sanitizer.ts` |
| Session rail | Right rail (`lg:w-60`, collapsible, collapse state saved in localStorage) listing the 30 most recent sessions, with **New chat** and Refresh. It becomes a slide-over drawer below 1024px | R | `web/src/components/ChatSessionList.tsx:31-266`; `ChatPage.tsx:337-346, 1792-1876` |
| Model badge + picker | The sidebar shows the current model; clicking opens a fuzzy two-column provider→model picker. Expensive models need confirmation. After switching, a "Switch model? Reload" prompt appears | R/W | `web/src/components/ChatSidebar.tsx:383-521`; `web/src/components/ModelPickerDialog.tsx:184-626` |
| Reasoning-effort picker | Off / Minimal / Low / Medium / High / Extra High / Max / Ultra, shown only when the model supports reasoning. Writes `agent.reasoning_effort` and shows "run /new" afterwards | W | `web/src/components/ReasoningPicker.tsx:56-97`; `web/src/lib/reasoning-effort.ts:24-47` |
| Image paste / drop | Ctrl/Cmd+V, paste event or drag-drop. Up to 25 MB; png/jpg/gif/webp/bmp. POSTs to `/api/chat/image-upload`, which saves under `HH/images/`, then types `/image <path>` into the TUI | W | `ChatPage.tsx:657-815`; `web/src/lib/chatImagePaste.ts:5-165`; `wr/files.py:322-358` |
| Copy last response | A button sends `/copy`; the TUI's OSC 52 reply is written to the clipboard. Requests from the TUI to read the clipboard are refused | R | `ChatPage.tsx:515-640, 1995-2016` |
| Learn-a-skill handoff | `/chat?learn=<text>` (from Skills) types `/learn …` into the TUI 800 ms after it connects | W | `ChatPage.tsx:1313-1331` |
| Terminal shortcuts | Copy only when text is selected (otherwise Ctrl+C interrupts the agent); Ctrl+Backspace / Ctrl+Delete delete a word; Alt-click for normal selection; right-click selects a word; IME composition fixes | — | `web/src/lib/pty-keyboard-shortcuts.ts:10-45`; `ChatPage.tsx:562-905` |
| Connection lifecycle UI | Error banners for close codes 4401 / 4403 / 4404 / 4408. Reconnect overlay (250 ms→3 s backoff, 5 tries; "Check server status" afterwards). "Session ended" overlay with **Start new session** / **Open logs**. Auto-redial on visibilitychange / pageshow / focus / online. 8 s timeouts for socket connect and ticket requests (mobile radio handoff) | — | `ChatPage.tsx:1171-1990`; `web/src/lib/pty-reconnect.ts:17-50`; `web/src/lib/pty-close-copy.ts:18-58` |
| Theme-aware terminal | xterm colours follow the dashboard theme. WebGL renderer only at ≥768 px. Font 7–14 px depending on width. Bundled JetBrains Mono | — | `ChatPage.tsx:139-174, 915-927, 1764-1768` |
| Credential warning | The sidebar banner offers **Add key** (→/env) / **Switch model** when the provider key is missing | R | `web/src/lib/chat-sidebar-banner.ts:9-58` |
| (Newer, v0.21.5) Workspace picker | Pick the cwd a chat starts in (`GET /api/chat/workspaces`, `/api/pty?cwd=`). The commit calls the dashboard "the phone/web front" | W | commit `d9ca819c`; [docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard) |

### Sessions & history
| Feature | What it does | R/W | Evidence |
|---|---|---|---|
| Stats strip | Total / Active in store / Archived / Messages / Sources (live: 85 / 85 / 0 / 3,953 / 4) | R | `web/src/pages/SessionsPage.tsx:1705-1740`; `wr/sessions.py:467` |
| Category tabs | Chats / Automation / All. Automation covers cron, tool, oneshot, api_server, acp, hermes_flow, vulcan_delegate, webhook | R | `SessionsPage.tsx:102-111, 1831-1840` |
| Source filter | Multi-select of chat sources with per-source counts | R | `SessionsPage.tsx:1842-1925` |
| Overview | Connected-platforms card + 5 most recent sessions; `/api/status` polled every 5 s | R | `SessionsPage.tsx:2128-2208`; `web/src/components/PlatformsCard.tsx` |
| History list | 20 per page. Each row has source icon, title, **Live** badge, model, message and tool counts, and age. The list refreshes silently when another process creates a session | R | `SessionsPage.tsx:468-822, 1134-1170` |
| Full-text search | FTS5 search over message content (300 ms debounce). Results show highlighted snippets; opening one scrolls the transcript to the first hit | R | `SessionsPage.tsx:1939-1966, 174-198`; `wr/sessions.py:254` |
| Transcript viewer | Expanding a row loads the latest 500 messages: role colours, Markdown, collapsible tool calls with pretty-printed JSON arguments, and "Context handoff" compaction blocks | R | `SessionsPage.tsx:297-503`; `web/src/components/Markdown.tsx` |
| Row actions | Resume in chat ▶, inline rename ✎, export JSON ⬇, delete 🗑 (with confirm) | R/W | `SessionsPage.tsx:533-591`; `wr/sessions.py:636-727` |
| Bulk | Checkboxes with shift-click range selection, select page, delete selected | W | `SessionsPage.tsx:607-626, 1338-1434, 2014-2080` |
| Delete empty / Prune | "Delete empty (N)"; "Prune old sessions" deletes ended sessions older than N days (default 90) | W | `SessionsPage.tsx:1436-1470, 1652-1703`; `wr/sessions.py:441-449, 762` |
| Import | `.json`/`.jsonl`/NDJSON import; a toast reports imported / skipped / detached counts | W | `web/src/lib/session-import.ts`; `wr/sessions.py:418` |
| Backend-only | `/timeline`, `/messages/around`, owner-backfill, cross-profile `/api/profiles/sessions` and `/sidebar` | R | `wr/sessions.py:592-651`; `wr/profiles.py:400-453` |

### Agents/Profiles & personas
| Feature | What it does | R/W | Evidence |
|---|---|---|---|
| Global profile scope | A sidebar select switches which profile every page manages. The choice is kept in `?profile=`; an amber banner shows while it differs from the dashboard's own profile; routes remount when it changes | R | `web/src/components/ProfileSwitcher.tsx:18-87`; `web/src/contexts/ProfileProvider.tsx:52-125`; `App.tsx:836-848` |
| Profile cards | Name, badges (active / default / alias / env / distribution), gateway running dot, description (with a "review" flag when auto-generated), model, skill count, path. Live instance: 6 profiles | R | `web/src/pages/ProfilesPage.tsx:1028-1200`; screenshot |
| ⋮ menu | Set as active · Change model · Edit description (with LLM **auto-describe**) · **Edit SOUL.md** · Manage skills & tools (→/skills?profile=) · Copy CLI command · Rename · Delete (warns if its gateway is running) | R/W | `ProfilesPage.tsx:89-254, 473-747`; `wr/profiles.py:782-943` |
| Quick create | Name, clone-from, description, model, "clone everything", "don't seed bundled skills" | W | `ProfilesPage.tsx:817-982` |
| Profile Builder wizard | `/profiles/new`, 5 steps: Identity → Model → Skills (keep subset + add from hub) → MCPs (HTTP/stdio, bearer/OAuth) → Review. Ends in a single `createProfile` call. There is no SOUL step | W | `web/src/pages/ProfileBuilderPage.tsx:33-797` |
| Backend-only | Profile export/import archive, open-terminal, desktop-overlay | — | `wr/profiles.py:814-1023` |

### Models & providers
| Feature | What it does | R/W | Evidence |
|---|---|---|---|
| Model settings card | Main model **Change**; **Auxiliary tasks** (11 slots: vision, compression, skills_hub, approval, mcp, title_generation, review, triage_specifier, kanban_decomposer, profile_describer, curator) with per-slot override or reset-all-to-auto; **Mixture of Agents** presets (reference models + aggregator, set default, add/delete) | R/W | `web/src/pages/ModelsPage.tsx:54-66, 551-1124`; `wr/models.py:204-275` |
| Per-model usage cards | 7/30/90-day period. Each card: rank, provider, context window, max output, sessions, API calls, tool calls, last used, capability badges (Tools / Vision / Reasoning). Tokens and cost appear only when the analytics flag is on. A **"Use as ▾"** menu assigns the model to main / all-aux / one aux slot | R/W | `ModelsPage.tsx:205-548, 1189-1360`; `wr/analytics.py:305` |
| Fuzzy model picker | Two columns (provider \| models), fuzzy highlight, Refresh Models, double-click to apply, "Persist globally" | R/W | `web/src/components/ModelPickerDialog.tsx`; `web/src/lib/model-picker-filter.ts:10-24` |
| OAuth provider logins | On the Keys page: Nous Portal, OpenAI Codex, MiniMax, xAI Grok by device code in the browser; Qwen, Copilot ACP, Anthropic, Claude Code show a copyable CLI command. Status / expiry / token preview, Disconnect | R/W | `web/src/components/OAuthProvidersCard.tsx:65-286`; `web/src/components/OAuthLoginModal.tsx:47-421`; `hermes_cli/web_server_oauth.py:139-167` |
| Credential pool | System page: add / remove multiple API keys per provider (masked), with status | R/W | `web/src/pages/SystemPage.tsx:1254-1306`; `wr/ops.py:334-421` |
| Backend-only | Custom-endpoint providers CRUD / validate, `/api/model/recommended-default`, local-models (llama.cpp / HF / GGUF) | — | `wr/config_env.py:651-874`; `wr/local_models.py` |

### Skills
| Feature | What it does | R/W | Evidence |
|---|---|---|---|
| Installed list | Enable switch per skill; "N/N enabled" counter; search; category sidebar with counts (live: 215 skills, 20 categories) | R/W | `web/src/pages/SkillsPage.tsx:185-210, 325-485, 767-808` |
| SKILL.md editor | Create (name, category, templated frontmatter) or edit a raw markdown SKILL.md | R/W | `web/src/components/SkillEditorDialog.tsx`; `wr/skills.py:392-427` |
| Learn a skill | Takes a file/dir, URL or free text and sends `/learn` in chat | W | `SkillsPage.tsx:241-254, 704-761` |
| Hub browser | Search across connected hubs (live: Official, Hermes Index, skills.sh, Well-Known, Direct URL, GitHub, ClawHub, LobeHub, browse.sh). Featured skills, trust badges, Install with live log, **Update all** | R/W | `SkillsPage.tsx:889-1366`; `wr/skills.py:97-265` |
| Hub detail | Read SKILL.md, file list, **security scan** (allow / ask / block verdict, findings with file:line) | R | `SkillsPage.tsx:1369-1665` |
| Curator | System page: status, interval, last run, Pause/Resume, **Run now** | W | `SystemPage.tsx:1083-1113`; `wr/status.py:608-647` |
| Gaps | No uninstall (the API exists but is never called), no delete, no bulk toggle | — | `web/src/lib/api.ts:1381` |

### Tools/Toolsets & MCP
| Feature | What it does | R/W | Evidence |
|---|---|---|---|
| Toolsets grid | Active/inactive state, "setup needed", tool badges, Configure | R | `SkillsPage.tsx:610-680` |
| Toolset drawer | Enable; choose the backend provider (including Nous Portal); save provider keys (password fields); **Run setup** post-install with a live log | R/W | `web/src/components/ToolsetConfigDrawer.tsx:85-455`; `wr/tools.py:280-615` |
| MCP servers | Add HTTP/SSE (none / bearer / OAuth) or stdio (cmd / args / env). Card actions: **Authenticate** (OAuth popup + polling), Enable/Disable, **Test** (lists tools), Delete | R/W | `web/src/pages/McpPage.tsx:121-753`; `web/src/lib/mcp-dashboard-oauth.ts:15-66`; `wr/mcp.py:94-322` |
| MCP catalog | Nous-approved catalog (65 live): transport/auth badges, setup notes, git source @ ref, one-click Install (prompts for required env first) | W | `McpPage.tsx:246-915`; `wr/mcp.py:381-443` |
| Shell hooks | System page: list hooks; create (event, absolute command, matcher, timeout, approve now); remove | R/W | `SystemPage.tsx:1601-1645, 799-892`; `wr/ops.py:656-756` |
| Tool gateway routing | System → Nous Portal card shows which backend handles web, image, video, TTS, STT, browser and Modal tools | R | `SystemPage.tsx:1036-1080`; `wr/status.py:707` |
| Gaps | No editing of an existing MCP server, no per-tool allow-list, no catalog search, no toolset model selection | — | `wr/mcp.py:136, 275`; `wr/tools.py:421-490` |

### Memory
| Feature | What it does | R/W | Evidence |
|---|---|---|---|
| Built-in memory files | System page: MEMORY.md / USER.md sizes; Reset MEMORY / USER / all (confirmed) | R/W | `SystemPage.tsx:1197-1252`; `wr/ops.py:481-518` |
| External memory provider | Plugins page: select a provider (status ready / needs setup / unavailable), install its dependencies, fill a dynamic config form (secret fields with show/hide eye, conditional fields), OAuth | R/W | `web/src/pages/PluginsPage.tsx:114-789`; `wr/memory_providers.py:516-559`; `hermes_cli/memory_oauth.py:50-64` |
| Context engine | Select the context engine (live: "compressor") and save | W | `PluginsPage.tsx:792-820` |
| Gaps | No viewer or editor for memory **contents**. `/api/learning/graph` exists but no web page uses it | — | `wr/status.py:656-696` |

### Cron/scheduling
| Feature | What it does | R/W | Evidence |
|---|---|---|---|
| Jobs list | Cross-profile list with a profile filter. Cards show state / profile / delivery / skills / mode / model badges, humanised schedule, repeat, last/next run (with an overdue warning), and errors | R | `web/src/pages/CronPage.tsx:659-709, 1086-1280` |
| Job actions | Pause/Resume, **Run now** (409 if already running), Edit, Delete | W | `CronPage.tsx:773-853`; `wr/cron.py:267-287` |
| Create/Edit modal | Profile, name, prompt, **ScheduleBuilder** (interval / daily / weekly / monthly / once / custom cron, with live preview), Deliver-to (platforms that have a home channel), skills checklist. Advanced fields: provider/model, base URL, `no_agent` + script, workdir, continuity, `context_from`, toolsets | W | `CronPage.tsx:197-1074`; `web/src/components/ScheduleBuilder.tsx:69-232`; `web/src/lib/cron-job.ts:44-197` |
| Stale-scheduler warning | Shows "last ticked X ago" when the scheduler stalls | R | `web/src/lib/cron-job.ts:173-197` |
| Automation Blueprints | 16 parameterised templates (morning brief, important mail, price watch, habit check-in …). Inline form → **Schedule it** | W | `web/src/components/AutomationBlueprints.tsx:30-211`; `cron/blueprint_catalog.py:103-530` |
| Gaps | **No run history or output viewer** (`GET /api/cron/jobs/{id}/runs` is unused), no search, no bulk actions | — | `wr/cron.py:242` |

### Tasks/Kanban/Missions/Orchestration
| Feature | What it does | R/W | Evidence |
|---|---|---|---|
| Kanban board (bundled plugin) | Board selector + New board + Settings. Columns Triage / Todo / Scheduled / Ready / … / Blocked / Done, scrolling horizontally (live: 2,382 px wide). Per-column "+" add. Search, tenant and assignee filters, show archived, **lanes by profile**, Nudge dispatcher, Refresh, Clear filters | R/W | `plugins/kanban/dashboard/manifest.json`; `plugins/kanban/dashboard/dist/index.js`; screenshot |
| Card operations | Drag-drop between columns (touch handlers and drag-to-delete trash zone), bulk delete, comments, attachments, links, decompose / specify / reassign / reclaim, runs and terminate, worker log | R/W | `plugins/kanban/dashboard/plugin_api.py:347-1563`; `dist/index.js:478, 2757-2961` |
| Orchestration | Orchestration mode badge (live: "Auto") + settings, dispatcher config, profile roster/describe, home-channel subscribe, diagnostics, stats | R/W | `plugin_api.py:1110-1716` |
| Live updates | Plugin WS `/api/plugins/kanban/events` tails `task_events` | R | `plugin_api.py:1717`; `dist/index.js:767` |
| Projects | `projects.db` tree across profiles; kanban `/projects` | R | `wr/profiles.py:597`; `plugin_api.py:1359` |
| Missions | **Not present** in the dashboard or gateway | — | BackendApi grep |

### Gateway & messaging platforms
| Feature | What it does | R/W | Evidence |
|---|---|---|---|
| Channels page | "N of 33 channels configured". One card per platform (telegram, discord, whatsapp(+cloud), slack, signal, mattermost, matrix, homeassistant, email, sms, dingtalk, feishu, wecom, weixin, bluebubbles, qqbot, … + plugin platforms) with status badge, enable switch, **Test**, **Configure** | R/W | `web/src/pages/ChannelsPage.tsx:43-650`; `gateway/config.py:195-218` |
| Configure modal | Per-env-var fields with help text, redacted current value, and client-side validation (Telegram token, numeric IDs, Slack xoxb/xapp). Mobile-tuned: dvh, safe-area padding, 16 px inputs | W | `ChannelsPage.tsx:62-535` |
| **Telegram QR onboarding** | "Create with QR": scan, confirm in Telegram; Hermes creates the bot via a Nous service and detects the owner ID. Allowed-user chips → **Save and restart** | W | `ChannelsPage.tsx:1061-1460`; `wr/messaging.py:680-782` |
| **WhatsApp QR pairing** | "Pair with QR" (Bot or Self-chat mode, allowed numbers). Installs the bridge if needed; the QR refreshes; "Linked as +phone" | W | `ChannelsPage.tsx:654-1058`; `wr/messaging.py:549-623` |
| Gateway control | Sidebar Restart; System card Start / Restart / Stop / Open logs; "Restart to apply" banners; **migrate to a single multiplexed gateway** (lists blockers, e.g. a credential shared between profiles) | W | `App.tsx:936-1113`; `SystemPage.tsx:1116-1192`; `wr/actions.py:139-165` |
| Pairing | Pending DM pairing requests → **Approve**; approved users → **Revoke**; Clear pending (native `confirm`) | W | `web/src/pages/PairingPage.tsx:40-268`; `wr/ops.py:84-129` |
| Webhooks | Enable receiver (auto-restart); New subscription (name, events, deliver to Log / Telegram / Discord / Slack / Email / GitHub comment, deliver-only, prompt) → URL + **one-time secret**; enable/disable (hot reload); delete | W | `web/src/pages/WebhooksPage.tsx:106-610`; `wr/ops.py:154-264` |

### Files/Workspace/Terminal
| Feature | What it does | R/W | Evidence |
|---|---|---|---|
| File browser | Path box + Go (when not locked), `..` up, folders first, Name / Size / Modified / Actions columns; clicking a file downloads it | R | `web/src/pages/FilesPage.tsx:131-391` |
| Upload / mkdir / delete | Drag-drop zone + multi-file upload (streamed, 100 MB cap); create folder; recursive delete with confirm | W | `FilesPage.tsx:168-523`; `wr/files.py:547-584` |
| Gaps | No preview, editor, rename, move or search (the `/api/fs/read-text` and `write-text` endpoints exist but the web UI doesn't use them) | — | `wr/files.py:609-748` |
| Hermes console | System → **Open console**: a terminal-like modal over WS `/api/console` running a restricted `hermes` command set. History (200), Ctrl+C, Ctrl+L, y/N confirms | W | `web/src/components/HermesConsoleModal.tsx:19-561`; `hermes_cli/console_engine.py:353-376` |
| Embedded TUI | See Chat. It is effectively a terminal into the agent, not a general shell | — | — |

### Config & environment
| Feature | What it does | R/W | Evidence |
|---|---|---|---|
| Schema form | Category sidebar with field counts (live: General 27, Agent 122, Terminal 33, Display 92, …, 30+ categories), search across key / label / description. AutoField widgets: switch / select / number / textarea / list / nested editor | R/W | `web/src/pages/ConfigPage.tsx:133-600`; `web/src/components/AutoField.tsx:6-197` |
| Raw YAML | Toggle to a plain textarea; saved via PUT `/api/config/raw`. No highlighting or validation | R/W | `ConfigPage.tsx:293-307, 532-548` |
| Import / export / reset | Export JSON, import JSON (staged until Save), scoped reset to defaults (active category or current search) | R/W | `ConfigPage.tsx:309-370` |
| Keys page | Section jump-nav (OAuth / Providers / Tools / Gateway / Settings / Custom keys). Provider keys grouped and collapsible with a "Get key" link. Masked values with **Reveal** (rate-limited and audited), Replace, Clear; custom keys; show-advanced toggle | R/W | `web/src/pages/EnvPage.tsx:49-1105`; `wr/config_env.py:962-986` |

### Observability (logs, usage, cost, analytics, health)
| Feature | What it does | R/W | Evidence |
|---|---|---|---|
| Logs viewer | File agent / errors / gateway; minimum level; component (gateway / agent / tools / cli / cron); lines 50/100/200/500; Auto-refresh toggle (5 s poll, "Live" badge); colour by level; auto-scroll; `?file=` deep link | R | `web/src/pages/LogsPage.tsx:27-245`; `wr/status.py:794-830` |
| Logs gaps | No text search (the backend supports `search=`), no download or copy, no streaming | — | `LogsPage.tsx`; issue [#127433](https://github.com/NousResearch/hermes-agent/issues/127433) |
| Token analytics | 7/30/90 days: total / input / output tokens, sessions, API calls; a **div-built** daily stacked bar chart (not Observable Plot); sortable daily, per-model and top-skills tables. **Off by default**: the page explains that local counts miss auxiliary calls (`dashboard.show_token_analytics`) | R | `web/src/pages/AnalyticsPage.tsx:29-601`; live screenshot text |
| Cost | The API returns estimated and actual cost, reasoning and cache tokens, but **the UI never shows them** on Analytics; Models shows cost only when the flag is on | — | `web/src/lib/api.ts:2204-2253`; `AnalyticsPage.tsx` |
| Status / health | Sidebar status strip (gateway state including heartbeat-stale, active sessions; 10 s poll); Overview platforms card; `/api/health` | R | `web/src/components/SidebarStatusStrip.tsx:50-79`; `web/src/hooks/useSidebarStatus.ts:5-26` |
| Host stats | OS, arch, host, Python, version + "N behind" (live: **9373 behind**), CPU, memory, disk, uptime, load avg | R | `SystemPage.tsx:902-990`; `wr/status.py:548` |
| Resource-pressure banner | App-wide: disk critical > memory critical > OOM restart suspected > elevated. Dismissal is per boot | R | `web/src/components/MemoryPressureBanner.tsx:5-180`; `wr/status.py:421-430` |
| Provider usage (user plugin) | `commandcode-usage` adds a credits / rolling-window card to Analytics through a slot (live) | R | `~/.hermes/plugins/commandcode-usage/dashboard/manifest.json` |

### Plugins/extensions
| Feature | What it does | R/W | Evidence |
|---|---|---|---|
| Dashboard plugin runtime | Manifests discovered from user, bundled and (opt-in) project roots. Script and CSS injected from `/dashboard-plugins/<name>/`; optional SRI; 2 s register timeout; LOAD_FAILED / NO_REGISTER states | R | `web/src/plugins/usePlugins.ts:21-160`; `hermes_cli/web_server_dashboard.py:464-579` |
| Plugin SDK | `window.__HERMES_PLUGIN_SDK__` exposes React, hooks, the full `api` client, fetchJSON, buildWsUrl, DS components, utils, useI18n. Contract v1.1.0 | — | `web/src/plugins/registry.ts:112-195`; `web/src/plugins/sdk.d.ts:106` |
| Tabs | Add a route (`tab.position` = after/before/end), override a built-in route (`tab.override`), or hide the nav entry (`tab.hidden`) | — | `App.tsx:257-369` |
| Slots | Shell: backdrop, header-banner, header-left, header-right, pre-main, post-main, overlay. Pages: `:top`/`:bottom` on sessions, analytics, logs, cron, skills, plugins, config, env, docs, chat, files, models. `sidebar`, `footer-left` and `footer-right` are declared but **never rendered** | — | `web/src/plugins/slots.ts:60-137` |
| Backend plugin APIs | `plugin_api.py` router mounted at `/api/plugins/<name>`, at startup only | R/W | `hermes_cli/web_server_dashboard.py:783-859` |
| Plugins page | Install from git URL / owner/repo (force, enable-after); **curated catalog** pinned to commits with capability chips (installs disabled); installed list with enable/disable, update, sidebar visibility, remove; Rescan | W | `web/src/pages/PluginsPage.tsx:313-1395`; `wr/dashboard_ui.py:131-306` |

### Settings/Themes/i18n
| Feature | What it does | R/W | Evidence |
|---|---|---|---|
| 8 built-in themes | Hermes Teal, Hermes Teal (Large), Nous Blue (light), Midnight, Ember, Mono, Cyberpunk, Rosé. Each sets palette, fonts, radius and density | R/W | `web/src/themes/presets.ts:68-255` |
| User themes | `~/.hermes/dashboard-themes/*.yaml`: palette, typography, `layoutVariant` (standard / cockpit / tiled), assets, componentStyles, colorOverrides, customCSS (≤32 KiB) | R | `hermes_cli/web_server_dashboard.py:414-423`; [extending docs](https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard) |
| Font override | 15 fonts, independent of the theme, previewed in the menu | R/W | `web/src/themes/fonts.ts:59-148` |
| Persistence | localStorage **and** server `config.yaml` (`dashboard.theme` / `font`, per profile); the server value wins on load | W | `web/src/themes/context.tsx:474-568`; `wr/dashboard_ui.py:71-100` |
| i18n | 17 locales (en, zh, zh-hant, ja, de, es, fr, tr, uk, af, ko, it, ga, pt, ru, hu, ar). Choice stored in localStorage only. Arabic sets `dir=rtl`, but the layout uses physical left/right classes. Several nav labels are hard-coded English | — | `web/src/i18n/types.ts:1-18`; `web/src/i18n/context.tsx:51-89`; `apps/shared/src/i18n.ts:70-80` |

### Auth/Security
| Feature | What it does | R/W | Evidence |
|---|---|---|---|
| Login page | `/login` with username/password (live: basic). The provider list comes from `/api/auth/providers`; Nous and OIDC redirects are also supported | — | `hermes_cli/dashboard_auth/routes.py:176-421`; live |
| Auth widget | User + provider ("via basic") + Logout in the sidebar | W | `web/src/components/AuthWidget.tsx:50-187` |
| Session hardening | Refresh-token rotation, WS tickets, Origin/Host checks, loopback-only fallbacks, one-shot reload on stale token | — | `hermes_cli/dashboard_auth/ws_tickets.py`; `web/src/lib/dashboard-auth-reload.ts:37-77` |
| Security audit / skill scan | System → Security audit (`hermes security-audit`); hub skill security scan | W/R | `wr/ops.py:552`; `wr/skills.py:265` |
| Secret hygiene | Env reveal limited to 5/30 s and audited; webhook secret shown once; debug share redacts by default | — | `wr/config_env.py:45-48, 962`; `WebhooksPage.tsx:335-366`; `SystemPage.tsx:1451-1580` |

### Updates/Maintenance
| Feature | What it does | R/W | Evidence |
|---|---|---|---|
| Update | Check for updates (forced) + **Update now** from System and the sidebar, with live log. Blocked for docker/nix/apt installs | W | `SystemPage.tsx:578-634, 991-1031`; `wr/actions.py:219-413` |
| Operations | Run doctor, Security audit, Update skills, Prompt size, Support dump, Migrate config. Each is a spawned action with a polled log | W | `SystemPage.tsx:1308-1336`; `wr/ops.py:546-821` |
| Backup / restore | Create + Download a zip; restore from an uploaded zip or a server path (destructive confirm) | W | `SystemPage.tsx:1338-1449`; `wr/ops.py:566-631` |
| Debug share | Uploads system info + logs to a public paste (auto-deletes after 6 h), with a redact option; links can be copied | W | `SystemPage.tsx:1451-1580`; `wr/status.py:772` |
| Checkpoints | Count / size + Prune | W | `SystemPage.tsx:1583-1599` |

### Misc/Unique
| Feature | What it does | R/W | Evidence |
|---|---|---|---|
| Achievements (bundled plugin) | Gamified badges mined from session history: 60 badges, 8 categories, tiers Copper → Olympian, secret achievements, progress bars, Rescan | R/W | `plugins/hermes-achievements/dashboard/plugin_api.py:843-879`; screenshot |
| Docs tab | Sandboxed iframe of the official docs + open-in-new-tab | R | `web/src/pages/DocsPage.tsx:8-67` |
| Swagger | FastAPI `/docs`, `/redoc`, `/openapi.json` are live (unintentionally shadowing the SPA's `/docs` on hard load) | R | `hermes_cli/web_server.py:307`; live |
| Nous Portal card | Subscription state + "Manage subscription" link | R | `SystemPage.tsx:1036-1080` |

## 5. Real-time & state model

| Channel | Transport | Behaviour | Evidence |
|---|---|---|---|
| Chat terminal | WS `/api/pty` (binary frames) | 20 s resize-frame keepalive. Backoff 250 ms→3 s, 5 tries, then a "gave up" banner. Redials on visibilitychange / pageshow / focus / online (at most 1/s). Reconnects pause while the tab is hidden. 8 s connecting timeout for wedged mobile sockets. Server keeps the PTY for 30 min and replays a 1 MiB buffer. Close codes: 4410 = process exited, 4409 = superseded by a newer tab | `web/src/lib/pty-reconnect.ts:17-50`; `ChatPage.tsx:1171-1756`; `hermes_cli/web_server_chat.py:48` |
| Chat sidebar | WS `/api/ws` (JSON-RPC) + `/api/events` (fan-out of `/api/pub`) | Session title, new-session events, credential warnings. Retries 1 s→30 s, 15 attempts | `ChatSidebar.tsx:329-337`; `web/src/lib/events-reconnect.ts:11-14` |
| Kanban | Plugin WS `/events` | Task event tail | `plugin_api.py:1717` |
| Everything else | **Polling** | Status every 10 s (sidebar) / 5 s (Sessions overview); Logs every 5 s when toggled; action logs every 1.2–1.5 s; OAuth device-code poll every 2 s; Telegram QR 2 s; WhatsApp QR 1.5 s; aux models refetch on focus. **No SSE.** | `web/src/hooks/useSidebarStatus.ts`; `web/src/contexts/SystemActions.tsx:37-73`; `LogsPage.tsx:113-133` |
| Multi-tab | Separate PTY per tab (attach token + Web Lock). The Sessions list refreshes silently when another process writes | | `pty-attach-token.ts`; `web/src/lib/session-refresh.ts` |
| Offline | None. No service worker or cache; the plain-HTTP Tailscale bind is not a secure context, so a service worker cannot register (live probe) | | live probe; `web/index.html` |
| Client state | localStorage: theme, font, locale, sidebar collapsed, chat panel collapsed. sessionStorage: plugin manifests, banner dismissals, token-reload flag. URL: `?profile=`, `?resume=`, `?learn=`, `?file=`. Server: theme/font in config.yaml | | ShellUx inventory; `web/src/themes/context.tsx:35-41` |

## 6. UX & visual design

- **Design language.** Nous "lens" aesthetic, which reads as a terminal-brutalist console:
  - uppercase letter-spaced nav (`font-sans text-display uppercase tracking-[0.12em]`), expanded display font for headings, Mondwest/Collapse brand fonts, mono for data;
  - thin 1 px borders, square or near-square corners, a dark single-hue palette, small type (15 px root);
  - many outlined pill badges.
  - Sources: `web/src/App.tsx:889`; `web/src/index.css:24-147`; `lib/utils.ts:9-15`.
- **Tokens.** CSS variables (`--background`, `--midground`, `--foreground` with alpha mixing; `--theme-*` for type and spacing; 19 `--color-*` overrides; `--component-*-*`; series colours; terminal colours). Density works by scaling `--spacing` (×0.85 / ×1 / ×1.2). Sources: `web/src/themes/context.tsx:113-284`; `web/src/index.css:56-185`.
- **Layout.**
  - Shell: fixed left sidebar (w-64, collapsible to a w-14 icon rail with tooltips) plus a single scrolling content column.
  - Pages are mostly vertical stacks of bordered cards and 1–3 column grids (profiles, model cards, toolsets).
  - Long admin pages (System, Keys) rely on scrolling or a jump-nav.
  - Density is medium-high on desktop.
- **States.**
  - Empty states ("No MCP servers yet … Browse catalog", "No webhook subscriptions yet", kanban "— no tasks —").
  - Pulse skeleton in the status strip; braille spinners; a LoadErrorNotice + Retry card (Cron, Skills only).
  - role=alert banners; toasts.
  - Action logs inline for long operations.
- **Keyboard.**
  - **No command palette and no global shortcuts.**
  - Escape closes drawers, menus and modals; Enter submits forms; Sessions supports shift-click range selection; terminal shortcuts in Chat; console history keys.
  - Sources: ShellUx grep; `web/src/hooks/useModalBehavior.ts`.
- **Accessibility.**
  - Present: aria-expanded/controls on the hamburger, listbox/option on the theme and language menus, role=status/alert, focus-visible rings.
  - Problems:
    - no focus trap in 15 hand-rolled dialogs (`useModalBehavior` returns a ref "for future focus trapping");
    - the closed drawer is not `inert`;
    - no skip link;
    - duplicate "Navigation" landmark label;
    - only one component honours reduced motion;
    - `document.title` never changes;
    - several sub-`text-xs` sizes despite the README rule.
  - Sources: `useModalBehavior.ts:3-49`; `App.tsx:583-656`; `ProfilesPage.tsx:62`.
- **i18n.** 17 locales, Arabic RTL only partially working, English hard-coded nav labels (Files, MCP, Channels, Webhooks, Pairing, System). Sources: `App.tsx:194-218`; `web/src/i18n/*`.

Screenshots (desktop 1440×900, live, read-only):

| | |
|---|---|
| ![Sessions history](images/hermes-dashboard/sessions-history-desktop.png) Sessions → History (bulk, search, per-row actions) | ![Session transcript](images/hermes-dashboard/session-detail-desktop.png) Expanded transcript with tool-call accordions |
| ![Models](images/hermes-dashboard/models-desktop.png) Models: main / aux / MoA + usage cards | ![Cron create](images/hermes-dashboard/cron-create-modal-desktop.png) Cron create modal (ScheduleBuilder, delivery, skills) |
| ![Skills hub](images/hermes-dashboard/skills-hub-desktop.png) Skills hub: 9 connected hubs, featured, install | ![Channels](images/hermes-dashboard/channels-desktop.png) Channels: Telegram QR quick setup, per-platform toggles |
| ![Profiles menu](images/hermes-dashboard/profiles-menu-desktop.png) Profiles with ⋮ actions (SOUL.md, auto-describe…) | ![Config](images/hermes-dashboard/config-desktop.png) Config schema form with 30+ categories |
| ![System](images/hermes-dashboard/system-desktop.png) System: host, "9373 behind", Portal routing, curator | ![Kanban](images/hermes-dashboard/kanban-desktop.png) Kanban plugin (orchestration, lanes, filters) |
| ![Achievements](images/hermes-dashboard/achievements-desktop.png) Achievements plugin | ![Theme menu](images/hermes-dashboard/theme-menu-desktop.png) Theme + font switcher (8 themes) |
| ![Logs](images/hermes-dashboard/logs-desktop.png) Logs (file / level / component / lines filters) | ![Swagger on /docs](images/hermes-dashboard/docs-hardload-swagger-desktop.png) Hard-loading `/docs` shows FastAPI Swagger, not the Docs tab |

## 7. Mobile & responsive support

- **Breakpoint strategy.**
  - The shell switches at **1024 px** (`lg`, plus `useBelowBreakpoint(1024)`). Theme and language pickers switch to bottom sheets below **640 px**. Chat terminal font scales from 7 to 14 px by width, and WebGL turns off below 768 px. Sources: `App.tsx:397, 505-591`; `ThemeSwitcher.tsx:33`; `ChatPage.tsx:139-174, 915`.
  - Responsive prefix counts across web/src: `sm:` 177, `lg:` 60, `md:` 6, `xl:` 5. Most pages use only `sm:` for stacking. No container queries.
- **Mobile nav.**
  - A fixed `h-14` top bar with a hamburger opens an off-canvas left drawer (w-64, black/70 backdrop, scroll lock, closes on Escape or navigation). **No bottom tab bar.** Sources: `App.tsx:528-591`; screenshot `nav-drawer-mobile`.
  - The drawer at 390×844 cuts off below Profiles: Config, Keys, System, Docs and the plugin tabs need scrolling inside it.
- **Viewport.** `width=device-width, viewport-fit=cover, interactive-widget=resizes-content`; `h-dvh`; content bottom padding `env(safe-area-inset-bottom)`. **The fixed top bar and drawer have no top or side safe-area insets.** Sources: `web/index.html:6-9`; `App.tsx:517, 773`.
- **Soft keyboard (Chat).** The `visualViewport` inset is applied as padding and the terminal refits. There are also IME and replacement-text de-duplication fixes for Android/Gboard. Sources: `web/src/lib/keyboard-inset.ts:33-58`; `web/src/lib/pty-mobile-input.ts`; `web/src/lib/pty-composition.ts`.
- **PWA.** None: no manifest, service worker, apple-touch-icon or theme-color. This holds on main too. On the live HTTP Tailscale bind a service worker could not register anyway. Sources: `web/index.html`; live probe; UpstreamIssues compare.
- **Touch targets.**
  - No 44 px minimum anywhere, and no `pointer:coarse` handling. DS icon buttons are about 28–30 px.
  - Live DOM probe at 390 px counted interactive controls under 32 px in either dimension (counts include about 22 off-screen drawer controls). Results: Skills 441/465 (row switches), Plugins 1455/1481, Files 188/213, Models 40/62, Logs 27/49, Profiles 15/37, Cron 18/41. Undersized targets dominate the list-heavy pages.
- **What breaks at 390 px** (live + code):
  - **Files:** the list keeps a 42rem minimum width, so the Modified and Actions columns (open/delete) sit off-screen behind a horizontal scroll. [screenshot `files-mobile`]
  - **Kanban:** columns become a horizontal scroller with roughly one column visible. Filters wrap into a tall header. [screenshot `kanban-mobile`]. Open issue [#99397](https://github.com/NousResearch/hermes-agent/issues/99397) asks for touch-friendly status controls.
  - **Skills:** category filter hidden below `sm`; the edit pencil appears only on hover, so it is unusable on touch. Source: `SkillsPage.tsx:449-485, 800`.
  - **Model picker:** a fixed `200px | 1fr` grid that is cramped on phones. Source: `ModelPickerDialog.tsx:384-388`.
  - **Language switcher:** renders empty below 640 px (`hidden sm:inline`). Live, the mobile drawer shows only the theme icon. Issue [#114648](https://github.com/NousResearch/hermes-agent/issues/114648).
  - **Config:** categories become horizontal chips. The page works but is long; 280 elements overflow (chips row).
  - **Chat (code + issues):** xterm touch scrolling is broken on Android/iPad ([#81119](https://github.com/NousResearch/hermes-agent/issues/81119), [#76002](https://github.com/NousResearch/hermes-agent/issues/76002)); some Android IMEs duplicate input ([#125517](https://github.com/NousResearch/hermes-agent/issues/125517), [#122766](https://github.com/NousResearch/hermes-agent/issues/122766)); Ctrl+V paste does nothing over plain-HTTP LAN ([#132591](https://github.com/NousResearch/hermes-agent/issues/132591)). A terminal UI is fundamentally poor for phone chat ([#89661](https://github.com/NousResearch/hermes-agent/issues/89661) is the RFC for a phone-native web chat).
  - **Works acceptably:** Sessions, Models, Cron (including the create modal), Profiles, Channels (best mobile tuning).
- **Mobile drawers with stock themes** are transparent ([#102695](https://github.com/NousResearch/hermes-agent/issues/102695)).

Mobile screenshots (390×844, live):

| | | | |
|---|---|---|---|
| ![nav drawer](images/hermes-dashboard/nav-drawer-mobile.png) Drawer nav (no language switcher visible) | ![sessions](images/hermes-dashboard/sessions-mobile.png) Sessions overview | ![models](images/hermes-dashboard/models-mobile.png) Models | ![cron modal](images/hermes-dashboard/cron-create-modal-mobile.png) Cron create modal |
| ![kanban](images/hermes-dashboard/kanban-mobile.png) Kanban: horizontal columns | ![files](images/hermes-dashboard/files-mobile.png) Files: actions column clipped | ![config](images/hermes-dashboard/config-mobile.png) Config: chip categories | |

## 8. Strengths
- **The most complete admin surface of any Hermes UI.** It covers nearly every `hermes` CLI capability: config schema, keys, OAuth, credential pool, gateway, channels with QR onboarding, pairing, webhooks, MCP catalog, plugin catalog, hub with security scan, backup/restore, doctor, debug share, shell hooks, curator.
- **First-party and always in sync.** Shipped and versioned with the agent; reads Hermes state in-process (no scraping); API discoverable through OpenAPI (336 operations).
- **Multi-profile done properly.** One server for all profiles, a global `?profile=` scope, cross-profile cron, profile builder, SOUL editor, auto-describe, multiplexed-gateway migration.
- **Chat fidelity.** Because Chat *is* the TUI, every TUI feature (slash commands, approvals, tool rendering, subagents) works immediately. Keep-alive reattach and the mobile IME and keyboard-inset work are mature.
- **Serious security model.** Fail-closed gate on any non-loopback bind, scrypt/OIDC/Nous providers, WS tickets, Host/Origin checks, rate-limited and audited secret reveal, one-time webhook secrets.
- **Extensible.** Plugin SDK with tabs, overrides and 30+ slots plus backend routers; YAML user themes with customCSS and layout variants. Kanban and Achievements show what plugins can do.
- **Honest analytics.** It deliberately hides token/cost estimates that would mislead.

## 9. Weaknesses, gaps & known issues
- **No native chat.** Chat is a terminal emulator:
  - no message bubbles, artifacts, rich tool cards, attachments UI, search-in-chat, or editing/branching from the web;
  - poor on touch;
  - the sidebar's "tool activity" panel described in comments is not implemented (`ChatSidebar.tsx:5-24`).
  - Issues: reconnect storms and redial loops [#129393](https://github.com/NousResearch/hermes-agent/issues/129393), [#133256](https://github.com/NousResearch/hermes-agent/issues/133256); orphaned PTYs [#131172](https://github.com/NousResearch/hermes-agent/issues/131172); black screen after losing WebGL context [#27740](https://github.com/NousResearch/hermes-agent/issues/27740).
- **Polling everywhere, no SSE.** Logs are not truly live; no push for cron, sessions or gateway events.
- **Unused backend capabilities:**
  - cron run history and output, skill uninstall, MCP edit, profile export/import, toolset model choice;
  - log search, cost / cache / reasoning token fields;
  - `/api/learning/graph` (no memory content viewer).
  - Sources: §4 gaps rows; `web/src/lib/api.ts`.
- **Files is minimal.** No preview, edit or rename. It defaults to an unlocked `$HOME` root. A dangling symlink causes a 500 ([#131659](https://github.com/NousResearch/hermes-agent/issues/131659)).
- **Route conflict.** A hard reload or deep link to `/docs` serves FastAPI Swagger instead of the Docs tab (FastAPI defaults at `hermes_cli/web_server.py:307`; verified live).
- **Mobile.**
  - No PWA, no bottom nav, small touch targets, no top safe-area handling.
  - Skills edit is hover-only, Files actions are clipped, the language switcher is invisible, terminal touch scrolling is broken.
  - 67 open `comp/dashboard` issues mention mobile.
- **Accessibility.** No focus traps in hand-rolled dialogs, drawer not inert, no skip link, little reduced-motion support, static document title.
- **No command palette or global shortcuts** (configurable keybindings requested in [#4256](https://github.com/NousResearch/hermes-agent/issues/4256)).
- **i18n.** RTL layout not mirrored; several nav labels not translated.
- **Plugin SDK contract drift.** The `registerSlot` argument order in `sdk.d.ts` doesn't match runtime; documented `sidebar`/`footer` slots are never rendered, so the "cockpit" layoutVariant has no effect (`web/src/plugins/sdk.d.ts:87` vs `web/src/plugins/slots.ts:125`).
- **Unused heavy dependencies.** three, gsap, leva, motion and Observable Plot are in package.json; gsap and leva are pulled in through the DS Badge.
- **Performance and stability issues.** Memory growth and OOM ([#46082](https://github.com/NousResearch/hermes-agent/issues/46082), [#76759](https://github.com/NousResearch/hermes-agent/issues/76759)); slow uncached `/api/messaging/platforms` (30 s) ([#131658](https://github.com/NousResearch/hermes-agent/issues/131658)); update/respawn failures on macOS and Windows ([#133220](https://github.com/NousResearch/hermes-agent/issues/133220), [#131864](https://github.com/NousResearch/hermes-agent/issues/131864)).
- **Security issues.**
  - Any authenticated `/api/ws` client can call `shell.exec` / `cli.exec` (`tui_gateway/methods_tools.py:476, 1531`).
  - Open: write endpoints bypass the sensitive-path check ([#132193](https://github.com/NousResearch/hermes-agent/issues/132193)); kanban comment author can be forged ([#102693](https://github.com/NousResearch/hermes-agent/issues/102693)); CORS preflight returns 401 ([#59052](https://github.com/NousResearch/hermes-agent/issues/59052)).
- **Remote access.** No built-in Tailscale/HTTPS story. Plain-HTTP tailnet binds lose secure-context APIs (clipboard, service worker). Requests for `--allowed-hosts` and CORS config: [#10567](https://github.com/NousResearch/hermes-agent/issues/10567), [#34390](https://github.com/NousResearch/hermes-agent/issues/34390).
- **Top open feature requests** (by reactions): browser voice mode / mic ([#20765](https://github.com/NousResearch/hermes-agent/issues/20765), [#54352](https://github.com/NousResearch/hermes-agent/issues/54352)); native mobile app ([#11911](https://github.com/NousResearch/hermes-agent/issues/11911), 44 reactions); multi-surface access to the same session ([#112028](https://github.com/NousResearch/hermes-agent/issues/112028)); session delta SSE for mobile mirrors ([#95573](https://github.com/NousResearch/hermes-agent/issues/95573)); thread-centric control UI ([#105257](https://github.com/NousResearch/hermes-agent/issues/105257)); Bot Mode group rooms ([#89995](https://github.com/NousResearch/hermes-agent/issues/89995)); `--install-service` ([#59289](https://github.com/NousResearch/hermes-agent/issues/59289)).
- **Newer on main or v0.21.5, not in the local copy:**
  - Chat workspace picker;
  - xterm font re-measure;
  - `skipped_active` toast on bulk delete;
  - telemetry opt-in banner;
  - plugin-registered aux tasks and Blueprints;
  - one-ID-per-box allowed users on Channels.
  - No new pages, PWA or mobile app ([v2026.9.24 release](https://github.com/NousResearch/hermes-agent/releases/tag/v2026.9.24); `compare/d337b736...main`).

## 10. Unique features (likely absent in other Hermes dashboards)
1. **Embedded real TUI over PTY** with keep-alive reattach, per-tab attach tokens, resume replay and mobile IME fixes.
2. **Channels with QR onboarding**: Telegram managed-bot "Create with QR" and WhatsApp "Pair with QR", plus a 23+ platform configure/test matrix.
3. **Pairing approvals** and **Webhooks subscriptions** (one-time secret, deliver-only, hot reload).
4. **Mixture-of-Agents presets** and **11 auxiliary model slots** with "Use as" from usage cards.
5. **Profile Builder wizard**, **SOUL.md editor**, **LLM auto-describe**, **multiplexed-gateway migration**, global profile scope with banner.
6. **Skills hub with 9 sources + security scan**, Learn-a-skill → `/learn`, **Automation Blueprints** (16 templates), skill curator controls.
7. **MCP catalog (65) + plugin catalog** pinned to commits; memory-provider and context-engine selection with dynamic config forms.
8. **System ops console**: restricted `hermes>` console, doctor, security audit, prompt size, support dump, config migrate, backup/restore, **public debug share with redaction**, checkpoints, shell hooks, credential pool, Nous Portal tool-gateway routing.
9. **Dashboard plugin SDK** (tabs, overrides, 30+ slots, backend routers) and **YAML user themes** with customCSS and layout variants; 8 themes + font override; 17 locales.
10. **Kanban multi-agent board** (orchestration mode, dispatcher nudge, lanes by profile, decompose/specify) and **Achievements** gamification (bundled plugins).
11. **Resource-pressure banner** (disk/memory/OOM) and the honest "token analytics hidden" stance.
12. Full **OpenAPI/Swagger** of the backend.

## 11. Design implications for the unified dashboard
- **Preserve (feature parity checklist):**
  - every admin domain in §4: config schema form + raw YAML, keys with audited reveal, OAuth device-code login, credential pool;
  - channels with QR onboarding, pairing, webhooks;
  - MCP and plugin catalogs, skills hub + security scan, toolset drawers;
  - cron with ScheduleBuilder + Blueprints, profiles with SOUL / auto-describe / builder;
  - system ops / backup / debug share / hooks / curator, gateway lifecycle + multiplex migration;
  - resource-pressure banner, global `?profile=` scope;
  - plugin slot / tab extensibility, user themes.
- **Reuse the backend contract.** Target the existing 336-operation FastAPI surface and the WS endpoints (`/api/pty`, `/api/ws` JSON-RPC, `/api/events`, `/api/console`, kanban `/events`) instead of reading files directly. Respect gated-mode auth (cookies + WS tickets) and the `?profile=` scoping.
- **Improve chat.**
  - Offer a **native message UI** driven by the `/api/ws` JSON-RPC (`session.*`, `prompt.submit`, `approval.*`, `slash.exec`): bubbles, tool-call cards, approvals as buttons, attachments, voice.
  - Keep the xterm TUI as an optional "terminal mode". This fixes touch scrolling and IME problems and makes chat usable on phones.
- **Use features the backend already supports:**
  - cron run history and output, log search + download + streaming (add SSE/WS), cost / cache / reasoning analytics with real charts;
  - memory contents and the learning graph, MCP edit and per-tool toggles, skill uninstall, profile export/import, file preview/edit.
- **Add missing UX primitives:**
  - command palette (⌘K) + global shortcuts;
  - real-time push instead of polling;
  - `document.title` per route, focus-trapped dialogs, inert drawers, skip link, reduced-motion support, logical (RTL-safe) CSS, complete translations.
- **Mobile-first requirements:**
  - bottom tab bar (Chat / Sessions / Kanban / Cron / More) instead of the drawer-only nav;
  - 44 px targets, `pointer:coarse` styles, no hover-only actions;
  - card layouts instead of wide tables (Files, Kanban lanes → per-column tabs or vertical lists);
  - full-screen sheets for pickers (no fixed 200 px columns);
  - top and side safe-area insets;
  - PWA manifest + service worker, which **requires HTTPS** — plan for Tailscale Serve / `ts.net` certificates or a reverse proxy, since the current plain-HTTP tailnet bind blocks SW and clipboard.
- **Mobile risks:**
  - xterm on touch;
  - long admin pages (System, Keys, Config with 500+ fields) need search, jump-nav and progressive disclosure;
  - secrets on small screens (reveal / clipboard behaviour);
  - destructive ops (restore, prune, delete profile) need strong confirmations on touch.
- **Fix the route clash.** Don't use `/docs` for an SPA route, or move FastAPI docs under `/api/docs`.

## Sources
1. https://github.com/NousResearch/hermes-agent (repo; tag v2026.9.21, commit d337b736; main 74306c1d)
2. https://github.com/NousResearch/hermes-agent/releases (cadence); https://github.com/NousResearch/hermes-agent/releases/tag/v2026.9.24; …/v2026.5.28; …/v2026.5.29; …/v2026.6.5; …/v2026.6.19; …/v2026.7.1; …/v2026.7.20; …/v2026.8.3; …/v2026.9.11; …/v2026.9.14
3. https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard
4. https://hermes-agent.nousresearch.com/docs/user-guide/features/extending-the-dashboard
5. https://hermes-agent.nousresearch.com/docs/reference/cli-commands#hermes-dashboard
6. https://hermes-agent.nousresearch.com/docs/plugins/hermes-tailscale
7. Local docs: `website/docs/user-guide/features/web-dashboard.md`, `website/docs/user-guide/features/extending-the-dashboard.md`
8. Frontend: `web/package.json`, `web/index.html`, `web/vite.config.ts`, `web/README.md`, `web/AGENTS.md`, `web/src/main.tsx`, `web/src/App.tsx`, `web/src/index.css`
9. Pages: `web/src/pages/{Chat,Sessions,Analytics,Logs,Files,Docs,Pairing,System,Models,Config,Env,Cron,Skills,Mcp,Plugins,Profiles,ProfileBuilder,Channels,Webhooks}Page.tsx`
10. Components: `web/src/components/*` (ChatSidebar, ChatSessionList, ModelPickerDialog, ReasoningPicker, ModelReloadConfirm, HermesConsoleModal, MemoryPressureBanner, OAuthProvidersCard, OAuthLoginModal, AutoField, ScheduleBuilder, AutomationBlueprints, SkillEditorDialog, ToolsetConfigDrawer, ProfileSwitcher, ProfileScopeBanner, SidebarStatusStrip, ThemeSwitcher, LanguageSwitcher, AuthWidget, PlatformsCard, Markdown)
11. Lib: `web/src/lib/api.ts`, `pty-*.ts`, `keyboard-inset.ts`, `chatImagePaste.ts`, `events-reconnect.ts`, `cron-job.ts`, `schedule.ts`, `model-picker-filter.ts`, `reasoning-effort.ts`, `mcp-dashboard-oauth.ts`, `dashboard-auth-reload.ts`, `session-import.ts`, `session-refresh.ts`
12. Themes / i18n / plugins: `web/src/themes/{presets,context,fonts}.ts(x)`, `web/src/i18n/*`, `web/src/plugins/{registry,slots,usePlugins,sdk.d,types}.ts`, `apps/shared/src/{i18n,theme-presets}.ts`
13. Backend: `hermes_cli/web_server.py`, `web_server_dashboard.py`, `web_server_chat.py`, `web_server_files.py`, `web_server_profiles.py`, `web_server_oauth.py`, `web_server_config.py`, `web_server_gateway.py`, `main.py`, `main_dashboard.py`, `subcommands/dashboard.py`, `console_engine.py`, `kanban_db.py`, `projects_db.py`, `logs.py`, `webhook.py`, `memory_oauth.py`
14. Routers: `hermes_cli/web_routers/{status,config_env,analytics,sessions,profiles,models,oauth,ops,skills,cron,messaging,mcp,tools,files,actions,chat_ws,dashboard_ui,memory_providers,git,audio,local_models}.py`
15. Auth: `hermes_cli/dashboard_auth/{routes,middleware,cookies,ws_tickets,audit,public_paths,native_flow,login_page}.py`; `plugins/dashboard_auth/basic/__init__.py`
16. Plugins: `plugins/kanban/dashboard/{manifest.json,plugin_api.py,dist/index.js}`; `plugins/hermes-achievements/dashboard/{manifest.json,plugin_api.py}`; `~/.hermes/plugins/commandcode-usage/dashboard/manifest.json`
17. Agent / gateway: `tui_gateway/methods_tools.py`, `tui_gateway/methods_projects.py`, `gateway/pairing.py`, `gateway/config.py`, `cron/blueprint_catalog.py`
18. Live instance http://100.64.0.10:9119 (read-only browse 2026-10-06; `/openapi.json` with 336 operations; DOM probes for PWA meta, overflow and touch targets)
19. Issues (https://github.com/NousResearch/hermes-agent/issues/N): 4256, 10567, 11911, 20765, 27740, 34390, 46082, 54352, 59052, 59289, 76002, 76759, 81119, 89661, 89995, 95573, 99397, 102693, 102695, 105257, 112028, 114648, 122766, 125517, 127433, 129393, 131172, 131658, 131659, 131864, 132193, 132591, 133220, 133256
20. Commits on main after the tag: d9ca819c, 0f9feda4, 907e3188, a928a959, 56afae60, 344a23bc, 7a06cb50 (GitHub API `commits?path=web`)
