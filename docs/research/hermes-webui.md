# Hermes WebUI — Research
> Inspected: https://github.com/nesquena/hermes-webui, local clone `~/hermes-webui` at commit `77323c31` (merge of release/stage-316 → **exp-v0.52.316**, 2026-09-17), compared against upstream HEAD `3e960237` (**exp-v0.52.422**, 2026-10-06). Date 2026-10-06. Live instance: http://127.0.0.1:8787 (password auth on; the System pane reports `WebUI: exp-v0.52.316-dirty-e1da01c3`, `Agent: v2026.9.21`). The live server runs from `~/hermes-webui`, which has uncommitted local changes to `api/profiles.py`, `api/routes.py`, `static/panels.js`, `static/style.css` and `static/i18n.js` (`git status`), plus one installed extension, `skin-pack`.
>
> Path conventions: `api/…`, `static/…` and `*.md` are repo-relative. `routes.py:N` means `api/routes.py:N`. `kb:N` means `api/kanban_bridge.py:N`. `[LIVE]` marks something observed in the running instance.

## 1. Identity

| Aspect | Finding | Evidence |
|---|---|---|
| Tagline | "The best way to use Hermes Agent from the web or from your phone!" — claims "nearly 1:1 parity with Hermes CLI" | GitHub repo description [S1]; `README.md:6`, `README.md:44` |
| Stack: backend | Python ≥3.11, stdlib `ThreadingHTTPServer` subclass (`QuietHTTPServer`, daemon threads, 128 request workers). No web framework. One flat if/elif router: `handle_get` at `routes.py:13555`, `handle_post` at `routes.py:15138`, PATCH/DELETE/PUT at `routes.py:17812`/`17844`/`17884` | `server.py:374-447`; ARCHITECTURE.md ADR-003 (`ARCHITECTURE.md:1045-1057`) |
| Stack: frontend | Vanilla JS, no framework, no bundler, no build step. Large single files: `ui.js` 21.9k lines, `panels.js` 13.8k, `sessions.js` 9.5k, `messages.js` 9.4k, `style.css` 7.3k, `i18n.js` 26k. Vendored streaming-markdown (smd), KaTeX and js-yaml. Prism and Mermaid 10.9.3 come from a CDN with SRI. xterm.js 5.3 for the terminal | `README.md:6`, `README.md:600-601`; `static/index.html:59-73`; `wc -l` |
| Build | None. `package.json` is a dev-only ESLint runtime guard ("NOT a build step"). pip-installable through setuptools-scm; console script `hermes-webui = bootstrap:main` | `package.json:4-8`; `pyproject.toml:1-30` |
| License | MIT ("Copyright (c) 2025 Hermes Web UI Contributors") | `LICENSE:1-3` |
| Maturity | Repo created 2026-03-30. 18.8k stars, 2.7k forks, 293 open issues (166 `bug`), 643 open PRs, 3,043 merged PRs, 326+ contributors. Tests: "~11,500 tests across ~1,150 files" | GitHub API [S1]; `README.md:593`, `README.md:713` |
| Release cadence | Two channels. **Stable** `v*`: last release v0.52.113 on 2026-08-14, 53 days ago. **Experimental** `exp-v*`: 106 releases between the local commit and 2026-10-06 (exp-317 → exp-422), about 5.6 per day. Roughly 1,700 tags in total. The repo is maintained largely by an autonomous agent ("StewardOS", bot account `nesquena-hermes`) | releases API [S2]; `ROADMAP.md:329-345`; `CHANGELOG.md:389` |
| Version policy | Still 0.x. v1.0 is planned "when the feature surface stabilizes" | `ROADMAP.md:427-429` |
| Install / deploy | `bootstrap.py` locates the agent and can auto-install it. `start.sh` runs it in the foreground; `ctl.sh start/stop/restart/status/logs` runs it as a nohup daemon and refuses to start if a launchd or systemd unit already owns it. Docker comes in 1-container (agent in-process), 2-container (adds `nousresearch/hermes-agent` gateway on :8642) and 3-container (adds `hermes dashboard` on :9119) variants. Also a Nix flake with a NixOS module, native Windows via `start.ps1` (no terminal), and WSL autostart scripts | `bootstrap.py:22-676`; `ctl.sh:7-26,410-640`; `Dockerfile`; `docker-compose*.yml`; `nix/nixosModules.nix:1-83`; `start.ps1:1-50`; `docs/wsl-autostart.md` |
| Process model | One Python process. Each chat turn gets a daemon thread that runs `run_agent.AIAgent` **in-process** (`routes.py:23422-23427`). Long-lived threads handle the state.db watcher, background-task drain, SSE channel reaper, terminal reaper and metering ticker. A stale-agent guard refuses to keep running if the agent checkout's HEAD changes underneath it. Supervisor auto-detection covers launchd, systemd and supervisord (`--foreground`), with `/health?deep=1` for watchdogs | `api/streaming.py:10755-10781`; `api/agent_runtime.py:1-36,428`; `docs/supervisor.md` |
| Auth / security | **Off by default.** Options: password (`HERMES_WEBUI_PASSWORD` env or a PBKDF2-SHA256 hash with 600k iterations in settings.json), passkeys/WebAuthn (opt-in, can be passwordless), native OIDC (requires `allow_claim`/`allow_values`), and trusted reverse-proxy header SSO with a group→profile map. The session cookie is HMAC-signed with a 30-day TTL. Login is limited to 5 attempts per 60 s per IP. CSRF uses an Origin check plus an `X-Hermes-CSRF-Token` header. CSP runs in Report-Only mode. Optional TLS. When auth is off, the terminal, onboarding and key writes accept loopback/LAN clients only | `api/auth.py:28-1175`; `api/auth_oidc.py:167-209`; `api/passkeys.py:31-32`; `routes.py:5689-5851,6290-6363` |
| Remote access | SSH tunnel by default (the server prints an `ssh -N -L` hint). Tailscale Serve is recommended (`tailscale serve --bg 8787`). Otherwise `HERMES_WEBUI_HOST=0.0.0.0` with a password. Installable PWA. Separate native shells exist: Hermes for iOS (Swift, pairs over Tailscale) and Android, plus a Tauri desktop app | `docs/remote-access.md`; `README.md:445-447`; `ROADMAP.md:301-321` |
| Live instance facts [LIVE] | `/api/auth/status`: password auth on, passkeys off, OIDC off. `/api/health/agent`: `gateway_chat.backend = "legacy"`, i.e. the in-process agent; gateway running with 2 platforms connected. `/health`: uptime about 2 days. 6 profiles (default, coder, general, homeassistant, librarian, **property**, which is active) | live GETs |

## 2. How it talks to Hermes

**Default mode: an in-process library.** `api/config.py:259-273` appends the agent checkout to `sys.path`. `api/agent_runtime.py:428` imports `AIAgent`. `streaming.py:10755-10781` builds `AIAgent(platform='webui', session_db=SessionDB(<profile>/state.db), stream_delta_callback, reasoning_callback, tool_progress_callback, clarify_callback)`, and `streaming.py:11262` calls `run_conversation()`. Before each turn the server mutates `os.environ` (`HERMES_HOME`, `TERMINAL_CWD`, `HERMES_SESSION_*`) under `_ENV_LOCK` (`streaming.py:9816-9840`) and restores it afterwards (`streaming.py:12899-12916`). Many other features also import agent modules directly: `cron.jobs`, `hermes_cli.kanban_db`, `hermes_cli.profiles`, `hermes_cli.goals`, `tools.approval`, `tools.skills_tool`, `tools.process_registry`, `tools.mcp_tool`, `agent.credential_pool`, `agent.account_usage`.

**Opt-in alternatives:**
- Gateway API: `HERMES_WEBUI_CHAT_BACKEND=gateway` sends chat to `POST /v1/chat/completions` or `/v1/runs` on :8642 (`api/gateway_chat.py:151-311,573-791,1107`).
- External runner: `HERMES_WEBUI_RUNTIME_ADAPTER=runner-local` uses `/v1/runs*` (`api/runtime_adapter.py:20-117`; `api/runner_client.py:18-99`).
- CLI subprocess: used only for `hermes gateway start|stop|restart` (`routes.py:1306-1335`; `api/gateway_restart.py:26-120`).

| Data domain | Mechanism | Read/Write | Evidence |
|---|---|---|---|
| Agent turns (LLM, tools) | In-process `run_agent.AIAgent` in a daemon thread; per-turn env and contextvar overrides | Exec | `streaming.py:855,10755-10781,11262`; `routes.py:23422` |
| Chat via gateway (opt-in) | HTTP `/v1/chat/completions` and `/v1/runs` with `X-Hermes-Session-Id`/`-Key` | R/W | `gateway_chat.py:258-311,1107-1130` |
| Chat via runner (opt-in) | HTTP `/v1/runs`, `/events`, `/cancel`, `/approval`, `/clarifications`, `/v1/sessions/<id>/goal` | R/W | `runner_client.py:56-99`; `routes.py:23465-23574` |
| `~/.hermes/[profiles/<p>/]state.db`: sessions/messages | The agent writes WebUI turns there itself (WebUI passes `session_db`). WebUI reads it for the sidebar through a read-only sqlite URI | R (W by agent) | `streaming.py:8671,10472`; `api/agent_sessions.py:21-46,1010-1013`; `api/models.py:8111,11162` |
| state.db change feed | A thread polls a fingerprint every 5 s and pushes it over SSE `/api/sessions/gateway/stream` | R | `api/gateway_watcher.py:1-90` |
| state.db: CLI session delete | Direct SQL `BEGIN IMMEDIATE` | W | `api/models.py:11321-11360` |
| state.db: usage mirror | `SessionDB.ensure_session(source='webui')` when `sync_to_insights` is on (off by default) | W | `api/state_sync.py:1-123` |
| state.db: insights | SQL over `sessions` (tokens, `estimated_cost_usd`) | R | `routes.py:11773-11930` |
| state.db: goals | `hermes_cli.goals.GoalManager` | R/W | `api/goals.py:14-170` |
| `config.yaml` (per profile) | Atomic YAML writer. Writes reasoning, default/aux models, max_tokens, skill toggles, `mcp_servers`, `webui.dashboard`, kanban lanes | R/W | `api/config.py:789,6024-6651`; `routes.py:28345-28392,29646-29728`; `kb:597-619` |
| `.env` (per profile) | Parsed and written (provider keys); loaded into `os.environ` per profile | R/W | `api/providers.py:1171,2904-2942`; `api/profiles.py:1541-1580` |
| `auth.json` | Atomic 0600 write of OAuth tokens into `credential_pool` | R/W | `api/oauth.py:184-373` |
| `memories/MEMORY.md`, `memories/USER.md`, `SOUL.md` | Direct file read/write; symlinks refused; honours `memory.*_enabled` | R/W | `routes.py:22373-22431,28399-28462` |
| `skills/` and `skills/.usage.json` | Parsed with agent helpers. Writes `SKILL.md`; delete is an rmtree; toggles write `skills.platform_disabled.webui` | R/W | `routes.py:674-1120,28273-28392`; `api/skill_usage.py:1-31` |
| `cron/jobs.json`, `cron/output/` | In-process `cron.jobs` under a per-profile env lock. "Run now" spawns a child process that calls `cron.scheduler.run_job`. **WebUI does not tick the scheduler**; the gateway does | R/W | `api/profiles.py:554-822`; `routes.py:1676-1830,24953-25115` |
| Kanban DB | In-process `hermes_cli.kanban_db` (CRUD, `dispatch_once`); returns 503 if `hermes_cli` is missing | R/W | `kb:1-34,723-733,1218-1221` |
| Profiles (`profiles/<name>`, `active_profile`) | `hermes_cli.profiles`. The active profile is **per browser**, held in the `hermes_profile` cookie. `~/.hermes/active_profile` is written only on a process-wide switch | R/W | `api/profiles.py:355,467-480,1599-1670,2545-2690`; `routes.py:16858-16902` |
| Approvals / clarify | `tools.approval` module state; `clarify_callback` | R/W | `api/route_approvals.py:14-30`; `streaming.py:10775-10779` |
| Background processes | `tools.process_registry.completion_queue` drain → `bg_task_complete` SSE and an auto wake-up turn | R | `api/background_process.py:1-40` |
| Slash/plugin commands | `hermes_cli.commands.COMMAND_REGISTRY`, `hermes_cli.plugins`, `agent.skill_bundles` | R/Exec | `api/commands.py:89-462` |
| MCP (the agent's) | `tools.mcp_tool` runtime inventory; CRUD on `mcp_servers` in config.yaml | R/W | `routes.py:14807-14812,17829-17903,29615-29730` |
| Logs | Tail of `<home>/logs/{agent,errors,gateway}.log` (whitelist) | R | `routes.py:11167-11205` |
| Gateway status | `sessions/sessions.json`, `gateway.pid`, `gateway_state.json`, plus HTTP `/health/detailed` | R | `routes.py:1165-1260`; `api/agent_health.py:36-595` |
| Official dashboard | HTTP GET `127.0.0.1:9119/api/status` (loopback only) to decide whether to show a rail link | R | `api/dashboard_probe.py:1-60` |
| Checkpoints | `<home>/checkpoints/<hash>` shadow git repos (list/diff/restore) | R/W | `api/rollback.py:4-67` |
| Agent dashboard plugins | `~/.hermes/plugins/<name>/dashboard/manifest.json`, served sandboxed | R | `api/plugins.py:1-93`; `routes.py:14872-14990` |
| LLM Wiki | `WIKI_PATH` / `skills.config.wiki.path` / `~/wiki` | R | `routes.py:11313-11326,13819-13906` |
| Claude Code transcripts | `~/.claude/projects/*.jsonl`, read-only in the sidebar | R | `api/models.py:88-92,6913-6920` |
| Cost snapshots | `<home>/cost-snapshots/<provider>.json` (OpenRouter) | R/W | `api/providers.py:2255-2531` |
| WebUI-owned state | `STATE_DIR` = `$HERMES_HOME/webui`. Contents: `sessions/<sid>.json` + `.bak`, `_index.json`, `_run_journal/`, `_turn_journal/`, `settings.json`, `projects.json`, `workspaces.json`, `saved_prompts.json`, `shares/`, `attachments/`, `media_snapshots/`, `extensions/`, `passkeys.json`, `.signing_key`, `.sessions.json` [LIVE: `~/.hermes/webui/` contains `sessions settings.json extensions models_cache*.json attachments`] | R/W | `api/config.py:78-91`; `api/run_journal.py:17-80`; `api/turn_journal.py:23-39` |
| WebUI's own MCP server | `mcp_server.py`, stdio, 7 project/session tools. Reads `_index.json` and `projects.json` directly; mutates through the WebUI HTTP API, logging in with `HERMES_WEBUI_PASSWORD` | R/W | `mcp_server.py:56-197,472-561` |

## 3. Information architecture

```
Titlebar (index.html:115-151): [hamburger ≤900px] logo · session title + message-count badge · optional profile switcher · [+ new chat · reload on phones]
Nav rail (desktop ≥641px, 48px; index.html:154-167) — tabs can be hidden/reordered (Settings → Appearance → Sidebar tabs)
├─ Chat ............ sidebar: session list (WebUI | CLI source tabs, project chips, date groups, search) → main: transcript + composer
├─ Tasks ........... cron jobs list → job detail / run history / create-edit form (index.html:207, 816)
├─ Kanban .......... filters, stats, dispatcher, task list → board (multi-board, lanes per profile) + task modal (index.html:219, 837, 1788, 1829)
├─ Skills .......... category tree + search + toggles → skill detail / editor (index.html:249, 783)
├─ Memory .......... My Notes · User Profile · Agent Soul · Project Context · External Notes → viewer/editor (index.html:260, 800)
├─ Spaces .......... workspaces list (add/rename/reorder/remove) → space detail + checkpoints/rollback (index.html:291, 865)
├─ Agent profiles .. profile cards (gateway dot, model · provider · skills) → profile detail / create / change model (index.html:302, 883)
├─ Todos ........... the agent's current task list for the session (index.html:267)
├─ Insights ........ usage analytics, system health, LLM Wiki, skill usage, model health (index.html:274, 900)
├─ Hermes Dashboard  external link, shown when :9119 is reachable (index.html:164)
├─ Logs ............ agent / errors / gateway tail viewer (index.html:312, 910)
├─ (Plugin pages) .. sandboxed iframe per agent dashboard plugin (index.html:926)
└─ Settings (pinned bottom) → Conversation · Appearance · Preferences · Providers · Plugins · Extensions · System · Help (+ settings search)
Right panel "Workspace" (index.html:1682-1730): Files | Artifacts (N) | [Todos]; file preview/editor; git badge; options menu
Composer dock (index.html:483-781): queue card, approval card, clarify card, terminal dock, selection chips, textarea, footer chips
Overlays: onboarding wizard (:1732), app confirm/prompt dialog (:1755), toast (:1771), kanban board/task modals, outline (:1902),
  profile dropdown (:1912), model picker, reasoning menu, workspace switcher, saved-prompts popup, session ⋮ menu, project chip menu,
  file-tree context menu, batch move picker, wiki browser, checkpoint diff, image/Mermaid lightbox, mobile composer config sheet
Banners: update, stale client, reconnect, offline, agent health, background error
Standalone pages: /login, /share/<token> (public read-only snapshot), PWA offline page (sw.js)
```

| Surface | Purpose |
|---|---|
| Chat | Conversations with streaming, tool cards, approvals and clarify prompts; composer with model/profile/workspace/reasoning/context chips |
| Tasks | Hermes cron jobs (agent and script modes) and their run outputs |
| Kanban | Hermes Kanban: multiple boards, task CRUD, dependencies, comments, and a dispatcher that spawns `hermes -p <assignee>` workers |
| Skills | Browse, search, enable/disable, create, edit and delete skills |
| Memory | Edit MEMORY.md, USER.md and SOUL.md; view the project context file; search external notes (MCP) |
| Spaces | Workspace registry and git-checkpoint rollback |
| Agent profiles | Multi-profile management, per-browser switching, model/provider/key per profile |
| Todos | Read-only view of the agent's `todo` list |
| Insights | Usage, cost and token analytics; live CPU/RAM/disk; LLM Wiki status; skill usage |
| Logs | Tail of agent/error/gateway logs with severity filter and auto-refresh |
| Settings | Conversation export/import/share; appearance; preferences; providers and quota; plugins; extensions gallery; system (version, password, gateway, MCP, stop server); help |
| Workspace panel | File tree, preview/editor, artifacts touched this session, upload, reveal/VS Code |

## 4. Feature inventory (exhaustive)

### 4.1 Chat & conversation
| Feature | What it does (user-visible behavior) | Read/Write | Evidence |
|---|---|---|---|
| Streaming chat | `POST /api/chat/start` starts a turn and returns a `stream_id`. `GET /api/chat/stream` (SSE) delivers tokens, tool calls, approvals and `done`. rAF-batched streaming-markdown render | W | `routes.py:16642→24246`, `routes.py:14508→18982`; `static/index.html:59-66` |
| Stream resume / replay | If the in-memory stream is gone, the stream replays from the run journal. Supports `Last-Event-ID`, `after_event_id`, `after_seq` and `cursor` | R | `routes.py:18442-18590`; `docs/sse-streams.md` |
| Stop / cancel | Stop button and `/stop`. Implemented as `GET /api/chat/cancel` (also stops the gateway run) | W | `routes.py:14460`; `static/commands.js:21` |
| Busy-input modes | Queue follow-up, Interrupt, or **Steer** (mid-turn correction via `/api/chat/steer`). The default is a setting; also `/queue`, `/interrupt`, `/steer`. Queued messages show as an editable card | W | `api/streaming.py:13539`; `static/commands.js:23-25,1335-1714`; `static/index.html:497-500,1367-1372` |
| `/btw` side question | Ephemeral side question answered in a hidden session; the parent session is untouched | W | `routes.py:16630→22541`; `static/commands.js:29` |
| `/background` | Runs a prompt in a parallel hidden agent; a badge shows completion | W | `routes.py:16633→22604`; `static/index.html:766` |
| `/goal` | Goal manager: set, status, pause, resume, clear; judged after each turn | W | `routes.py:16636→24051`; `api/goals.py:654`; `static/commands.js:1230-1330` |
| Tool approval card | Allow once (↵) / Allow session / Always / Deny / Skip all. Focus lands on "Allow once". Delivered over SSE `/api/approval/stream` with a polling fallback | W | `static/index.html:501-542`; `routes.py:14542-14548,16791` |
| Clarify card | Choice buttons, free-text answer and countdown. SSE `/api/clarify/stream` | W | `static/index.html:543-561`; `routes.py:14554-14563,16795` |
| YOLO mode | Per-session auto-approve pill (`/yolo`), held in memory only | W | `routes.py:16615`; `static/commands.js:1940-1990` |
| Attachments | Picker, drag-drop and pasted screenshots. Accepts images, text, PDF, JSON, xls(x), doc(x) and zip/tar (archives are extracted by `/api/upload/extract`). Up to 20 per message | W | `api/upload.py:206,395`; `static/boot.js:2569-2590` |
| Large paste → .md attachment | Pastes of ≥4000 chars or ≥100 lines become a file (setting) | W | `static/boot.js:2531-2567` |
| `@path` references | Dragging a workspace file into the composer inserts `@path`. There is no typed @-autocomplete | W | `static/panels.js:7797-7813` |
| `~/` path autocomplete | Suggests paths in the composer | R | `static/commands.js:515-545`; `routes.py:14305` |
| Saved prompts | Popup to insert a prompt, save the current text, or delete (`/api/prompts`) [LIVE: "Saved prompts" button] | W | `static/messages.js:838-930`; `routes.py:14279,15367,17866` |
| Selection actions | Selecting transcript text offers "Reply with selection" and "Refine", which create named, renamable context chips | W | `static/messages.js:780-1116` |
| Dictation | Browser SpeechRecognition, or MediaRecorder → `/api/transcribe` (server STT). Append or replace mode; wake-lock while dictating | W | `static/boot.js:686-690,921-930`; `api/upload.py:427,599` |
| Hands-free voice mode | Speaks naturally, auto-sends after a pause and reads replies aloud | W | `static/index.html:672,1235` |
| Raw audio messages | Sends the recording itself instead of a transcript (Telegram-style) | W | `static/index.html:1242` |
| Text-to-speech | Per-message speaker button and auto-read. Engines: browser, Edge TTS, ElevenLabs or OpenAI TTS (`POST /api/tts`), plus extension engines; voice, rate and pitch settings | R | `routes.py:15218→20088`; `static/ui.js:9059-9080` |
| Message actions | Edit (last user message), Copy, **Fork from here**, Regenerate, Listen, jump to the start of the response, timestamp [LIVE: "Fork from here / Copy / Edit message / Regenerate response / Jump to the start of this response"] | W | `static/ui.js:17240-17269`; `routes.py:16358,16407` |
| Retry / undo / branch | `/retry`, `/undo`, `/branch [name]` (`/api/session/retry`, `/undo`, `/branch`) | W | `static/commands.js:27-35`; `routes.py:16407,16575,16591` |
| Activity display modes | **Compact Worklog** (tool/thinking activity folded into a summary), **Transparent Stream** (each event as its own timestamped row) or **Final answer only** [LIVE] | R | `static/index.html:1050-1072`; `docs/rfcs/transparent-stream-activity-mode.md` |
| Tool / subagent cards | Args, results, diff colouring, show more; subagent/delegate cards; grouped worklog; process wake-up cards | R | `static/ui.js:18923-19060,17283-17320` |
| Thinking blocks | Reasoning cards; `/reasoning show/hide` | R | `static/ui.js:20328`; `routes.py:14067,15793` |
| Rich rendering | Custom markdown; KaTeX; Mermaid with zoom/pan lightbox; Prism; JSON/YAML tree/raw viewer; inline diff, CSV, Excalidraw, PDF (pdf.js) and sandboxed HTML; `MEDIA:` tokens rendered as image/audio/video players; image lightbox | R | `static/ui.js:7590-7764,19631-20310,2037-2736` |
| Sortable/filterable tables | Markdown tables get a filter box and column sorting [LIVE: "Filter table", "Sort column: …"] | R | `static/messages.js:394` |
| Context ring | Shows window usage, token counts, auto-compress threshold, estimated cost and cache-hit %, with a Compress button [LIVE: "Context window 10% used · $0.12 · Cache: 94% hit"] | R/W | `static/index.html:744-765` |
| Manual compression | `/compress [focus]` (alias `/compact`): asynchronous job with status polling and a recovery flow when compression is exhausted | W | `routes.py:14125,16563-16566,15622`; `static/commands.js:848-1040` |
| Tokens/sec & usage | TPS in headers (SSE `metering` event); token usage per reply (`/usage`) | R | `api/metering.py:1-45`; `static/index.html:1291,1317` |
| Conversation outline | Desktop-only jump list of user questions (setting) | R | `static/outline.js:20-50` |
| Jump buttons / auto-follow | Floating Start/End buttons; auto-follow toggle; endless scroll-up; "Load earlier messages (50 older)" [LIVE] | R | `static/index.html:433-434,1037-1076` |
| Transcript virtualization | Experimental windowing for transcripts over 80 messages | R | `static/index.html:1188` |
| Deep links | `/session/<id>`, `?q=` / `?prompt=` prefill, `?profile=` [LIVE: `/session/a2d7f7411dcb`] | R | `static/sessions.js:4148-4260` |
| Memory/skill-save toasts | Persistent toast when the agent saves memory or a skill | R | `static/messages.js:714-760` |
| Notifications | Sound and browser notification (via the service worker) when a response completes or an approval is needed in the background | R | `static/messages.js:9210-9270`; `static/index.html:1214,1277-1288` |

### 4.2 Sessions & history
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Session list | Date groups (Pinned / Today / Yesterday / This week / Last week / Older), collapsible; unread dots; streaming indicators; compact or detailed density [LIVE] | R | `routes.py:14180`; `static/sessions.js:7950-7975,498-560` |
| Source tabs | "WebUI sessions (N)" and "CLI sessions (N)" [LIVE: 21 / 3] | R | `static/sessions.js:7792-7806` |
| Cross-profile toggle | "Show 63 from other profiles" [LIVE] | R | `static/sessions.js:7911-7925` |
| Search | Instant title filter plus debounced full-text content search (`/api/sessions/search?content=1`) | R | `routes.py:14323→18124`; `static/sessions.js:6574-6628` |
| Projects | Coloured project chips (All / Unassigned / named): filter, rename, recolour, delete, optional per-project new-chat "+". MCP tools mirror these | W | `routes.py:14255,17446-17506,17389`; `static/sessions.js:7810-7905,9375-9524` |
| Pin | Pin and unpin; limit set in settings (default 3, per profile upstream) | W | `routes.py:17225` |
| Archive | Archive and restore; paged archived list | W | `routes.py:17297`; `static/sessions.js:7928-8090` |
| Row ⋮ menu | Copy link, Rename, Share / Stop sharing, Pin, Move to project, Archive, Duplicate, Export HTML, Stop response, Regenerate title, Remove worktree, Delete; arrow-key navigation | W | `static/sessions.js:4890-5075` |
| Batch select | Select all; bulk archive, move or delete | W | `static/sessions.js:4262-4404` |
| Touch gestures | Swipe right archives, swipe left deletes, long-press opens the menu, double-tap renames | W | `static/sessions.js:373-381,8783-9045` |
| Titles | Rename, LLM regenerate, and adaptive refresh every 5/10/20 exchanges | W | `routes.py:15851,15875`; `static/index.html:1357-1363` |
| Export / import | Markdown transcript, JSON, standalone **HTML themed with the current palette**, Import JSON, Clear (Settings → Conversation) [LIVE] | R/W | `routes.py:14282→18027,17575`; `static/boot.js:2172-2197` |
| Public share links | Read-only snapshot at `/share/<token>`; create, copy, revoke | W | `static/sessions.js:4717-4797`; `static/share.js:55-95`; `routes.py:13608,13744` |
| Duplicate / fork / branch | Duplicate a session; fork from any message; lineage segments and child sessions shown | W | `routes.py:15625,16407`; `static/sessions.js:8191-8345` |
| Git worktree sessions | New session in a git worktree; worktree badge; safe removal | W | `routes.py:15470,14106,16122`; `static/sessions.js:9083-9156` |
| Composer drafts | Saved server-side per session (`POST /api/session/draft`), so drafts survive devices and reloads [LIVE: network shows POSTs while typing] | W | `static/sessions.js:229-343`; `routes.py:15974` |
| Session recovery | `.bak` snapshots, startup recovery, audit and safe repair, cleanup of empty sessions | R/W | `api/session_recovery.py:1-25`; `routes.py:14142,15343,15842-15845` |
| j/k navigation | Next/previous session | R | `static/sessions.js:9532-9548` |

### 4.3 CLI-session bridge (external sessions)
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Merged sidebar | Shows sessions from the CLI/TUI, messaging (Telegram, Discord, Slack, Weixin, Matrix, Signal…), cron, webhook, kanban workers and **Claude Code**, each behind its own toggle | R | `routes.py:14188-14195`; `api/agent_sessions.py:49-133`; `static/index.html:1391-1430` |
| Import & continue | Clicking a CLI session imports it (`/api/session/import_cli`) and you can continue it under the same id. Messaging, cron and Claude Code sources are read-only (403) but can still be branched | W | `routes.py:17629→28547,24281-24312`; `static/sessions.js:2521-2533` |
| Live updates | state.db watcher → SSE `/api/sessions/gateway/stream`, with a 30 s polling fallback [LIVE probe: `watcher_running: true`, `fallback_poll_ms: 30000`] | R | `api/gateway_watcher.py`; `routes.py:14514` |
| Handoff summary | For messaging-origin sessions, shows a hint after N rounds and generates an LLM summary of recent activity | R | `routes.py:16569-16572`; `static/sessions.js:2753-2949` |
| Previous messaging segments | Shows sessions replaced by reset or compression | R | `static/index.html:1430` |

### 4.4 Agents/Profiles & personas
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Profile list | Cards show a gateway running/stopped dot, ACTIVE/default/hidden badges, and model · provider · enabled/total skills; an explainer card covers profiles vs workspaces [LIVE: 6 profiles] | R | `static/panels.js:6638-6745`; `routes.py:14735` |
| Profile detail | Status, gateway, model, provider, base URL, "API keys configured", skills, default space; Activate; Delete; "Change model & provider" [LIVE] | R/W | `static/panels.js:6746-6855` |
| Create profile | Name, clone the active config, model/provider, base URL, API key; seeds bundled skills | W | `static/panels.js:7298-7375`; `routes.py:16904`; `api/profiles.py:1987-2120` |
| Edit profile model | Filterable model list; `/api/profile/update-model` (also extended locally by the user's uncommitted diff) | W | `static/panels.js:7446-7735`; `routes.py:16944` |
| Per-browser switching | Composer profile chip, optional titlebar switcher, `?profile=`; cookie-scoped, no restart | W | `routes.py:16858-16902`; `static/panels.js:6856-6967` |
| Isolated/single-profile mode | `HERMES_WEBUI_ISOLATED_PROFILE=1` pins one profile and hides management | R | `api/profiles.py:204-300`; `static/panels.js:6649-6653` |
| Trusted-header → profile binding | Reverse-proxy groups mapped to profiles (multi-user-ish) | R | `api/auth.py:104-113,685-945` |
| Personalities | `/personality <name>` from `agent.personalities` | W | `routes.py:14341,15899`; `static/commands.js:18` |
| Assistant name | Default assistant name for the default profile; other profiles show their own name [LIVE: "Property" avatar label] | W | `static/index.html:1468-1470` |

### 4.5 Models & providers
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Composer model picker | Search, a "Configured" group, provider groups with show-more, custom model ID, the note "Applies to this conversation from your next message", keyboard navigation [LIVE screenshot] | W | `static/ui.js:4286-4870`; `routes.py:13923` |
| Live model lists | `/api/models/live?provider`, refresh cache | R/W | `routes.py:13944,15785` |
| Reasoning effort chip | Default / None / Minimal / Low / Medium / High / XHigh / Max (`/reasoning`) [LIVE: "XHigh"] | W | `static/index.html:736-815`; `routes.py:15793` |
| Default model | Settings → Preferences; writes config.yaml | W | `routes.py:15723`; `static/index.html:1154` |
| Auxiliary models | Per-task routing: vision, web extract, compression, approval, MCP, title generation, skills hub, curator, kanban decomposer, profile describer, triage specifier; "Reset all to auto" [LIVE] | W | `routes.py:13950,15736`; `static/index.html:1164-1170` |
| Max output tokens | Caps output for new turns | W | `static/index.html:1297` |
| Providers pane | Every Hermes provider with model count and auth state (API key / OAuth / not configured); set, replace or remove a key; self-hosted base URL + Test connection; refresh models [LIVE: 40+ providers] | W | `static/panels.js:11689-12180`; `routes.py:13970,15757-15778` |
| Quota & spend | Active-provider quota card, credential pool availability, account-limit windows, **7-day spend chart, monthly pace, monthly budget** [LIVE] | R/W | `static/panels.js:11268-11550`; `routes.py:13983,13997` |
| Quota chip | Remaining-quota chip in the composer (≥1400px, opt-in) | R | `static/index.html:732-735,1303` |
| OAuth flows | Device/OAuth for OpenAI Codex, Copilot, Copilot-ACP, Qwen, Nous and Anthropic (Claude Code) | W | `routes.py:17165-17175,14569`; `api/onboarding.py:631` |
| `runtime_model` event (upstream exp-360) | Reports the model that actually served the turn | R | upstream CHANGELOG #7767 [S3] |

### 4.6 Skills
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Skill browser | Collapsible category tree, search, per-skill enable toggle [LIVE] | R/W | `static/panels.js:4884-4965`; `routes.py:14654,16847` |
| Skill detail | Frontmatter metadata, rendered SKILL.md, linked files opened inline | R | `static/panels.js:4995-5115`; `routes.py:14696` |
| Create / edit / delete | Name, category, content | W | `static/panels.js:5116-5260`; `routes.py:16841-16844` |
| Slash integration | `/skills [q]`, `/use <skill>`, one slash command per skill, skill bundles | W | `static/commands.js:19-20,1104-1186,2098-2131` |
| Skill usage | Uses, views, patches and usage % per skill (Insights) [LIVE: "28 invocations, 1/111 used"] | R | `routes.py:14660`; `static/panels.js:4696-4703` |

### 4.7 Tools/Toolsets & MCP
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Session toolsets chip | Free-text per-session toolset override; Apply / Clear | W | `static/index.html:744-753,816-826`; `routes.py:15947` |
| MCP servers | Lists configured servers with transport, status and tool count. Enable/disable works via PATCH even though the UI text says "read-only here for now" [LIVE] | R/W | `static/panels.js:13439-13490`; `routes.py:14807,17831,17863,17903` |
| MCP tools | Searchable, paginated (5/10/20/40) tool inventory with parameter summary; never spawns servers | R | `static/panels.js:13491-13657`; `routes.py:14811` |
| Agent/plugin commands | `/api/commands` catalog; executes agent/plugin slash commands server-side | R/Exec | `routes.py:14390-14398,16799,16815` |
| WebUI as an MCP server | `mcp_server.py` (stdio): list/create/rename/delete projects, list sessions, rename/move a session | R/W | `mcp_server.py:472-561` |

### 4.8 Memory
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| My Notes | `memories/MEMORY.md`: view (path + mtime) and edit; entries separated by `§` [LIVE screenshot] | R/W | `static/panels.js:5280,5414-5584`; `routes.py:14731,16851` |
| User Profile | `memories/USER.md` | R/W | `static/panels.js:5281` |
| Agent Soul | `<profile>/SOUL.md` (persona/system prompt) [LIVE: shows path `~/.hermes/profiles/property/SOUL.md`] | R/W | `static/panels.js:5282` |
| Project Context | The workspace's context file (AGENTS-type), including shadowed ones; read-only | R | `static/panels.js:5284,5402-5408`; `routes.py:22301` |
| External Notes | MCP-backed notes sources (Joplin by default; opt-in): source cards, search, preview, recent AI notes | R | `static/panels.js:5285,5345-5535`; `routes.py:14814-14818` |
| LLM Wiki | Status card plus a wiki browser overlay (Insights) | R | `routes.py:13819-13836`; `static/panels.js:4495-4560` |

### 4.9 Cron/scheduling (Tasks tab)
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Job list | 🤖 agent and 📜 script badges, owner profile, status, new-run dot, paused jobs collapsed, "Show N from other profiles", nav badge count [LIVE] | R | `static/panels.js:1035-1153`; `routes.py:14587` |
| Job detail | Status, schedule (cron expression), next/last run, deliver target, mode, profile, completion toasts, skills, script path, prompt, last error [LIVE] | R | `static/panels.js:1290-1462` |
| Run history | Latest runs with size; expand to read the output; usage strip [LIVE: "SCRIPT OUTPUT (20 RUNS)"] | R | `routes.py:14612-14626` |
| Actions | Run now (in an isolated child process), Pause, Resume, Edit, Duplicate, Delete, copy diagnostics | W | `routes.py:16667-16702,1676-1830`; `static/index.html:816-835` |
| Create/edit form | Name; presets (Hourly / Daily / Weekdays / Weekly / Monthly / Custom cron or "every 1h"); script mode; prompt; deliver-to (messaging targets); profile; model pin; completion toasts; skills picker | W | `static/panels.js:514-521,1585-1720`; `routes.py:14646` |
| Completion toasts | Polls `/api/crons/recent` and shows a toast [LIVE: `Cron "realestate-brisbane" completed`] | R | `routes.py:14633` |
| Cron sessions in sidebar | Optional | R | `static/index.html:1398` |
| Per-job badge toggle (upstream exp-397) | `badge_notifications` per job; Next/Last shown in the job's timezone | W | upstream #7375, #7740 [S3] |

### 4.10 Tasks/Kanban/Missions/Orchestration
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Kanban board | Columns triage / todo / ready / running / blocked / done; drag-drop (never into running); quick Complete/Archive; consolidated or per-profile lanes [LIVE] | R/W | `kb:26,1189`; `static/panels.js:2440-2558,2153-2200` |
| Multiple boards | Switcher; create/edit (name, slug, description, default workdir, emoji icon, colour); archive | W | `kb:1187,1239-1243,1298,1332`; `static/panels.js:3901-4310` |
| Sidebar controls | Search, assignee and tenant filters, include archived, only mine, stats chips, bulk status, quick new task [LIVE] | R/W | `static/index.html:219-247`; `kb:1255` |
| Task modal | Title, description, status, priority, assignee profile, tenant, workspace kind (scratch/worktree/dir) + path, skills, max runtime, parent dependencies | W | `static/index.html:1829-1900`; `static/panels.js:3283-3681` |
| Task detail | Status buttons, block/unblock, comments, events, dependency links, runs, worker log | R/W | `kb:1201-1270`; `static/panels.js:3695-3780` |
| Dispatcher | **Preview dispatcher** (dry run) and **Run dispatcher**, which claims Ready tasks and spawns `hermes -p <assignee>` workers (max 8 per call) | W | `kb:1253→723`; `static/panels.js:2886-2980` |
| Live events | SSE `/api/kanban/events/stream`, mirroring the agent dashboard's WS `/events` contract | R | `kb:1199→1069` |
| Project OS dashboard | Repo, git and docs overview for a board's workdir | R | `routes.py:13806→12250` |
| Todos | Sidebar panel and optional workspace tab showing the agent's current task list [LIVE: "No active task list in this session"] | R | `static/index.html:267-272,1701`; `static/panels.js:3818` |
| Subagent cards | Delegate/subagent progress inside the transcript; child sessions in the sidebar | R | `static/ui.js:18923-19060` |

### 4.11 Gateway & messaging platforms
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Gateway status card | Configured / running / stale / unreachable; platform badges; session count; last active; **Start / Stop / Restart** [LIVE: "Running · Stop · Restart"] | R/W | `static/panels.js:13658-13688`; `routes.py:14803,16854` |
| Agent health banner | Heartbeat banner with "Restart Service" | R/W | `static/index.html:479-488`; `routes.py:13913,15205` |
| Messaging sessions | Telegram, Discord, Slack and Weixin sessions in the sidebar, plus handoff summary (§4.3) | R | `static/index.html:1391-1430` |
| Cron delivery targets | Delivery options pulled from gateway platforms | R | `routes.py:14646→24993` |
| Per-profile gateway dot | Profile cards show whether each profile's gateway is running | R | `static/panels.js:6697` |
| Gateway chat backend | Optional routing of WebUI chat through the gateway API | R/W | `api/gateway_chat.py` |

### 4.12 Files/Workspace/Terminal
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Spaces (workspaces) | Add (path suggestions, validated), rename, drag reorder, remove, use; composer workspace switcher; `/workspace`; optional "new chat on switch" [LIVE] | W | `static/panels.js:5990-6400`; `routes.py:14285-14305,16778-16787` |
| Checkpoints / rollback | Lists the agent's shadow-git checkpoints for a space; diff modal; restore | R/W | `static/panels.js:6100-6105,13689-13793`; `routes.py:14822-14836,17793` |
| File tree | Expand dirs; sort by name/created/modified; show hidden; drag-move; context menu: Reveal in Finder, Open in VS Code, Copy path, Rename, Delete, New file/folder, Add as workspace | R/W | `static/ui.js:20800-21750`; `routes.py:14326,16747-16774` |
| File preview/editor | Code (Prism), markdown, CSV, image, audio/video, PDF, sandboxed HTML, **Office docx edit/save**; Edit/Save; auto-refresh when the agent edits the open file; download; folder zip download | R/W | `static/workspace.js:890-1230`; `routes.py:14527-14536,16750-16753` |
| Artifacts tab | Files changed during this session, with count [LIVE: "Artifacts 0"] | R | `static/workspace.js:372,520-611` |
| Uploads | Button and OS drop into the workspace | W | `api/upload.py:604`; `static/workspace.js:1323-1460` |
| Symlink escape grants | Short-lived authorisation to browse a symlink target outside the workspace | R | `routes.py:15244,14329,14530-14539` |
| Git | **UI: only a badge** showing branch, changed count and ahead/behind (`/api/git-info`). **Backend: full API** for status, branches, diff, stage/unstage/discard, LLM commit message, commit, fetch/pull/push, checkout, stash-checkout. Destructive operations need `HERMES_WEBUI_WORKSPACE_GIT_DESTRUCTIVE=1` | R (UI) / W (API) | `static/workspace.js:807-831`; `routes.py:14332-14363,16709-16744`; `docs/workspace-git.md` |
| Remote workspaces | Profiles with an ssh/docker `terminal.backend` keep remote `terminal.cwd` paths; validation is remote-aware; the embedded terminal refuses remote backends | R/W | `docs/remote-workspaces.md:24-25`; `routes.py:19285-19293` |
| Embedded terminal | xterm.js docked above the composer: real PTY (`$SHELL -i`, secrets stripped from env). Input via POST, output via SSE with backlog/resume, shared by multiple viewers. Clear / Copy / Restart / Collapse / Close; resizable; auto-expand on output; `/terminal`. Local-only when auth is off; not available on Windows | W | `api/terminal.py:332-634`; `routes.py:14511,16652-16661`; `static/terminal.js:235-760` |
| Workspace git worktrees | Per-session worktree creation and removal (§4.2) | W | `routes.py:15470,16122` |

### 4.13 Config & environment
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Onboarding wizard | 5 steps: System check (agent, provider, password, config/.env paths) → Provider setup (key, base URL + test, model search, Codex/Claude Code OAuth) → Workspace → Password → Finish. Skippable | W | `static/onboarding.js:121-839`; `routes.py:14084,17181-17207`; `docs/onboarding.md` |
| Settings persistence | Most settings go to server `settings.json` via `POST /api/settings`; some are browser-local (tab order/visibility, raw-audio flags) | R/W | `static/panels.js:9119-9131,7868-7900`; `routes.py:14007,16988` |
| Footer control customisation | Toggle and drag-reorder composer chips (Attach, Saved prompts, Mic, Profile, Workspace, Model, Reasoning, Context) and situational chips (Voice mode, YOLO, Background badge, Mobile config, Quota, Toolsets, Status) [LIVE] | W | `static/boot.js:3060-3081`; `static/index.html:1135-1142` |
| Sidebar tab customisation | Hide and drag-reorder nav tabs [LIVE] | W (LS) | `static/panels.js:7868-7900` |
| Dashboard link | Auto-detect / Always / Never, with a URL for the official Hermes dashboard | W | `routes.py:13954-13960,15355` |
| Redaction | "Redact sensitive data in API responses" toggle | W | `static/index.html:1338` |
| Env-driven config | Many `HERMES_WEBUI_*` vars: HOST, PASSWORD, STATE_DIR, CHAT_BACKEND, RUNTIME_ADAPTER, TLS_*, OIDC_*, TRUSTED_AUTH_*, ALLOWED_ORIGINS, SSE_CHUNKED, EXTENSION_*; upstream added SETTINGS_FILE, MAX_SESSION_RESOLVE, VISIBLE_SESSION_LIMIT, CSP_IMG_EXTRA | R | `api/auth.py`; `api/config.py:78-91`; upstream CHANGELOG [S3] |
| Unsafe: secrets in config.yaml | Open bug: saving Settings writes env-expanded secrets into config.yaml | W | issue #8032 [S4] |

### 4.14 Observability (logs, usage, cost, analytics, health)
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Insights | 7/30/90/365-day windows: sessions, messages, tokens, cost; daily token chart (input/output, cache %); model table; model health comparison; activity by day and hour; token breakdown | R | `routes.py:13804→11773`; `static/panels.js:4419-4835` |
| System health | Live CPU / RAM / disk bars ("Live snapshot only") [LIVE] | R | `routes.py:13919`; `static/panels.js:4463-4488` |
| LLM Wiki status | Enabled, entries, pages, raw files, last updated, last writer [LIVE: "Unavailable"] | R | `routes.py:13819` |
| Skill usage table | Per-skill uses, views, patches, usage % [LIVE] | R | `routes.py:14660` |
| Logs viewer | agent / errors / gateway; tail 100/200/500/1000; severity All / Errors / Warnings+; auto-refresh every 5 s; wrap; copy all [LIVE] | R | `routes.py:13907→11185`; `static/panels.js:4313-4428` |
| Provider quota & spend | See §4.5 [LIVE: "7-day spend · Monthly pace $56.74 · Monthly budget"] | R/W | `routes.py:13983-13997` |
| Per-session usage | Context ring, `/api/session/usage`, TPS | R | `routes.py:14163` |
| Health endpoints | `/health` (`?deep=1`: streams, runs, accept-loop), `/api/health/agent`, `/api/system/health` | R | `routes.py:13910-13919` |
| Client telemetry | Browser error/event log to the server; CSP reports | W | `routes.py:15141,15221` |
| Sync to `/insights` | Mirrors WebUI token usage into state.db so `hermes /insights` includes it | W | `api/state_sync.py`; `static/index.html:1433` |

### 4.15 Plugins/extensions
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Extensions gallery | Settings → Extensions: **Gallery** (one-click install from the vetted registry with sha256 check), **Installed** (enable, configure, reset, clear storage, sidecar consent, uninstall), **Diagnostics** [LIVE: Assistant Avatar, Auto List, Custom Assistant Avatar, Custom Branding, Desktop Companion…] | W | `static/panels.js:10542-11048`; `routes.py:14087-14092,15281-15329`; `api/extensions.py` |
| Extension JS API | `window.hermesExt.register(id)`: settings, storage, events `turn:start/complete/error/cancel`; custom skins (`registerHermesSkin`); TTS engines; session pre-open hook; upstream adds `ext.messages.registerAction` (message buttons) | — | `static/extension_settings.js:4-640`; `docs/EXTENSIONS.md:345-609`; upstream #7245 [S3] |
| Loopback sidecars | An extension can ship a local process; WebUI proxies `/api/extensions/<id>/sidecar/*` with consent and an injected token | R/W | `routes.py:5853-6012`; `api/extension_sidecar_auth.py:1-30` |
| Agent plugins pane | Read-only list of Hermes plugins, versions and lifecycle hooks [LIVE: a2a-platform, browser-use, buzz…] | R | `routes.py:13981→12755`; `static/panels.js:11050-11258` |
| Dashboard plugin pages | Agent dashboard plugins render as sandboxed iframe tabs | R | `routes.py:14872-14990` |
| Skin pack (installed here) | Adds 6 skins: Dracula, Gruvbox, One Dark, Tokyo Night, Rosé Pine, Solarized Dark [LIVE] | — | `~/.hermes/webui/extensions/skin-pack/extension.json` |
| `/pet` Desktop Companion | Slash command bridged to a native desktop-pet extension | — | `static/commands.js:51-207` |

### 4.16 Settings/Themes/i18n
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Theme | Light / Dark / System (default dark in code) | W | `static/boot.js:2688-2819`; `static/index.html:20` |
| Skins | 21 built in: Default, Ares, Mono, Graphite, GitHub, Codex, Terracotta, Slate, Poseidon, Sisyphus, Charizard, Sienna, Catppuccin, Hepburn, Nous, Neon, Neon Soft, Neon Paint, Geist Contrast, Zeus, Verdigris. Extensions can add more [LIVE: 27] | W | `static/boot.js:2693-2716`; `static/style.css:129-1336` |
| Font size | Small / Default / Large / Extra Large | W | `static/style.css:36-113` |
| Behaviour toggles | Workspace panel default, Todos tab, jump buttons, endless scroll, activity mode, event timestamps, auto-follow, user-message markdown, paste-as-file, per-project buttons, JSON/YAML tree threshold, titlebar profile switcher, worklog auto-expand, hide suggestions, hide welcome, virtualization, send key, sound, TTS, notifications, token usage, outline, TPS, fade text, terminal auto-expand, density, pin limit, auto-title, default message mode, busy placeholder, new chat on workspace switch, external-session toggles, update channel, AI "What's New" summary [LIVE: all present] | W | `static/index.html:1023-1470` |
| Settings search | Search box across settings | R | `static/index.html:356-359`; `static/panels.js:8491` |
| i18n | 15 locales: en, it, ja, ru, es, de, zh, zh-Hant, pt, ko, fr, cs, tr, pl, vi; about 1.7k keys; English fallback; upstream picks the browser language on first visit | W | `static/i18n.js:6-26430`; upstream #7730 [S3] |
| RTL chat | Opt-in right-to-left layout for the chat area only (code/math kept LTR); no RTL locale | W | `static/style.css:7156-7231`; `static/panels.js:9810-9822` |
| `/theme` | Switches theme or skin from the composer | W | `static/commands.js:17` |

### 4.17 Auth/Security
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Login page | Password form, passkey sign-in, safe `next` redirect, server-reachability probe with retry [LIVE screenshot] | R | `static/login.js:5-200`; `routes.py:13619` |
| Password management | Set or change (current password required); env var locks it [LIVE: "HERMES_WEBUI_PASSWORD … takes precedence"]; disable auth with an acknowledgement; Sign out | W | `static/panels.js:13222-13316`; `routes.py:16988,17767` |
| Passkeys | Register, list, delete; go passwordless (cannot delete the last factor) | W | `routes.py:17668-17759`; `static/panels.js:12309-12370` |
| OIDC | Native OIDC with a claim allowlist | W | `api/auth_oidc.py:167-209` |
| Trusted proxy SSO | Header-based identity, groups → profile, logout URL | R | `api/auth.py:685-945` |
| CSRF + Origin | Injected token header on all unsafe fetches | — | `static/index.html:30-57`; `routes.py:5797-5851` |
| Local-network gates | Terminal, onboarding and key writes are LAN-only when auth is off | — | `routes.py:6332-6363` |
| Credential hygiene | chmod 0600 on `.env`, `auth.json` and keys at startup; terminal env scrub; API-response redaction | — | `api/startup.py:6-56`; `api/terminal.py:332-345` |
| Remote-image gating (upstream exp-410) | Remote chat images are click-to-load; CSP `img-src` allowlist | — | upstream #7962 [S3] |
| Approvals / YOLO | §4.1 | W | — |

### 4.18 Updates/Maintenance
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Update check | Background git fetch; banner when the WebUI or Agent is behind; stable/experimental channel; ignore agent updates [LIVE System pane: versions + "Check now"] | R | `api/updates.py:716-1411`; `routes.py:14405,15247` |
| Update now / force / clear lock | Stash → `pull --ff-only` → pop, then re-exec. Force discards local changes. Clear-lock returns instructions only. Agent updates restart the gateway. Blocked while streams are running | W | `api/updates.py:138-228,1631-1931`; `routes.py:17579-17605` |
| AI "What's New" | LLM summary of incoming commits | R | `routes.py:17620` |
| Stale-client banner | Hard refresh: unregisters the SW and clears caches | W | `static/panels.js:2596-2703` |
| Stop server | "Stop the Hermes WebUI server" button (`/api/shutdown`) [LIVE] | W | `routes.py:15202→12827` |
| Hot reload | `/api/admin/reload` reloads `api.models` | W | `routes.py:15830` |
| Session store maintenance | Audit / repair-safe / cleanup (§4.2) | W | — |

### 4.19 Misc/Unique
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Native-wrapper hooks | `theme-color` follows the skin for WKWebView wrappers; `__hermesSetBackgrounded` | — | `static/boot.js:2742-2765`; `static/messages.js:62` |
| Pull-to-refresh | Standalone PWA only | R | `static/ui.js:6274-6341` |
| Mobile composer config sheet | Workspace / model / reasoning chips plus a context-detail card, behind one ring button [LIVE screenshot] | W | `static/index.html:676-678,769-805` |
| Help pane | Docs link and GitHub issues link | R | `static/index.html:1640-1675` |

### 4.20 API endpoint index (count and domains)
There are **278 explicit routes**: GET 120, POST 149, PATCH 4, DELETE 4, PUT 1. Of these, 25 are Kanban. There are also two catch-alls: the sidecar proxy and OPTIONS. There are **10 SSE endpoints** and no WebSockets: `/api/chat/stream`, `/api/session/stream`, `/api/sessions/events`, `/api/sessions/{sid}/events`, `/api/sessions/gateway/stream`, `/api/approval/stream`, `/api/clarify/stream`, `/api/terminal/output`, `/api/kanban/events/stream`, plus `/btw` and `/background` streams that go through chat/stream.

| Domain | Routes (abridged; full handler lines in the per-area tables above) |
|---|---|
| Chat | `POST /api/chat/start`, `POST /api/chat` (legacy sync), `GET /api/chat/stream`, `/stream/status`, `GET /api/chat/cancel`, `POST /api/chat/steer`, `/api/btw`, `/api/goal`, `/api/approval/{pending,stream,respond,inject_test}`, `/api/clarify/{pending,stream,respond,inject_test}`, `/api/session/yolo`, `/api/tts`, `/api/transcribe{,/capability}` |
| Sessions | `/api/sessions`, `/api/session`, `/api/sessions/search`, `/api/session/{status,lineage/report,export,new,update,rename,title/regenerate,delete,clear,truncate,branch,duplicate,retry,undo,pin,archive,move,draft,toolsets,anchor-scene,compress,compress/start,compress/status,compression-recovery/start,recovery/audit,recovery/repair-safe,import,import_cli,worktree/status,worktree/remove,usage,conversation-rounds,handoff-summary}`, `/api/sessions/{cleanup,cleanup_zero_message,events,gateway/stream,{sid}/events}`, `/api/projects{,/create,/rename,/delete}`, `/api/prompts` (GET/POST/DELETE), `/api/share/{create,revoke}`, `/api/share/<token>`, `/api/personality/set` |
| Profiles / memory | `/api/profiles`, `/api/profile/{active,models,switch,create,update-model,delete}`, `/api/memory`, `/api/memory/write`, `/api/personalities`, `/api/wiki/{status,browse,page}`, `/api/notes/{sources,search,item}` |
| Models | `/api/models`, `/api/models/live`, `/api/models/refresh`, `/api/model/auxiliary`, `/api/model/set`, `/api/default-model`, `/api/providers{,/delete,/self-hosted}`, `/api/provider/{quota,cost-history}`, `/api/reasoning`, `/api/onboarding/oauth/{start,poll,cancel}`, `/api/onboarding/probe` |
| Skills / tools | `/api/skills{,/content,/usage,/save,/delete,/toggle}`, `/api/mcp/servers` (+PUT/PATCH/DELETE `/{name}`), `/api/mcp/tools`, `/api/commands{,/bundles,/bundles/resolve,/moa/resolve,/exec}` |
| Cron | `/api/crons{,/output,/history,/run (GET detail / POST run-now),/recent,/status,/delivery-options,/create,/update,/delete,/pause,/resume}` |
| Kanban | `/api/kanban/{boards,board,config,stats,assignees,events,events/stream,tasks,tasks/{id},tasks/{id}/log,tasks/bulk,tasks/{id}/comments,block,unblock,patch,links,links/delete,boards/{slug}/switch,dispatch}`, `/api/project-os/dashboard` |
| Gateway / health | `/api/gateway/{status,start,stop,restart}`, `/api/health/{agent,restart}`, `/health`, `/api/system/health`, `/api/logs`, `/api/insights`, `/api/client-events/log`, `/api/csp-report` |
| Workspace | `/api/workspaces{,/suggest,/add,/remove,/rename,/reorder}`, `/api/list`, `/api/file{,/raw,/save,/office-save,/create,/create-dir,/rename,/move,/delete,/reveal,/path,/open-vscode}`, `/api/folder/download`, `/api/media`, `/api/upload{,/extract}`, `/api/workspace/upload`, `/api/escape/{authorize,list,file/read,file/raw}`, `/api/git-info`, `/api/git/{status,branches,diff,stage,unstage,discard,commit-message,commit-message-selected,commit,commit-selected,fetch,pull,push,checkout,stash-checkout}`, `/api/rollback/{list,diff,restore}` |
| Terminal / background | `/api/terminal/{start,input,resize,close,output}`, `/api/background{,/status}`, `/api/bg-task-complete-ack`, `/api/process-complete-ack` (410) |
| Settings / updates / extensions | `/api/settings`, `/api/dashboard/{status,config}`, `/api/onboarding/{status,setup,complete}`, `/api/updates/{check,apply,force,clear_lock,summary}`, `/api/extensions/{status,registry,install,uninstall,toggle,sidecar-proxy-consent}`, `/api/extensions/{id}/sidecar/*`, `/extensions/*`, `/api/plugins`, `/plugins/plugin.css`, `/dashboard-plugins/*` |
| Auth | `/login`, `/api/auth/{status,login,logout,oidc/start,oidc/callback,passkey/options,passkey/login,passkey/register/options,passkey/register,passkey/delete,passkeys}` |
| Admin / static | `/api/shutdown`, `/api/admin/reload`, `/`, `/session/*`, `/static/*`, `/manifest.json` (+`.webmanifest`), `/sw.js`, `/favicon.ico`, `/share/*` |

## 5. Real-time & state model
- **Transport:** SSE only (ADR-004, `ARCHITECTURE.md:1045-1057`); no WebSockets at all. The terminal is POST for input and SSE for output. Kanban SSE mirrors the agent dashboard's WS contract (`kb:1069`).
- **Streaming:** each turn runs in a server thread. Events go to the in-memory `STREAMS` queue, then to SSE `/api/chat/stream`. Every event is **mirrored to a JSONL run journal** (`api/run_journal.py:1-80`); event ids are `<stream>:<seq>`. A per-session persistent channel (`/api/session/stream`) carries `server_turn_started`, session-updated and `bg_task_complete`. A per-session run-journal relay (`/api/sessions/{sid}/events`) supports `Last-Event-ID` resume with a snapshot fallback (`docs/sse-streams.md`; `docs/rfcs/session-sse-contract-v1.md`).
- **Reconnect:** a reconnect banner plus auto-reconnect that resumes from a cursor. A heartbeat every 5 s, `X-Accel-Buffering: no`, and optional chunked mode for buffering proxies (`docs/sse-streams.md`). The offline banner probes `/health` and refreshes automatically (`static/ui.js:39-200`). Upstream fixed reconnect amplification, but #7902 (reconnect re-persisting rows until OOM) is still open [S4].
- **Durability:** a write-ahead turn journal (fsync + flock, `api/turn_journal.py:1-80`); `.bak` before any shrinking save; recovery at startup; recovery of an "interrupted response" retried for up to 24 h (`docs/troubleshooting.md:89`). Turns survive a browser close because they run server-side. Upstream: gateway-runs turns now survive a WebUI restart (#7785, #7878).
- **Multi-tab / multi-device:** session-list invalidation SSE (`/api/sessions/events`). Drafts are stored server-side (`/api/session/draft`), so they follow you across devices. Unread state is merged between the PWA and a tab (upstream #7577). Hidden-tab polling is bounded (#7301, #7716). The profile is per browser via cookie, so two tabs in one browser share a profile.
- **Polling remains** for cron recent/status, gateway fallback (30 s), logs auto-refresh (5 s) and approval fallback.
- **State persistence:** server holds sessions (JSON per session plus index), settings.json and drafts. Client localStorage holds theme/skin/font (flash-free bootstrap), tab order, collapsed groups, source filter, workspace-panel state and `hermes.ext.*`.
- **Offline:** the service worker serves the cached shell, network-first, or an inline "You are offline" page. API calls are never cached. There is no offline queue and no background sync (`static/sw.js:85-175`).

## 6. UX & visual design
- **Design tokens** (`static/style.css:8-29` light, `:115-126` dark):
  - `--bg` #FEFCF7 / #0D0D1A, `--sidebar` #141425, `--surface` #1A1A2E, `--text` #FFF8DC (dark).
  - Accent gold #B8860B / **#FFD700**.
  - Semantic colours: error, success, warning, info.
  - Radii 4/8/12/pill; spacing 4/8/12/16.
  - Type 11/12/14; message body 14px with line-height 1.75.
  - `--font-ui` system stack (-apple-system, Segoe UI, Inter); `--font-mono` ui-monospace/SF Mono.
  - Message column `--msg-max` 780px (1100 at ≥1400px, 1200 at ≥1800px).
  - `DESIGN.md` describes a "Calm Console" palette (Georgia serif, #0A0908) that **does not match** the shipped CSS (drift).
- **Theme × Skin model:** 3 modes × 21 skins. Some skins are full palettes (Graphite, Codex, Terracotta, GitHub, Sienna, Catppuccin, Hepburn, Nous with monospace UI, Geist Contrast, Neon×3); others are accent-only. Zeus and Verdigris are dark-only. Extensions register more skins through an allowlisted token API (`static/boot.js:2936-3042`). `THEMES.md` is stale (lists 12 skins, says System is the default).
- **Layout:** three panes:
  - rail 48px + sidebar 300px (resizable 180–420, collapsible with Cmd+B);
  - main transcript (max 780px);
  - right workspace panel 300px (resizable to 1200, container queries).
  The composer is a rounded "box" (radius 16, max `clamp(780px,60vw,1100px)`). Model, profile, workspace, reasoning and context live in the composer footer rather than a top bar (`README.md:8-13`). The active nav item gets a gold left indicator bar. See `images/hermes-webui/desktop-chat-workspace-panel.png`.
- **Density:** fairly dense. 13–14px UI and muted secondary metadata (model · provider · skills counts). The sidebar density setting chooses compact or detailed.
- **States:**
  - Empty: logo + "What can I help with?" + 3 suggestions; panels show "Select a …" placeholders with an icon [LIVE].
  - Loading: skeleton shimmer for the session list; elsewhere plain "Loading…".
  - Error: session-list error with Retry; offline, reconnect, agent-health and background-error banners.
  - Toast: a single toast whose type is inferred **by regex on the message text** (`static/ui.js:8813`); errors get Copy/Dismiss.
  - Dialogs: a custom confirm/prompt dialog with focus trap (`static/ui.js:8832-8960`).
- **Keyboard:**
  - Cmd/Ctrl+K new chat, Cmd+B sidebar, Cmd+/ focus composer, Cmd+, settings.
  - Enter answers "Allow once" on an approval card; Esc steps out of overlays; j/k switch sessions.
  - Arrow keys work in menus, the model picker and the lightbox; the send key is configurable.
  - Slash autocomplete navigates with ↑/↓/Tab.
  - **No command palette** (Cmd+K means "new chat"); there is a settings search box instead (`static/boot.js:2394-2530`).
- **Slash commands (28 built in):** help, clear, compress, compact, model, workspace, terminal, new, usage, theme, personality, skills, use, stop, goal, queue, interrupt, steer, title, retry, undo, btw, background, status, voice, reasoning, yolo, branch (`static/commands.js:8-35`). Also dynamic agent/plugin/skill/bundle commands. Upstream now lists only the commands WebUI can dispatch (#6962).
- **Accessibility:**
  - About 225 lines in `index.html` contain `aria-` attributes.
  - Roles: alertdialog (approval), 5 dialogs with `aria-modal`, tablists, about 16 live regions, an `.sr-only` announcer.
  - `:focus-visible` outlines; focus trap in dialogs; `inert` on hidden cards; 8 `prefers-reduced-motion` blocks.
  - Gaps: session rows are non-focusable `div`s; the mobile drawer has no focus trap and the hamburger has no `aria-expanded`; the toast has no live region; `#messages` has no `role=log`; **pinch-zoom is disabled**; no `prefers-contrast`/forced-colors support; the light-mode warning toast text is about 2.4:1 contrast [INFERENCE from hex values].
- **i18n:** 15 locales, about 1.7k keys, `data-i18n*` DOM stamping, chat-only RTL toggle.
- **Screenshots (desktop 1440×900):**
  - Chat + workspace: `images/hermes-webui/desktop-chat-workspace-panel.png`
  - Model picker: `images/hermes-webui/desktop-model-picker.png`
  - Cron job detail: `images/hermes-webui/desktop-cron-detail.png`
  - Kanban: `images/hermes-webui/desktop-kanban.png`
  - Skills: `images/hermes-webui/desktop-skills.png`
  - Memory / Agent Soul: `images/hermes-webui/desktop-memory-soul.png`
  - Profile detail: `images/hermes-webui/desktop-profile-detail.png`
  - Insights: `images/hermes-webui/desktop-insights.png`
  - Settings → Appearance: `images/hermes-webui/desktop-settings-appearance.png`
  - Settings → Extensions: `images/hermes-webui/desktop-settings-extensions.png`

## 7. Mobile & responsive support
- **Breakpoints** (`static/style.css`):
  - 340, 420, 520, 560, 600, **640/641**, 700, 768, **900/901**, 1400, 1600, 1800px, plus `@container` queries for the right panel (≤160/220/420/520) and the composer footer (≥1100).
  - Pointer/hover queries (`(hover:none) and (pointer:coarse)`) are used widely.
  - JS mirrors these: `_isPhoneWidthViewport` ≤640, `_isCompactWorkspaceViewport` ≤900 (`static/boot.js:159-170`).
  - The main phone block is `style.css:3055-3216`. At ≤900px the right panel is `display:none` (`style.css:3001-3004`, verified); the slide-over exists only ≤640px locally. Upstream exp-400 (#7364) adds a 641–900px tablet/foldable slide-over.
- **Mobile nav pattern:**
  - Hamburger in a 52px titlebar opens a **full-width (100vw) drawer** containing a 52px vertical icon column plus the active panel (`images/hermes-webui/mobile-sidebar-drawer.png`).
  - There is **no bottom tab bar**. `README.md:313` says this is deliberate; `ROADMAP.md:254` claims a 5-tab bottom nav that is not in the code.
  - A left-edge swipe opens the drawer (start ≤80px, opens at 64px; `static/boot.js:415-510`).
  - The workspace/files panel is a right slide-over, `min(300px,100vw)` (`images/hermes-webui/mobile-workspace-files.png`).
  - Choosing a non-chat panel keeps the drawer open on that panel. For example, Kanban on a phone shows the filter/list view inside the drawer (`images/hermes-webui/mobile-kanban.png`), and the board uses 82vw scroll-snap columns (`style.css:7086`).
  - The titlebar holds 44px "+" (new chat) and reload buttons. Tapping the title shows a popover; a long-press opens the session menu (`static/panels.js:200-262`).
- **Composer on phones:**
  - The footer collapses to icons: attach, mic, profile, files, context ring, send.
  - Model, workspace and reasoning move into a **config sheet** opened from the ring button (`images/hermes-webui/mobile-composer-config-sheet.png`; `static/ui.js:5078-5140`).
  - Saved prompts are hidden.
  - Enter inserts a newline on touch-only devices (`static/boot.js:2380-2438`).
  - Inputs are forced to ≥16px to prevent iOS zoom (`style.css:6636`).
  - Keyboard handling uses `visualViewport` to compute `--keyboard-bottom-inset` plus a forced reflow (`static/boot.js:171-211`).
- **Touch targets:** a 44px minimum is enforced at ≤640px for titlebar buttons, nav, composer, send, approval/clarify buttons and session rows [LIVE: composer buttons measured 44×44]. Below 44px [LIVE/INFERENCE]: session ⋮ buttons (26×26 measured), panel-head +/refresh (24px), project chips (~20px), message actions (40px), jump buttons (32px). Upstream issues #8044 and #8051 cover tap-target problems.
- **Gestures:** session swipe archive/delete, long-press menus, double-tap rename (which adds a **300ms tap delay**), pull-to-refresh (standalone only), Mermaid pinch-zoom, mic hold, terminal drag. Kanban uses HTML5 drag-and-drop, which likely does not work on touch [INFERENCE].
- **PWA:**
  - `manifest.json`: `standalone` + `display_override`, `portrait-primary`, theme/background #0D0D1A, one "New conversation" shortcut, SVG/32/192/512 icons (`any maskable`).
  - Service worker: version-keyed shell cache, network-first; never caches `/api`, streams or login; inline offline page; `notificationclick` deep links.
  - `beforeinstallprompt` is captured, but **no UI ever calls `promptInstall()`** (`static/pwa-startup.js:47-81`).
  - **No Web Push:** there is no `push` handler (open issue #3196).
  - iOS: `apple-mobile-web-app-capable` with a `black-translucent` status bar.
- **Safe area:** the viewport meta is `width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no` (`static/index.html:5`, verified). There is **no `viewport-fit=cover`**. `env(safe-area-inset-top)` is used only in standalone mode (titlebar, drawer, panels), plus left/right insets. **`safe-area-inset-bottom` is never used** (grep verified), so the composer may crowd the iPhone home indicator in standalone mode [INFERENCE]. `100dvh` is used for the body and sheets.
- **What breaks or is weak at 390px** [LIVE 390×844 + code]:
  - Layout holds: no horizontal overflow (`scrollWidth` = 390 measured) and readable chat (`images/hermes-webui/mobile-chat-session.png`).
  - The drawer covers chat completely, so every panel switch costs two taps.
  - Settings is a long single column (`images/hermes-webui/mobile-settings-appearance.png`).
  - Memory works well (`images/hermes-webui/mobile-memory-detail.png`).
  - Toasts and banners ignore safe areas.
  - Pinch-zoom is locked.
  - Code blocks wrap instead of scrolling at ≤700px.
  - Open mobile issues: iOS PWA resume flicker storm (#7891), iPad keyboard offset (#6368), keyboard-resize closes dropdowns (#7471), no camera capture (#6942), no fullscreen previews (#6675), WKWebView freeze on cancel (#6653) [S4].
- **Login on mobile:** `images/hermes-webui/mobile-login.png` (a minimal card: password field + Sign in).

## 8. Strengths
- **Deepest Hermes coverage of any surface:** chat, CLI/messaging session bridge, profiles, Memory/Soul, skills, cron, Kanban with dispatcher, gateway control, MCP, providers/OAuth/quota, logs, insights, updates, extensions. All of it runs against the same `~/.hermes` files the CLI uses.
- **Durable streaming:** run journal + turn journal + resumable SSE cursors + `.bak` recovery. Turns survive tab closes and reconnects.
- **Rich agent-run UX:** approvals with four scopes, clarify prompts, Queue/Interrupt/**Steer**, `/btw`, `/background`, `/goal`, three activity-display modes, subagent cards, a context ring with cost and cache-hit %, TPS.
- **Profiles done right for multiple users:** per-browser cookie profile, gateway status per profile, cross-profile session and cron visibility, trusted-header group→profile mapping.
- **Strong mobile groundwork:** visualViewport keyboard inset, 16px inputs, 44px targets on phones, swipe/long-press session gestures, edge-swipe drawer, composer progressive collapse into a config sheet, dvh-capped approval/clarify sheets, theme-color sync, SW notifications for iOS.
- **Customisation:** 21+ skins × 3 modes, 4 font sizes, reorderable nav tabs and composer chips, 15 locales, chat-only RTL, an extension API with a gallery and sidecars.
- **Security options:** password, passkeys, OIDC, proxy SSO, CSRF, rate limiting, LAN-gated terminal, env scrubbing.
- **No build step:** trivial to self-host; many deploy targets (Docker 1/2/3, Nix, launchd/systemd, WSL).

## 9. Weaknesses, gaps & known issues
- **Architecture coupling:** imports agent source in-process and mutates `os.environ` per turn under a lock. A stale-agent guard causes 409 `agent_runtime_stale` after agent updates (`docs/troubleshooting.md:180`). The RFCs to decouple (#1925, #2453, #2491) are still open [S4]. Crash loop after an agent update: #7982.
- **Performance at scale:** huge single files (ui.js about 1 MB, i18n.js 1.7 MB loaded eagerly; #7341). Large sessions hold a lock about 5 s per poll (#7899). Session switches take 10+ s (#6802). A 100 GB RAM incident (#6881). Profile skill stats slow `/api/profiles` (#7940).
- **Data-loss bugs:** 11 open `data-loss` issues, e.g. #7969 (worklog >256 KB lost) and #7945 (post-compression turns dropped) [S4].
- **Security posture:**
  - Auth is off by default.
  - `/api/chat/cancel` is a GET with no CSRF.
  - `/api/shutdown`, `/api/admin/reload`, `/api/commands/exec` and `/api/updates/apply` have no extra gate when auth is off (`routes.py:12827,15830,14460`).
  - Extensions run with full session authority and no sandbox (`docs/EXTENSIONS.md`).
  - Open #8032: Settings saves env-expanded secrets into config.yaml.
  - CSP is report-only.
- **Hidden backend features:** a full git API (stage, commit, push, AI commit message) with **no UI** (badge only). The MCP "read-only" label is wrong: toggles exist. The undo button is built but not placed.
- **Navigation:** 11+ top-level rail items with no grouping and no command palette. Cmd+K is taken by "new chat". Session rows are not keyboard-focusable. No unread-only filter (#3910). Origin filtering is only two tabs (#3418).
- **Mobile gaps:** no bottom nav (two taps per switch); full-screen drawer with no peek; zoom locked; no bottom safe-area; no install prompt UI; no Web Push (#3196); Kanban drag-and-drop is not touch-capable; 641–900px tablet band hid the files panel until upstream exp-400; the 300ms tap delay; sub-44px targets in drawer headers, project chips and ⋮ buttons.
- **Insights:** live snapshot only, no historical resource charts (#6726). No goal panel; goals exist only as `/goal` messages.
- **Multi-agent:** the most-voted request is a "Bot Mode" roster with @mention handoffs (#7174, 18 👍). Also requested: a teams/agents panel (#719), a credential vault (#8020), a `.env` Custom Keys page (#7815), a Custom Endpoints page (#7118), and sync of pinned items/titles with Hermes Desktop (#7889, #3986).
- **Doc drift:** `BUGS.md:9` says "No open bugs" while 166 are open. The ROADMAP bottom-nav claim contradicts the README. `THEMES.md` and `DESIGN.md` are stale. The SPRINTS header is v0.51.792. The stable channel has been frozen since 2026-08-14 while experimental ships about 5 releases a day.
- **Cron scheduling depends on the gateway:** WebUI never ticks the scheduler (`api/profiles.py:615-616`).
- **Platform:** native Windows has no terminal and several open startup bugs (#7937, #8033).

## 10. Unique features (likely absent in other Hermes dashboards)
1. **CLI/messaging/Claude Code session bridge:** a merged sidebar of state.db and `~/.claude/projects` sessions with click-to-import-and-continue, read-only foreign stores, and LLM **handoff summaries** for messaging sessions.
2. **Durable resumable streaming** via run journal + turn journal, with `Last-Event-ID` cursors and replay after a server restart.
3. **Steer / Queue / Interrupt** busy modes, `/btw` side questions, `/background` parallel agents, `/goal` loops.
4. **Three activity-display modes** (Compact Worklog / Transparent Stream / Final answer only).
5. **Kanban dispatcher** that spawns per-profile `hermes -p` workers, with multi-board, tenants, dependencies and worker logs.
6. **Agent Soul + My Notes + User Profile editors** plus Project Context and **External Notes (MCP)** sources, and an LLM Wiki browser.
7. **Checkpoint rollback** (agent shadow-git checkpoints: diff and restore) and **per-session git worktrees**.
8. **Embedded PTY terminal** over SSE, shareable across viewers.
9. **Extensions gallery** with loopback sidecars, a JS API, skin registration, `/pet` desktop companion, and agent dashboard-plugin iframes.
10. **WebUI-as-MCP-server** (`mcp_server.py`) so the agent can organise its own projects and sessions.
11. **Provider spend tracking:** 7-day spend chart, monthly pace and budget, credential-pool health, quota chip.
12. **Auxiliary-model routing UI** for 11 side tasks (vision, compression, titles, approval, curator, kanban decomposer…).
13. **Voice stack:** dictation (browser or server STT), hands-free voice mode, raw-audio messages, 4 TTS engines.
14. **Public share links**, themed standalone HTML export, server-side drafts.
15. **In-app self-update** with stable/experimental channels and an AI "What's New" summary.
16. **Passkeys, OIDC and trusted-header SSO** with group→profile mapping.
17. **27 skins** (21 built in + extension packs), reorderable nav tabs and composer chips.

## 11. Design implications for the unified dashboard
**Preserve:**
- **Preserve the composer-centric control model:** profile, workspace, model, reasoning and context live in the composer, and on phones they collapse into one config sheet. It is the best mobile pattern observed here.
- **Preserve durable streaming semantics:** server-side runs, a journaled event log, resumable cursors, and server-side drafts. A mobile client will drop connections constantly.
- **Preserve the run-control vocabulary:** approvals (once/session/always/deny), clarify, Queue/Interrupt/Steer, Stop, `/btw`, `/background`, `/goal`, context ring with Compress. Also the three activity-display modes.
- **Preserve the session bridge:** one list across WebUI/CLI/messaging/cron/kanban/Claude Code with source filters, cross-profile toggle, projects, pins, archive, swipe gestures and handoff summary.
- **Preserve every Hermes surface:** Memory (MEMORY/USER/SOUL + project context + external notes), skills CRUD and usage, cron (agent + script modes, run history), Kanban with dispatcher, gateway control, MCP inventory, providers/OAuth/quota/spend, logs, insights, checkpoints, terminal, extensions.

**Improve:**
- **Improve navigation:** replace the flat 11-item rail and full-screen drawer with a bottom tab bar (Chat, Tasks/Kanban, Memory/Skills, Insights, More) plus a real command palette (Cmd+K). Group "Agent" surfaces (Profiles, Soul, Skills, Memory) and "Ops" surfaces (Cron, Kanban, Gateway, Logs, Insights).
- **Surface hidden capabilities:** a git panel (diff, stage, commit with AI message, push), a goal panel, an editable MCP config, and an undo action.
- **Improve mobile fundamentals:**
  - `viewport-fit=cover` plus all four safe-area insets, with no zoom lock;
  - bottom-sheet modals;
  - touch-capable Kanban (long-press drag or move-to menu);
  - ≥44px targets everywhere, including ⋮ and chips;
  - no 300ms tap delay;
  - an install prompt UI;
  - Web Push for run completion, approvals and cron;
  - toasts with `aria-live` and safe-area placement.
- **Improve security defaults:** auth on when bound off loopback, POST-only state changes (cancel), gates on shutdown/update/exec, and a sandbox or permission model for extensions.
- **Improve performance:** lazy per-locale i18n, code splitting, virtualised session lists and transcripts by default, and no full-transcript rebuilds per turn.

**Mobile risks:**
- Phones must still reach dense desktop-grade panels (Kanban board, providers list with 40+ entries, settings with 60+ toggles, insights tables). Plan progressive disclosure and search-first settings.
- Tablet band (641–900px) handling must be designed explicitly. WebUI only fixed it upstream on 2026-10-01.
- iOS PWA resume storms (#7891) show that background/foreground recovery must be rate-limited and cursor-based.

## Sources
1. GitHub repo metadata — https://github.com/nesquena/hermes-webui (API: https://api.github.com/repos/nesquena/hermes-webui) [S1]
2. Releases — https://github.com/nesquena/hermes-webui/releases ; latest stable https://api.github.com/repos/nesquena/hermes-webui/releases/latest [S2]
3. Upstream CHANGELOG (exp-317 → exp-422) — https://raw.githubusercontent.com/nesquena/hermes-webui/master/CHANGELOG.md ; upstream HEAD https://github.com/nesquena/hermes-webui/commit/3e960237f50118b5a999f6e1edaf727b578f868f [S3]
4. Open issues — https://github.com/nesquena/hermes-webui/issues (cited: #719, #1925, #2453, #2491, #3196, #3418, #3910, #3986, #6368, #6653, #6675, #6726, #6802, #6881, #6942, #7118, #7174, #7341, #7471, #7815, #7889, #7891, #7899, #7902, #7937, #7940, #7945, #7969, #7982, #8020, #8032, #8033, #8044, #8051) [S4]
5. Local commit — https://api.github.com/repos/nesquena/hermes-webui/commits/77323c310e777b2b510aa62116b1ea07fce215e8
6. Hermes Agent docs — https://hermes-agent.nousresearch.com/docs
7. `~/hermes-webui/server.py`
8. `~/hermes-webui/api/routes.py`
9. `~/hermes-webui/api/streaming.py`
10. `~/hermes-webui/api/agent_runtime.py`, `api/config.py`, `api/agent_sessions.py`, `api/models.py`, `api/gateway_watcher.py`, `api/state_sync.py`
11. `~/hermes-webui/api/gateway_chat.py`, `api/runtime_adapter.py`, `api/runner_client.py`, `api/gateway_restart.py`, `api/agent_health.py`, `api/dashboard_probe.py`
12. `~/hermes-webui/api/auth.py`, `api/auth_oidc.py`, `api/passkeys.py`, `api/startup.py`, `api/extension_sidecar_auth.py`
13. `~/hermes-webui/api/kanban_bridge.py`, `api/goals.py`, `api/profiles.py`, `api/providers.py`, `api/oauth.py`, `api/onboarding.py`, `api/commands.py`
14. `~/hermes-webui/api/terminal.py`, `api/upload.py`, `api/workspace.py`, `api/workspace_git.py`, `api/rollback.py`, `api/background.py`, `api/background_process.py`
15. `~/hermes-webui/api/run_journal.py`, `api/turn_journal.py`, `api/session_recovery.py`, `api/compression_recovery.py`, `api/metering.py`, `api/skill_usage.py`, `api/system_health.py`
16. `~/hermes-webui/api/updates.py`, `api/extensions.py`, `api/plugins.py`, `api/plugin_providers.py`, `api/shares.py`, `api/media_snapshots.py`
17. `~/hermes-webui/mcp_server.py`
18. `~/hermes-webui/static/index.html`
19. `~/hermes-webui/static/style.css`
20. `~/hermes-webui/static/boot.js`
21. `~/hermes-webui/static/ui.js`
22. `~/hermes-webui/static/panels.js`
23. `~/hermes-webui/static/sessions.js`
24. `~/hermes-webui/static/messages.js`
25. `~/hermes-webui/static/commands.js`
26. `~/hermes-webui/static/workspace.js`, `static/terminal.js`, `static/onboarding.js`, `static/outline.js`, `static/extension_settings.js`, `static/login.js`, `static/share.js`
27. `~/hermes-webui/static/manifest.json`, `static/sw.js`, `static/pwa-startup.js`, `static/i18n.js`
28. `~/hermes-webui/README.md`
29. `~/hermes-webui/ARCHITECTURE.md`
30. `~/hermes-webui/ROADMAP.md`, `SPRINTS.md`, `BUGS.md`, `CHANGELOG.md`, `LICENSE`, `pyproject.toml`, `package.json`
31. `~/hermes-webui/DESIGN.md`, `THEMES.md`, `docs/UIUX-GUIDE.md`, `docs/GUIDELINES.md`, `docs/ui-ux/`
32. `~/hermes-webui/docs/sse-streams.md`, `docs/supervisor.md`, `docs/remote-access.md`, `docs/remote-workspaces.md`, `docs/workspace-git.md`, `docs/EXTENSIONS.md`, `docs/CONTRACTS.md`, `docs/troubleshooting.md`, `docs/onboarding.md`, `docs/why-hermes.md`, `docs/wsl-autostart.md`, `docs/docker.md`
33. `~/hermes-webui/docs/rfcs/*` (10 RFCs), `docs/architecture/agent-api-contract.md`, `docs/architecture/unified-session-db.md`
34. `~/hermes-webui/bootstrap.py`, `ctl.sh`, `start.sh`, `start.ps1`, `Dockerfile`, `docker-compose.yml`, `docker-compose.two-container.yml`, `docker-compose.three-container.yml`, `docker_init.bash`, `flake.nix`, `nix/nixosModules.nix`
35. `~/.hermes/webui/extensions/skin-pack/extension.json` (installed extension, live instance)
36. Live instance http://127.0.0.1:8787 — read-only GETs `/health`, `/api/health/agent`, `/api/auth/status`, `/api/sessions/gateway/stream?probe=1`, `/api/updates/check`, plus UI browsing (screenshots in `images/hermes-webui/`)
