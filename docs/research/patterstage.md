# PatterStage (formerly "Control Hub (Hermes)" / hermes-control-hub) — Research
> Inspected: https://github.com/Daniel-Parke/PatterStage — **`dev` branch @ `6dc4ce158de67e75ea7238d2a16ed5807dfa29f6` (2026-10-04, the newer, primary target)** and **`main` @ `7b9d6d6856386e6e3e39a30edb8cf6596a7f9417` (last feature merge 2026-06-02, still branded "Control Hub")**, date 2026-10-06. Live instance: **isolated local run of `dev`** (production build, `HERMES_HOME=/tmp/dashboard-research/fake-hermes`, `PS_DATA_DIR=/tmp/dashboard-research/ch-data`, `HOME` faked, port 42199, seeded with the shipped catalogue, no model key, no Hermes gateway of its own) — stopped after capture. The user's `~/.hermes` was not used.

**Citation convention.** Unless prefixed, `path:line` is relative to the `dev` checkout. `main:` = the `main` checkout. Live observations from the isolated run are marked **[LIVE]**. Unverified = **[INFERENCE]**.

### Same project, renamed — which is canonical
- `https://github.com/Daniel-Parke/hermes-control-hub` answers `301 → https://github.com/Daniel-Parke/PatterStage`; both clones resolve to the same history and the same HEAD SHA. The README on `dev` says so explicitly: "This repository was called `hermes-control-hub` and is now `PatterStage`" (README.md:153-155). **It is a rename, not a fork.**
- The two *branches* are what differ. `main` is the old Control Hub (package name `control-hub`, MIT, 23 pages / 57 API route files, cron bridge to `~/.hermes/cron/jobs.json`, missions run as `hermes chat -q` subprocesses, **no real authentication** — `main:src/lib/api-auth.ts:93-107`). `dev` is PatterStage (package `patterstage`, Apache-2.0 + trademark policy, 27 pages / 104 API route files, HTTP runtime against the Hermes API Server, proxy-enforced auth, design system, quests, help). PR #157 "promote dev to main" has been open since 2026-06-04 and states "`main` today is 276 commits behind, still MIT-licensed, and predates the S1 authentication hotfix… This repo shipped an unauthenticated RCE chain once" [S5].
- **Canonical/newer = `dev`.** Every section below describes `dev`; differences from `main` are summarised in §10/§9 and in the "Main vs dev" table at the end of §3.

---

## 1. Identity

| Aspect | Finding | Evidence |
|---|---|---|
| Positioning | "Local-first web console for running and watching a Hermes AI agent on your own machine… built for one person on one install, so there are no accounts." Owner's wider ambition: the operator console of a "PatterTech" product estate ("hosts WORK, not SURFACES"). | README.md:1-12; org/decisions/ADR-0001-patterstage-hosts-work-not-surfaces.md:36-46 |
| Frontend | Next.js **16.3.6** App Router, React **19.2.8**, TypeScript, Tailwind CSS v4 (no custom breakpoints), TanStack Query 5, `@xyflow/react` 12 + `@dagrejs/dagre` (Composer graph), lucide-react icons, zod 4. Vendored Inter + JetBrains Mono. | package.json (dependencies); src/app/layout.tsx:24-35 |
| Backend | Same Next.js process: route handlers under `src/app/api/**` (104 `route.ts` files ≈ "99 routes" in docs), `src/proxy.ts` (Next 16 middleware) as the single auth boundary, `src/instrumentation.ts` starts a lease-owned background scheduler. SQLite via `better-sqlite3` (schema v43 after migrate **[LIVE]**). `undici` for gateway HTTP. | src/proxy.ts; src/instrumentation.ts:85-115; src/lib/orchestration/scheduler/BackgroundScheduler.ts:117 |
| Build/test | `next build` (~30 s cold on M-series **[LIVE]**), Jest unit (PR claims 8,902 unit / 511 browser passes on dev), Playwright (`chromium` + `phone` 390×844 projects), design-lint/contrast/census gates, knip, "output canary", docs site build. | package.json scripts; playwright.config.ts:40-58; dev commit log 2026-10-04 |
| License | `dev`: **Apache-2.0** + NOTICE + TRADEMARK.md; branding/ not licensed; forks must rebrand (REBRANDING.md). `main`/GitHub-detected: **MIT**. | README.md:141-149; REBRANDING.md:10-28; GitHub API [S2] |
| Maturity | 66 stars, 15 forks, 2 open issues (1 is PR #157). Created 2026-04-09. **No tags or GitHub releases.** `main`: 153 commits Apr, 256 May, 66 Jun, 1 Sep. `dev`: very high cadence (78 commits on 2026-10-04 alone) heading to **v1.0.0-rc.1** (task T-0113 in progress). Version string `0.1.0`. Heavy AI-agent-driven governance corpus (`org/`: CONSTITUTION, TASKS, 20 ADRs, plans). | GitHub API [S2][S3]; `git log`; org/TASKS.md:128; CHANGELOG.md:9-11 |
| Install/deploy model | `git clone` + `bash scripts/bootstrap/install.sh --in-repo` (asks to install Hermes and the Hindsight memory server, builds, writes `.env.local` with a free port 42069-42100, offers to seed the catalogue) then `npm run start`. Linux supported, macOS dev-tier, Windows via WSL2 only. Node ≥ 22.19. Docker image exists but is "the CI parity rig… not a way to deploy". Self-update from the UI (git reset --hard + rebuild + restart). | README.md:23-63; docs/running/deploy.md:116-131; docs/running/limitations.md:50-83 |
| Process model | One Node process (Next server) + in-process background loops (15 s SyncScheduler: RunSync, ScheduleTick, ComposerTick, MissionQueueSync, Session/Process/Log/Env/Config/Memory sync). Optional detached `node scripts/tooling/ps-deploy.mjs` for update/rebuild/restart. Hermes runs separately (`hermes gateway` with API server on :8642). Hindsight memory is a separate service (:9177). | src/lib/sync/SyncScheduler.ts:34-57; src/lib/sync/index.ts:44-68; src/app/api/update/route.ts:114-122 |
| Auth/security model | Single operator token (32 random bytes, `PS_DATA_DIR/auth-token`, 0600) → exchanged on a sign-in page for an opaque `ps_session` cookie (HttpOnly, SameSite=Lax, 30 min idle / 12 h absolute / invalidated on restart). Bearer header for scripts. Exact-Origin CSRF check, per-request CSP nonce + `strict-dynamic`, `frame-ancestors 'none'`, throttled guesses, read-only mode, `PS_AUTH_MODE=none` (host-exec routes then refuse). Token = "root on the host". | docs/SECURITY.md:52-68; src/proxy.ts:31-49,142-190,238-332; src/lib/auth/session-store.ts:15-16 |
| Remote access | `npm run start` binds 127.0.0.1. `start:network` refuses unless `PS_PUBLIC_ORIGIN` + exactly one of `PS_PRIVATE_PROXY_NETWORK=1` (behind trusted HTTPS proxy) or `PS_INSECURE_LAN_HTTP=1`. Recommends same-host HTTPS reverse proxy or SSH port-forwarding; no Tailscale-specific story; no multi-user. | docs/running/deploy.md:23-37; docs/SECURITY.md:98-114; docs/running/limitations.md:45-48 |

---

## 2. How it talks to Hermes

**Architecture in one line:** PatterStage's SQLite DB is the source of truth for everything it manages (profiles, models, credentials, skills catalogue, missions, schedules, runs, chats, workflows, stories); `HERMES_HOME` is treated as a *runtime mirror* written through one adapter with `.bak` backups + atomic writes and drift detection; *all agent work* goes over HTTP to the **Hermes API Server** (`API_SERVER_ENABLED=true`, default `http://127.0.0.1:8642`, Bearer `API_SERVER_KEY`). **No `hermes` CLI subprocess is spawned anywhere in `src/`** (only mentioned in advice text). (docs/reference/runtime-architecture.md:30,112,153-157; src/lib/runtime/HermesRuntime.ts)

| Data domain | Mechanism | Read/Write | Evidence |
|---|---|---|---|
| HERMES_HOME resolution | `HERMES_HOME` → `AGENT_HOME` (deprecated) → `~/.hermes`; distinguishes default root vs `profiles/<x>` | — | src/modules/hermes/lib/home.ts:18-21; src/modules/hermes/lib/profile-paths.ts:62,73 |
| Gateway location/auth | `HERMES_GATEWAY_URL` / `PS_LLM_API`, default `127.0.0.1:8642`; Bearer `API_SERVER_KEY` (must match `~/.hermes/.env`; setup.sh writes `API_SERVER_ENABLED=true` + key into `~/.hermes/.env`). Every profile resolves to the same single endpoint. | R | src/modules/hermes/lib/agent-runtime.ts:26-38; src/lib/runtime/endpoint-registry.ts:36-39; docs/reference/runtime-architecture.md:112 |
| Run submission (missions, chat agent turns, Composer stages, schedule fires) | `POST /v1/runs` with Idempotency-Key (= PatterStage run id), `X-Hermes-Session-Id/Key`; retries only on 429 (4×) | W | src/lib/runtime/HermesRuntime.ts:199-202,273-288 |
| Run status | `GET /v1/runs/{id}` polled by RunSync every 15 s (authoritative) | R | src/lib/runtime/HermesRuntime.ts:409; src/lib/orchestration/run-reconcile.ts:302 |
| Run events | `GET /v1/runs/{id}/events` (SSE) proxied to browser at `/api/runs/[id]/events` | R | src/lib/runtime/HermesRuntime.ts:390,423; src/app/api/runs/[id]/events/route.ts:114 |
| Stop / approval | `POST /v1/runs/{id}/stop` (404 = stopped); `POST /v1/runs/{id}/approval {approved, note}` | W | src/lib/runtime/HermesRuntime.ts:356,462,481 |
| Chat sessions | `POST /api/sessions {title, source:"chat"}` on the gateway | W | src/lib/runtime/HermesRuntime.ts:571; src/app/api/chat/route.ts:39 |
| Health / models | `GET /health/detailed` → `/health` (5 s); `GET /v1/models` for chat health + model list | R | src/lib/runtime/HermesRuntime.ts:486-508; src/app/api/gateway/health/route.ts:36; src/app/api/gateway/models/route.ts:20 |
| Direct completions | `POST /v1/chat/completions` (Fast chat, Deep Research, Story Weaver) — or straight to the provider when a registry model has its own base URL + key | W(upstream) | src/app/api/orchestration/chat/route.ts:137-143; src/lib/models/llm.ts:85-172 |
| Admission gate | In-process limiter per gateway endpoint: 8 in flight, 32 queued, 10 s wait → 503 (`PS_GATEWAY_*`) | — | src/lib/runtime/gateway-gate.ts:55-68 |
| Sessions & transcripts | `HERMES_HOME/state.db` opened **read-only** (better-sqlite3); 10,000 newest sessions copied into PS `sessions` table every 15 s and on list load; transcript = `messages WHERE session_id=?` (cap 2000). Fallback `sessions/<id>.json/.jsonl` (413 > 64 MiB), then PS mission output files. | R | src/lib/runtime/state-db.ts:70-71,107,163; src/lib/sessions/session-sync.ts:113-217; src/app/api/sessions/[id]/route.ts:167-170 |
| Cron job names | `HERMES_HOME/cron/jobs.json` read only (to title cron sessions); **no write bridge on dev** | R | src/modules/hermes/lib/cron-jobs.ts; src/lib/sessions/session-sync.ts:124 |
| Root `config.yaml` | Assembled from `agent_root` row on push; managed keys `skills.disabled`, `platform_toolsets`, `agent.personality`; Settings deep-merges one section per save into the *active* HERMES_HOME file; `model.*`, `auxiliary.<11 slots>.*`, `fallback_providers`, `agent.api_max_retries/restore_primary_on_fallback/fallback_notification`, `memory.provider` written by Models/Memory pages; everything else preserved verbatim; `.bak` before every write | R/W | src/modules/hermes/lib/profile-push.ts:85; profile-config-builder.ts:19-27,184-189; src/app/api/config/route.ts:72,176; config-sync.ts:73,182,225; hermes-fallback-config.ts:101; memory-provider-sync.ts:40 |
| Profiles | `profiles/<slug>/{config.yaml, SOUL.md, AGENTS.md, memories/USER.md, memories/MEMORY.md}`; creates `memories, sessions, skins, logs, plans, workspace, cron` subdirs; copies root `auth.json`; rename dir on slug change; `rm -rf` on delete; discovery/import of unknown dirs | R/W | src/modules/hermes/lib/profile-push.ts:52; profile-sync-shared.ts:35-64; profile-discovery.ts:40,84-88 |
| Root identity files | `SOUL.md`, `AGENTS.md`, `HERMES.md`, `memories/{USER,MEMORY}.md` | R/W | src/modules/hermes/lib/profile-push.ts:85; profile-pull.ts:121 |
| Skills | `skills/**/SKILL.md` (+references/templates/scripts/assets) scanned/imported, written on edit; global (not per-profile) dir; per-profile enablement = `skills.disabled` denylist | R/W | src/modules/hermes/lib/profile-discovery.ts:93,123; skill-view.ts:44-66; skills-config.ts:152-153 |
| `.env` | `<PROVIDER>_API_KEY` written/removed on credential create/rotate/delete (order/comments kept, 0600); read by import; masked on GET; PUT refused; EnvSync detects which **platform tokens** exist (never values) | R/W | src/modules/hermes/lib/hermes-env-sync.ts:87,125; src/app/api/agent/files/[key]/route.ts:188,216; src/lib/sync/sources/EnvSync.ts:23 |
| Backups | `<HERMES_HOME>/backups/<file>.<ISO>.bak` before each overwrite | W | src/lib/fs/fs-helpers.ts:84-93 |
| Logs | `HERMES_HOME/logs/*.log` tail/list; **DELETE truncates all**; `gateway.log` + `errors.log` scraped into `error_log_entries` every 60 s | R/W | src/app/api/logs/route.ts:49-157; src/lib/sync/sources/LogSync.ts:65,120-121 |
| Deploy logs written *into* Hermes home | `HERMES_HOME/logs/ps-deploy.status`, `ps-update.log`, `ps-build.log`, `ps-restart.log` | W | src/lib/deploy/deploy-status.ts:29-30; docs/running/limitations.md:154-157 |
| Memory | `memory_store.db` read-only (holographic fact count); Hindsight over its own HTTP API `http://<host>:<port>/v1/default/banks/<bank>/…` (list, retain, reflect, directives, mental-models, health) | R/W | src/lib/runtime/memory-db.ts:34-37; src/lib/memory/hindsight-read-actions.ts:23-85; hindsight-write-actions.ts:20-100 |
| OS processes | `exec("ps aux")` every 15 s for `gateway run` + subagent processes; `/proc/uptime` (Linux). **[LIVE]** even with a fake HERMES_HOME it listed the host's real Hermes gateway processes ("3 Active") — process detection is not scoped to HERMES_HOME. | R | src/lib/sync/sources/ProcessSync.ts:34,159 |
| Host crontab | `crontab -l` / `crontab <tmp>` for host scripts (Linux/macOS) | R/W(host) | src/lib/host/host-scheduler.ts:64,71 |
| Git | version check/update (`git fetch`, `reset --hard`), branch list for mission working dirs | R/W | src/lib/update-handlers/version-check.ts:18,93; src/lib/git/git-workspace-branches.ts:44,60 |
| PatterStage-owned data | `PS_DATA_DIR` (default `~/patterstage/data`): `patterstage.db`, `auth-token`, `templates/*.json`, `scripts/`, `logs/`, `missions/<id>.*`, `seed-state.json`, `backups/db/` | R/W | docs/running/env-reference.md:49-62; src/lib/host/paths.ts:125-147 |

**Main-branch contrast:** missions ran a bash wrapper of `hermes … -q` tracked via pid files and killed with SIGTERM/`pkill -f CH_MISSION_ID=`; agent cron was synced both ways with `~/.hermes/cron/jobs.json` through Hermes' own venv python; gateway `trigger_job` for "run now" (main:src/lib/backends/hermes.ts:170-247; main:src/app/api/cron/route.ts:5-13,165-169,386-402; main:docs/MISSIONS.md:89-98).

---

## 3. Information architecture

Navigation is generated from one registry (`src/lib/modules/registry.ts`) — rail, page titles, `document.title`, help deep-links, e2e route matrix and quest hrefs all derive from it. Five sections: Home, Work, Results, Agent, Rec Room (src/lib/modules/types.ts:22).

```
PatterStage  "The Stage is Yours"
├─ Dashboard                 /                         operations board: next quest, 5 subsystems, scheduler/spend/processes pills, progress line, launch-a-mission strip, active missions, platforms, errors, processes
├─ WORK
│  ├─ Chat                   /work/chat                agent (tools+memory, streamed reasoning/tool cards, HITL approvals) or fast (raw model) chat; conversation list (sheet on phone)
│  ├─ Missions               /work/missions            5-column mission board, composer sheet (4 dispatch modes), templates, categories
│  ├─ Composer (flag)        /work/composer            Run tab (launch, runs list, live pipeline canvas, gates, clarify) / Build tab (React Flow graph editor)
│  ├─ Research               /work/research            deep-research runs (search→visit→reason loops), cited HTML report
│  ├─ Scripts                /work/scripts             host shell/Node scripts: editor, run now, logs, schedule via crontab or internal timer
│  └─ Automation             /work/automation          one list of everything on a timer (PS schedules + host crontab rows)
├─ RESULTS
│  ├─ Sessions               /results/sessions         session browser (state.db), filters in URL, group by mission
│  │   └─ (detail)           /results/sessions/[id]    transcript viewer with role filters, search, copy
│  ├─ Artifacts              /results/artifacts        saved outputs (research reports, Composer deliverables, saved stages)
│  ├─ Insights               /results/insights         charts, spend + budget, achievements trophy case
│  └─ Logs                   /results/logs             HERMES_HOME/logs viewer (tail, filter, download, delete all)
├─ AGENT
│  ├─ Agents                 /agent/profiles           profiles table, push/pull/import, drift, Identity (SOUL.md) + Files tabs, XP
│  ├─ Skills                 /agent/skills             catalogue per profile with toggles, edit; detail /agent/skills/[...path]
│  ├─ Tools                  /agent/tools              toolset grid per profile (7 platform bundles + 15 toolsets), JSON editor
│  ├─ Memory                 /agent/memory             provider card + Hindsight browser (memories / directives / mental models)
│  ├─ Models                 /agent/models             registry, credentials, agent default, 12 task slots, fallback chain, drift
│  └─ Settings               /agent/settings           one page, 7 groups / 27 config.yaml sections, search
│      ├─ /agent/settings/[section]   → redirects to #anchor
│      ├─ Restore            /agent/settings/restore   seed pack restore + test-clutter cleanup
│      └─ System             /agent/settings/system    install facts, browser sessions, update/rebuild/restart, DB backups
├─ REC ROOM
│  └─ Story Weaver           /recroom/story-weaver     library; /create (themes, characters, model); /[id] reader
└─ footer: Quests /quests (badge n/32) · Help /help/[[...slug]] · Collapse (≥1024) · version + "Update available" badge
Unlisted: /auth sign-in page (proxy-served 401 HTML), /healthz, /api/health(z)
```
(Evidence: src/lib/modules/registry.ts:29-153; src/components/layout/Sidebar.tsx:274-359; src/components/layout/RailFooter.tsx:36-90; live rail **[LIVE]** `images/patterstage/live-dashboard-desktop.png`)

**Modals/sheets/panels (non-exhaustive by page, exhaustive lists in §4):** mission composer Sheet (4 steps), SchedulePicker, Manage categories modal, Edit Templates modal + editor, DirectoryPickerModal; Composer "Review before launch" dialog, gate panel, clarify prompt, node detail sheet, stage/route inspectors; Research report viewer; Script editor modal, Logs modal, Schedule modal; Agents New/Edit/Delete profile modals, file editor (Preview/Edit); Models Add/Edit model modal, Pull/Push diff dialog, credential add/rotate; Skills edit modal; Artifacts viewer sheet; Story Weaver edit-chapter modal, continue dialog, Bible panel, reader settings; Session manager (System). Phone: Chat/Logs/Composer/Research list panes become bottom sheets (src/components/ui/SplitPane.tsx:64-115).

**Legacy redirects:** 52 temporary 307s from the Control-Hub URLs (`/orchestration/*`, `/operations/*`, `/config/*`, `/laboratory/*`, `/sessions`, `/logs`, `/memory`, Story Weaver library/characters/themes, 27 settings sections → anchors); `/orchestration/cron` was dropped with **no redirect** (404). (next.config.ts:105-144; org/reviews/2026-09-decision-register.md:1973)

**Main (Control Hub) IA for contrast:** Main (Dashboard, Sessions, Memory, Logs) / Orchestration (Cron, Missions, Chat) / Operations (Agents, Skills, Tools, Personalities) / Rec Room (Story Weaver + Library/Characters/Themes) / Config Settings (Models, HERMES.md, Environment, All Settings + 6 collapsible groups with 26 section links incl. Seed); sidebar footer held Check for Updates / Rebuild / Restart (main:src/components/layout/sidebar-config.ts:41-150; main:src/components/layout/Sidebar.tsx:51-415; `images/patterstage/repo-main-dashboard.png`).

| main page | dev equivalent | Status |
|---|---|---|
| `/`, `/sessions`, `/sessions/[id]`, `/memory`, `/logs` | `/`, `/results/sessions…`, `/agent/memory`, `/results/logs` | moved/reworked |
| `/orchestration/chat`, `/orchestration/missions` | `/work/chat`, `/work/missions` | moved |
| `/orchestration/cron` (Agent + System tabs, Sync Jobs, Pause all) | `/work/automation` + `/work/scripts` | **removed, 404** |
| `/operations/agents|skills|tools` | `/agent/profiles|skills|tools` | moved |
| `/operations/personalities` (cards, Copy, Edit, Set active, New) | `/agent/profiles?tab=identity` | **page removed**; "Set as active" dropped |
| `/config`, `/config/[section]`, `/config/models`, `/config/seed` | `/agent/settings`, `#anchor`, `/agent/models`, `/agent/settings/restore` | moved |
| `/recroom/story-weaver/library|characters|themes` | library = index; create#characters / #themes | pages merged |
| — | `/quests`, `/help`, `/work/composer`, `/work/research`, `/work/scripts`, `/work/automation`, `/results/artifacts`, `/results/insights`, `/agent/settings/system` | **new in dev** |

Removed API routes vs main: `/api/cron` (jobs.json bridge), `/api/cron/hardware/meta`, `/api/personalities`, `/api/agent/personality`, `/api/agent/profiles/sync/drift`, 5 `/api/models/fallbacks/*` sub-routes (merged into one `action` route). (main API glob; CHANGELOG.md:562-572; src/app/api/models/fallbacks/route.ts:5-10)

---

## 4. Feature inventory (exhaustive)

### 4.1 Chat & conversation (`/work/chat`)
| Feature | What it does (user-visible behavior) | Read/Write | Evidence |
|---|---|---|---|
| Agent / Fast mode toggle | Agent = real Hermes run with tools + memory; Fast = raw model reply, no tools. Disabled while streaming. | — | src/app/work/chat/page.tsx:44,207 |
| Fast-mode model dropdown | Only in Fast mode; registry models, default "Agent Default". Agent turns send no model. | R | src/app/work/chat/page.tsx:208; src/lib/orchestration/chat-dispatch.ts:79-85 |
| New Chat | Creates a conversation (registers a Hermes session) or reuses an empty one; title collision retried with suffix. | W | src/app/work/chat/page.tsx:219; src/hooks/useChatConversations.ts:123-135; src/app/api/chat/route.ts:39-50 |
| Conversation list | Most recent first (100, API max 500); Retry on failed read; on phone a "Conversations (N)" button opens a sheet. | R | src/app/api/chat/route.ts:21-22; src/app/work/chat/page.tsx:233-236,325 |
| Export conversation | Per-row Download JSON / CSV. | R | src/app/work/chat/page.tsx:279,295 |
| Delete conversation | Two-step confirm, auto-disarm 3 s; messages cascade; Hermes session kept. | W | src/app/work/chat/page.tsx:178,306; src/lib/chat/chat-repository.ts:181 |
| Gateway banners | Blocking `offline`, `auth-missing`; advisory `model-missing`, `checking`; names the probed URL and tells you `hermes gateway start`. | R | src/components/chat/gateway-banner-states.ts:11-51; src/components/chat/GatewayBanner.tsx:90-107 |
| Composer box | Enter sends, Shift+Enter newline; disabled with remedy text when gateway offline **[LIVE]** (`live-chat-mobile.png`). | — | src/hooks/useChatSend.ts:345; src/app/work/chat/page.tsx:418-424 |
| Send ⇄ Stop | Button turns red Stop while streaming; `POST /api/chat/[id]/stop` → gateway stop, local cancel. | W | src/app/work/chat/page.tsx:438; src/app/api/chat/[id]/stop/route.ts:20-48 |
| Streaming reasoning panel | Collapsible thinking trace from `reasoning.*` SSE events. | R | src/hooks/useAgentRunStream.ts:118; src/components/chat/MessageBubble.tsx |
| Tool-call cards | One card per `tool.*` event: running / done / failed / awaiting approval. | R | src/hooks/useAgentRunStream.ts:87,126; src/lib/chat/chat-utils.ts:233-241 |
| Tool approval (HITL) | Strip names the tool; Approve/Deny forwarded to Hermes (`/v1/runs/{id}/approval`). | W | src/app/work/chat/page.tsx:87,402; src/app/api/chat/[id]/approval/route.ts:19,35 |
| Failed turn + Retry | `role=alert` bubble with gateway reason; Retry resends as a new turn. | W | src/app/work/chat/page.tsx:390; src/hooks/useChatSend.ts:298 |
| Auto-title | First user message renames "New Chat". | W | src/lib/chat/chat-repository.ts:220 |
| Interrupted-turn recovery | Reload folds a finished run onto the message; fast turns stuck >30 min failed at boot. | W | src/app/api/chat/[id]/route.ts:22; src/instrumentation.ts:97 |
| Typing indicator | Bouncing dots until first token. | — | src/app/work/chat/page.tsx:119 |
| API | `GET/POST /api/chat`, `GET/DELETE /api/chat/[id]`, `POST /api/chat/[id]/messages`, `PATCH …/messages/[messageId]`, `POST …/stop`, `POST …/approval`, `POST /api/orchestration/chat` (fast proxy to `/v1/chat/completions`, max_tokens 4096), `GET /api/gateway/health`, `GET /api/gateway/models`, `GET /api/runs/[id]`, `GET /api/runs/[id]/events` (SSE), `POST /api/runs/reconcile` | R/W | src/app/api/chat/**; src/app/api/orchestration/chat/route.ts:84-177; src/app/api/runs/** |
| Not present | No attachments/file upload, no image input, no voice, no slash commands, no message edit/branch, no markdown export of whole history beyond JSON/CSV, no per-chat profile switch [INFERENCE from page code]. | — | src/app/work/chat/page.tsx |

### 4.2 Sessions & history (`/results/sessions`)
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Session list | 50/page + page-size picker, first/last page; header counts and tiles from whole-table totals. | R | src/app/results/sessions/page.tsx:42,240,292 |
| Server-side search | Debounced 300 ms over title, id, profile, mission id (not message text). | R | src/app/results/sessions/page.tsx:85; src/components/session/SessionFilterBar.tsx:53 |
| Source filter | Buttons from reachable `sources` (CLI, Mission, Cron, API, chat…). | R | src/app/api/sessions/route.ts:79-91 |
| Failed-only, Group by mission, Hide API noise | Toggles; latter two persisted in localStorage `ps.sessions.*`; noise = api session <1 KB & ≤60 s. | R | src/components/session/SessionFilterBar.tsx:121-145; src/lib/sessions/session-filters.ts:7,10 |
| Shareable view | search/source/status/page/pageSize/missionId in the URL. | — | src/app/results/sessions/page.tsx:207 |
| Live indicator | Pulsing dot + 1 s elapsed counter while a session is live; list polls 10 s only then. | R | src/app/results/sessions/page.tsx:197; src/hooks/useSessions.ts:40 |
| Insights strip | Donut by source + tiles; one-line strip on phone. | R | src/components/session/SessionInsights.tsx:24-43; src/components/viz/StatStrip.tsx:80-158 |
| Failed badge + exit code | Failed sessions flagged with exit code; Hermes `end_reason` mapped (interrupt→143 etc.). | R | src/lib/sessions/hermes-state-sessions.ts:25-49 |
| Mission linkage | Session ↔ mission badges/links; mission "View sessions" deep link. | R | src/components/session/MissionGroupCard.tsx:79-82; src/components/missions/MissionEditorPanel.tsx:365 |
| Transcript viewer | Model, message count, size; Expand/Collapse all; Copy transcript (visible only); Refresh while running; role badges filter (dbl-click jumps to next); client search over text + tool names; failed banner; truncation note (newest 2000). | R | src/app/results/sessions/[id]/page.tsx:186-268 |
| Status-specific errors | 400/404/413/429 headings. | R | src/app/results/sessions/[id]/page.tsx:128 |
| Sync-on-read | List load triggers a state.db sync (debounced 30 s, inline ≤2 s); skipped in read-only. | R/W | src/app/api/sessions/route.ts:36-91 |
| Orphan sweep | Closes stale "active" rows (5/30 min); `POST /api/admin/sessions/backfill-status` (dry-run default, no UI). | W | src/lib/sessions/session-orphan-sweep.ts:40-41; src/app/api/admin/sessions/backfill-status/route.ts:42-86 |
| Rate limit | 120 req/min per client on sessions API → 429. | — | src/lib/sessions/sessions-api-guard.ts:10-13 |
| Not present | No full-text search of message bodies, no session delete/rename/resume/fork, no export, no virtualised transcript. | — | docs/running/limitations.md:124-133 |

### 4.3 Agents / Profiles & personas (`/agent/profiles`)
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Profile table | Root "Bob (local default)" + named profiles; slug, skills, files, last pushed, sync status (synced/drift/error) **[LIVE]** `live-agents-desktop.png`. | R | src/app/agent/profiles/page.tsx:111; src/app/api/agent/profiles/route.ts:67-123 |
| Header profile picker | One selection shared by Agents/Skills/Tools (localStorage `patterstage.selected-profile`). | R/W(browser) | src/hooks/useSelectedProfile.ts:28-54 |
| Drift banner | "Profile drift — database and Hermes disk differ" with counts; config.yaml compared semantically, others by hash. | R | src/components/agents/AgentProfilesOverview.tsx:37-78; src/modules/hermes/lib/profile-drift.ts |
| Push all / Pull all / Import discovered | DB→disk for all; disk→DB for all + adopt unknown `profiles/<dir>` + import skills; adopt only. | W | src/app/agent/profiles/page.tsx:209-243; src/app/api/agent/profiles/sync/{push,pull,import}/route.ts |
| Per-row push/pull arrows | Single profile sync. | W | src/app/agent/profiles/page.tsx:217,243 |
| New Profile modal | Name, description, Clone From (Bob or any profile); creates slug and pushes to disk; `default` reserved (409). | W | src/app/agent/profiles/page.tsx:307; src/app/api/agent/profiles/route.ts:139-228 |
| Edit profile | Rename + description; rename moves `profiles/<slug>`. Root rename = label only (`PUT /api/agent/root`). | W | src/app/api/agent/profiles/[id]/route.ts:23-91; src/app/api/agent/root/route.ts:26 |
| Delete profile | Two-step; `rm -rf profiles/<slug>`; root undeletable. | W | src/app/api/agent/profiles/[id]/route.ts:105-117 |
| Identity tab (personality) | `?tab=identity` opens SOUL.md editor; replaces main's Personalities page; save logs `personality.changed`. | R/W | src/app/agent/profiles/page.tsx:462,528; src/app/api/agent/files/[key]/route.ts:317 |
| Files tab + editor | SOUL.md, AGENTS.md, USER.md, MEMORY.md, config.yaml (+HERMES.md on root); Preview/Edit, Reset, Save (backup), discard guard; YAML parse check (409). | R/W | src/app/api/agent/profiles/route.ts:28-41; src/app/api/agent/files/[key]/route.ts:273-336 |
| Performance strip | Per-agent runs, success rate, tokens, avg time. | R | src/components/agents/AgentPerformanceStrip.tsx:18-24 |
| Growth panel (XP/levels) | Level, runs, active days, skills, toolsets, XP; 10 titles (e.g. "Specialist" **[LIVE]**). | R | src/components/agents/AgentGrowthPanel.tsx:26-31; src/lib/stats/agent-experience.ts:37-75 |
| Agent-not-installed notice | Shown when framework unavailable. | R | src/components/agents/AgentSetupNotice.tsx:35-52 |
| Process list API | `GET /api/agents` from ProcessSync. | R | src/app/api/agents/route.ts:14 |
| Progression snapshots | `GET /api/agents/progression` append-only table (no UI). | R/W | src/app/api/agents/progression/route.ts:34 |
| Seeded personas | 7 profiles: qa, swe, devops, data-scientist, creative-lead, support, baseline (+ root Bob) with SOUL/AGENTS/config. | W | data/seed/profiles/manifest.json |

### 4.4 Models & providers (`/agent/models`)
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Registry table | Name, Provider, Model ID, Protocol, Context, Default For, actions (pull, push, edit, delete) **[LIVE]** `live-models-desktop.png`. | R | src/app/agent/models/page.tsx:253 |
| Re-import from config | Reads config.yaml `model`/`auxiliary`/`fallback_providers` + `.env` keys into registry; dry-run GET shows counts + masked hints. | R/W | src/app/api/models/import/route.ts:27,48; src/modules/hermes/lib/config-import.ts:270 |
| Add/Edit Model modal | Name, provider (23), model id, base URL, context length, credential (inline create). | W | src/components/models/ModelEditor.tsx:211-248; src/app/api/models/route.ts:59 |
| Provider catalogue | 23 providers mapped to `<PROVIDER>_API_KEY`; `nous` OAuth-only; ollama/lmstudio/vllm/custom keyless. | R | src/modules/hermes/lib/providers.ts:13-84 |
| Credentials panel | Add, **Rotate key** (keeps models attached), two-click delete (reports orphaned models); only hints shown; writes `.env` with rollback. | R/W | src/components/models/CredentialsPanel.tsx:131-258; src/app/api/credentials/route.ts:74; src/app/api/credentials/[id]/route.ts:72,119 |
| Provider-mix donut | Insight strip. | R | src/app/agent/models/page.tsx:243 |
| Per-model Pull/Push with diff | Field-level diff dialog, exclude fields on pull / credential on push. | R/W | src/components/models/ModelSyncButtons.tsx:195-271; src/app/api/models/[id]/diff/route.ts:65 |
| Drift banner | Hermes-only, registry-only, primary-differs lines with Pull/Push actions. | R/W | src/components/models/ModelsDriftBanner.tsx:82-104; src/app/api/models/sync/drift/route.ts:12 |
| Agent default | Writes `model.default/provider/base_url/context_length` (`api_key:""`); readiness = the one "do I have a model?" answer. | W | src/app/api/models/defaults/route.ts:63,117 |
| Task defaults (12 slots) | agent, hindsight, compression, vision, web_extract, session_search, title_generation, skills_hub, mcp, triage_specifier, approval, delegation → `auxiliary.<slot>`. Bulk Set Auxiliaries (11). | W | src/lib/models/task-types.ts; src/components/models/DefaultsGrid.tsx:69-70; BulkAuxiliaryUpdater.tsx:71 |
| Fallback chain | Add from registry / custom, enable, reorder, override base URL, delete → `fallback_providers`; settings: retry threshold, restoration policy, notify (debounced 400 ms); Sync to Hermes (verify read-back) / Import. | R/W | src/components/models/FallbackChainList.tsx:236-322; FallbackConfigPanel.tsx:69-178; src/app/api/models/fallbacks/**/route.ts |
| Not present | No live model catalogue/pricing fetch from providers, no OAuth flows (Nous) in UI, no per-profile model (missions record model but don't send it — §9). | — | src/lib/orchestration/dispatch.ts:78-82 |

### 4.5 Skills (`/agent/skills`, `/agent/skills/[...path]`)
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Catalogue per profile | DB catalogue ∪ disk scan of `skills/**/SKILL.md`; enabled unless in profile denylist. | R | src/app/api/skills/route.ts:17; src/modules/hermes/lib/effective-disabled-skills.ts:40 |
| Active/Inactive sections, foldable categories, 24/page | Client grouping (`repo-dev-skills.png`). | R | src/app/agent/skills/page.tsx; docs/guides/skills.md |
| Search | Names + descriptions across catalogue. | R | src/app/agent/skills/page.tsx:223,362 |
| Toggle switch | Updates `skills.disabled` and pushes profile config.yaml. | W | src/app/api/skills/[name]/toggle/route.ts:29-78 |
| View / Edit | Inline preview; edit modal writes `skills/<key>/SKILL.md` (frontmatter dropped — bug). | R/W | src/app/api/skills/[name]/route.ts:12-55; docs/guides/skills.md:142-145 |
| Import from Hermes | Empty-state import. | W | src/app/agent/skills/page.tsx:89,193 |
| Skill detail | Rendered/Raw, metadata sidebar (`hidden lg:block`), linked files (references/templates/scripts/assets). | R | src/modules/hermes/lib/skill-view.ts:44-66; src/app/agent/skills/[...path]/page.tsx:152 |
| Seeded skills | web-research, code-review, summarize, step-plan. | W | data/seed/skills/manifest.json |
| Not present | No skills-hub browse/install, no create-new-skill wizard [INFERENCE], no per-profile skill dirs. | — | src/modules/hermes/lib/skills-config.ts:152-153 |

### 4.6 Tools / Toolsets & MCP (`/agent/tools`)
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Toolset grid | 22 buttons: 7 platform bundles (hermes-cli/-discord/-telegram/-slack/-whatsapp/-signal/-homeassistant) + 15 granular toolsets; bundle coverage disables covered ones. | R/W | src/modules/hermes/lib/toolset-catalog.ts:18,29; src/app/agent/tools/page.tsx:389 |
| Save & push | One list fanned to all 7 platform keys → `platform_toolsets`. | W | src/app/agent/tools/page.tsx:188,299; src/modules/hermes/lib/toolset-unify.ts:52 |
| Pull from / Push to Hermes | Profile-level sync. | W | src/app/agent/tools/page.tsx:211 |
| Advanced JSON | Raw per-platform JSON; locks the grid once edited; validation. | W | src/app/agent/tools/page.tsx:177,457-461 |
| Warnings | Drift, last sync failed, platforms diverged, unsaved on profile switch. | R | src/app/agent/tools/page.tsx:309-337 |
| Reference table | Read-only toolset ID catalogue. | R | src/app/agent/tools/page.tsx:490; src/app/api/tools/route.ts:33 |
| MCP | **None.** Only the `mcp` auxiliary model slot. "No MCP client" is an explicit scope decision. | — | org/VENTURE_BRIEF.md:184; src/components/models/DefaultsGrid.tsx:69-70 |

### 4.7 Memory (`/agent/memory`)
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Provider card | Provider (hindsight/holographic), host, port, bank; Test connection; saving writes `memory.provider`. | R/W | src/components/memory/MemoryProviderSettings.tsx:302-317; src/app/api/memory/config/route.ts:46-78 |
| Hindsight browser | Tabs Memories (50 recent, stale >90 d hidden until "Show stale") / Directives (CRUD, activate) / Mental Models (CRUD, refresh); Search, **Recall**, **Reflect** (60 s), **Add Memory**. | R/W | src/components/memory/HindsightBrowser.tsx:81-83; src/components/memory/hindsight/*.ts |
| Status | `GET /api/memory` stats or "Run: hermes memory setup". | R | src/app/api/memory/route.ts:86-90 |
| Built-in MEMORY.md / USER.md | Edited on Agents › Files, not here. | R/W | src/app/api/agent/profiles/route.ts:28-31 |
| Holographic | Fact count read from `memory_store.db`; no client. | R | src/lib/runtime/memory-db.ts:34-37 |
| Not present | Edit/delete individual memories (400), other providers (mem0 etc.). | — | src/app/api/memory/route.ts:86-88; docs/running/limitations.md:104-108 |

### 4.8 Cron / scheduling
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Automation page | Unified list of PatterStage schedules + host-crontab script rows: kind, owner (which scheduler), cadence, next, last, outcome, log link. | R | src/components/automation/AutomationList.tsx:94-116,372 |
| Schedule a mission | Mission, name, cron or "every Nm/h/d", presets, catch-up policy (fire_once/skip). | W | src/components/automation/AutomationList.tsx:46,199-273 |
| Row actions | Pause/Resume, Run (streams progress), Delete (confirm); host rows → "manage on Scripts". | W | src/components/automation/AutomationList.tsx:284,352,393-425 |
| SchedulePicker | Presets (Interval/Daily/Weekly/Monthly), custom builder, raw cron, next 3 fire times. | — | src/components/schedule/SchedulePicker.tsx:86-93,297,355 |
| Built-in scheduler | Lease in `meta`, 15 s tick, deterministic occurrence id (exactly-once), catch-up 120 s, interval 1 min–366 d, server-local TZ; heartbeat shown on dashboard ("Ticking, last tick 6s ago · pid" **[LIVE]**). | W | src/lib/orchestration/scheduler/tick.ts:30-251; src/lib/schedule/interval-bounds.ts:18,27 |
| Spend gate on unattended runs | Schedule tick / queue drain / Composer tick blocked by hard spend stop; attended clicks never blocked. | — | src/lib/spend/spend-guard.ts:35-79 |
| Scripts page | Lists `.sh/.mjs/.cjs/.js/.ps1/.bat/.cmd` in `PS_DATA_DIR/scripts`; New/Edit (256 KB), Run now (execFile, 10 min, 8 MB, blocking), Logs (400 lines), Schedule/Unschedule; example gallery (skeleton, http-ping, dir-backup). | R/W | src/app/work/scripts/page.tsx:71-310; src/lib/scripts/scripts-manager.ts:59-63,297,427 |
| Host crontab | Writes user crontab on Linux/macOS (fires without PatterStage); falls back to PS timer where no crontab ("Runs while PatterStage is running"). | W(host) | src/lib/host/host-scheduler.ts:36-90; src/components/scripts/ScheduleScriptModal.tsx:76 |
| API | `/api/schedules` (+`[id]`, `[id]/run`), `/api/scripts` (+`[name]`, `run`, `logs`), `/api/cron/hardware` | R/W | src/app/api/schedules/**; src/app/api/scripts/**; src/app/api/cron/hardware/route.ts:43-77 |
| Hermes native cron | **Not managed on dev** (main had a two-way jobs.json bridge with Agent/System tabs — `repo-main-cron-jobs.png`). | — | docs/running/env-reference.md:173 |

### 4.9 Tasks / Kanban / Missions / Orchestration
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Mission board (Kanban) | 5 columns draft / queued / dispatched / successful / failed; running timer, overdue warning; completed/failed collapse after 5; category + status filters, search; insights ring. | R | src/components/missions/MissionsList.tsx:212-484; src/lib/missions/mission-board.ts:2,18 |
| Quick-load templates | Collapsed panel ("N templates"); pills by category prefill composer; Manage categories / Edit Templates. | R | src/components/missions/MissionsList.tsx:121-164 |
| Mission composer (4 steps) | 1 Dispatch: Save draft / Queue / Run now / Schedule; 2 Parameters: working dirs (folder browser + git branch), references, recommended skills/toolsets (≤10), context, output format, constraints; 3 Runtime: profile, model/provider, scope, timeout (≤4320 min); 4 Assembled prompt preview (Human/AI). Save as template. | W | src/components/missions/MissionCreateForm.tsx:124-764; src/components/missions/DirectoryPickerModal.tsx:39 |
| Prompt format | `<hermes_mission>` XML: brief, dirs, refs, skills, toolsets, context, goals (GOAL_DONE), expected output, constraints, scope, safety, task. | — | src/lib/missions/build-mission-prompt.ts:4,161,213 |
| Detail panel | Facts, full template, schedule card (next/last/won't-fire reason), timing note, live run stream (SSE), result/error; Copy prompt, Duplicate, View sessions, Edit/Re-dispatch, Cancel/Remove from queue, Delete. | R/W | src/components/missions/MissionEditorPanel.tsx:64-407 |
| Queue & single-flight | Queue drain every 15 s, one dispatched mission at a time (Run now bypasses). | W | src/lib/missions/mission-repository.ts:125-136; src/lib/missions/mission-queue-tick.ts:30 |
| Cancellation | Local finalise first (mission failed "Cancelled by user", run cancelled, exit 143) then background `stopRun`. | W | src/lib/missions/cancel-finalise.ts:38,56 |
| Reconcile/deadlines | Timeout + 5 min grace; unreachable cap 120 min (`PS_RUN_MAX_MINUTES`); 404 for 2 min = lost; uncertain acceptance held "unconfirmed". | W | src/lib/orchestration/run-deadline.ts:19-24; src/lib/orchestration/run-reconcile.ts:211-362; src/lib/orchestration/dispatch.ts:119 |
| Categories & templates | 8 system categories, 12 seeded templates (General Task, Bug Hunt, Feature Build, Code Review, Deploy & Verify, Infrastructure Audit, Data Analysis, Research Brief, Content Draft, Regression Suite, Support Triage, Maintenance Sweep); custom templates in `PS_DATA_DIR/templates`; template-pack v1 import (API only). | R/W | data/seed/template-packs/patterstage-professional-v1.json; src/lib/templates-handlers/import-pack.ts:21 |
| **Composer** – Run tab | Workflow + profile pickers, objective with examples, "Review before launch" flags repo-writing stages; runs list with status filter incl. "Waiting for you"; live pipeline canvas; two-step cancel; deep link `?workflow=&runId=`. | R/W | src/app/work/composer/page.tsx:80-497; src/components/composer/ComposerRunForm.tsx:32-182 |
| Composer – HITL gate | Stage output + verdict, note, Accept (on_approve) / Reject (on_reject); note passed to redone stage. | W | src/components/composer/ComposerGatePrompt.tsx:105-113; src/app/api/composer/runs/[id]/nodes/[nodeId]/approve/route.ts:64-109 |
| Composer – Clarify | Stage emitting `OUTCOME: needs_clarification` + `QUESTION:` pauses run for an answer. | W | src/lib/composer/engine.ts:481; src/app/api/composer/runs/[id]/clarify/route.ts:25-49 |
| Composer – Build tab | React Flow editor: palette (Task, Research, Validate, Test, Group) drag-to-add, stage inspector (kind, instruction, research query, sub-workflow, input spec, HIL/Start/End), route inspector (condition: on_pass/on_fail/on_approve/on_reject/on_<outcome>/always), auto-layout (dagre), create/save/duplicate/delete; loops allowed (max 5 attempts/node, 100 steps/run), groups nest to depth 8. | W | src/components/composer/WorkflowCanvas.tsx:62-686; src/lib/composer/engine.ts:58-69,234,507; src/lib/composer/schema.ts:18,100 |
| Composer – verdicts & artifacts | `VERDICT: PASS|FAIL` parsing; deliverable saved as artifact; "Save as artifact" per node. | W | src/lib/composer/verdict.ts:12-64; src/lib/composer/engine.ts:332 |
| Seeded workflows | Software Delivery (16 stages), Research then summarise, Draft and review. | W | src/lib/composer/schema.ts:279,354,395 |
| Not present | No multi-agent parallel fan-out board, no Kanban of arbitrary tasks beyond missions, no workflow versioning, no server-side run pagination. | — | docs/running/limitations.md:144-145 |

### 4.10 Research & Artifacts (added area)
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Deep Research form | Question, model (agent default/registry), search (DuckDuckGo/SearXNG/none), depth 1-8, breadth 1-12; presets load/save (no delete). | W | src/app/work/research/page.tsx:55-278 |
| Engine | Plan → (search → visit top 2 → reason) × rounds → synthesise; honest failure + "Incomplete evidence" caveat; DNS-pinned fetching (ADR-0020, in flight). | — | src/lib/laboratory/deep-research/engine.ts:114-231; run-job.ts:36-128; org/decisions/ADR-0020-research-fetch-dns-pinning.md |
| Report | Brief, nav, clickable [n] citations, Sources, Timeline; Copy, View, Download HTML; Stop run. | R/W | src/components/research/ResearchReport.tsx:124-172; src/app/api/laboratory/research/[id]/{cancel,export,events}/route.ts |
| Artifacts | Grid (kind icon, source, size, age), filter All/Deep Research/Composer/Missions/Saved, escaped viewer sheet, download by mime, delete; polls 5 s. | R/W | src/app/results/artifacts/page.tsx:46-220; src/app/api/artifacts/**/route.ts |

### 4.11 Gateway & messaging platforms
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Platforms panel (dashboard) | cli, discord, telegram, slack, whatsapp, signal, homeassistant shown Configured/Not configured from `.env` token presence; link to `.env` section **[LIVE]**. "Sync now" forces all sync sources. | R/W(sync) | src/modules/hermes/components/PlatformsPanel.tsx:75-99; src/lib/sync/sources/EnvSync.ts:23 |
| Gateway health badge | Header "Gateway · Healthy/Degraded/Not running" mirrors Subsystems row with reason tooltip. | R | src/app/page.tsx:262-275 |
| Gateway gate row | Admission limiter stats ("1 admitted, 0 refused" **[LIVE]**). | R | src/lib/status/subsystems.ts; src/lib/runtime/gateway-gate.ts |
| Running processes | Cards for detected `gateway run` processes. | R | src/components/dashboard/ProcessesPanel.tsx:40 |
| Per-platform toolsets | Via Tools page (fan-out to 7 platform keys). | W | §4.6 |
| Platform config | Settings › Integrations › `discord` (auto_thread, reactions, require_mention), `streaming`, `human_delay`. | W | src/lib/config/config-schema.ts:304-328,352-361 |
| Not present | **No gateway start/stop/restart**, no per-platform token entry (.env is read-only/masked), no pairing/allow-list management, no channel routing UI. UI only tells you to run `hermes gateway start`. | — | src/components/chat/GatewayBanner.tsx:90-104; src/app/api/agent/files/[key]/route.ts:188,216 |

### 4.12 Files / Workspace / Terminal
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Agent behaviour-file editor | SOUL/AGENTS/USER/MEMORY/config.yaml/HERMES.md with backup. | R/W | §4.3 |
| Directory picker + git branches | For mission working dirs; restricted to home, PS_DATA_DIR, HERMES_HOME. | R | src/app/api/fs/list/route.ts:14; src/lib/fs/path-security.ts:53; src/app/api/fs/git/branches/route.ts:12 |
| Host script editor & runner | §4.8 (non-streaming output). | R/W | src/lib/scripts/scripts-manager.ts |
| Terminal backend settings | Settings › `terminal` (backend, timeout, persistent_shell, docker_image, container cpu/mem/disk). | W | src/lib/config/config-schema.ts:123-138 |
| Not present | No web terminal/PTY, no workspace file browser/editor, no diff viewer for agent edits, no file upload. | — | (absence across src/app) |

### 4.13 Config & environment
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Settings one-page | 7 groups / 27 sections: Core (agent, display, memory), Infrastructure (terminal, compression, browser, checkpoints, code_execution, logging), Security (security, privacy, approvals), Voice & Audio (tts, stt, voice), Automation (delegation, cron, session_reset, skills), Integrations (discord, streaming, web, platform_toolsets ro, smart_model_routing, human_delay), Files (hermes_md editor, env read-only masked). | R/W | src/lib/config/config-schema.ts:69-402; src/lib/config/config-sections.ts:27-101 |
| Search across settings | Filters sections by label/id/description/field; sticky nav (IntersectionObserver); phone: "Jump to section" select. | R | src/app/agent/settings/page.tsx:139-217; src/components/config/SettingsNav.tsx:52-76 |
| Per-section save | Changed keys only, client+server validation, Reset, UNSAVED badge, Clear (null deletes key), read-only nested keys disclosure, backup, 409 if file unparseable. | W | src/app/api/config/route.ts:27-176; src/components/config/ConfigField.tsx:182-185 |
| "Whose settings" card | Names whose config.yaml is edited; warns if selected profile differs. | R | src/app/agent/settings/page.tsx:61 |
| Restore page | Restore everything / Bob / add missing / one agent / one template / categories (pre-restore DB snapshot, refuses if snapshot fails); clear test clutter. | W | src/app/agent/settings/restore/page.tsx:119-516; src/app/api/seed/route.ts:29; src/app/api/seed/clean/route.ts:12 |
| System page | Install facts (auth mode, deploy API, read-only, composer, data dir, DB, Hermes home, gateway, port, schema, version, commit, node, platform) + "Copy for a bug report" **[LIVE]**; browser sessions; updates; DB backups (Back up now, list, copy restore command). | R/W | src/app/agent/settings/system/page.tsx:64-214; src/app/api/backup/route.ts:25,65 |
| Env vars | `PS_*` (CH_* legacy aliases through v1.0.0): data dir, auth, read-only, composer flag, search provider, gateway limits, run cap, deploy API, update branch. | — | docs/running/env-reference.md |
| Not present | No raw config.yaml editor, no per-profile Settings (edits active HERMES_HOME only), no `.env` editing. | — | docs/running/limitations.md:142-143 |

### 4.14 Observability (logs, usage, cost, analytics, health)
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Subsystems panel | Always 5 rows: Gateway, Memory, Sync, config.yaml, Gateway gate — state word + actionable reason + checked time **[LIVE]**. | R | src/lib/status/subsystems.ts; src/components/dashboard/SubsystemsPanel.tsx:69-81 |
| Stat pills | Scheduler heartbeat, Spend this month, Processes N Active. | R | src/app/page.tsx:325-346 |
| Errors panel | ERROR/CRITICAL lines from gateway.log/errors.log, All/Errors/Warnings, dedupe ×N. | R | src/components/dashboard/ErrorsPanel.tsx:33-75 |
| Logs page | File picker (core/system/other), terminal newest-first, auto-refresh 5 s, lines 100-1000, client filter + count, copy/download, "Latest lines", insights donut, written-ago, Delete All (truncate). | R/W | src/app/results/logs/page.tsx:63-348; src/components/logs/LogTerminal.tsx:30-117 |
| Insights | Range 7/30/90 d; tiles (interactions, active days, tokens, achievements); charts: activity by category, category donut, hour-of-day clock, duration histogram, success trend, tokens by model, top missions, mission mix, 91-day heatmap. | R | src/app/results/insights/page.tsx:43-389 |
| Spend & budget | Today/week/month USD, split by source (agent runs, Composer, Research, Story Weaver), estimated marks (15-family price table, fallback $1/$3 per Mtok); optional budget per day/week/month; warn at 80/100 %; hard stop for unattended work only; UTC windows; per-story spend note. | R/W | src/components/spend/SpendPanel.tsx:117-340; src/lib/spend/spend-law.ts:1-20; src/lib/analytics/model-cost.ts:37-58 |
| Analytics events | Server-only `analytics_events` (no client POST); read APIs analytics/insights/timeseries. | R | src/app/api/analytics/**/route.ts |
| Health endpoints | `/api/health`, `/api/healthz`, `/healthz` (unauthenticated liveness), `/api/status`, `/api/status/runtime`, `/api/status/subsystems`, `/api/monitor` (10 s cacheable snapshot). | R | src/app/api/health/route.ts:13; src/app/api/status/**; src/app/api/monitor/route.ts:39-156 |
| Audit log | Timestamp, action, resource, success (no actor). | W | src/lib/api/audit-log.ts; docs/running/limitations.md:31-35 |
| Not present | No dedicated Spend page, no server-side log search, no live log streaming (poll only), no OpenTelemetry/Prometheus export. | — | docs/running/limitations.md:134-152 |

### 4.15 Plugins / extensions
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| ProductModule seam | Internal modules (core, hermes, laboratory, rec-room) register nav, routes, accents through one contract; Rec Room is "first tenant". | — | org/decisions/ADR-0005-product-modules.md:31-39; src/lib/modules/registry.ts |
| AgentRuntime seam | Framework-agnostic runtime interface; only `HermesRuntime` implemented. | — | docs/reference/runtime-architecture.md:153-155; docs/running/limitations.md:89-92 |
| Memory provider registry | Pluggable; Hindsight only client. | — | src/lib/memory/memory-providers/registry.ts:29-35 |
| Feature flags | `GET /api/feature-flags` → `composer` only. | R | src/app/api/feature-flags/route.ts:16 |
| Not present | No third-party plugin install, no Hermes plugin management UI, no MCP. | — | org/VENTURE_BRIEF.md:184 |

### 4.16 Settings / Themes / i18n
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Theme | **Dark only** (Cherenkov blue palette); reader's light/sepia themes were removed. | — | src/app/globals.css:253-254; src/modules/rec-room/components/ReaderSettings.tsx:6-7 |
| Operator prefs | Install-wide: sidebar.collapsed, dispatchStrip.open, quests.completedAt/skipped, guide.hidden, help.lastSlug. | R/W | src/app/api/prefs/route.ts:12-24 |
| Reader settings | Serif choice (Literata, EB Garamond, Lora, Merriweather), sizes — localStorage. | R/W(browser) | src/modules/rec-room/components/ReaderSettings.tsx:34-81 |
| i18n | **None** (`lang="en"`, browser-locale dates, one hard-coded en-US). | — | src/app/layout.tsx:87; src/components/schedule/SchedulePicker.tsx:332 |

### 4.17 Auth / Security
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Sign-in page | Proxy-served 401 HTML, single "Operator token" field **[LIVE]** `live-signin-desktop.png`; redirects to `/agent/settings` after sign-in **[LIVE]**. | W | src/proxy.ts:142-190; src/app/api/auth/sign-in/route.ts:26 |
| Sessions | 30 min idle / 12 h absolute / restart; hashed; List & Revoke need fresh token; Sign out this browser. | R/W | src/lib/auth/session-store.ts:15-117; src/components/auth/SessionManager.tsx:37-117 |
| `?ps_token=` hand-off | URL token swapped for cookie, redirect to clean URL. | W | src/proxy.ts:300-321 |
| CSRF / CSP / framing | Exact Origin on cookie writes; nonce CSP `strict-dynamic`; XFO DENY; HTML no-store. | — | src/proxy.ts:31-49,347-362 |
| Throttle | 5 free failures then doubling penalty ≤15 s, shared across spoofed XFF. | — | src/lib/api/auth-throttle.ts:16-98 |
| Modes | token / none (host-exec routes 403) / read-only (unsafe methods 503); network startup guard. | — | src/lib/api/read-only.ts:31-34; src/lib/auth/public-origin.ts:10-51 |
| Request signing | Optional HMAC on `POST /api/update` only (no body coverage, disables in-app buttons). | — | docs/running/env-reference.md:97 |
| Data hygiene | Secrets masked in config GET; credentials stored **plain text in SQLite** + `.env`; PS_DATA_DIR 0700, DB 0600. | — | src/lib/models/credentials-repository.ts:5-7; docs/SECURITY.md:58 |

### 4.18 Updates / Maintenance
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Update badge | Rail footer version + "Update available" (git behind count, 5 min cache) → Settings › System. | R | src/components/layout/RailFooter.tsx:39-90 |
| Check / Install update / Rebuild / Restart | Branch dropdown (default `dev`); second click to confirm rebuild/restart; gated by `PS_ENABLE_DEPLOY_API`; status polled every 2 s ≤15 min, log tail on failure. | W | src/components/system/DeployControls.tsx:21-121; src/hooks/useVersionFooter.ts:107-329 |
| ps-deploy pipeline | git fetch/checkout/`reset --hard`, npm install, build, DB backup, migrate, Hermes registry/state import, seed merge, model sync, discover agents, restart. | W | scripts/tooling/ps-deploy.mjs:430-511 |
| DB backups | Manual snapshot; automatic snapshot before restore/purge/migration; restore is a shell step. | W | src/app/api/backup/route.ts; docs/running/backup.md |
| Migrations | Forward-only schema versions (43); retention prune is a manual CLI (`db:retention`), off by default. | W | docs/running/limitations.md:195-210 |
| Hermes updates | **Not handled** (no `hermes update` integration). | — | (absence) |

### 4.19 Misc / Unique
| Feature | What it does | Read/Write | Evidence |
|---|---|---|---|
| Quests | 32 quests / 7 chapters (get running → first backup), proved by recorded events/DB facts (never ticked by hand), skip/unskip, "can't attempt here" reasons, toasts, rail badge, dashboard "Start here" card **[LIVE]** `live-quests-desktop.png`. | R/W | src/app/quests/page.tsx:33-147; src/lib/quests/quest-defs.ts:95-510; src/lib/quests/quest-latch.ts |
| Achievements & streaks | 40 badges / 4 rarities (1,785 pts), trophy case, unlock toasts, daily streak. | R | src/lib/stats/derive.ts:134-335; docs/reference/achievements.md |
| Agent XP / levels | Per agent: XP from runs, tokens, active days, skills, toolsets, memory facts; 10 titles. | R | src/lib/stats/agent-experience.ts:37-75 |
| In-app Help | `/help` renders the docs corpus (start-here, guides per screen, concepts, reference) with search, prev/next; every page header has `?` to its guide; `?` key shortcut; ConceptHint dotted-underline glossary popovers **[LIVE]** `live-help-desktop.png`. | R | src/app/help/[[...slug]]/page.tsx:43-183; src/components/help/HelpLink.tsx:60-100; src/components/help/ConceptHint.tsx:38-118 |
| Story Weaver (Rec Room) | Library (filters, word counts), create (quick-start templates, theme + character libraries, POV, length, writing-model picker, local draft), reader (write next/keep writing/Stop/retry/edit chapter/continue, story Bible, read marks, reader typography), per-story spend. | R/W | src/app/recroom/story-weaver/**; src/app/api/stories/route.ts:44-75 |
| Empty-state actions | Empty pages offer the action (New Mission, Run Deep Research, Schedule a mission…). | — | CHANGELOG.md:119-125 |

---

## 5. Real-time & state model

| Concern | Behaviour | Evidence |
|---|---|---|
| Client data layer | One TanStack QueryClient per tab; defaults staleTime 10 s, refetchOnWindowFocus, retry 1. All reads via `useApiResource` (deduped by endpoint; `settled` distinguishes not-loaded vs failed). Writes via `runWrite` → one toast in the server's words, reload on success. | src/components/providers/FeedbackProvider.tsx:112-122; src/hooks/useApiResource.ts:1-180; src/lib/api/api-write.ts |
| Polling intervals | monitor 10 s; agents/missions/subsystems 15 s; stats 20 s (rail badge + toasts); analytics/spend/scripts/gateway health 30 s; artifacts 5 s; logs 5 s (toggle); composer/research detail 3 s, lists 4 s; sessions 10 s only while live; dashboard clock 30 s. | src/hooks/useDashboard.ts:87-137; src/hooks/useStats.ts:15; useArtifacts.ts:16; useComposer.ts:35-60 |
| SSE | `/api/runs/[id]/events` proxies Hermes run SSE (chat agent turns, mission live stream); `/api/composer/runs/[id]/events` and `/api/laboratory/research/[id]/events` push DB snapshots every 1 s (`state`, `: ping`, `end`); streams re-check auth every frame. | src/app/api/runs/[id]/events/route.ts:35-114; src/lib/sse/event-stream.ts:18-120; src/lib/auth/stream-guard.ts |
| Fast chat streaming | Streamed fetch body from `/api/orchestration/chat`. | src/lib/chat/chat-utils.ts:443 |
| Reconnection | Chat: on SSE drop, reconcile from server after 1.5 s; generic `useEventStream` falls back to polling. Server: RunSync polling is authoritative (15 s), so a lost stream never loses state. | src/hooks/useAgentRunStream.ts:152-163; src/hooks/useEventStream.ts:32-58 |
| Hidden tab | `useInterval` pauses while hidden and fires once on return. | src/hooks/useInterval.ts:36-67 |
| Server loops | 15 s SyncScheduler: Session/Process/Memory/Log/Env/Config sync with freshness windows (15–60 s), RunSync, ScheduleTick, ComposerTick, MissionQueueSync; 30 s per-source timeout; lease to avoid double scheduler. | src/lib/sync/SyncScheduler.ts:34-57; src/lib/sync/index.ts:44-68 |
| Multi-tab | No BroadcastChannel/storage listeners; each tab polls; server prefs are install-wide (two browsers share rail/quest state). | docs/running/limitations.md:36-40 |
| Offline | No offline mode/service worker; LoadErrorBanner + Retry; Help served from local files. | src/components/ui/LoadErrorBanner.tsx:38-60 |
| Persistence | SQLite (`patterstage.db`) for all domain state; localStorage for selected profile, session toggles, story draft, reader settings; cookies for auth. | docs/running/data-storage.md |
| Toasts | Global stack ≤3; errors persist (`role=alert`), success 4 s; achievement/quest toasts seeded silently on first poll. | src/components/ui/Toast.tsx:86-131 |

---

## 6. UX & visual design

- **Design system (dev):** "Cherenkov" dark palette (cherenkov-100…500 `#33ddff`→`#0071c2`; accents cyan `#00bfff`, purple `#a480ff`, pink `#e879f9`, green `#a3ff12`, orange `#ff6622`, yellow `#facc15`, danger `#f87171`), script-derived surface ladder (ground `#040b12`, panel `#1e3042`, raised `#2e4a66`) and edge ladder (≥3:1), text tiers white 92/70/55/50 % all ≥AA (src/app/globals.css:22-165; docs/contributing/design-tokens.md:46-90).
- **Typography:** Inter for prose, JetBrains Mono for "machine words" (labels, IDs, badges); 5-step scale micro 12/16 → display 28/34 (globals.css:167-210). Visual signature in screenshots: mono uppercase section labels, glowing card edges, grid background, scanlines.
- **Tokens:** radius 4/8/12, one raised shadow + glow, named z-ladder (sticky 10 … toast 70, tooltip 80), motion 120/200 ms (globals.css:212-377).
- **Enforcement:** `design-lint` (token-must-exist, no raw colours/alpha, type/radius/z scale only, no inline card chrome, one container per page, no raw fetch in components, native `confirm()` banned), contrast-check, design census ratchet at 1440×900, hit-target ≥24 px gate, reduced-motion gate (scripts/tooling/design-lint.mjs:15-512; tests/e2e/design-census.spec.ts; tests/e2e/hit-targets.spec.ts:21-22).
- **Layout patterns:** `AppPageShell` densities board/prose/pane, page measure 82 rem, sticky full-bleed page header with icon + title + prose subtitle + actions + always-present `?` (src/components/layout/AppPageShell.tsx:15-58; PageHeader.tsx:74-165); `SplitPane` list/detail; `DataList` table that restacks to cards; stat strips with rings/donuts.
- **Primitives:** Button/IconButton/LinkButton/ConfirmButton (two-step arm), Card, Badge, Dialog (center/right/bottom/sheet) + Modal/Sheet aliases, Popover, Picker, Select, SegmentedControl, CollapsibleSection, CategoryAccordion, DataList, Pagination, SplitPane, Skeleton, PageLoading, EmptyState, LoadErrorBanner, ErrorBoundary, LiveDot, AutoTextarea, Toast, ProfilePicker; field/ Input, NumberInput, SearchInput, Toggle (src/components/ui/**).
- **States:** skeleton body under a live header; EmptyState with the page's primary action; LoadErrorBanner (`role=alert` + Retry); ErrorBoundary + global error page; "LastResult" durable saved/failed line on settings pages (src/components/ui/*).
- **Copy:** three registers (novice/operator/internal), sentence case, ratified 13-word status vocabulary mapped to a 7-rung colour ladder, "Pull from Hermes / Push to Hermes" verbs, prose subtitles that explain consequences (docs/contributing/copy.md:21-76; globals.css:226-244). Very explanatory UI text throughout (e.g. Models info box, Agents profile explainer) **[LIVE]**.
- **Keyboard:** only global hotkey is `?` → help for current screen; Enter/Shift+Enter in chat; Escape closes dialogs. **No command palette** (deferred post-1.0) (src/components/help/HelpLink.tsx:60-100; docs/running/limitations.md:122-123).
- **Accessibility:** skip link, global `:focus-visible` 2 px cyan ring, deny-by-default reduced motion, dialog contract (stack-aware Escape, focus trap skipping undrawn, restore focus, scroll lock), `aria-current`, named icon buttons and form controls enforced by lint; non-text contrast gate (src/app/layout.tsx:109-122; globals.css:498-533,812-816; src/hooks/useDialogA11y.ts:17-160).
- **i18n:** none.

**Screenshots (live, isolated `dev`):**

| Desktop 1440×900 | |
|---|---|
| ![Dashboard](images/patterstage/live-dashboard-desktop.png) Dashboard: Start-here quest, 5-row Subsystems, Scheduler/Spend/Processes pills, progress line (streak, agent level, achievements), Launch-a-Mission strip | ![Agents](images/patterstage/live-agents-desktop.png) Agents: drift banner, Push all / Pull all / Import discovered, profile table with per-row push/pull |
| ![Missions](images/patterstage/live-missions-desktop.png) Missions board (empty state with New Mission / Load a template) | ![Composer Build](images/patterstage/live-composer-build-desktop.png) Composer Build: React Flow canvas, drag palette (Task/Research/Validate/Test/Group), minimap, auto-layout |
| ![Models](images/patterstage/live-models-desktop.png) Models: registry donut, credentials, models table with pull/push/edit/delete, agent default + bulk auxiliaries, fallback chain | ![System](images/patterstage/live-settings-system-desktop.png) Settings › System: install facts + Copy for bug report, browser sessions (paths shown are the throwaway /tmp sandbox) |
| ![Quests](images/patterstage/live-quests-desktop.png) Quests: chapters with progress ring | ![Help](images/patterstage/live-help-desktop.png) In-app Help: docs corpus with nav + search |
| ![Sign-in](images/patterstage/live-signin-desktop.png) Token sign-in page | |

**Repo screenshots (`dev` docs/images, 1440×900, generated by `npm run screenshots` against mocks):** `repo-dev-{dashboard,chat,missions,composer,research,scripts,automation,sessions,artifacts,insights,logs,agents,skills,tools,memory,models,settings,quests,help,story-weaver,story-create}.png` in `images/patterstage/`. Notable: `repo-dev-sessions.png` (session list with source donut and mission badges), `repo-dev-logs.png` (split file list + terminal with level ring), `repo-dev-insights.png` (spend tiles, category charts, achievements 1/40), `repo-dev-memory.png` (Hindsight provider card + Memories/Directives/Mental Models tabs), `repo-dev-tools.png` (toolset chips per platform), `repo-dev-story-create.png` (quick-start pills, theme & cast builders).

**Repo screenshots (`main` / Control Hub, ~1024 px wide, originally JPEG-in-.png, converted):** ![main dashboard](images/patterstage/repo-main-dashboard.png) `repo-main-dashboard.png` (live clock, Processes/Cron/Sessions/Memory-facts tiles, Mission Dispatch pills, Cron Jobs/Platforms/Errors panels, sidebar Check for Updates/Rebuild/Restart), `repo-main-missions-board.png` (Kanban + expanded mission card with prompt and Edit/Cancel), `repo-main-mission-create.png`, `repo-main-cron-jobs.png` (Hermes cron jobs.json manager), `repo-main-agent-profiles.png`, `repo-main-chat.png`, `repo-main-models-config.png`, `repo-main-skills-manager.png` (card grid with toggles).

---

## 7. Mobile & responsive support

**Status: deliberately responsive, not mobile-first, not a PWA.** All 21 routes rendered at 390×844 with **zero horizontal page overflow [LIVE]** (scripted `scrollWidth` check on every rail route; empty-data states).

| Aspect | Finding | Evidence |
|---|---|---|
| Breakpoints | Tailwind v4 defaults only. `sm:` ~60 lines/38 files, `md:` ~25/13, `lg:` ~55/24, `xl:` ~19/7; no `2xl`, no container queries; CSS media only for reduced motion + fine pointer; JS `matchMedia` at 767/1023 px. | src/app/globals.css:18-337; src/hooks/useIsMobile.ts:10-17; src/components/ui/SplitPane.tsx:32 |
| Shell tiers | <768: 3 rem sticky MobileHeader + 44×44 hamburger → left drawer `w-56` (`role=dialog`, `aria-modal`, inert when closed, backdrop button, closes on navigation) **[LIVE]** `live-nav-drawer-mobile.png`. 768–1023: forced 64 px icon rail. ≥1024: 224/64 px per persisted preference; collapse button only here. | src/components/layout/Sidebar.tsx:95-127,166-170,240-359 |
| Bottom nav | None. | src/components/layout/ (absence) |
| List/detail | <1024 list panes become a button ("Conversations (N)", "Log files", "Runs") opening a bottom sheet (`max-h-[92vh]`); Chat, Logs, Composer, Research, story reader chapters. | src/components/ui/SplitPane.tsx:1-115; src/components/ui/Dialog.tsx:72-116 |
| Headers | Actions wrap to own row below `sm`; back link arrow-only; subtitle wraps (`live-chat-mobile.png`, `live-dashboard-mobile.png`). | src/components/layout/PageHeader.tsx:85-162 |
| Tables | `DataList` restacks to labelled cards; SessionCard drops columns progressively; StatStrip one-liner on phone; Settings "Jump to section" select (`live-settings-mobile.png`). | src/components/ui/DataList.tsx:63-110; src/components/config/SettingsNav.tsx:54-72 |
| Touch targets | Hamburger 44 px; buttons 26/32/40 px; expanded rail rows ~24 px; `?` 24 px. Gate floor is 24 px (measured at desktop). | src/components/ui/button-chrome.ts:21-25; tests/e2e/hit-targets.spec.ts:21-22 |
| PWA / manifest / SW | **None** (no `app/manifest`, service worker, apple-touch-icon, `themeColor`). | glob of src/app, public/ |
| Safe area / viewport | No `env(safe-area-inset-*)`, no `viewport-fit=cover`, no `dvh/svh` (uses `vh`, `h-screen`, `min-h-screen`). Relies on Next default viewport meta. | grep of src; src/app/layout.tsx |
| Tests | Playwright `phone` project (390×844, hasTouch) runs `phone.spec.ts`: no sideways scroll at 390/1024 on every documented route, h1 width, split panes as sheets, chat composer ≥270 px, settings select. (limitations.md still claims desktop-only — stale.) | playwright.config.ts:40-58; tests/e2e/phone.spec.ts |
| Phone work in changelog | Header actions wrap, split panes → sheets, banner text before button, drawer focus-trap fix, tablet icon rail, settings jump select, sessions strip, log terminal bar, research picker row. | CHANGELOG.md:115-166,405-424 |

**What breaks or degrades at 390 px**
- **Composer Build canvas** — fixed 600 px board; the 144 px "Drag to add" palette overlays the canvas and the 288 px inspector cannot fit; HTML5 drag-and-drop palette is unlikely to work by touch [INFERENCE]; confirmed visually cramped **[LIVE]** `live-composer-build-mobile.png`. (src/components/composer/WorkflowCanvas.tsx:587-686)
- Fallback chain table `min-w-[480px]` scrolls sideways; chat model selector fixed 220 px; toasts `fixed right-6` without left bound (src/components/models/FallbackChainList.tsx:236-237; src/components/chat/ChatModelSelector.tsx:57; src/components/ui/Toast.tsx:131).
- `vh`-based dialogs/drawer + no safe-area padding under bottom sheets → iOS chrome/home-indicator clipping risk [INFERENCE].
- Most controls 24–32 px (below 44 px guidance); dense mono labels at 12 px.
- Desktop-centric density: dashboard is a long single column on phone (`live-dashboard-mobile.png`), Missions composer is a 4-step long form in a bottom sheet.

Mobile screenshots (390×844): ![dash](images/patterstage/live-dashboard-mobile.png) ![drawer](images/patterstage/live-nav-drawer-mobile.png) ![missions](images/patterstage/live-missions-mobile.png) ![chat](images/patterstage/live-chat-mobile.png) ![settings](images/patterstage/live-settings-mobile.png) ![composer build](images/patterstage/live-composer-build-mobile.png)

**main (Control Hub) mobile:** drawer below `lg` (1024) via two duplicated `<aside>`s, overlay div without dialog semantics/focus trap, no tablet tier, rail collapse not persisted, one desktop Playwright project (main:src/components/layout/Sidebar.tsx:812-835; main:playwright.config.ts:12-19).

---

## 8. Strengths
- **Deep orchestration layer:** missions with 4 dispatch modes, queue + single-flight, deadlines/reconcile, PatterStage-owned exactly-once scheduler, a graph workflow engine with loops, verdict routing, HITL gates and clarify pauses, plus deep research — all on Hermes' `/v1/runs` API rather than CLI scraping.
- **Two-way, drift-aware config sync** between its DB and `HERMES_HOME` (profiles, skills, toolsets, models, auxiliary slots, fallbacks, credentials) with `.bak` backups, atomic writes, semantic YAML diffing and field-level pull/push diffs.
- **Serious security posture for a local tool:** proxy-enforced token → session cookie, CSRF origin check, nonce CSP, frame denial, read-only mode, fail-closed network startup, host-exec routes refused in no-auth mode.
- **Honest, operator-grade UX copy and states:** every subsystem row says why; refused writes always toast the server's reason; empty states carry their action; schedule rows say which scheduler owns them; spend shows "estimated".
- **Onboarding and self-documentation:** 32 evidence-proved quests, per-screen `?` help served in-app from the same docs corpus, concept hint popovers.
- **Cost governance:** spend by source, optional budget with a hard stop that only blocks *unattended* work.
- **Engineering discipline:** registry-driven nav, enforced design tokens, contrast/hit-target/reduced-motion gates, phone viewport e2e, migrations with automatic backups.

## 9. Weaknesses, gaps & known issues
- **Not shipped/unstable:** no releases; `dev` (the real product) is unmerged (PR #157 open since 2026-06-04); `main` is 276 commits behind, MIT, and lacks authentication ("shipped an unauthenticated RCE chain once") [S5]; very high churn and heavy AI-governance overhead.
- **Model/profile routing gap:** a mission's chosen model/provider is recorded but not sent to Hermes; every profile resolves to the same single gateway (no per-profile gateway) (src/lib/orchestration/dispatch.ts:78-82; src/lib/runtime/endpoint-registry.ts:36-39).
- **No gateway lifecycle or messaging-platform management** (no start/stop, no token entry, no pairing); `.env` read-only.
- **No MCP, no Hermes native cron management, no skills hub, no web terminal/file browser, no command palette, no i18n, dark theme only, no PWA.**
- **Session limits:** sync-on-read, 2000-message cap without virtualisation, no message-body search, no session delete/resume (docs/running/limitations.md:124-133).
- Logs: client-side search only; DELETE truncates all Hermes logs; PatterStage writes its deploy logs into `~/.hermes/logs` (limitations.md:134-157).
- Skill editor drops SKILL.md frontmatter (docs/guides/skills.md:142-145); new skills enabled for every profile by default.
- Credentials stored plain text in SQLite and mirrored to `.env`; `.env.*.bak` files accumulate (src/lib/models/credentials-repository.ts:5-7).
- Settings edit only the active HERMES_HOME config.yaml, not a selected profile's [INFERENCE: later push could revert] (src/modules/hermes/lib/hermes-config-write.ts:88).
- Host-cron "disable" only writes a sidecar file; crontab keeps firing (src/lib/host/host-scheduler.ts:88-90).
- Process detection is host-wide (`ps aux`), not scoped to HERMES_HOME **[LIVE]**.
- Install-wide prefs (no per-user state); single shared token; audit has no actor (limitations.md:18-44).
- Update action does `git reset --hard`; Restart kills whatever owns the port (limitations.md:201-210).
- Doc drift: limitations.md says e2e desktop-only and "both start scripts bind every interface" while deploy.md/playwright config disagree; api.md subsystem list and achievement count stale; mission schema comment says JSON files / 120 min cap.
- Open issue #223: migration 004 `missions.queued_for_run` missing while schema_version=5 (silent drift) [S4]. Proposed tasks T-0195..T-0197, T-0201, T-0208 (chat Stop ignores refusal, composer/research draft ownership races, research cancel leaves NULL usage) (org/TASKS.md:210-220; org/reviews/2026-10-t0194-recon-defects.json).
- Deferred post-1.0: command palette, virtualised transcripts, Composer versioning, raw config editor, Task Scheduler backend, streaming script output, server-side log search, OpenAPI, dedicated Spend page, public help, story export (org/plans/2026-09-final-release.md:814-829).
- Mobile: Composer builder unusable on phones; small touch targets; no safe-area handling (§7).

## 10. Unique features (likely absent in other Hermes dashboards)
1. **Composer** — graph workflow builder/runner with loops, `VERDICT` routing, human approval gates with notes fed back, clarify pauses, nested groups, seeded "Software Delivery" 16-stage pipeline.
2. **Missions system** — structured `<hermes_mission>` prompt builder, 4 dispatch modes, Kanban board, template packs + categories, queue with single-flight, deadline reconciler, "unconfirmed" dispatch handling.
3. **PatterStage-owned scheduler + host-script scheduler** (user crontab or internal timer) with a unified Automation view of both.
4. **Deep Research lab** with search-provider choice (DuckDuckGo/SearXNG), depth/breadth, cited HTML reports → Artifacts store.
5. **DB-as-source-of-truth profile sync with drift detection**, field-level model pull/push diffs, credential rotation, 12 auxiliary task-model slots, fallback chain editor.
6. **Spend governance** — per-source spend, budget, hard stop for unattended work only.
7. **Gamification** — 32 evidence-proved quests, 40 achievements, streaks, per-agent XP/levels.
8. **In-app help corpus** with per-screen `?`, `?` hotkey, concept hint popovers.
9. **Story Weaver** creative-writing app (themes, characters, story Bible, chapter generation with Stop and per-story spend).
10. **Hindsight memory browser** (recall/reflect/directives/mental models).
11. **Seed catalogue + Restore page** (7 personas, 12 templates, skills, tool bundles) with pre-restore DB snapshots and test-clutter cleanup.
12. **Security envelope** (token→session cookies, CSRF, CSP nonces, read-only mode, session list/revoke) — stronger than typical local dashboards.

## 11. Design implications for the unified dashboard
**Preserve**
- Missions (structured brief + board + templates + 4 dispatch modes), Composer (gates/clarify/loops), Deep Research + Artifacts, Automation view merging all schedulers, Scripts.
- Run model built on Hermes `/v1/runs` + SSE with server-side reconcile as source of truth; HITL tool approvals in chat with streamed reasoning/tool cards.
- Drift-aware Push/Pull to Hermes with backups and field-level diffs; models registry with task slots + fallback chain + credential rotation.
- Subsystems panel with actionable reasons; spend-by-source + budget hard stop; per-screen help and quests-style onboarding (as an optional layer).
- Security envelope (session cookies from a token, CSRF/CSP, read-only mode) and "Copy for a bug report" install facts.

**Improve**
- Mobile-first shell: bottom tab bar for Work/Results/Agent, 44 px targets, safe-area insets, `dvh`, PWA manifest + service worker, push notifications for gates/approvals ("Waiting for you").
- Make Composer usable on touch: phone shows a read-only/linear run view and a list-based stage editor; reserve canvas for ≥1024.
- Add what PatterStage lacks: gateway start/stop + platform tokens/pairing, MCP servers, Hermes native cron, skills hub, command palette, light theme, i18n, message-body search, transcript virtualisation, per-profile routing of model/gateway.
- Keep its honesty copy patterns but reduce density (mono-uppercase labels everywhere, long explanatory boxes) for small screens.

**Mobile risks to plan for**
- Graph editors, wide tables (fallbacks, models), multi-step forms in bottom sheets, long dashboards, and hover tooltips (icon rail `title`). Host-exec features (scripts, deploy) need extra confirmation friction on phones.

---

## Sources
1. Repo (dev): https://github.com/Daniel-Parke/PatterStage/tree/dev — local `/tmp/dashboard-research/patterstage-dev` @ 6dc4ce1
2. GitHub API repo metadata: https://api.github.com/repos/Daniel-Parke/PatterStage
3. GitHub branches/releases: https://api.github.com/repos/Daniel-Parke/PatterStage/branches ; /releases (empty)
4. Issue #223: https://github.com/Daniel-Parke/PatterStage/issues/223
5. PR #157 (promote dev to main): https://github.com/Daniel-Parke/PatterStage/pull/157
6. Closed PRs incl. #234 /healthz, #201 benchmarks, #189 consolidation, #187/#188 HTTP runtime + scheduler: https://github.com/Daniel-Parke/PatterStage/pulls?q=is%3Apr+is%3Aclosed
7. Rename redirect: https://github.com/Daniel-Parke/hermes-control-hub (301 → PatterStage)
8. Repo (main): https://github.com/Daniel-Parke/PatterStage/tree/main — local `/tmp/dashboard-research/patterstage` @ 7b9d6d6
9. README.md, CHANGELOG.md, REBRANDING.md, TRADEMARK.md (dev)
10. docs/SECURITY.md; docs/running/{deploy,env-reference,limitations,data-storage,backup,migration,host-scheduling,cross-platform}.md (dev)
11. docs/reference/{api,runtime-architecture,schema,spend,quests,achievements,analytics-events,catalog-and-profiles}.md (dev)
12. docs/guides/*.md (21 per-screen guides), docs/concepts/*.md, docs/start-here/*.md, docs/contributing/{design-tokens,copy,testing}.md (dev)
13. org/STATE.md, org/TASKS.md, org/QUESTIONS.md, org/VENTURE_BRIEF.md, org/HANDOVER.md, org/plans/2026-09-final-release.md, org/plans/2026-09-ui-overhaul.md, org/decisions/ADR-0001…ADR-0020 (dev)
14. Source files cited inline under src/app/**, src/app/api/**, src/components/**, src/hooks/**, src/lib/**, src/modules/**, src/proxy.ts, src/instrumentation.ts, next.config.ts, playwright.config.ts, tests/e2e/**, scripts/tooling/**, data/seed/** (dev)
15. main: docs/{API,CONTROL_HUB,MISSIONS,TOOLS_AND_MISSIONS,CATALOG_AND_PROFILES,HERMES_CONFIG_INTEGRATION,SYSTEM-CRON,PLATFORM_VISION,USER_WALKTHROUGH_GUIDE,design-tokens,DEPLOY,SECURITY}.md; main:.hermes/plans/2026-05-25_121807-cron-missions-chat-refactor.md; main:src/lib/api-auth.ts; main:src/lib/backends/hermes.ts; main:src/app/api/cron/route.ts; main:src/components/layout/Sidebar.tsx
16. Hermes Agent docs: https://hermes-agent.nousresearch.com/docs (API server / gateway context)
17. Live isolated run of dev (2026-10-06, port 42199, fake HERMES_HOME) — screenshots in `images/patterstage/live-*.png`
