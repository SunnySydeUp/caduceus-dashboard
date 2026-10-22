# Caduceus Dashboard — Architecture

**Inputs:**
- Decisions D1–D8 (see `README.md`).
- `../research/hermes-protocol.md`: the JSON-RPC gateway, transport, auth, replay and security.
- `../research/hermes-api-coverage.md`: REST coverage, companion requirements R1–R11, hosting and friction tiers.
- `../research/industry-patterns.md`: ranked requirements in §12.

Hermes paths are relative to `~/.hermes/hermes-agent/`.

## 1. Shape of the system

```mermaid
flowchart LR
  subgraph Devices
    P[Phone PWA]
    D[Desktop / tablet browser]
  end
  P & D -- "HTTPS  https://<node>.ts.net:9443 (tailnet only)" --> TS[Tailscale Serve\n--https=9443]
  TS -- "http://127.0.0.1:9130\n+ Tailscale-User-Login" --> CS
  subgraph CS[Caduceus server — TypeScript BFF, launchd]
    ST[Static PWA + SW]
    AU[Auth: passkeys · sessions · step-up · read-only]
    PX[Policy proxy: REST + WS\n(method allowlist, risk tiers, audit)]
    WK[Workers: push watcher · playbook engine · budget guard\n(single-writer lease)]
    CA[Caduceus API /_caduceus/api/*]
  end
  CS -- "X-Hermes-Session-Token / ?token=\nloopback only" --> HS[hermes serve\n127.0.0.1:9131 (child, per-spawn token)]
  HS --> HH[(HERMES_HOME\nstate.db · kanban.db · cron · profiles · config)]
  GW[hermes gateway\nmessaging · cron ticker · kanban dispatcher] --> HH
  CS --> CD[(HERMES_HOME/caduceus/\ncaduceus.db · playbooks/*.yaml · artifacts/ · vapid.json)]
  CS -- "Web Push (RFC 8030/8291)" --> PUSH[(APNs / FCM / Mozilla)]
```

There are three runtime pieces on the Hermes machine:

1. **Hermes, unchanged.** It is the source of truth (D1):
   - a `hermes serve` backend that the Caduceus server spawns, holding REST, `/api/ws` JSON-RPC and in-process agents for interactive chat;
   - the existing `hermes gateway`, which handles messaging platforms and runs the cron ticker and the Kanban dispatcher.
2. **The Caduceus server (BFF).** A single TypeScript process bound to `127.0.0.1`. It serves the PWA, owns Caduceus authentication, and proxies Hermes behind a policy layer. It also runs the few background workers Hermes lacks.
3. **Tailscale Serve.** It provides HTTPS on a tailnet-only port. Port `:443` on this node is already a public Funnel, and Funnel can only use 443, 8443 and 10000, so Caduceus uses **9443** (`hermes-api-coverage.md` §6).

### Why this shape (rejected alternatives)

| Option | Verdict | Reason |
|---|---|---|
| PWA on its own origin calling Hermes directly | ✗ | Hermes CORS allows only `localhost`; cookies are `SameSite=Lax`; WebSocket `Origin`/`Host` must match (`hermes_cli/web_server.py:388-395, 548-572`; `web_server_chat.py:165-189`). Verified live: a foreign Origin gets 403 (`hermes-protocol.md` §11) |
| Same-origin reverse proxy only (no Caduceus server), using Hermes's login gate | ✗ | No Web Push: Hermes events reach only connected sockets. No passkeys, session revoke, read-only mode, method allowlist or Caduceus-owned state (drafts, playbooks, budgets) |
| Companion as a Hermes dashboard **plugin backend** | ✗ | Mounted once at startup, so every update restarts the process that hosts live chats. Runs in the agent's event loop and is mounted in every backend process, so workers would run more than once. No backend contract version (`hermes-api-coverage.md` §4.1) |
| WebUI-style in-process import of agent internals | ✗ | D2. Causes stale-agent 409s, `os.environ` mutation per turn and crash loops after updates (`hermes-webui.md` §9) |
| **BFF + spawned loopback `hermes serve`** | ✓ | This is the launcher contract Hermes Desktop uses: a per-spawn `HERMES_DASHBOARD_SESSION_TOKEN` that `.env` can never override (`hermes_cli/env_loader.py:57-62`). One origin. The token never reaches the browser. One backend serves all profiles through `?profile=` / RPC `profile` |

## 2. Data ownership (D1)

| Data | Owner | Where | Caduceus access |
|---|---|---|---|
| Profiles, SOUL/AGENTS/MEMORY/USER, config.yaml, .env, auth.json | Hermes | `HERMES_HOME[/profiles/<p>]` | REST (`/api/profiles*`, `/api/config*`, `/api/env*`, `/api/fs/*`), RPC `profiles.*` |
| Sessions, messages, usage, pins, archive, unread, projects | Hermes | `state.db`, `projects.db` | RPC `session.*` and `projects.*`; REST `/api/sessions*` (FTS, paging, `PATCH` flags), `/api/analytics/*` |
| Tasks, runs, boards, comments, attachments | Hermes | `kanban.db` (shared by all profiles) | REST `/api/plugins/kanban/*` + WS `/events` |
| Cron jobs, scripts, run output | Hermes | `cron/jobs.json`, `scripts/`, `cron/output/` | REST `/api/cron/*` |
| Skills, MCP servers, toolsets, plugins, hooks, channels, pairing, webhooks | Hermes | Hermes files and config | REST |
| **Caduceus-only concepts** | Caduceus | `$HERMES_ROOT/caduceus/` (root home, so it is cross-profile and included in `hermes backup`) | Caduceus API |

Caduceus-owned state is limited to concepts Hermes does not have (R1–R9 in `hermes-api-coverage.md` §3). It only ever stores Hermes IDs as references, never copies of Hermes state:

| Store | Contents |
|---|---|
| `caduceus.db` (SQLite, WAL) | The tables listed in §10. **No playbook-run state**: runs live entirely in Kanban (tags, links, comments) |
| `playbooks/*.yaml` | Template and Playbook definitions, human-editable and versioned (`work-model.md` §2.3) |
| `artifacts/` | Deliverables of playbook stages (files named in the `artifacts` table) |
| `shares/<id>.json` | Frozen transcripts of share links (the token itself is stored only as a SHA-256) |
| `vapid.json` | VAPID keypair, made at the first start |
| `config.json`, `logs/`, `mcp-token`, `playbook-engine.lease`, `artifact-capture.lease`, `budget-guard.lease` | The service's settings (written by `caduceus setup`), the service log, the Caduceus MCP server's token, and the single-writer leases of the three workers |

Secret files are `0600`. Backups include them, and the docs must say so.

**As built (M0 #03).** The store is `<Hermes root home>/caduceus/caduceus.db` (SQLite, WAL), with the root home resolved like Hermes's `get_default_hermes_root()` from the server's `HERMES_HOME`. On every start Caduceus creates or re-tightens the directory to `0700` and the database to `0600`; SQLite gives its `-wal`/`-shm` files the database's mode. That re-tightening matters because `hermes import` restores modes only for the secret files it knows (`hermes_cli/backup.py` `_SECRET_FILE_NAMES`).
- **`hermes backup` includes the store.** `run_backup` walks `get_default_hermes_root()`. `caduceus/` is in none of `_EXCLUDED_DIRS`, `_EXCLUDED_ROOT_DIRS` or `_EXCLUDED_BACKUP_ROOT_DIRS`, and `*.db` files are copied with `sqlite3.backup()` (the sidecars are skipped). A full backup of a temp home was checked and listed `caduceus/caduceus.db`. `hermes backup --quick` snapshots only Hermes's critical files, so it does not include the store.
- **Backups therefore contain Caduceus secrets:** the owner's password hash (scrypt), session records and the audit log. Sessions are stored only as SHA-256 hashes of their tokens, so a backup cannot be replayed as a signed-in session. Treat a Hermes backup as a secret.

**Per-device preferences as built (M0 #07).**
- **What a device is.** A device is a browser profile: the `caduceus_device` cookie, a random 128-bit id (32 hex characters) that Caduceus hands out the first time that browser asks for its preferences. It is `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` unless the request came from this Mac over plain http (the same rule as the session cookie), lasts 400 days (the longest a browser keeps one) and is renewed by every request. It is not the session: signing out and in again, or revoking a session in Settings › Security, keeps a device's preferences, and two browsers signed in as the owner never share them. Clearing a browser's cookies makes it a new device; the web app offers its local copy to the new record. The cookie is an id, not a credential: every preferences route is behind the sign-in gate, and a cookie that is not an id the server made is replaced.
- **Where.** The `device_preferences` table (`device_id`, `section`, JSON `value`; migration 2) in `caduceus.db`. `section` names a group of preferences; `appearance` is the first (`server/src/device-preferences.ts`). `GET /_caduceus/api/preferences/appearance` answers `{ appearance }` (`null` until the device has saved one) and `PUT` takes `{ appearance }`, refuses anything that is not exactly one of the offered theme, skin, density and text size values (`400 bad-request`, nothing stored) and answers what it stored. The shapes and the choices are in `contracts/appearance.ts`.
- **Local copy.** The browser also keeps the choices in `localStorage` (`caduceus.appearance`: the choices and whether Caduceus has them yet), so they apply before any network answer and offline. A change is applied and kept locally at once, then sent; a change made offline stays `pending` and is sent when the device is back online. When the signed-in app starts, `web/src/appearance.ts` (`reconcile`) compares the local copy with Caduceus's record: a pending local copy is sent; otherwise Caduceus's record wins (which restores a device whose `localStorage` the browser dropped), and a local copy that Caduceus has no record of (a new device after cookies were cleared) is sent. Other tabs of the same browser follow through the `storage` event. `caduceus.shell` (layout) and `caduceus.keyboard` stay device-local and unmirrored.
- **Before first paint.** `web/index.html` starts with a small classic inline script that reads `caduceus.appearance` and sets `data-theme`, `data-skin`, `data-density` and `data-text-scale` on `<html>`, before the stylesheet and the bundle load, so the sign-in screen and every page start in the right theme. A test runs the script that `index.html` ships against the same contract; it needs a CSP hash or nonce if one is added (M0 #13). `system` and `auto` density need no script: tokens.css resolves them with `light-dark()` and a media query.

**One bounded exception to D2: guarded file operations (R11).** Hermes has no API for moving or renaming files, saving Office documents, or truncating a log. The Caduceus server runs on the same host, so it performs these four operations on disk itself, under these limits:
- only inside the roots Hermes's own file API exposes (`HERMES_DASHBOARD_FILES_ROOT`, or the profile's workspace), plus `HERMES_HOME/logs/` for truncation;
- never on `.env`, `auth.json`, `caduceus/` or anything outside those roots;
- each operation is tier-gated (§5) and audited.

Everything else goes through Hermes.

## 3. Hermes interfaces used

| Need | Interface | Notes |
|---|---|---|
| Interactive chat and run control | WS `/api/ws`, OpenRPC contract v1 (257 methods, 79 events, 16 server→client requests; Hermes 0.22.2) | Vendor `@hermes/shared` (`JsonRpcGatewayClient`, replay, heartbeat, reconnect backoff, generated types), pinned to the Hermes version (`hermes-protocol.md` §1, §12) |
| Search, paging, admin | REST (344 operations; OpenAPI; Hermes 0.22.2) | Types generated from the pinned `/openapi.json` |
| Kanban live updates | WS `/api/plugins/kanban/events` | Drives the Board, Work's state view, the Inbox data layer and the playbook engine |
| Global change signals | RPC events `cron.changed`, `sessions.changed`, `pairing.changed`, `platforms.changed` | Read on the BFF's standing observer connection |
| Voice | REST `/api/audio/transcribe`, `/speak`, `/speak-stream`, `/voice-live` | RPC voice uses the host's own microphone and speaker, so it is not usable from a browser (`hermes-protocol.md` §0) |
| Terminal mode (D3) | WS `/api/pty` | Desktop only, opt-in. Can share sessions with native chat |
| **Not used** | `/api/pub` + `/api/events` | Any authenticated client can inject frames into these, so they are not a trust source (`hermes-protocol.md` §10) |
| **Not used in v1** | API server `/v1/runs` (:8642) | Unattended work runs through the Hermes Kanban dispatcher (D4). `/v1/runs` stays an option for server-to-server automations |
| Kanban fields the REST API can't set (completion contract, branch name, max retries, initial status) | `hermes kanban create` command line, run by the Caduceus server with a fixed argument list (no shell), scoped to profile and board | Checked against the v0.21.4 source: the REST create body omits these fields, and the CLI accepts them. This is still Hermes's own interface (D2) |
| Playbook stage tags | `idempotency_key` on create | Hermes reads and filters `workflow_template_id` / `current_step_key`, but neither REST nor CLI can set them in v0.21.4. The key encodes playbook@version, root task, stage and attempt, and Hermes de-duplicates on it, so stage creation is exactly-once. The native fields are written once a pinned contract shows Hermes accepts them (`work-model.md` §2.3) |

**Session `source` (verified in M0 #10, Hermes 0.21.4).** Caduceus sessions use `source: "caduceus"`, on `session.create` and on `session.resume` (both take it; a live session's tools follow the source of the request that made its runtime, not the stored row's). The field is a free string (`SessionCreateParams.source`). Caduceus must never use `"desktop"`, which enables the Desktop GUI toolset: bridges that need the Desktop window to answer.

- **Why "caduceus" gets Hermes's normal tools.** Hermes keys a session's tools on its source in one place. `session.create` keeps an explicit source and otherwise falls back to the backend's own platform: `"tui"`, or `"desktop"` when the backend was started with `HERMES_DESKTOP=1` (`tui_gateway/methods_session.py:65-67`, `server.py:1418-1428`). The agent's toolsets are the profile's configured CLI toolsets plus `_gui_surface_toolsets(source)`, which is `{"project", "desktop_ui"}` for `"desktop"` and `{"project"}` for every other source (`server.py:1827-1831`, `1880-1914`, used at `2416`). `desktop_ui` (`toolsets.py:137-143`; each tool registers into it from `tools/`) is ten tools in Hermes 0.21.4: `desktop_preview`, `drive_preview`, `annotate_preview`, `read_terminal`, `close_terminal`, `read_window_below`, `focus_pane`, `gui_tour`, `show_tip` and `apply_layout`; `react_to_message` joins them when the Desktop reactions setting is on. Each hands its work to the Desktop window as a renderer event, and the reads (`read_terminal`, `read_window_below`, the preview reads and `drive_preview`) wait for the window's answer, which Caduceus has none for. `caduceus` is not a gateway platform either (`session_lifecycle.py:314-330`), so Hermes ends its rows on close like those of the TUI.
- **What the live check shows** (`server/test/session-source.test.ts`, over the browser's gateway connection through Caduceus, real Hermes in a temp `HERMES_HOME`, a stub LLM as its provider). Once the agent is built, `tools.show` lists 27 tools for `"caduceus"` and for no source, and 37 for `"desktop"`: the same 27 plus the ten above (counts for that bare temp home; a profile with more toolsets configured has more of both). `toolsets.list` has `desktop_ui` enabled only for `"desktop"`. A session with no source gets the same tools as `"caduceus"`, so the launcher does not set `HERMES_DESKTOP`.
- **The `project` toolset is not a bridge.** `desktop_project` (create, switch, list projects) is on for every source. It writes Hermes's own `projects.db` and needs no window, so a Caduceus session has it and Projects (M1 #14, M3 #10) shows what it does.
- **No session row.** `session.create` writes none (`methods_session.py:369-388`); Hermes inserts it at the first prompt, or at once for a create seeded with `messages`. `session.close` only ends the runtime. Live, with no prompt sent: Hermes's `state.db` and `GET /api/sessions?archived=include` hold no session before or after `close`, and the stub LLM was asked only about its models. When a prompt is sent, the row appears with `source = "caduceus"` (seen in a mutation check of the test).
- **Inspect only a built agent.** `session.create` answers at once with `lazy: true` and empty `tools`, and Hermes builds the agent about 50 ms later; the `session.info` event with tools in it marks that. Before it, `tools.show` and `toolsets.list` have no agent to ask and report every tool and every toolset enabled, bridges included. Even built, `session.info.tools` (what the model is shown directly) does not tell sources apart, because Hermes defers the GUI tools behind `tool_search` for `"desktop"` too (`hermes_cli/config_defaults.py:1972-1978`); `tools.show` lists deferred tools and does. A build needs a configured provider: without one it fails with an `error` event ("Hermes is not connected to any AI provider yet…") and the session has no tools.
- **Also keyed on `"desktop"` (read in source, not exercised).** A `"desktop"` session's launch directory is not a workspace and its row stores no `cwd` unless one was chosen; any other source stores the session's own `cwd` (`session_workdir.py:76-91`). So a Caduceus chat should pass the chosen workspace as `cwd` to `session.create`; without one the agent works in the backend's launch directory. The startup orphan sweep closes only `tui`, `desktop`, `subagent` and `unknown` rows (`session_reaper.py:337`), so that sweep leaves a stale `caduceus` row open.

## 4. Realtime, resume and push

### Browser ↔ Caduceus ↔ Hermes
- The browser speaks the **unmodified** Hermes JSON-RPC protocol to Caduceus at `wss://…/api/ws`.
- Caduceus opens one upstream socket per browser socket (with `?token=`). It forwards frames both ways through the policy layer (§5) and drops the browser's `Origin`/`Host` headers.
- On connect, the client sends `client.capabilities {server_requests:true}`. Without it, approvals fail on that socket (`tui_gateway/server_requests.py:24-28`).

**As built (M0 #09).**
- **The gate.** `server/src/websocket-routes.ts` gates every WebSocket upgrade: the exact Origin first (403), then a Caduceus session (401), then the route's policy from `classifyWebSocketRoute` (a denied route 403; `/api/pty` and `/api/console` are T2 and need a step-up grant; read-only mode refuses every route that is not a read, except the gateway, whose frames are judged one by one). The routes behind it (`caduceus-server.ts`): `/api/ws` (the gateway proxy), `/api/plugins/kanban/events` (the board's live view), `/api/console` (Hermes's restricted console), `/api/pty` (Hermes's TUI for Terminal mode) and `/_caduceus/api/terminal` (the Workspace shell, run by Caduceus). Any other path finds nothing (404); `/api/events` and `/api/pub` stay denied (frame injection).
- **The proxy.** `server/src/gateway-proxy.ts` opens the upstream first and completes the browser's handshake only once it is open: 503 while the backend is not ready, 502 if Hermes refuses the connection or does not answer within `gatewayOpenTimeoutMs` (10 s). The upstream is the `ws` client with the launch secret in `?token=` and no `Origin`, cookie or browser token. It is not the global `WebSocket`, which never closes a connection that failed to open (a refused dial is an `error` alone) and opens a second connection if it is closed while still opening. Every frame, both ways, goes through `gatewayPolicy` (§5); frames from the browser are judged in order; text frames from Hermes are scrubbed of the launch secret (`HermesBackend.redact`, which knows every secret of every launch).
- **Closing.** Hermes's side closing closes the browser's with 1012 (the page redials); a browser leaving, even mid-handshake, closes its upstream. A session that ends (sign-out, revoke, expiry: `OwnerAuth.onSessionEnded`) closes its sockets with 4401, which is also the code Hermes's own auth gate uses, and the page then stops dialling; stopping Caduceus closes with 1001. Every browser socket is pinged every 30 s and dropped when it misses a pong, so a phone that vanishes without a goodbye does not keep an upstream alive.
- **The page.** `web/src/gateway-connection.ts` wraps Hermes's vendored shared client (`@hermes/shared`: heartbeat `gateway.ping` every 15 s and a drop after 45 s of silence, replay by sequence number, the `client.capabilities` handshake on every connect). It adds when to dial again (Hermes's backoff ladder: full jitter, 300 ms up to 15 s) and what the app bar's dot shows: `connected`, `reconnecting` with the attempt count, or `offline`, each with a plain reason. After a drop or a failed dial it asks `GET /_caduceus/api/backend` why: a 401 means the session ended (stop and sign in again); no answer means Caduceus is not reachable (offline); a stopped backend is offline too, and a starting or restarting one is reconnecting. A page that is offline stays offline while it fails again, so the dot does not flicker. `gateway.ready` carries the replay epoch: a different one means Hermes restarted (`ready.restarted`), so what the page holds about sessions is stale and its sequence numbers meaningless, and every reconnect says global change events were missed. `web/src/gateway.ts` is the page's one connection and its hooks: `useGatewayStatus`, `useBackend`, `useGatewayEvent(type)` and `useLiveLoad(load)`, which runs `load` at every `gateway.ready`, so live data is never older than the connection.
- **Live runs** come from the server's observer (`session.active_list` and the background sessions, `server/src/inbox-requests.ts`, which looks at Hermes at its own pace) and reach the page over the Inbox's live stream. The crew, Today and Work read that stream; the page does not poll. (Home's own `/api/status.active_sessions` read is gone.)

### Resume (Desktop's proven sequence)
1. On reconnect: `session.activate` with the runtime id. If it is gone, fall back to `session.resume` with the stored id.
2. Call `session.events.since {last_seen}`. If the reply is `truncated` or the epoch changed, refetch the transcript.
3. Re-deliver `open_requests` (pending approvals and clarifies) to their handlers *before* the UI unblocks.

Hermes keeps a 512-event / 4 MiB per-session ring. Detached *running* turns continue (they are stopped only after 600 s without activity). Turn markers auto-continue an interrupted turn for 15 minutes (`hermes-protocol.md` §2.5).

### PWA resume storms
Reconnects triggered by `visibilitychange`/`pageshow` are coalesced (at most one per second) and backed off. This addresses WebUI #7891 and Dash #129393. **Built (M0 #09):** `web/src/reconnect-coalescer.ts` is pure (it takes the clock and timers of the page) and `web/src/gateway.ts` feeds it `visibilitychange` (when the page becomes visible), `pageshow` and `online`. A signal that arrives while one is waiting is part of the same burst. What it runs is `reconnect()`: if the connection is down, dial now; if it looks open, ask Hermes with a `gateway.ping` and drop the connection (to redial) when no answer comes within 5 s, since a socket can die while a phone sleeps without anyone saying so.

### Upstream grace hold
When a browser socket drops, for example because a phone was suspended:
- Caduceus keeps that upstream socket open for a **grace period** (default 10 min) so the session stays hosted and server requests stay deliverable.
- On reconnect within the grace window, the device's next socket re-binds to the held upstream (keyed by Caduceus session + device id). The client then runs the normal resume sequence.
- **Built (M1 #03).** `server/src/gateway-proxy.ts`. The page names its tab in `/api/ws?tab=<id>` (`web/src/tab-id.ts`: kept in the tab's `sessionStorage`, so a reload is the same tab and another tab is not). When that tab's browser socket closes, the upstream is held for `DEFAULT_GRACE_MS` (10 min, `gatewayGrace` on the server, with injectable timers for tests); the next socket of the same sign-in and tab takes it over and is sent Hermes's `gateway.ready` again (Hermes says it once). Frames Hermes sends while it is held are dropped: the session's replay buffer in Hermes, read by `session.events.since`, brings the page up to date. A socket that names no tab is never held (it could not be taken over). Hermes closing a held upstream, a sign-out or revoke (`closeSession`) and a server stop end it at once. Another tab or another sign-in never takes it.
- **The chat engine (M1 #03).** `web/src/modules/chat/chat-session.ts` (no DOM, no React; tests in `server/test/chat*.test.ts` over the real Hermes with the stub LLM). After a (re)connect, or when opened from `/chat/:id`, it runs `session.activate` (the runtime id it knows) falling back to `session.resume` (stored id, `source: "caduceus"`), then `session.events.since`. A truncated replay, or an epoch that is not the one it knew, takes the snapshot (`messages`, `inflight`) Hermes just gave instead of the replay; a page with no watermark rebuilds the running turn from the events after the last `message.start`. Live events are held during the catch-up and applied seq-gated, so no text is missed or repeated. `message.complete` refetches `session.history`. Hermes does not say which replies were stopped: the page remembers it only while it is open.

### Push watcher (R2)
Caduceus's own **observer connection** receives global change events. Together with the per-device proxied sockets it raises:

| Event | Push |
|---|---|
| Server→client `approval` / `clarify` requests on sessions whose device is not visible | high-priority push |
| `message.complete` for runs the user started | "Finished" |
| Kanban `review`, `blocked:needs_input`, `gave_up` and failures | push |
| Cron failures (from `cron.changed`, then a REST diff of `/runs`) | push |
| `pairing.changed` with pending requests | push |
| Gateway down; budget thresholds | push |

Delivery rules:
- **Presence-aware:** no push while any Caduceus client for that user is visible.
- **Server-side dedupe:** there is no `tag` support on iOS.
- **iOS rules:** permission is requested from a tap after Home Screen install; every push shows a notification (`userVisibleOnly`); declarative payloads on iOS 18.4+ with a service-worker fallback.
- Every notification **deep-links to the decision**: a notification that named the Inbox opens Today (`/today`). Inline notification actions are added only where the platform supports them (`industry-patterns.md` §4, §12 #2–3).

The observer connection never answers a server request (`gateway-observer.ts`): it does not send `client.capabilities {server_requests: true}`. Server requests fan out to the sockets that did say so, and the first answer wins (`hermes-protocol.md` §0).

### Live relays (R12)
Some Hermes surfaces can only be polled. The Caduceus server polls them once and pushes deltas to every subscribed client over its own SSE channel:
- **Log tail:** `GET /api/logs` is polled every 1–2 s while anyone is watching.
- **Kanban worker logs:** `/tasks/{id}/log`.
- **Transcripts of sessions owned by other processes** (messaging gateway, cron, Kanban workers). These refresh message by message, triggered by `sessions.changed`. A token-level tail of those sessions is impossible (`hermes-protocol.md` §0).

Clients therefore get streaming behaviour, while Hermes sees a single poller.

### Offline
- The service worker precaches the shell.
- Offline lists are not cached, and no screen snapshot is kept (the offline Home snapshot was removed with Home).
- Drafts are kept on the server and synced (`web/src/modules/chat/draft-sync.ts`).
- An IndexedDB outbox for low-risk writes is **not built**. A write that cannot be sent offline is switched off with its reason (`WriteButton`). There is no Background Sync on iOS.
- T2/T3 actions are never queued offline.

**PWA and offline shell as built (M0 #12).**
- **Worker.** `web/src/sw/service-worker.ts`, bundled as `/sw.js` (scope `/`, `Service-Worker-Allowed: /`, `Cache-Control: no-cache`) by `web/pwa/vite-plugin.ts` instead of `vite-plugin-pwa` (the caching rules are a pure, tested module; no workbox). It precaches the whole build (page, hashed assets, icons, manifest) into a cache named for the build's version (a hash of every shell file), serves those files cache-first, and answers a page load network-first with the cached shell as the fallback (after 4 s or on failure). Every other request is untouched: nothing under `/_caduceus/` or `/api/` is ever stored, and the server sends those `no-store`. A new build waits until the owner accepts "Update available"; accepting reloads into it.
- **No offline screen snapshot.** The offline Home snapshot is gone with Home. Changes that cannot be queued are switched off with the reason (`WriteButton`). The IndexedDB outbox above is still to come (M1).
- **Install.** Chromium: the install event is captured at start and the Install button is in Settings › Install app. iOS: a banner after a meaningful action (a passkey added, an appearance chosen, a Repair run) opens the Add to Home Screen guide; dismissal is kept in `localStorage` per device. The manifest `id` is `/`: never change it.
- **Theme colour.** `<meta name="theme-color">` is set from the canvas the page paints, so it follows skin, theme and the OS scheme; the manifest carries the default (Desk, light).

## 5. Security model

Each layer has its own boundary:

1. **Network.** Tailnet ACLs; HTTPS through Tailscale Serve. Caduceus requires a `Tailscale-User-Login` header that matches an allowlist. The header is trustworthy only because Caduceus binds to localhost (Tailscale KB 1312).
   - **As built (M0 #13).** `startCaduceusServer({ tailnetOwners })` (`server/src/tailnet-identity.ts`): a request that is not from this Mac itself (it carries a forwarding header, as everything through Serve does) must carry a `Tailscale-User-Login` equal, ignoring case, to one of the owners. Otherwise `403 {"error":"tailnet-identity"}` on every route, WebSocket upgrades included, whatever the cookie. An empty list refuses all of them, and without the option nothing is enforced (development). The service reads the owners, the port, `publicOrigin` and `rpId` from `config.json` (`CADUCEUS_CONFIG`), which refuses a configuration without an owner, off a ts.net host, on a Funnel-capable port (443, 8443, 10000) or with an RP ID that is not the host; an unusable file stops the service. Refused sources are reported once each (`onTailnetRefusal`, logged by `main.ts`). The loopback-only bind is tested by connecting to this machine's other addresses.
   - **Cookie scope across ports (owner decision, 2026-10-07).** Caduceus is served on the same hostname as the public Funnel on :443 (`https://my-mac.tail0000aa.ts.net:9443`). Browsers do not scope cookies by port, so the session cookie is also sent to the Funnel's service (`localhost:2283`). The owner **accepted this risk**. What limits it: the cookie is `HttpOnly`, `Secure` and `SameSite=Strict` (nothing narrower is free: Caduceus lives at `/`, and `__Host-` does not scope by port); a stolen cookie is useless from outside the tailnet, because Caduceus is not on Funnel and Serve forwards only to allowed Tailscale logins; T2/T3 actions need a passkey; and a session can be revoked in Settings.
2. **Caduceus auth.**
   - Passkeys first (RP ID = the ts.net hostname, which must stay stable), with a password fallback.
   - HttpOnly `Secure` `SameSite=Strict` cookie; idle and absolute TTLs.
   - Session and device list with revoke.
   - Exact-Origin CSRF check on unsafe methods and on WS upgrades.
   - Login throttling.
   - The audit log records actor, action, target, tier and profile.
3. **Policy proxy.** One server-side map from REST route or RPC method to a risk tier, enforced in Caduceus and mirrored in the UI:

| Tier | Friction | Examples (full list: `hermes-api-coverage.md` §7, `hermes-protocol.md` §10) |
|---|---|---|
| T0 | Undo toast | Rename, pin, archive, toggle a skill |
| T1 | Confirm, naming object + profile | Doctor, skill uninstall, LLM auto-describe, terminate a run, create a profile, registered-workspace file writes |
| T2 | Passkey step-up + confirm | Gateway stop / restart / migrate, env key write/delete, pairing approve, bulk task ops, make-default profile, OAuth disconnect, push subscription, opening Hermes's restricted `hermes>` console (`/api/console`) or the terminal |
| T3 | Step-up + typed confirmation, stating whether it can be undone; blocked in read-only mode and offline | Config / raw-YAML writes, file writes outside a workspace, cron script jobs, MCP stdio servers, plugin / skill install, hooks, env reveal, backup (make and download), profile export, backup restore / `ops` import, profile delete, session bulk-delete / prune, memory reset, git push / revert, `rollback.restore` |

   **File writes (as built, M0 #08 and the security pass):** the file guard (`server/src/file-guard.ts`) judges every path first. `fs/write-text`, uploads, new folders, deletes, renames and moves are **T1 inside a workspace the owner registered (Work › Projects) and T3 outside one**; a path outside the allowed roots is refused. Caduceus snapshots the previous content of a text or Office save and refuses stale overwrites. No write may reach a place that runs code later (shell startup files and git settings in the owner's home, Hermes's `hooks`, `scripts`, `skills` and `plugins` folders: `persistence-path`). Reads also refuse keys and credentials (SSH, cloud, browser profiles, Keychains, Hermes's credential files and folders: `secret-path`). `.env*`, `auth.json` and `caduceus/` are denied for reads and writes (`protected-path`) and are edited only through their own screens. Archives never reach a file route, and a backup is written only to a `backups` folder. Importing a session (JSON/JSONL, Claude Code) is additive and T1. "Restore / import" in the T3 row means backup restore and profile import.

   **Denied in v1** (not reachable through the proxy): `shell.exec`, `cli.exec`, `command.dispatch` exec types, `vault.*`, `billing.*` / `subscription.*`, `groups.peer.*`, `bot_relay.*` and `diagnostics.share_nous`, plus `/api/pub`. The interactive terminal is the explicit, T2-gated home for shell access.

   **Approval escalation from a phone:** "Allow always" and YOLO require step-up (Claude Code does not allow bypassing permissions from mobile; `industry-patterns.md` §12 #4).

   **Read-only mode:** an allowlist of GET routes and read-only RPC methods, enforced at the proxy.

   **Owner sign-in as built (M0 #03).**
   - **This Mac.** A request counts as coming from this Mac only when its peer is loopback **and** it carries none of `Tailscale-User-Login`, `X-Forwarded-For`, `X-Forwarded-Host`, `X-Forwarded-Proto` or `Forwarded`. Tailscale Serve also connects from loopback, and it always sets `X-Forwarded-Host` and `X-Forwarded-For` (`ipn/ipnlocal/serve.go`, `addProxyForwardedHeaders`). First-run owner setup (`POST /_caduceus/api/auth/setup`) works only from this Mac and only while no owner exists.
   - **Gate.** Every page, every Caduceus API call and every Hermes request needs a session, except `/sign-in`, `/assets/*` and the public auth routes (`session`, `setup`, `sign-in`, `sign-out`, `passkey-sign-in/options`, `passkey-sign-in`; an explicit list). Without one, pages redirect to `/sign-in?next=…` and APIs answer `401 {"error":"signed-out"}`.
   - **Cookie.** `caduceus_session` is HttpOnly, `SameSite=Strict`, `Path=/` and `Max-Age` 30 days. It is `Secure` on every request except one from this Mac over plain http. Sessions end after 7 days idle or 30 days after sign-in.
   - **Origin.** Unsafe methods and WebSocket upgrades must carry an `Origin` that exactly matches Caduceus's loopback URLs (`http://127.0.0.1:<port>`, `http://localhost:<port>`) or the configured Serve origin (`publicOrigin`, set in ticket 13). Otherwise the answer is `403 {"error":"origin-mismatch"}`.
   - **Throttling and storage.** After 5 consecutive wrong passwords, sign-in is locked for 60 s, and each further failure doubles the lock (up to 15 min). The count is kept per account, so forwarding headers cannot reset it. It lives in memory. The password is stored with scrypt (N=2^17, r=8, p=1: 128 MiB per guess).
   - **Audit.** The audit log (`GET /_caduceus/api/audit`) records time, actor, action, target and source (`local`, `tailnet:<login>` or `forwarded:<address>`) for set-up, refused set-up, sign-in (`session.sign-in`, `session.sign-in-passkey`), failed password sign-in, sign-out, revoke, step-up, passkey register / rename / delete and password set / remove.

   **Passkeys, devices and step-up as built (M0 #04).**
   - **Relying party.** `@simplewebauthn/server`. The RP ID is the `rpId` option of `startCaduceusServer` (default `localhost`; ticket 13 sets the ts.net hostname). A ceremony is accepted only from Caduceus's own origins on that hostname, so in development passkeys work at `http://localhost:<port>`, not `http://127.0.0.1:<port>` (an RP ID cannot be an IP address).
   - **Passkeys.** Discoverable and user-verified (`residentKey` and `userVerification` `required`), `none` attestation, ES256/EdDSA/RS256. Stored in `caduceus.db` (`passkeys`: credential ID, public key, counter, transports, name, created, last used) under a random per-owner WebAuthn user handle. Settings › Security (`/system/security`) registers, renames (1–64 characters) and deletes them.
   - **Sign-in.** `POST …/passkey-sign-in/options` is public; the sign-in screen starts a conditional (autofill) request on load (the password field's `autocomplete` ends in `webauthn`) and also offers a "Sign in with a passkey" button. Challenges are single-use, expire after 5 minutes and are bound to their purpose (anonymous sign-in, or one session's registration or step-up). Anonymous ones are kept apart and capped at 64, so a flood cannot evict a signed-in owner's.
   - **Sign-in methods.** The password and each passkey. The owner may turn the password off (passkey-only) and set it again; the last remaining method can never be deleted (`409 {"error":"last-sign-in-method"}`, enforced in one SQL statement). Deleting a passkey does not need step-up, so the password alone can remove a lost device's passkey.
   - **Devices.** `GET …/auth/sessions` lists live sessions (User-Agent, created, last seen to the minute, current); `DELETE …/auth/sessions/:id` revokes one, and its next request gets 401.
   - **Step-up.** `POST …/step-up/options` then `POST …/step-up` with a passkey assertion grants the current session, and only it, 5 minutes (kept in memory; a restart only means confirming again). `requireStepUp(auth)` (in `auth-routes.ts`) is the server-side requirement: without a live grant it answers `403 {"error":"step-up-required"}` (`StepUpRequired` in the Caduceus API contract). The web app's `fetchWithStepUp` shows the step-up dialog on that answer and retries once. Changing or removing the password is behind it; the policy proxy (M0 #08) puts T2/T3 behind it.
   **Policy proxy as built (M0 #08).**
   - **The map.** `contracts/policy/` (shared by the server, which enforces it, and the web app, which mirrors it): `rest.ts` has one row per pinned REST operation (`METHOD /path`, as `contracts/hermes/openapi.json` names it; 333 today) and the WebSocket routes; `gateway.ts` has the 219 methods, 12 server→client requests and 69 events of the pinned OpenRPC; `tiers.ts` has the tiers, the denial reasons and their messages. A test (`server/test/policy-map.test.ts`) fails when the pin has an operation, method, request or event without a row, when a row has nothing pinned, and when two operations whose paths can overlap have different tiers, so `npm run contracts:regenerate` cannot bring in something unclassified. At run time anything not in the map is **denied** (`unclassified`): that includes an owner-installed plugin's routes, until somebody classifies them (`startCaduceusServer({ extraRoutes })`). Where the tier depends on what a request says, a row's base tier is the least it can be and `REFINED` (REST) or `refine` (gateway) lifts it from the query, the body or the params: a cron job with a script or `no_agent`, a stdio MCP server, `?delete=true` on a board, a recursive file delete, an `approval.respond` of "always", the key of a `config.set`, the action of `cron.manage` / `plugins.manage` / `skills.manage`. Tiers follow this document, then the ticket that builds the screen using the operation, then `hermes-api-coverage.md` §7.
   - **The path.** A REST request is classified by the path Hermes will route: each segment is percent-decoded, and a path with an escaped slash, `.`/`..`, an empty segment or a control character is refused (`bad-path`); what is forwarded is the path as classified, with only `Content-Type` and no other header of the browser's.
   - **Order of checks** (REST and gateway alike): denied → the file guard → read-only mode → step-up (T2, T3) → typed confirmation (T3) → audit → forward. Read-only mode is checked before the step-up, so nobody is asked for a passkey for what cannot happen. A body the policy must read (to lift a tier or find a file path) and cannot parse as JSON is refused (`bad-body`): Hermes's parser accepts things like `NaN` that `JSON.parse` does not, and an unreadable body must not be forwarded at its base tier.
   - **Refusals** are JSON the UI can show (`PolicyRefusal` in the Caduceus API contract): `403 {error: "denied", tier, operation, reason, message}`; `403 {error: "read-only"}`; `403 {error: "step-up-required", tier, operation}`; `403 {error: "confirmation-required" | "confirmation-invalid" | "confirmation-expired"}`; `413 {error: "payload-too-large", maxBytes}`. A gateway frame gets the same body as the `data` of a JSON-RPC error with code `-32001` (a notification, which has no id to answer, gets a `caduceus.refused` notification instead).
   - **Body limits.** 1 MiB for a Hermes request, 160 MiB for the operations that take uploads (Hermes caps managed files at 100 MiB; base64 adds a third), 64 KiB for the Caduceus API (`/_caduceus/*`). A body is counted as it arrives, never buffered past the limit.
   - **Read-only mode.** Kept in the Caduceus store (`settings`), so it survives a restart. It lets through only operations marked `read`, and **no T3 at all**, a read that discloses secrets (env reveal, backup download) included. Turning it on or off is T2 (`PUT /_caduceus/api/policy/read-only`, `GET` for the state). The shell shows a banner while it is on; M0 #11 turns an incompatible Hermes into the same mode.
   - **Typed confirmation (T3).** After the step-up the owner types the object's name in the dialog, which asks the server for a token (`POST /_caduceus/api/policy/confirmations {operation, target, typed, bodySha256?}`). The server needs a live step-up, refuses in read-only mode, requires `typed === target`, and binds the token to the session, the request line (`DELETE /api/profiles/coder`, or `rpc session.delete`) and, if given, the SHA-256 of the exact body. The request carries it as `X-Caduceus-Confirmation` (a gateway frame as a `caduceus: {confirmation}` member, which is removed before the frame reaches Hermes). A token is single-use, whatever the answer, and good for **60 seconds** (`CONFIRMATION_TTL_MS`). That is how "offline" is enforced on the server: a T3 request that was queued while the device was offline and replayed later arrives with an expired or used token and is refused. The web app also refuses a T2 or T3 locally while `navigator.onLine` is false, and never queues one.
   - **File guard** (`server/src/file-guard.ts`). `fs/write-text`, the managed-file writes (`upload`, `upload-stream`, `mkdir`, `DELETE /api/files`) and the archive writers (`ops/backup`, profile export, board export) name a path that is checked first. It is resolved as Hermes will resolve it: `~` expanded, symlinks followed component by component (so `..` after a symlink leaves the link's target), the stored case of what exists. Relative paths, `file:` URLs, `~user` and NULs are refused (`bad-path`). **Protected:** any file named `.env`, `.env.*`, `.envrc` or `auth.json` (Hermes's own read guard protects the same names) and everything under `<Hermes root>/caduceus/`, for reads too, since Hermes's read guard does not know Caduceus's data (`protected-path`). **Roots:** a write outside the allowed roots (`fileRoots`; the owner's home by default, and the Hermes root home always) is refused (`outside-roots`). A raw `fs/write-text` is T3, and **T1** inside a workspace Caduceus knows (`workspaceRoots`, supplied by the workspace registry of M3 #10; none yet, so all T3). Snapshotting the previous text and refusing stale overwrites belong to the editors (M4 #02, M7 #01). The check and Hermes's write are not atomic: a symlink swapped in between is not caught.
   - **Gateway frames** (`server/src/gateway-policy.ts`; the browser WebSocket proxy of M0 #09 calls it). `server.gatewayPolicy.connect({sessionId, source})` returns `fromBrowser(text)` and `fromHermes(text)`, each answering `{forward?, reply?}`: pass `forward` on, send `reply` back to whoever sent the frame. A call is classified by method and params; an unknown method is denied. A server→client request is remembered by id, so the answer is judged by what it answers: an approval of "always", a `secret` or a `sudo` password needs a step-up, and so does an answer to a request the connection never saw (including `request.answer` for one; the requests a resumed session still has open are learned from `open_requests` in the result). Hermes's `vault.*` requests are not delivered and are answered with an error on the browser's behalf; the events of denied families are dropped. A lookup of Hermes's config decides whether `command.dispatch` / `slash.exec` names an **exec-type quick command** (one that Hermes runs with `shell=True`): the exec ones of every profile are denied by name, and a lookup that fails denies too (`exec-unverified`). Hermes 0.21.4's built-in slash commands that change Hermes itself (`/update`, `/skills`, `/cron`, `/import`, `/restart`, `/debug`…) are denied (`slash-admin`; they have screens with their own tiers), those that change what the agent may do or stop work (`/yolo`, `/approvals`, `/stop`, `/rollback`…) are T2, and any other name (a skill, plugin or bundle command, or a command a later Hermes adds) is an agent turn, T0. A built-in's alias is not resolved: a quick command named like a built-in is reached through that built-in's alias.
   - **Tiers of Caduceus's own actions.** Adding the first passkey is T1 (there is nothing to step up with yet), adding another and deleting one are T2 (without it a stolen session cookie could delete every passkey and then add its own, and so gain step-up), renaming one is T0, revoking a session is T1 (the password alone must be able to cut off a lost device), changing or removing the password and turning read-only mode on or off are T2. If the only passkey is lost, removing it needs the owner to edit the Caduceus store; a recovery path is M5 #15's.
   - **Audit.** Every forwarded request of T1 and above, and every refused T3 confirmation (`policy.refused`) and denial (`policy.denied`), is recorded with actor, action (the operation, `rpc <method>`), target (the path, or `session:<id>`), source, **tier** and **profile** (`?profile=`, else the body's `profile`, else the profile a path names). T0 and reads are not audited. The audit entry is written when the request is forwarded, not when Hermes answers.

4. **Hermes.** A loopback-only child with a per-spawn token.

   Known Hermes holes are mitigated at the proxy:
   - `fs/write-text` bypasses the sensitive-path guard: Caduceus judges every path first (the file guard; see "File writes" above). The Keys screen uses the env endpoints, never a raw file write.
   - Kanban comment authors can be forged: Caduceus stamps the author server-side.

## 6. Contract stability

Hermes ships about every 5.5 days.

- Caduceus pins **both** `/openapi.json` and `gateway-contract.openrpc.json` per supported Hermes version, generates TypeScript types from them, and diffs them in CI.
- At runtime it checks the `gateway.ready` payload (`replay_epoch`, `heartbeat`, `change_events`), `gateway.capabilities` and `session.info.desktop_contract` (currently 7). If the backend is newer and incompatible, Caduceus degrades to read-only and raises a Health "Repair" item instead of breaking.
- Unknown-method `-32601` responses hide the related UI affordances.
- **As built (M0 #02).** The pins live in `contracts/`: `hermes/openapi.json` (taken from a private `hermes serve` in a throwaway `HERMES_HOME`, so the owner's own plugins stay out of the pin), the vendored `@hermes/shared` with its OpenRPC contract, and `hermes/pin.json` (Hermes version, upstream commit, markers). `npm run contracts:regenerate` refreshes all of them plus the generated REST types. On every backend launch the Caduceus server compares the live `/openapi.json`, the gateway contract published in the Hermes install (`apps/shared/src/gateway-contract.openrpc.json`, located through `hermes --version`) and the live `gateway.ready` / `gateway.capabilities` markers with the pins, and serves the result at `GET /_caduceus/api/compatibility`. Additions (for example plugin routes) are listed but stay compatible; removals, changes and lost markers make Hermes incompatible. `npm test` runs the same check against the installed Hermes.
- **Limits found in M0 #02.**
  - `desktop_contract` is only in `session.info`, so the startup check creates no session to read it: the pinned value (7) comes from `DESKTOP_BACKEND_CONTRACT` in the installed source. **Observed live (M0 #10):** Hermes 0.21.4 reports 7 in the `info` of `session.create` and in the `session.info` event of the built session, equal to the pin (`session-source.test.ts`). The report's `markers.live.desktopContract` stays `null` until a session reports it; since M1 #03 the gateway proxy reads it from the frames it relays and `withDesktopContract` (hermes-contract.ts) puts it on the live markers and recomputes the verdict (a different number is drift: incompatible, read-only). The server reads `info.desktop_contract` from the frames it already relays (the `session.create` / `session.resume` / `session.activate` results and `session.info` events), sets it on the current report and runs `markerMismatches` again, so an incompatible number follows the M0 #11 path (read-only plus a Repair item).
  - Hermes 0.21.4 declares a response schema for only 1 of its 333 REST operations (FastAPI handlers return plain dicts), so the generated REST types cover paths, parameters and request bodies, while most response bodies are `unknown` and are read defensively. The gateway contract is fully typed.


**Hermes 0.22.2 (the first re-pin after the build, 2026-10-19).** What changed for Caduceus, and where it is handled. When Hermes is updated, Caduceus is read-only until it is re-pinned (`npm run contracts:regenerate`, classify what is new, run the suite); the points below are what that first re-pin needed.
- **Session writes are fenced.** `PATCH /api/sessions/{id}` (rename, archive, pin, read mark), `DELETE /api/sessions/{id}` and `POST /api/sessions/import` are refused with 409 `client_upgrade_required` unless they carry `request_id`, `expected_revision` and, when the session has one, `expected_generation`. The page holds no revisions, so the proxy and the MCP route read the counters from `GET /api/sessions/{id}/mutation-snapshot` and add them (`server/src/session-fence.ts`), retry once on a stale revision, and send the writes of one profile one at a time (Hermes takes an exclusive lock per write when no gateway owns the store).
- **One `hermes serve` per host.** A second `hermes serve` attaches to the first or is refused. Caduceus's backend is private, so `server/src/hermes-backend.ts` gives it (and the CLIs it runs) a `HERMES_GATEWAY_LOCK_DIR` of its own, `<hermes root>/caduceus/host-state`: it never joins the owner's server, never takes its place in the host record, and the owner's own `hermes dashboard` is never refused behind it. The one gateway of the host records itself in the same directory and Hermes reads a served profile as running only from that record, so `host-gateway.json` and `host-gateway.lock` there are links to the shared ones (nothing else is).
- **Dependencies are per data root.** A `HERMES_HOME` with no committed environment refuses to start until `hermes pm repair` has built one. Test homes link `installs` to one repaired root under `node_modules/.cache` (`server/test/fixtures/hermes-installs.ts`, repaired once per run under a lock, stamped with the `--version` banner); `hermesPython()` is a wrapper that boots the dependency environment the way Hermes's launcher does. Never run `hermes` without a temp `HERMES_HOME` from a test or an agent: `hermes pm repair` rewrites the owner's environment.
- **Clarify.** Every question arrives as `questions: [{qid, …}]`, even a single one, and only `{answers}` is read as an answer (`{answer}` is a cancel). A card with one question is a single question, and the result is always `{answers}` (`web/src/modules/chat/requests.ts`).
- **`approval.cancelled`** is broadcast with no session on the frame (it names the session in the payload); the chat closes the cards it names (`cancelledApprovals`).
- **Removed or moved.** `profiles.remember_onboarding` is gone (the wizard no longer records in Hermes); Hindsight, Honcho, Holographic, Mem0, Supermemory and OpenViking are catalogue plugins installed per profile (`hermes plugins install <name>`; Caduceus reads them when installed and says so when a profile names one that is not); Home Assistant is a plugin, not a core toolset.
- **Changed shapes read.** `free_tier` is `free_tier_route` on `setup.runtime_check`; Hermes marks a redacted value `«redacted:1234...6789»` (`server/src/channel-secrets.ts` unwraps it and still masks anything else); a Mixture-of-Agents save is the whole preset list, so a left-out preset is removed; a branch gets new row ids, so fork-from-here finds the message by role and time; quick-command aliases run through `command.dispatch`; 68 REST routes take an optional `?profile=`; a download job can be paused and resumed (`can_pause`, `can_resume`, status `paused`).
- **Denied as not used.** The Desktop app's first-run chat (`onboarding.*`), the Bot Screen (`display.*`), its metrics counters (`shared_metrics.desktop_*`, `slash_command`, `startup_latency`, `update_run`), `machine.facts`, and the cards `setup_beat`, `theme.apply`, `theme.pick`. Usage-metrics consent (`shared_metrics.status/set`, `/api/shared-metrics/consent`) is classified (read, and T2 to change) but has no screen.

## 7. Stack

| Layer | Choice | Rationale |
|---|---|---|
| PWA | React 19, TypeScript, Vite 8 | Same as Hermes `web/` and Desktop, so contracts and logic port directly |
| Routing / URL state | TanStack Router (code-based routes built from the module registry) | Type-safe search params; list state lives in the URL (IA §7) |
| Server state | Plain `fetch` through `web/src/hermes-api.ts`, `tiered-fetch.ts` and per-module `*-data.ts` files; the live gateway connection in `web/src/gateway.ts` (`useLiveLoad`, `useGatewayEvent`) | TanStack Query and nanostores were planned and are **not used** |
| Chat | Own engine (`web/src/modules/chat/chat-session.ts`, no DOM) and own Markdown parser; highlight.js, KaTeX and Mermaid load lazily | `@assistant-ui/react`, streamdown and shiki were planned and are **not used**; a purpose-built parser keeps raw HTML out by construction (M1 #04) |
| Lists | Own windowing (`virtual-list.ts`, `history-window.ts`) | TanStack Virtual is **not used** |
| UI primitives / styling | Prototype CSS over the `--cd-*` tokens of `tokens.css`; own layers (`web/src/overlays/`); inline Tabler-style icons (`web/src/icons.tsx`) | Tailwind, Radix and the Tabler package are **not used**; `npm run lint:ui` enforces the tokens |
| Charts | No charting library | Observable Plot is **not used** |
| Terminals | xterm.js in the browser; `node-pty` on the server | Terminal mode (M1 #19) and the Workspace shell (M7 #05) |
| PWA plumbing | Own build plugin `web/pwa/vite-plugin.ts` and service worker `web/src/sw/service-worker.ts` (precache, push, notification click) | `vite-plugin-pwa` is **not used** |
| i18n | **Deferred** (owner, 2026-10-08): plain English strings, no catalogues | Partial work is parked on the branch `wip/m1-01-i18n`. Logical CSS properties are in use throughout |
| Caduceus server | Node 22 + Hono (HTTP), `ws`, `node:sqlite`, `@simplewebauthn/server`, `node-pty`, `yaml`; Web Push (RFC 8030/8291/8292) written out in `web-push.ts` | Shares generated types and `@hermes/shared` with the PWA. There is no `web-push` package |
| Tests | Vitest over a real `hermes serve` in a temp home (`server/test/`, `web/test/`); the few Playwright checks in `e2e/` (shell loads on Today, the Hermes restarting banner, a secret never reaches the page); axe and hit-target gates as throwaway browser smoke; `lint:ui` | See `AGENTS.md` "Tests" and §10 below |

**App shell as built (M0 #05).**
- **Registry.** `web/src/module-registry.ts` is pure and generic over what a route renders, so it is tested without React. A module declares its id, title, icon, Desk placement (`today`, `talk`, `work` or `control`; a Control module also a group), landing path, order, routes, palette commands, settings panels (each also a route, `/settings/<id>` unless it names a path) and a policy hook (`tierOf(action)`, read by the tiered dialog in M0 #08), plus `crossProfile` / `profileScoped`. From that the shell reads (`deskNavigation` in `shell/nav-order.ts`, with the crew): the Today, Talk and Work destinations (each leads to its first module; More is the shell's own and opens `/control`), the crew rows, Control's groups, the Work sub-navigation chips, the route table, the redirects (`/more`, and `/today`, `/talk`, `/work` to their first module), the palette entries, the `g` jumps (a module's `key`) and the Settings list. A duplicate module id or route is refused, so a mistake fails at start-up. `web/src/modules/index.ts` lists the built-in modules; adding a feature area is one more entry there.
- **Routing.** TanStack Router with code-based routes built from the registry. Query strings are plain `?key=value` text (`?profile=` and list state stay strings). Screens load lazily per module. After navigation, focus moves to the new page's `h1`; the first load never moves it.
- **Size classes.** `web/src/size-class.ts`: compact < 600 ≤ medium < 1200 ≤ large, from `window.innerWidth` only, matching `--breakpoint-rail` / `--breakpoint-sidebar` in `tokens.css` (a test reads the tokens). The large sidebar collapses to the rail (remembered per device in `localStorage`).
- **Profile scope.** `web/src/profile-scope.ts` resolves the effective profile (URL, then this device's last choice as it was when the tab loaded, then Hermes's sticky default from `GET /api/profiles/active`), loads the profile list through the proxy with GETs only, and builds the new URL when a profile is chosen. A cross-profile screen (Today) shows All profiles until the URL names one. Nothing in the web app writes Hermes's default (`POST /api/profiles/active` is Profiles' "Make default", M4 #01).
- **Layers.** Sheets, dialogs and drawers are not native `<dialog>`s: the page behind gets `inert`, one history entry per layer lets back close the top layer first, and toasts stay readable and usable above them. `web/src/overlays/layers.ts` owns the stack; `Layer` / `Sheet` render into `#overlays`.
- **Chrome.** The banner stack (`setBanner` / `clearBanner`) and the toast region (`toast()`) are stores any module can use. The connection dot and its banners follow the page's live gateway connection (M0 #09; `shell/connection.ts` over `web/src/gateway.ts`): the dot shows connected, reconnecting with the attempt count, or offline, and says why in plain words (a hover title and screen-reader text; the banner has the same reason). The browser's own "no network" wins over the gateway's status. There is no polling: the 1 s poll of `/_caduceus/api/backend` (once `web/src/backend-status.ts`) is gone, and `useBackend` is read from the gateway connection, which asks Caduceus for the backend's state only after a drop or a failed dial. The app-bar search opens the command palette (below).
- **Command palette and keyboard** (M0 #06). The app-bar search and ⌘K / Ctrl+K open `shell/Palette.tsx` (a full-screen sheet on phones). What it lists, how it ranks and how its list is driven are pure (`web/src/palette.ts`): every route that can be opened plus every module command, in the groups This screen · Actions · Navigate, labels matched with Hermes's shared `fuzzy.ts` (vendored under `contracts/vendor/hermes-shared`, imported as `@caduceus/contracts/hermes/shared/fuzzy`) and the matched characters highlighted. A command's tier is the owning module policy's `tierOf(id)`, else its own `tier`; T1+ goes through `shell/tier-confirmation.ts` (`setTierConfirmer`), the one path M0 #08's dialog installs itself on, and is **not run** while no dialog is mounted. Shortcuts are data: a module declares `key` (the letter after `g`) and a command may declare `shortcut`; `shortcuts.ts` turns key presses into steps (`mod+shift+o`, `g`, `?`), builds the keymap (remaps and the single-key switch applied, clashes and the reserved ⇧⌘O refused) and `keyboard-flow.ts` is the pure step function the `ShellActionsProvider` feeds from `document` keydown. Single-key shortcuts ignore text fields, open sheets and ⌘/Ctrl-held keys. Both settings (`caduceus.keyboard` in localStorage: `singleKey`, `remaps`) are per device by design; Settings › Keyboard edits them and the `?` sheet shows them.
- **Contextual help** (M1 #02). Help is registry data, not a separate system. A module's definition has `help: { pages, glossary }`: a page for each route it owns (`route` may use the registry's `:param` and `*splat`; topic pages have none) and the glossary terms it uses, each pointing at the page it opens. Help that belongs to no module (sign-in, More, the shell) is registered under the owner `shell` with `registry.addHelp`. Everything is plain English in the bundle, so it is precached with the rest of the build and works offline from the installed PWA; the panel and its pages are a lazy chunk, kept out of the first load (initial JS stays under the 170 KB budget). Pure pieces in `web/src/help.ts`: the page for a path (the route that fits best at the first place two routes differ wins), `[[term]]` markers in help text, `resolveHelpTarget`, and `helpProblems`, the contract a test holds the app to: a module route without a page, a marker naming an unregistered term, a related page or a term's page that does not exist, a marker in a title, summary or heading. `?`, the app-bar help button and the palette open the panel (`shell/HelpPanel.tsx`: a drawer on tablet and desktop, a sheet on phones; a Help tab with Back and All topics, and a Shortcuts tab that replaced the M0 #06 sheet); the palette lists help pages and glossary terms in a Help group, only once there is a query (`palette.ts`: titles match like labels, then the words of a page's text). A glossary term in the UI is `shell/Term.tsx`: a `role="button"` span that opens a `popover` pop-up on tap or keyboard focus, announced through the polite `#toasts` region, closed by Escape before the layer under it (`overlays/layers.ts` `openDismissible`), placed inside the viewport by the pure `popover-placement.ts`. A term is marked in a sentence, never a heading: inline text is exempt from the 44 px target rule, a heading is not. The sign-in screen has its own Help button and `?` (a lazy chunk, outside the shell).
- **Not adopted.** TanStack Query, Tailwind, Radix and the Tabler icon package (see the table). `npm run lint:ui` enforces tokens-only colours, no `vh`, named icon buttons, unlocked zoom and reduced motion (durations from the `--cd-dur-*` tokens, looping or literal-duration animations switched off under `prefers-reduced-motion`, no smooth scrolling); the browser gates run through `.scratch/m0-foundation/m0-05-smoke/ui-gates.mjs` (no Playwright tests).

## 8. Operations
- **Install:** the `caduceus` command (`npm run caduceus -- setup`; see the next item for what it does). Only a macOS LaunchAgent is built, not a systemd unit. The VAPID keys are made by the server at its first start (`vapid.ts`). The owner sets the password on the Mac and adds passkeys in Settings › Security.
- **As built (M0 #13).** `npm run caduceus -- setup|uninstall|restart|status` (`server/src/service-cli.ts`, planning in `service-plan.ts`). `setup` creates `<Hermes root>/caduceus/` (0700, with `logs/`), writes `config.json` (0600) and the LaunchAgent `dev.caduceus.dashboard` (`RunAtLoad`, `KeepAlive`, `Umask` 077, log `caduceus/logs/caduceus.log`; one process: `node --import tsx/dist/loader.mjs server/src/main.ts`, so that launchd's pid is the server), loads it with `launchctl bootstrap gui/<uid>`, waits for `/_caduceus/healthz`, and, after its own confirmation, runs `tailscale serve --bg --https=9443 http://127.0.0.1:9130`. Every step is a planned action shown first and carried out only with `--yes`; the Tailscale step also needs `--yes-tailscale` or a typed yes at the terminal. It is idempotent (an empty plan once everything is in place) and refuses to replace a foreign Serve entry or to go on if Funnel is on for 9443. `uninstall` removes the Serve entry only if it is Caduceus's own (`tailscale serve --https=9443 off`), unloads the service and deletes the plist, and keeps `caduceus/`. VAPID keys and the first passkey are not part of setup: the server makes the VAPID keys at its first start, and the owner sets the password on this Mac and adds passkeys in Settings. `restart` is the one command for picking up new code after an update.
- **Child supervision:** the Caduceus server spawns `hermes serve` (headless) on a free loopback port and restarts it with backoff.
  - Hermes runs under a small watchdog. The server holds the watchdog's stdin open, and when the server dies for any reason (crash, SIGKILL), the pipe closes and the watchdog stops Hermes. macOS has no other parent-death signal. Without this, a hard-killed server left `hermes serve` orphaned (found in M0 #01).
  - On a Hermes update (Maintenance › Update), Caduceus drains first: no new turns, active turns are allowed to finish or are marked. It then updates and respawns. Clients resume through §4.
- **Coexistence:** the stock dashboard (`:9119`) and WebUI (`:8787`) keep working during migration. Several backends on one `HERMES_HOME` is a pattern Hermes supports (`web_server.py:497-511`). Once Caduceus reaches parity:
  - rebind the stock dashboard to loopback, or retire it;
  - stop WebUI.
- **Health:** Caduceus exposes `/_caduceus/healthz`. Its Health screen aggregates Caduceus workers, the Hermes child, the gateway (cron ticker and dispatcher heartbeat), providers and host resources as "Repairs": each issue shows severity, cause and a one-tap fix (`industry-patterns.md` §12 #16).
  - **As built (M0 #11):** `/_caduceus/healthz` is public and answers only `{"ok":true}` (Hermes being down is not Caduceus being down). `GET /_caduceus/api/health` asks Hermes's own endpoints again on every report (`/api/status`, `/api/cron/jobs?profile=all` for the ticker heartbeat, kanban `stats` and `diagnostics`, `/api/credentials/pool`, `/api/system/stats`) and keeps no copy; the page reloads it at `gateway.ready`, on `platforms.changed` / `cron.changed`, when the backend's lifecycle changes and when the tab is shown. Repairs: repeated backend restarts (3 stops in an hour, fix "Restart Hermes backend", T2, audited, allowed in read-only mode), contract mismatch (a read difference turns read-only mode on by itself, audited as `caduceus`; a contract that could not be read is only a warning), gateway not running or stuck, scheduler tick stale (more than 200 s on a job that should run), plus dispatcher, providers and host resources. A requested restart forgets the earlier stops, so the Repair clears.

## 9. Risks
- **Upstream churn:** mitigated by the pinned contracts and runtime capability checks (§6).
- **Resource cost of a second `hermes serve` process (measured in M0 #01, 2026-10-07, Hermes 0.21.4, this Mac):**

  | Process | CPU idle | CPU while Home loads (3 reloads) | CPU after Home | Memory: RSS (`ps`) / footprint (`top`) |
  |---|---|---|---|---|
  | Private backend (`hermes serve`) | 0.1% | 0.2% | 0.2% | 163 MB idle → 222 MB after Home / 187–188 MB |
  | Watchdog | 0.0% | 0.0% | 0.0% | 41 MB / 12 MB |
  | Existing stock dashboard (`:9119`) | 0.3% | 0.5% | 0.5% | 461 MB / 351 MB |
  | Existing gateway | 0.1% | 0.2% | 0.2% | 343 MB / 321 MB |

  CPU is the average of instantaneous `top` samples taken 2 s apart.

  **Go.** The cost is small next to the existing processes, and retiring the stock dashboard after parity reduces total memory. If it ever becomes a problem, Caduceus can attach to an existing loopback backend, as long as a token-spawn path is available.
- **Hermes's in-memory replay ring:** a backend restart loses mid-turn deltas. The turn marker plus the DB transcript cover recovery.
- **Kanban "v2 workflow routing" upstream:** the playbook engine writes only `workflow_template_id` / `current_step_key` / links / comments, so it can retire when Hermes routes natively (`work-model.md` §2.3).
- **Phone = operator:** Hermes has no scoped tokens, so an authenticated device can do anything the policy proxy allows. The device list, step-up and read-only mode are the compensating controls, and the UI says so.

## 10. The product as built

This section is the map for a developer. Earlier sections give the reasons and the per-ticket detail. If this section and a code comment disagree, the code wins; fix this section.

### Web modules
`web/src/modules/index.ts` lists `builtInModules`. A module is one folder and one entry. Every module has a Desk placement (`today`, `talk`, `work` or `control`); Control modules also name a group (`main`, Agents, Connect, Workspace, Observe, System, Settings). Home and the Inbox screen no longer exist; the crew (`modules/crew/`) is not a module but is read by the shell.

| Group | Module (landing path) | `g` key |
|---|---|---|
| Desk: Today | `today` (`/today`) | h |
| Desk: Talk | `chat` (`/chat`), Terminal mode included | c |
| Desk: Work | `work-overview` = Overview (`/work`), `work` = Board (`/work/board`), `tasks`, `schedules`, `playbooks`, `projects` (the last four under `/work/`) | w, b, t, s |
| Control › Main | `notices` (`/notices`) | none |
| Agents | `profiles` (`/agents/profiles`), `models`, `skills`, `memory`, `tools` = Tools & MCP (all under `/agents/`) | p |
| Connect | `gateway` (`/connect/gateway`), `channels`, `pairing`, `webhooks` | n, k |
| Workspace | `files` (`/workspace/files`), `git`, `checkpoints`, `terminal`, `artifacts` | none |
| Observe | `health` (`/observe/health`), `insights`, `logs` | e, l |
| System | `config` (`/system/config`), `keys`, `plugins`, `maintenance` (`/system/maintenance`) | o |
| Settings | `settings` (`/settings`), `onboarding` = Setup guide (`/onboarding`) | , |

Settings panels are declared by the `settings` module: Appearance, Security (`/system/security`), Notifications, Audit log (`/system/security/audit`), Voice, Keyboard, Install app, Navigation. `web/src/modules/shares/` and `voice/` hold code used by Chat and Settings and are not modules. `chat` also has Terminal mode (`?mode=terminal`).

**Help and glossary convention.** Every module has `modules/<name>/help.ts` with `pages` (one per route it owns, `route` may use `:param` and `*splat`) and `glossary` (terms it uses, each pointing at a page). `shell/shell-help.ts` holds sign-in, More and how the shell works. `[[term-id]]` or `[[term-id|words]]` marks a term in a paragraph or list, never in a heading, title or summary. `Term` (`shell/Term.tsx`) shows it in the UI. `web/test/help-contract.test.ts` runs `helpProblems` over the loaded registry. See §7 "Contextual help".

### Server files
All in `server/src/`. `caduceus-server.ts` wires them; `main.ts` starts the service; `production-config.ts` reads `config.json`.

| Area | Files |
|---|---|
| Hermes child | `hermes-backend.ts` (launcher, backoff, restart history; sets `HERMES_TUI_CHECKPOINTS=1`), `hermes-watchdog.mjs`, `hermes-contract.ts` and `contract-diff.ts` (pins and drift), `hermes-root-home.ts`, `process-start.ts` |
| Sign-in | `owner-auth.ts`, `auth-routes.ts`, `passkeys.ts`, `passkey-routes.ts`, `auth-methods.ts`, `auth-method-routes.ts`, `oidc.ts`, `oidc-routes.ts`, `tailnet-identity.ts`, `audit-log.ts`, `audit-routes.ts` |
| Policy | `policy.ts` (REST), `gateway-policy.ts` (frames), `policy-gate.ts` and `owned-request.ts` (Caduceus-owned routes), `policy-routes.ts`, `confirmations.ts`, `read-only.ts`, `file-guard.ts`, `content-security-policy.ts`, `credential-guard.ts`, `config-raw.ts`, `channel-secrets.ts`, `webhook-secrets.ts` |
| Proxies and relays | `hermes-proxy.ts` (REST), `websocket-routes.ts` (upgrade gate), `gateway-proxy.ts`, `gateway-observer.ts`, `kanban-events-proxy.ts`, `console-proxy.ts`, `pty-proxy.ts`, `terminal.ts`, `log-relay.ts`, `log-routes.ts`, `relay-stream.ts`, `run-log.ts`, `kanban-author.ts` |
| Web app | `web-app.ts` (static files, service worker, no-store rules), `api-reference.ts` |
| Health and operations | `health.ts`, `health-rules.ts`, `health-routes.ts`, `repair-recurrence.ts`, `drain.ts`, `update-routes.ts`, `update-log.ts`, `self-update.ts`, `restore.ts`, `maintenance-routes.ts`, `log-files.ts`, `service-cli.ts`, `service-plan.ts` |
| Inbox and push | `inbox.ts` and `inbox-*.ts` (one source each: requests, cron, pairing, system, work, activity, hidden; the data layer of Today, the tray, Work and the crew), `push.ts`, `push-watcher.ts`, `push-rules.ts`, `push-settings.ts`, `web-push.ts`, `vapid.ts`, `presence.ts`, `job-notifications.ts`, `active-turns.ts` |
| Today | `today.ts` (the review-state routes), `today-review.ts` (pure rules: the ready window, stamps, visits) |
| Work | `work-tasks.ts` (`hermes kanban create`), `playbooks.ts`, `playbook-*.ts` (YAML, plan, engine, Kanban access, lease, seeds, stage task, capabilities, routes), `template-seeds.ts`, `saved-filters.ts`, `script-files.ts`, `workspaces.ts`, `artifacts.ts`, `artifact-capture.ts`, `budgets.ts`, `budget-guard.ts`, `unattended.ts` |
| Chat | `chat-drafts.ts`, `chat-preferences.ts`, `chat-behaviour.ts`, `chat-limits.ts`, `saved-prompts.ts`, `shares.ts`, `exec-quick-commands.ts` |
| Agents and workspace | `behaviour-files.ts`, `profile-preferences.ts`, `hindsight.ts`, `notes.ts`, `notes-mcp.ts`, `notes-tools.ts`, `mcp-*.ts` (Caduceus as an MCP server for agents), `file-operations.ts` (guarded rename, move, Office save), `key-routes.ts`, `plugin-routes.ts`, `gateway-routes.ts` |
| Preferences | `device-preferences.ts`, `onboarding-preferences.ts` |
| Store | `caduceus-store.ts` |

### The store (`caduceus.db`)
Migrations are append-only and counted by `PRAGMA user_version`; 24 are applied today. Never edit a shipped migration. The base schema has `owner`, `sessions` and `audit`. Migrations add, in order:

| # | Tables and changes | Ticket |
|---|---|---|
| 1 | `passkeys`; `owner` gets a nullable password and a WebAuthn user handle | M0 #04 |
| 2 | `device_preferences` | M0 #07 |
| 3 | `audit.tier`, `audit.profile`; `settings` (read-only mode and other keys) | M0 #08 |
| 4 | `profile_preferences` | M4 #01 |
| 5 | `gateway_restart_pending` | M5 #01 |
| 6 | `saved_filters` | M3 #03 |
| 7 | `file_snapshots` (text a write replaced, ring buffer) | M4 #02 |
| 8 | `template_categories` | M3 #08 |
| 9 | `workspaces` | M3 #10 |
| 10 | `chat_drafts`, `chat_draft_attachments` | M1 #11 |
| 11 | `saved_prompts` | M1 #11 |
| 12 | `inbox_hidden`, `activity_cursors` | M2 #02 |
| 13 | `push_subscriptions`, `push_log`, `push_digest` | M2 #03 |
| 14 | `file_byte_snapshots` (Office saves) | M7 #02 |
| 15 | `shares` | M7 #06 |
| 16 | `auth_methods` (OIDC, Tailscale) | M5 #15 |
| 17 | `hindsight_banks`, `notes_sources`, `notes_commands` | M4 #10 |
| 18 | `job_notifications_off` | M3 #09 |
| 19 | `push_subscriptions.session_id` | security |
| 20 | `artifacts` | M6 #05 |
| 21 | `budgets`, `budget_alerts` | M5 #05 |
| 22 | `hindsight_key_urls` | security |
| 23 | `guard_trips`, `guard_actions`, `guard_exempt_jobs` | M6 #06 |
| 24 | `today_state`, `today_opened` | M8 #03 |

The tables hold Caduceus-only concepts and Hermes references, never copies of Hermes state (D1). The Inbox activity feed and the Repair history are in memory and a restart empties them.

### The Desk as built (M8)
The Desk replaced Home and the Inbox decision list. The screens are described in `information-architecture.md`; this is what sits under them.

- **Today's review state** (`server/src/today.ts`, rules in `today-review.ts`, types in `contracts/today.ts`; migration 24). Hermes knows what finished. It has no notion of "opened", so that one fact is Caduceus's own. Three routes, all behind sign-in:
  - `GET /_caduceus/api/today/ready`: **read live on every ask** from every Hermes Kanban board (tasks in Done with their `completed_at`), from Hermes's cross-profile session list of the `cron` source (scheduled-job runs it closed with `cron_complete`, one item per job: its newest run, id `run:<session id>`, stamp `ended_at`) and from the activity feed (finished chat runs). Nothing is cached. It answers 502 with words when Hermes does not answer. An item is offered when it finished inside 14 days, after Caduceus began keeping the owner's place, and has not been opened at its current finish stamp.
  - `POST /_caduceus/api/today/ready/opened` `{id, stamp}`: **kept**. `today_opened` holds an id (`task:<board>:<id>` or `run:<session id>`) and the stamp of the finish that was opened, never a title, summary or result. A task finished again has a later stamp and returns as new work. Markers older than 28 days are pruned.
  - `POST /_caduceus/api/today/visit` → `{since, at}`: **kept** in `today_state` (`began_at`, `visit_at`, `previous_visit_at`). Opening Today again within 15 minutes is the same visit, so a reload does not empty "While you were away".
  - Talk calls the opened route when its chat is open (`talk-review.ts`, `use-review-opened.ts`), also when a run finishes while its chat is already open; Work calls it when a row is opened. Both make the item leave Ready for review.
  - The activity feed is in memory, so a restart empties the finished chat runs it offers.
- **Crew state** (`web/src/modules/crew/crew-state.ts`, pure, stores nothing): per profile one of waiting, working, done, blocked, idle, with a live line and a time, derived from the Inbox's live stream and Today's review state (approvals and questions: waiting; live runs: working; failed notices: blocked; items in Ready for review: done). Precedence: waiting, working, blocked, done, idle. The page keeps one copy of the ready list for it (`web/src/modules/today/ready-feed.ts`), read after the first screen is done and again when a run finishes, Hermes's sessions change, the gateway is ready or the tab returns; `markOpened` there reads it again, so opening the work anywhere clears the agent's Finished ring. A device can hide the ring and tick (Settings › Chat › Finished marks on agents, `finishedMarks` in `contracts/chat-behaviour.ts`; `<html data-finished-marks-hidden>`).
- **Background runs are read on their own task** (`server/src/inbox-requests.ts`, commit 58f56fc). Hermes lists a delegated (Delegate intent) run nowhere but as its own `bg_<id>` session in the profile's store. The live-request observer reads those beside `session.active_list`, with `is_active`, and marks them `HomeRun.background`. The read runs after the live sessions are looked at and on a task of its own, never inside a look: a look that waited on those reads came round too late to see a short run working, and the activity feed then never heard it finish. A run that left the list is told to the activity feed (`onBackgroundDone`). Talk never opens a `bg_` session as an agent's latest conversation.
- **The Inbox's data layer stays; its screen is gone.** The live stream (`useInbox`, `inbox-feed.ts`), the model, `InboxDecision` and `inbox-actions.ts` (web) and `server/src/inbox*.ts` feed Today (Needs you), the Talk tray, Work and the crew. Decisions keep their tiers, undo and step-up in one component (`today/DecisionCard.tsx` over `InboxDecision`), shared by Today and the tray.
- **The tray** (`web/src/modules/chat/decide-tray.ts`, `DecideTray.tsx`) lists the decisions of other agents and of other sessions of the same agent (labelled with the session title). The open session's own decision stays inline in the transcript. It ignores the profile scope, because a Talk screen is always scoped to its own agent.
- **Notices** (`web/src/modules/notices/`, `/notices`, Control › Main) shows what the Inbox kept that is not a decision: failed, FYI and decision-less items with their actions, snooze and dismiss, and the Activity feed.
- **Routes removed.** Home's `POST /_caduceus/api/home/runs/:id/steer` and `/stop` (`home-routes.ts`) are removed with Home. The web routes `/`, `/home`, `/inbox` and `/inbox/:itemId` redirect to `/today`; push and notification links that named the Inbox open `/today`.
- **Removed with Home, replaced by nothing:** the offline Home snapshot (`caduceus.home-snapshot`; the sign-in screen still clears a copy an older version left on the device). **Moved to Today:** the Install card and the setup guide's offer, shown after the blocks; Install stays in Settings › Install app too. Home's health strip is gone from the landing screen (Health, in Control, stays); today's spend of the open agent is in Talk's Details, and Insights holds the full spend.

### Policy tiers and the maps
`contracts/policy/` is shared by the server (enforces) and the web app (mirrors):
- `tiers.ts`: `Tier` (`T0`, `T1`, `T2`, `T3`, `denied`), the denial reasons and their messages.
- `rest.ts`: one row per pinned REST operation (333) with its tier, whether it is a read, and where a request names a file path (`FilePathSource`).
- `gateway.ts`: the 219 methods, 12 server requests and 69 events; a method's tier may depend on its params (`refine`): `approval.respond`, `config.set`, `cron.manage`, slash commands (`slashPolicy`).
- `owned.ts`: the operations Caduceus performs itself (`CADUCEUS_OPERATIONS`), judged like Hermes routes.
- `guards.ts`: `isRecord`.

`server/test/policy-map.test.ts` fails on anything unclassified or conflicting. The order of checks is in §5 "Policy proxy as built".

### Security rules added by the security pass
Each is a commit marked `(security: …)` in `git log`.
- **File guard deny-lists** (`file-guard.ts`): protected names, credential folders under the owner's home and Hermes's home, private keys, archives and backups on file routes, and code-persistence places. See §5 "File writes".
- **T3 for writes outside a workspace**, T1 inside a registered one.
- **CSP on every answer** (`content-security-policy.ts`): `default-src 'self'`, scripts from the app's own files plus the pre-paint script by SHA-256 hash, `connect-src 'self'`, `frame-ancestors 'self'`, `object-src 'self'`, `base-uri 'none'`. `img-src` also allows `https:`. Answers carry `nosniff`, `Referrer-Policy: no-referrer` and same-origin framing; sign-in follows only a path of this origin.
- **Push subscription is T2**, audited, limited to the push services' hosts over HTTPS, and ends with the session that made it.
- **Share redaction** (`contracts/share-links.ts`): secrets in text (tokens, keys, private keys, bearer headers, passwords in addresses and assignments) and tool arguments with secret-like names are removed from the frozen snapshot.
- **Slash commands** are judged as Hermes reads them (every leading slash, Python white space, aliases by real name).
- **Config secrets** (a password in an address of the config) are masked in reads and put back when the masked value is sent back.
- **Hindsight key** is sent only to the address it was first used with; in cloud mode only to a public https address.
- **Backup** is T3; its archive never reaches a file route; it is written only to a `backups` folder.

### Test fixtures (`server/test/fixtures/`)
- `real-hermes.ts`: `launchTestHermes()` runs the real launcher against a temp `HERMES_HOME` and a temp HOME of its own (`isolatedHome`: the owner's files by symlink, an empty `.local/bin`). `TestHermes.cli(...args)` is **async** and resolves with what the CLI printed; it never blocks the event loop (`run-program.ts`). `HERMES_WORK_TIMEOUT_MS` (60 s) is the limit for waits on Hermes doing work.
- `run-temp-root.ts`: vitest `globalSetup` (see `vitest.config.ts`). Each run gets `TMPDIR=<tmp>/vitest-run-<pid>-…`. A test that leaves a `caduceus-*` or `fake-hermes-*` directory fails the run by name. A killed run's directory is removed by the next run once its pid is gone.
- `vitest.config.ts`: `maxWorkers: 5` (the default was nine here, and over half of the files start their own Hermes, so they starved each other), `testTimeout` 15 s, `hookTimeout` 60 s.
- Stubs: `stub-llm.ts`, `stub-speech.ts`, `stub-telegram-setup.ts`, `stub-oidc.ts`, `push-stub.ts`, `hindsight-stub.ts`, `honcho-oauth-server.ts`, `mcp-oauth-server.ts`, `mcp-http-server.ts`, `mcp-server.mjs`, `device-code-portal.ts`, `huggingface-fixture.ts`, `hub-fixture.ts`, `plugin-repo.ts`, `deployment-repo.ts`.
- Faults only: `fake-hermes.mjs` and `fake-hermes.ts`. System programs: `fake-system.ts` (`launchctl`, `tailscale`, `hermes`), `plist.ts`.
- Helpers: `owner.ts`, `step-up.ts`, `software-authenticator.ts`, `browser-socket.ts`, `gateway-client.ts`, `event-stream.ts`, `grace-clock.ts`, `launcher-host.ts`, `seed-session.ts`, `seed-logs.ts`, `seed-pairing.ts`, `mcp-client.ts`.

### Hermes checkpoints
Workspace › Checkpoints needs Hermes to take agent checkpoints, which its gateway does only when `HERMES_TUI_CHECKPOINTS` is set. `hermes-backend.ts` sets it to `1` for the Hermes that Caduceus runs, unless the environment Caduceus started with already sets it.
