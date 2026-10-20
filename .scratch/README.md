# Caduceus Dashboard — implementation tickets

**Tracker:** local markdown, one folder per milestone, one file per ticket. `/setup-matt-pocock-skills` has not been run, so no tracker config exists. The design is `docs/design/` (decisions D1–D10, milestones). Feature coverage is in `docs/design/feature-traceability.md`.

**Reference form:** `M1 #03` means `.scratch/m1-chat/issues/03-*.md`. Within a folder, tickets are numbered in dependency order (blockers first).

**Frontier:** a ticket can start when every ticket it is blocked by is done.

## Rules every ticket inherits
- **Help.** M1 #02 (help framework) is a prefactor. After it, every module registers a help page and its glossary terms, and a test enforces this.
- **Internationalisation is deferred by the owner (2026-10-08).** Write plain English UI strings. Wherever a ticket's criterion mentions message catalogues, "strings via catalogues", locales or translation, that part does not apply: tick the rest of the criterion and note "catalogue part deferred (owner)". M1 #01 and M7 #08 are deferred, and M1 #01's partial work is parked on the branch `wip/m1-01-i18n`. Keep using logical CSS properties.
- **Policy and gates.**
  - Every Hermes call goes through the policy proxy with its risk tier (T0 undo · T1 confirm · T2 passkey step-up · T3 step-up + typed confirmation), using the shared confirmation dialog.
  - Every screen registers through the module registry.
  - Every screen passes the M0 #05 gates: phone 390, small phone 320, tablet 820 and desktop 1440; no overflow; axe clean; hit targets; tokens only. Run `npm run lint:ui` and the browser check `.scratch/m0-foundation/m0-05-smoke/ui-gates.mjs` (see AGENTS.md). Tickets that change colour or shell chrome run it in every skin, light and dark (`m0-07-smoke/gates-matrix.mjs`).
- **Data and behaviour.**
  - Hermes is the source of truth (D1): no copies of Hermes data, only Caduceus-owned concepts in the Caduceus store.
  - Phone behaviour follows `mobile-and-interaction.md`.
  - Empty states carry their primary action.
  - Gestures always have a visible alternative.
- **Settings search.** Any module that adds settings registers search metadata for Settings search (M1 #20).
- **Kanban writes.** Hermes's Kanban REST API can't set some task fields: completion contract, branch name, max retries, initial status, and the workflow tag fields. For those, the Caduceus server calls the `hermes kanban create` command line with a fixed argument list (no shell), scoped to the profile and board. This is Hermes's own interface, so D2 still holds. Playbook stages are tagged through `idempotency_key` until Hermes accepts `workflow_template_id` / `current_step_key` on create (see the architecture doc).

## M0 — Foundation (`m0-foundation/`, approved)
01 walking skeleton · 02 pinned contracts · 03 password sign-in · 04 passkeys & step-up · 05 app shell & gates · 06 palette · 07 appearance · 08 policy proxy · 09 live gateway connection · 10 spike: caduceus source · 11 Health & Repairs · 12 installable PWA · 13 tailnet production run

## M1 — Chat (`m1-chat/`)
| # | Ticket | Blocked by | Delivers |
|---|---|---|---|
| 01 | Internationalisation foundation (**deferred by owner**) | M0 #05, M0 #07 | Message catalogues (ICU plurals, dates, numbers); Settings › Language with English + pseudo-locale; RTL through logical CSS; lint bans hard-coded strings; M0 screens migrated |
| 02 | Contextual help framework | M0 #06 | Modules register help pages; `?` opens help for the current screen; glossary pop-ups; help searchable in the palette; a test fails when a module lacks help; help for M0 screens |
| 03 | Chat tracer bullet: new chat, streamed reply, resume | 02, M0 #09, M0 #10 | Start a chat in the scoped profile, stream a reply, stop it, see it in a minimal session list. Reload or drop the connection and resume mid-turn. Caduceus holds the upstream for a 10-minute grace period |
| 04 | Rich transcript rendering | 03 | Markdown, highlighted code, maths, Mermaid, sortable/filterable tables, JSON/YAML trees, media, lightbox. Virtualised end-anchored transcript with jump-to-latest, auto-follow, load earlier, desktop outline |
| 05 | Agent activity: reasoning, tools, subagents, todos | 04 | Reasoning cards; tool cards (args, diffs, failures); subagent cards; Todo panel; activity modes Worklog / Stream / Final only; tokens/sec and per-reply usage; memory/skill-saved toasts |
| 06 | Approvals and clarify questions | 03, M0 #08 | Typed approval decisions (once / session / always / deny with reason), inline on desktop and as a sheet on phone. Step-up for Always and YOLO. Clarify with choices, free text and countdown. Pending requests restored on resume |
| 07 | Run control: steer, queue, interrupt, side tasks, goals | 03 | Busy-composer split control; editable/cancellable queued messages; `/btw`; `/background` with completion badge; `/goal` with goal panel |
| 08 | Composer chips, config sheet and context ring | 03 | Profile / model / reasoning / workspace / toolsets chips with a model picker; phone config sheet; context ring with cost, cache and Compress; credential warning; customisable chip order |
| 09 | Slash commands, path references and selection actions | 08 | Slash menu from Hermes's command catalogue (skills, personalities, retry, undo, title…); `@path` and `~/` autocomplete; Reply-with-selection and Refine chips |
| 10 | Attachments | 08 | Images (paste/drop), files, PDFs, archives unpacked in the browser, up to 20 per message; large paste becomes a Markdown attachment |
| 11 | Drafts and saved prompts | 08 | Drafts saved on the Caduceus server per session and shared across devices, with a draft indicator; saved-prompts library |
| 12 | Message actions and turn recovery | 04 | Copy, edit-and-resend, regenerate, fork from a message, retry, undo; failed-turn bubble with retry; interrupted-turn recovery; auto-title and regenerate title |
| 13 | Sessions list | 03 | Date groups, pinned, unread, live and failed markers, density; source and category filters (Chats / Automation, failed-only, hide API noise); cross-profile toggle; stats strip; live updates; j/k; pull-to-refresh; phone list layout |
| 14 | Session organisation and bulk actions | 13, M0 #08 | Hermes projects (create, rename, colour, move into); pin, archive, unread, rename, delete; bulk select; delete empty; prune; phone swipe and long-press with menu alternatives |
| 15 | Session search and transcript tools | 13, 05 | Full-text search with highlighted snippets in the list and the palette; jump to first hit; role filters; in-transcript search; expand/collapse all; copy transcript |
| 16 | Sessions from other surfaces | 13, 04 | Open CLI, messaging, cron, Kanban-worker and Claude Code sessions; import and continue, or branch read-only ones; message-level live refresh through Caduceus relay; previous segments; handoff summaries |
| 17 | Duplicate, worktree sessions, export/import, deep links | 12, 13 | Duplicate a session; start a session in a new git worktree and remove it safely; export Markdown / JSON / themed HTML; import JSON/JSONL; `/chat/new?prompt=&profile=` links |
| 18 | Fast chat mode | 08 | Raw-model replies without tools through one-shot calls, with model choice and a clear label that they are not saved in Hermes history |
| 19 | Terminal mode (desktop) | 03, M0 #08 | Hermes TUI in a terminal pane behind step-up; keep-alive reattach; theme-aware; copy-last; shortcuts; shares the session with native chat; hidden on phones |
| 20 | Chat behaviour settings and settings search | 08, 13 | Send key, sound, timestamps, density, pin limit, auto-follow and other toggles; nav-order customisation; search across all of Settings |

## M2 — Inbox + Push (`m2-inbox-push/`)
| # | Ticket | Blocked by | Delivers |
|---|---|---|---|
| 01 | Inbox tracer bullet: live approvals and questions | M1 #06 | Caduceus's observer connection surfaces pending approvals and clarify questions from every active session across profiles. Inline Allow once / Deny / Answer. The badge counts only decisions. Items resolve when answered elsewhere. `/inbox/:id` opens the decision |
| 02 | Inbox sources, grouping and activity feed | 01 | Cron failures, overdue jobs and stale scheduler; pairing requests; gateway down; resource pressure; missing key; update available; finished runs. Groups (Needs decision / Failed / FYI); category and profile filters; per-device snooze and dismiss; swipe gestures with menu alternatives |
| 03 | Web Push notifications | 02, M0 #12, M0 #13 | VAPID keys; per-device subscriptions after a meaningful action (on iOS, after install); categories and quiet hours; presence-aware suppression; server-side dedupe; declarative payloads with service-worker fallback; deep link to the decision; app badge; test notification; per-source overrides |
| 04 | Home overview | 01, M1 #07, M1 #13 | Waiting-for-you strip; running now with steer/stop; health chips; spend tile; recent sessions; connected platforms; quick launch |

## M3 — Work (`m3-work/`)
| # | Ticket | Blocked by | Delivers |
|---|---|---|---|
| 01 | Board tracer bullet | M0 #08, M0 #09, M1 #02 | Live Hermes Kanban board (columns, cards, lanes by status/profile, filters); phone status-list and columns variants; read-only task peek; live via Kanban events |
| 02 | Board operations and dispatcher | 01 | Move to / Assign / Priority sheets; drag on large screens; multi-select bulk actions (T2); boards create / rename / archive / export / import / switch; dispatcher mode, nudge and settings; diagnostics; stats; active workers; reclaim |
| 03 | Tasks list with saved filters | 01 | Dense table on wide screens, restacked cards on phones; saved filters (mine, waiting for me, failed, by playbook, by project) kept in the URL |
| 04 | Task detail | 01, M1 #05 | Tabs Brief / Runs (list) / Activity / Links / Attachments / Settings. Run now, terminate, retry, specify, decompose, reassign, reclaim. Comments with the author stamped by Caduceus; live status from Kanban events |
| 05 | Schedules list and job detail | M0 #08, M1 #02 | Cross-profile Hermes cron list with type badges, next fire, last result and stale-scheduler warning. Job detail with run history and output; run now, pause/resume, duplicate, delete, copy diagnostics |
| 06 | Schedule builder and job types | 05 | Create/edit with interval / daily / weekly / monthly / once / cron and a next-3 preview (DST-safe). Job types: agent prompt; create task (recurring tasks); blueprint, from the gallery |
| 07 | Brief editor and dispatch modes | 04, 06 | New-task brief with sections and structured fields (assignee, model, reasoning, skills, workspace dir/worktree + branch picker, runtime, retries, goal mode, completion contract). Save draft / Queue / Run now / Schedule. "Make this a task" from chat |
| 08 | Task templates and categories | 07 | One-stage templates stored by Caduceus; categories; 12 seeded templates; start from a template; save a task as a template |
| 09 | Work in the Inbox and notifications | 04, 05, M2 #02, M2 #03 | Review, needs-input, gave-up and failed tasks plus cron failures as Inbox items with Approve / Reject + note / Answer / Retry / Reassign; push categories for reviews and blocked work; per-job notification toggle |
| 10 | Projects and spaces | M0 #08, M0 #09, M1 #02 | Hermes projects tree and project overview (repo, git, docs, linked boards); workspace registry (add, rename, reorder, remove) feeding the composer workspace chip and task workspaces |
| 11 | Run view | 04 | `/work/runs/:runId`: step list with outcome, duration and cost per step; live worker log through Caduceus relay (end-anchored, jump to latest); per-step transcript sheets with Chat's cards; Open in Chat; Terminate / Reclaim / Retry |
| 12 | Script jobs and advanced job options | 06 | Script job type with an editor that writes into the profile's scripts folder (T3, path-guarded); script output as prompt context; monitor_script / monitor_url, context_from, deliver-to, failure delivery, attach-to-session and workdir options |

## M4 — Agents (`m4-agents/`)
| # | Ticket | Blocked by | Delivers |
|---|---|---|---|
| 01 | Profiles list and overview | M0 #08, M1 #02 | Profile cards with gateway status; overview (counts, runs, success rate, tokens); use in this tab; make default (T2); rename; delete (T3); copy CLI command; description with auto-describe; assistant display name |
| 02 | Profile file editors | 01 | SOUL, AGENTS/HERMES, MEMORY/USER (sizes, limits, reset) and raw config.yaml, with preview / edit / split, unsaved guard, snapshot before every write and restore of the previous version |
| 03 | Model picker, main model and auxiliary slots | M0 #08, M1 #02 | Shared model picker over the live catalogue (search, groups, capabilities, refresh); main model per profile; reasoning default; max output tokens; every auxiliary slot Hermes reports |
| 04 | Installed skills and editor | M0 #08, M1 #02 | Browse / search / toggle / categories per profile; skill detail with linked files; create/edit SKILL.md; uninstall/delete; usage stats |
| 05 | Skills hub, learn-a-skill and curator | 04, M1 #03 | Hub search across sources; featured; detail with the security-scan verdict before install; install / update all with live logs; learn-a-skill into chat; curator status / pause / run |
| 06 | Toolsets and tool routing | M0 #08, M1 #02 | Toolsets grid with setup state; configure drawer (provider, keys, run setup with live log); per-platform toolsets and advanced JSON; tool-gateway routing card |
| 07 | MCP servers and catalogue | 06 | Add HTTP / SSE / stdio servers (stdio is T3); edit; OAuth authenticate; test with tool inventory; enable/disable; delete; searchable catalogue install with env prompts |
| 08 | Shell hooks and terminal backends | 06 | List / create (T3) / remove shell hooks; per-profile terminal backend (local / ssh / docker) and remote-aware workspace paths |
| 09 | Memory, context engine and learning graph | 02 | Memory provider selection with dynamic config forms and OAuth; context engine; built-in memory overview and reset; learning graph; project context and LLM Wiki |
| 10 | Hindsight browser and external notes | 09 | Hindsight memories / directives / mental models with recall, reflect and add through the Caduceus proxy; MCP-backed external notes sources with search and preview |
| 11 | Caduceus as an MCP server | 07, M0 #09 | stdio MCP server that lets agents list/create/rename/delete Hermes projects and list/rename/move sessions through Caduceus's policy layer; "Add to this profile" uses the MCP add flow |
| 12 | Profile builder, personas and export/import | 01, 03, 04, 07 | 5-step builder (identity, model, skills, MCPs, review); start from a seeded persona or a clone; export (T3) and import profiles |
| 13 | Mixture-of-Agents, fallback chain and usage cards | 03 | Mixture-of-Agents presets (view, edit, default); fallback chain editor (add, remove, reorder with buttons); per-model usage cards for 7/30/90 days with Use as… |
| 14 | Local models | 03 | Hermes local models (llama.cpp / GGUF / HF): list, download with progress, load/unload, delete (T1), use as main or auxiliary model, on desktop and tablet |

## M5 — Operate (`m5-operate/`)
| # | Ticket | Blocked by | Delivers |
|---|---|---|---|
| 01 | Gateway control | M0 #08, M1 #02 | Per-profile gateway status; start / stop / restart (T2); running processes; restart-to-apply banners; multiplexed-gateway migration with blockers |
| 02 | Channels | 01 | 23+ platform cards with status, enable, test, configure (validated fields, redacted values) and platform behaviour settings |
| 03 | QR onboarding | 02 | Telegram "Create with QR" and WhatsApp "Pair with QR" with allowed users |
| 04 | Pairing and webhooks | 01 | Pending/approved DM pairing with approve (T2), revoke and clear; webhook receiver and subscriptions with one-time secret, enable/disable and delete |
| 05 | Insights and budgets | M1 #02, M2 #03 | Token / cost / cache analytics with charts (periods; by model, source and profile); activity heatmap and hour-of-day; top skills; provider quota and spend pace; budget definitions with 80/100% alerts to Inbox and push |
| 06 | Logs | M0 #08, M1 #02 | File / level / component filters; structured query; server-side search; live-tail relay with pause and jump-to-live; download; copy; deep links; truncate (T3) |
| 07 | Health completion | M0 #11, M2 #04 | Full subsystem panel with actionable reasons; host stats; resource-pressure banner; Home errors panel; recurring-failure flags; Repairs count on Settings |
| 08 | Config form | M0 #08, M1 #02 | Schema-driven config with search and @modified / @profile / @restart-required filters; per-field deep links; reset to default; diff review; save (T3); restart prompt |
| 09 | Raw YAML and config import/export | 08 | Raw YAML editing with validation on larger screens; read-only with handoff on phones; staged import; export; scoped reset |
| 10 | Keys, OAuth and credential pool | M0 #08, M1 #02 | Provider keys (masked; reveal is T3 with auto-hide; replace; remove); OAuth device-code logins and disconnect; credential pool; custom endpoints; Nous Portal card |
| 11 | Hermes plugins | M0 #08, M1 #02 | Installed plugins (enable, update, remove); install from git (T3); curated catalogue |
| 12 | Updates | M0 #11, M1 #02 | Check and update Hermes with Caduceus drain and live log; Caduceus self-update; What's New summaries; update-available banner |
| 13 | Diagnostics and operations | M0 #08, M1 #02 | Doctor; security audit; prompt size; config migrate; support dump; redacted debug share (T3); install facts with copy-for-bug-report; restricted `hermes>` console (T2); restart Caduceus server; API reference from the pinned contracts |
| 14 | Backup and restore | M0 #08, M1 #02 | Create and download backups (T3); restore from upload or path (T3) with Caduceus drain; checkpoint storage count and global prune (T2) |
| 15 | Security completion | M0 #13, M1 #02 | Additional sign-in methods (OIDC; Tailscale identity sign-in); audit-log viewer |
| 16 | Onboarding wizard | 10, M2 #03 | First-run checks (Hermes, provider, gateway, HTTPS/install, passkey); provider setup; default workspace; notifications opt-in; resumable |

## M6 — Orchestrate (`m6-orchestrate/`)
| # | Ticket | Blocked by | Delivers |
|---|---|---|---|
| 01 | Playbook definitions and library | M3 #08 | Extends the M3 #08 template library and storage: multi-stage definitions, versioning, schema validation, detail with stage list and inspector, YAML view; seeds Software Delivery (16 stages), Research → summarise, Draft → review |
| 02 | Playbook engine tracer bullet | 01, M3 #04 | Run form from inputs; a run creates tagged Kanban tasks; the Caduceus engine (single-writer lease) advances linear stages on Kanban events; run timeline with task links; restart-safe |
| 03 | Gates, verdicts and loops | 02, M3 #09 | Human gates as review tasks in the Inbox; approve, or reject with a note fed to the rework attempt; on-fail routing (judge, contract, VERDICT); bounded loops; clarify pauses; re-run from stage |
| 04 | Graph view and parallel groups | 03 | DAG at ≥1024 px with labelled edges, loops and parallel groups; keyboard navigation and a list alternative; compact and raw run views |
| 05 | Deep Research and Artifacts | 02, M1 #05 | Seeded research playbook (question, depth, breadth) producing a cited report; Artifacts store and screen (filter by source, viewer, download, delete); the chat context panel's Artifacts tab |
| 06 | Budget guard | M2 #03, M3 #02, M3 #05, M5 #05 | Hard stop for unattended work: pause the dispatcher and unattended cron jobs on breach; record and undo only its own actions; alerts; guard state in Insights; attended chat never blocked |

## M7 — Workspace & media (`m7-workspace-media/`)
| # | Ticket | Blocked by | Delivers |
|---|---|---|---|
| 01 | Files | M0 #08, M1 #02 | Browse managed roots; previews (code, Markdown, CSV, images, media, PDF, sandboxed HTML); edit text (guarded; T3 for protected areas); upload; new folder; delete; download; phone card list |
| 02 | Move, rename and Office editing | 01 | Caduceus-guarded move/rename and in-browser Office document editing and save, inside Hermes's allowed roots |
| 03 | Git panel | M0 #08, M3 #10 | Status; diff (unified on phone, split on desktop); stage/unstage/discard (T3); AI commit message; commit; fetch / pull / push (T3); branches; worktrees |
| 04 | Checkpoints | M0 #08, M3 #10 | Agent checkpoints per workspace: list, diff and restore (T3). Pruning lives in M5 #14 |
| 05 | Terminal shell | M0 #08, M1 #02 | Real PTY shell provided by Caduceus behind T2 step-up; multiple viewers; resize, copy, restart; tablet and desktop, with an explicit "open anyway" on phones |
| 06 | Share links | M1 #04 | Create/revoke read-only snapshot links for a session; tailnet-reachable renderer; expiry; active shares listed in Settings › Security |
| 07 | Voice | M1 #10 | Dictation (browser or server transcription); phone hold-to-talk; hands-free voice mode; read-aloud and auto-read; raw audio messages; voice settings |
| 08 | Additional locales (**deferred by owner**) | M1 #01 | Ship the union of Dash (17) and WebUI (15) locales through the catalogue pipeline; RTL verified with Arabic; untranslated-key report |

## M8: The Desk (`m8-desk/`)
Owner decisions (2026-10-19): build the Desk design (`docs/design/mocks/desk/`); keep sessions visible.
|#|Ticket|Blocked by|Delivers|
|---|---|---|---|
| 01 | Sigils, crew state and the Desk skin | none | Sigil component, pure crew-state module, Desk skin, typeface decision |
| 02 | Shell: Today, Talk, Work and the crew | 01 | Four destinations, crew list, phone bridge, Control |
| 03 | Today | 01, 02 | Needs you, Ready, schedule, away, crew tiles |
| 04 | Talk: an agent's thread, sessions kept | 01, 02 | Agent thread, session list, Details panel and sheet |
| 05 | The decide-anywhere tray | 03, 04 | Other agents' decisions answerable in any thread |
| 06 | Composer intents | 04 | Ask, Delegate, Repeat |
| 07 | Work by state | 01, 02 | State groups, agent filter |
| 08 | Cutover and docs | 03-07 | Retire Home and Inbox list, docs, budgets |
| 09 | A calmer Talk | 04, 06 | Composer with one context button and a split Send, a titles-only session rail, Details closed by default |
