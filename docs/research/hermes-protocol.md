# Hermes JSON-RPC Gateway Protocol: Can It Run Caduceus Dashboard Chat?

Research date: 2026-10-06. Agent checkout: `~/.hermes/hermes-agent` v0.21.4 (live instance reports `"version":"0.21.4"`, `config_version 44`). All paths below are relative to that checkout unless they start with `~/hermes-dashboard`. Anything not checked against source or the live instance is marked `[INFERENCE]`.

---

## 0. Answers (acceptance)

**Can a browser PWA on another device use this contract for full chat?** **Yes, with gaps.** Hermes Desktop and the dashboard's own Chat tab use the same contract. The dashboard's `/api/ws` endpoint serves it to browsers. Sources: `hermes_cli/web_routers/chat_ws.py:567-590`, `web/src/lib/gatewayClient.ts:29-62`, `apps/desktop/src/AGENTS.md:6-15`. I connected live from another host on the tailnet, got a ticket and handshake, and called read-only methods (§11).

The contract covers almost every chat and run-control capability in research README §2.1 and §2.2: streaming, reasoning, tool cards, approvals (once / session / always / deny), clarify, queue / interrupt / steer / redirect, `/btw`, `/background`, `/goal` (session control), attachments, edit / regenerate (truncate-and-resubmit), fork, undo, per-session model / reasoning / fast, context, cost and compress, slash commands, subagents, todos, and resume / rename / branch / hide / delete. The remaining gaps:

1. **Voice is host-side in RPC.** `voice.record` and `voice.tts` use the Hermes host's microphone and speaker, so a browser must use the REST audio routes instead (§6).
2. **Session search and paginated listing are REST-only.** Neither is in RPC. `session.list` has no offset or full-text search.
3. **Server-side drafts, saved prompts, share links and pins do not exist** in Hermes at all.
4. **No push channel exists.** Events reach only connected sockets. That rules out Web Push or notifications while the PWA is closed unless a companion process holds the connection.
5. **No live view of sessions running in other processes.** This covers the messaging gateway, cron and kanban workers. Their transcripts are readable from the database after the fact, but they cannot be watched live or driven while that process owns them (`SESSION_NOT_OWNED`).
6. **Authentication is all-or-nothing.** Any authenticated socket can call every method, including `shell.exec`, `cli.exec`, plugin install and billing (§10).

**How it authenticates.** The live instance runs in gated mode (`/api/status` → `auth_required: true, auth_providers: ["basic"], auth_flows: ["cookie","native_pkce"]`). Sequence:

1. `POST /auth/password-login` (or the OAuth redirect flow) sets the HttpOnly session cookies `hermes_session_at` and `hermes_session_rt`.
2. Authenticated `POST /api/auth/ws-ticket` returns `{ticket, ttl_seconds: 30}`. The ticket is single-use.
3. Open `wss://<host>/api/ws` with `Sec-WebSocket-Protocol: hermes-gateway-v1, hermes-gateway-ticket.<ticket>`, or with `?ticket=`.

The server also checks that the Host and Origin hostnames match the bound host or the configured `dashboard.public_url`. REST CORS allows `localhost` origins only and does not send credentials. So Caduceus must be served **from the same origin as the Hermes dashboard**, for example behind one HTTPS reverse proxy or Tailscale Serve, or reach Hermes through its own BFF (backend-for-frontend server). Details in §2.3.

**How resume works.**

- The server stamps every session event with a per-session `seq`. It keeps the last 512 events / 4 MiB per session (64 MiB per process) in an in-memory ring, tagged with a process `replay_epoch`.
- After reconnecting, the client calls `session.events.since {session_id, last_seen}`. The reply carries the missed events, `truncated`, `epoch` and `open_requests` (approvals and clarifies still waiting for an answer).
- To re-attach to the live session, the client calls `session.activate` (live runtime id) or `session.resume` (stored id). Both return an `inflight` snapshot of the partial turn, `queued`, `pending_approval`, `todo_state` and `open_requests`.
- A detached session that is idle is reaped after 20 s (`ws_orphan_reap_grace_s`). A detached *running* turn keeps going; it is interrupted only after 600 s with no activity.
- If the process dies, a durable turn marker lets `session.resume` auto-continue a fresh interrupted turn (15 min window).
- The shared client `JsonRpcGatewayClient` implements watermarks, replay, holding live frames back during replay, and epoch reset. Details in §2.5.

**What's missing compared with WebUI chat:** see §7. In short: server-side drafts across devices, saved prompts, public share links, pins, browser-mic voice over RPC (REST covers it), a run journal that survives a server restart (Hermes's replay ring is in-memory; only the turn marker and the database survive), full-text search over RPC, git-worktree sessions on a remote host, and push notifications.

---

## 1. Contract location, generation and versioning

| Item | Where | Notes |
|---|---|---|
| Source of truth | `tui_gateway/contracts/*.py` (Pydantic, `extra="forbid"`) | `tui_gateway/AGENTS.md:36-50` |
| Generated OpenRPC | `apps/shared/src/gateway-contract.openrpc.json` | `openrpc: 1.3.2`, `info.title "Hermes TUI/Desktop gateway"`, `info.version "1"`. 219 `methods`, 12 `x-server-requests`, 69 `x-notifications`. |
| Generated TS | `apps/shared/src/gateway-contract.generated.ts` (5,133 lines) | `RpcMethods`, `ServerRequestMap`, `BackendGatewayEventMap`, `GATEWAY_EVENT_TYPES`. A test fails when the file is stale (`tui_gateway/AGENTS.md:43-46`). |
| Event envelope | `apps/shared/src/gateway-events.ts:19-50` | `{type, session_id?, seq?, payload?}` plus client-local synthetic events (`gateway.reconnecting`, …). |
| Param validation | `tui_gateway/rpc_dispatch.py:27-31` | Unknown keys are rejected with error `4000`. Verified live: `"bogus: Extra inputs are not permitted"`. Unknown method returns `-32601`. |
| Compatibility markers | `gateway.ready.payload` `{skin, change_events, heartbeat, replay_epoch}` (`tui_gateway/ws.py:299-304`); `gateway.capabilities` → `{per_session_exclusive_submit}`; `session.info.desktop_contract` = **7**, a monotonic GUI↔backend contract number. v7 = blocking prompts are server→client requests (`tui_gateway/server.py:2045-2051`). | There is no version handshake: the client adapts based on these fields, `-32601` replies and `desktop_contract`. Desktop refuses a backend that reports a lower contract number (`server.py:2045`). |
| Reusability | `@hermes/shared` is `"private": true` and has no runtime dependencies (`apps/shared/package.json`). The repo is MIT (`LICENSE`). | Caduceus would vendor it (pinned to the Hermes version) or generate from the OpenRPC JSON `[INFERENCE: either works; vendoring keeps replay/heartbeat logic identical to Desktop]`. |

---

## 2. Transport

### 2.1 Who hosts the gateway

| Host | Transport | Use |
|---|---|---|
| `tui_gateway.entry` | Newline-delimited JSON-RPC over **stdio** | Ink TUI child (`tui_gateway/AGENTS.md:7-34`) |
| Dashboard `hermes dashboard` / headless `hermes serve` (same `cmd_dashboard` / `start_server`) | WebSocket **`/api/ws`** → `tui_gateway.ws.handle_ws` | Desktop (local pooled `serve` per connection+profile, or remote), dashboard Chat-tab sidecar (`apps/desktop/src/AGENTS.md:6-34`; `chat_ws.py:573-590`). Agents run **inside the dashboard process** (`hermes_cli/main.py:2662`). |
| Same server | `/api/pub` + `/api/events?channel=` | Relay that rebroadcasts frames from the PTY child's TUI gateway to sidebar subscribers. Not needed for native chat (`chat_ws.py:596-644`). |
| Same server | `/api/pty` (TUI in xterm), `/api/console` (curated CLI engine), `/api/audio/speak-stream` | Terminal mode, voice |
| Messaging gateway (:8642 API server) | REST + SSE `/v1/runs` | A different protocol (§8) |

The live instance at `http://100.64.0.10:9119` serves `/api/ws`. The handshake succeeded (§11).

### 2.2 Framing and handshake

- Each JSON-RPC 2.0 object travels in its own WS text message. The server sends a batch as separate frames, in order (`ws.py:185-214`).
- **Frame 1 is always** `{"jsonrpc":"2.0","method":"event","params":{"type":"gateway.ready","payload":{skin, change_events:true, heartbeat:true, replay_epoch}}}` (`ws.py:299-304`; verified live, `replay_epoch` is 32 hex chars).
- The client then sends `client.capabilities {server_requests:true}`. The shared channel does this automatically (`apps/shared/src/json-rpc-channel.ts:489-491`). **Without it, every approval or clarify fails immediately for that socket** (`tui_gateway/server_requests.py:24-28`).
- Client→server: `{"jsonrpc":"2.0","id","method","params"}`. Long handlers run on a pool; the response may arrive after later events (`rpc_dispatch.py:45-87`).
- Server→client events: `method:"event"`, `params:{type, session_id?, seq?, payload}`. The server stamps `seq` per session; session-less broadcasts have no seq (`event_replay.py:50-69`).
- Server→client requests: `{"jsonrpc":"2.0","id":"srq-<12hex>","method":"approval"|…,"params":{session_id,…}}`. The client replies `{"jsonrpc":"2.0","id":"srq-…","result":{…}}` (`server_requests.py:1-13,61-63`; `rpc_dispatch.py:54-58`). The server withdraws a request with a `request.cancel {id, method, reason}` event.
- Heartbeat: the client sends `gateway.ping` every 15 s and drops the socket after 45 s with no inbound frame. Any inbound frame counts as liveness (`json-rpc-channel.ts:143-144`; `json-rpc-gateway.ts:158-171`). The server answers `gateway.ping` on the read loop even while agents are busy (`ws.py:352-355`; verified live, 66 ms). The contract also has `ping` → `{pong:true}`. On non-loopback binds uvicorn adds WS protocol pings at 20 s / 20 s (`web_server.py:1157-1198`).

### 2.3 Auth, Origin/Host, CORS

| Mode | Credential on the WS upgrade | Source |
|---|---|---|
| Loopback / `--insecure` | `?token=<_SESSION_TOKEN>` (injected into the SPA as `window.__HERMES_SESSION_TOKEN__`); constant-time compare | `web_server_chat.py:285-290`; `web_server_dashboard.py:114-146` |
| **Gated** (any non-loopback bind or non-loopback `dashboard.public_url`) | Single-use 30 s **ticket** via the subprotocol `hermes-gateway-ticket.<t>` alongside `hermes-gateway-v1` (the server selects only `hermes-gateway-v1`, so the credential never echoes back), or `?ticket=`; `?internal=` is reserved for server-spawned children. **The legacy token is rejected.** | `web_server_chat.py:202-283`; `dashboard_auth/ws_tickets.py:1-60` |
| Ticket mint | `POST /api/auth/ws-ticket` (requires session cookie or bearer) → `{ticket, ttl_seconds}` | `dashboard_auth/routes.py:458-466` |
| Login | `POST /auth/password-login {provider, username, password}` (basic) or `/auth/login?provider=` OAuth; native apps use RFC 8252 PKCE `/auth/native/{authorize,token,refresh}` → bearer (OAuth providers only, not password) | `dashboard_auth/routes.py:1-17,365-373`; `apps/desktop/electron/native-auth-decisions.ts:218-226` |
| Cookies | `hermes_session_at` (access token), `hermes_session_rt` (rotating refresh token), `hermes_session_provider`. HttpOnly, `SameSite=Lax`, `Secure` on https. Path = proxy prefix. | `dashboard_auth/cookies.py:3-10,59-63` |
| Identity | The ticket's `{user_id, provider}` is attached to the transport (`auth_identity`). It is the only identity authority for `browser.controller.register` and for the agent's `user_id`. RPC params can never set it. | `web_server_chat.py:247-254`; `ws.py:96-99` |
| Host check | Host must equal the bound host, a loopback alias (on a loopback bind), an exact `dashboard.public_url` hostname, or anything on a `0.0.0.0` bind. **Ports are ignored.** | `web_server.py:548-572` |
| Origin check | If an `Origin` header is present and http(s), its **hostname** must pass the same test. A missing Origin, `file:`, `app:` or `null` is allowed. | `web_server_chat.py:165-189` |
| Peer-IP check | Loopback bind → loopback peers only; gated or non-loopback → any peer | `web_server_chat.py:137-157` |
| REST CORS | `allow_origin_regex=^https?://(localhost\|127.0.0.1)(:\d+)?$`, **no `allow_credentials`** | `web_server.py:388-395` |

**Verified live (§11):**

- Subprotocol ticket and `?ticket=` ticket: both accepted.
- Reused ticket, no credential, garbage `?token=`: HTTP 403.
- Foreign-host Origin: 403.
- Same host on a different port: accepted.
- No Origin header: accepted.
- CORS preflight from `http://100.64.0.10:5173`: 400. From `http://localhost:5173`: allowed, but without credentials.

**Deployment consequence (decision input).** A PWA on another origin cannot read `POST /api/auth/ws-ticket`: CORS blocks the response, and the cookies are Lax and first-party. Two workable topologies:

1. **Same-origin proxy (no Caduceus server).** One HTTPS hostname, e.g. Tailscale Serve or Caddy. It serves Caduceus static bundle and forwards `/api/*`, `/auth/*` and `/login` to Hermes :9119. Set `dashboard.public_url` to that hostname so the Host/Origin checks accept it (`web_server.py:452-465,1098-1102`). The browser then uses Hermes's own login. `X-Forwarded-Prefix` is supported, so Hermes can live under a sub-path (`dashboard_auth/routes.py:60-62`; `web/src/lib/gatewayClient.ts:58` `HERMES_BASE_PATH`). `[INFERENCE: exact path split between Caduceus SPA and Hermes routes must avoid `/api/*` collisions; mounting Hermes under a prefix is the clean option.]`
2. **Caduceus BFF.** A thin server holds the Hermes session or bearer server-side, proxies REST and WS, and sets an acceptable Origin. Only this option can provide Web Push or background notifications, because the protocol delivers only to connected sockets (§7). It adds a second auth layer to secure.

In both cases the PWA needs **HTTPS**. Plain-HTTP tailnet access loses service workers and `getUserMedia` (`~/hermes-dashboard/docs/research/hermes-dashboard.md:421`).

### 2.4 Multi-profile routing

- One `serve`/dashboard process can host sessions from several `HERMES_HOME` profiles. Every home/config/`.env`-touching method runs under `@_profile_scoped`, resolved from the live session's `profile_home` or an explicit `profile` param. The first non-launch home turns on fail-closed multiplex guards (`tui_gateway/AGENTS.md:52-74`).
- Nearly every method accepts `profile?: string|null`. A profile that cannot be resolved fails closed with `4064` (`rpc_dispatch.py:35-36`).
- Desktop keeps one socket per (connection, profile) and tags events with `profile` / `connectionId` (`gateway-events.ts:39-44`; `apps/desktop/src/AGENTS.md:26-34`).
- For Caduceus's per-tab profile scoping (decision 6), one socket can carry calls for several profiles by passing `profile`. One socket per profile is also possible. "All profiles" views need N calls (e.g. `session.list` per profile) or REST `/api/profiles/sessions`.
- Only REST `POST /api/profiles/active` changes the sticky default. RPC calls with `profile` never do.

### 2.5 Replay, resume and reconnect

Server side (`tui_gateway/event_replay.py`):

- Per-session seq counters and ring: `_REPLAY_BUFFER_MAX=512` events, `4 MiB` per session, `64 MiB` per process, LRU across `64` sessions (`:26-34`).
- A frame larger than the per-session budget is not stored and marks the ring as truncated (`:79-81`).
- The `_REPLAY_EPOCH` uuid changes on every process start (`:21-24`).
- `session.events.since` → `{events, latest_seq, truncated, count, epoch, open_requests}`. It does not re-attach the socket (`methods_session.py:2264-2278`).

Re-attach: `session.activate {session_id: runtime}` or `session.resume {session_id: stored, source, omit_messages, lazy, defer_history}` returns `SessionResumeResult`:

```
session_id, stored_session_id, session_key, messages(+omitted/hydrating), info(SessionLiveInfo),
running, turn_started_at, status, inflight{assistant, streaming, user, corrections, error, …},
queued, pending_approval, open_requests, pending_connection, todo_state, auto_continue
```

The shared channel re-delivers `open_requests` to the request handlers *before* the caller sees the result (`json-rpc-channel.ts:456-460`). Desktop's recovery pattern: on `session not found` (4001/4007) for a stale runtime id, call `session.resume(stored id, source, omit_messages:true)` and retry the call with the new runtime id (`apps/desktop/src/app/session/hooks/use-prompt-actions/index.test.tsx:3555-3558`; `submit.ts:611-614`).

Detached-session lifecycle:

- On WS close, sessions created with `close_on_disconnect` are reaped. The rest detach to a drop sentinel (`ws.py:389-398`).
- After `ws_orphan_reap_grace_s` (default **20 s**), an *idle* orphan is reaped. A *running* turn is interrupted only after `ws_orphan_activity_stale_s` (**600 s**) without activity (`server.py:119-137`; `config_defaults.py:991-996`).
- Idle TTL is 6 h. An LRU cap evicts detached sessions only (`server.py:361`; `session_reaper.py:278-309`).
- The stored database row always stays resumable.

Crash survival: a turn marker is written at turn start and cleared when the turn ends, so only process death leaves one behind. `session.resume` then auto-continues if the turn is fresher than 15 min (`turn_marker.py:1-7`; `session_auto_continue.py:11-18`). `prompt.submit` writes the session row and user row before the agent builds (`apps/desktop/AGENTS.md:59-63`).

Client side (`apps/shared/src/json-rpc-gateway.ts`):

- Per-session `lastSeenSeq` watermarks (`:113-114`).
- On open, `fetchReplay()` calls `session.events.since` per known session with a 10 s timeout (`:240-254,461-537`).
- Live seq'd frames for sessions being replayed are held back and flushed seq-gated, so frames are neither duplicated nor skipped (`:119-126,577-591`).
- An epoch change clears the watermarks (`:565-575`).
- The 15 s connect timeout gives a clean `error` state (`:46-49`).
- Reconnect delay comes from `reconnectBackoffDelayMs`: full jitter, base 300 ms, cap 15 s. The ladder resets only after a socket stays open ≥ 5 s (`reconnect-backoff.ts:27-58`). The *owner* decides when to redial and must **mint a fresh ticket per dial** (`websocket-url.ts:39-94`; `apps/desktop/AGENTS.md:150-155`).
- Watermarks live in memory only. After a PWA reload, recover from the resume snapshot (`inflight`, `messages`) rather than replay.

Mobile caveat: 512 events can be only seconds of token deltas on a long turn. The server coalesces deltas into ~30 fps batches on the wire (`ws.py:71-77`), but stamps each delta separately `[INFERENCE: _stamp_event runs per emitted event; coalescing happens later in WSTransport.write]`. Expect `truncated:true` after a phone sleep. The `inflight` snapshot is the real recovery path.

### 2.6 Multi-client fan-out

- A live session holds a `FanoutTransport` of every attached socket. A second device attaches by `session.activate` or `session.resume`, and all peers receive the session's events and server→client requests (`tui_gateway/session_transports.py:20-112`).
- **Ownership is not enforced.** A second login sharing a session is only logged (`session_transports.py:50-59`).
- The first answer to an `srq-*` wins; later answers for a closed id are dropped (`server_requests.py:11-13`).
- Session-less broadcasts reach every live socket: `sessions.changed`, `cron.changed`, `skin.changed`, `platforms.changed`, `pairing.changed`, `setup.ready`, … (`server.py:673-690`; `change_watcher.py:216-219`).
- Across processes, `per_session_exclusive_submit=true`: a session owned by another live process (e.g. the messaging gateway) refuses writes with `SESSION_NOT_OWNED` (`hermes_cli/active_sessions.py:101-117`).
- The TUI-in-terminal mode can share the same in-process gateway: the dashboard spawns the PTY child with `HERMES_TUI_GATEWAY_URL` pointing at this process, except for profile-scoped chats (`web_server_chat.py:303-307,375`). The native chat and the TUI pane can therefore view the same sessions.

### 2.7 Backpressure and limits

- Token events (`message.delta`, `reasoning.delta`, `thinking.delta`) are coalesced on a 33 ms timer. Any other frame flushes the buffer first, so order is preserved (`ws.py:71-77,110-168`).
- A writer that cannot drain a frame in 30 s is treated as dead: the server closes with 1011, which triggers the client reconnect. A worker thread waits at most 10 s on a stalled event loop (`ws.py:59-68,185-205`).
- Max WS message size is 384 MiB, for base64 attachments (`web_server.py:384-385,1197`).
- The JSON-RPC request timeout defaults to 120 s on the client (`json-rpc-gateway.ts:40`).
- There is no flow control beyond this. The ring caps protect server memory.

---

## 3. Method inventory (219 methods, 62 prefixes)

The OpenRPC file carries the full shapes. P = notable params, R = result highlights. Almost every method accepts `profile?`. Session methods take the *runtime* `session_id` except `session.resume`, `session.delete` and `session.set_hidden`, which take the stored id.

### 3.1 Chat core

| Domain | Methods | Notes |
|---|---|---|
| Session lifecycle (30) | `session.create` (P: cwd, model, provider, reasoning_effort, fast, source, parent_session_id, title, messages, close_on_disconnect, hidden; R: session_id, stored_session_id, info) · `session.resume` · `session.activate` · `session.close` · `session.delete` · `session.list` (P: title, limit, include_hidden; **no offset**) · `session.most_recent` · `session.active_list` · `session.history` (durable transcript with row ids) · `session.title` · `session.branch` (P: name, count) · `session.undo` · `session.compress` (focus_topic) · `session.usage` · `session.context_breakdown` · `session.status` · `session.save` · `session.set_hidden` · `session.cwd.set` · `session.workspace.move` · `session.interrupt` · `session.steer` · `session.redirect` · `session.control` / `.read` (goal / loop / subgoal / heartbeat) · `session.events.since` / `.stats` · `session.foreign.list` / `preview` / `import` (Claude Code / Codex) | `contracts/sessions.py:143-647` |
| Prompting (3) | `prompt.submit` (P: text, queued, interrupted, surface, voice_context, title_preview, `truncate_before_row_id` / `message_id` / `user_ordinal` + `confirm_truncate`; R: status `streaming\|queued\|steered\|redirected`) · `prompt.btw` → `btw.complete` · `prompt.background` → `background.complete` | `contracts/prompt_voice.py:28-74,229-232` |
| Approvals / prompts (5) | `approval.respond` (choice, all, request_id) · `approval.pending` · `approval.received` (starts the timeout clock) · `clarify.lock` (batch answers) · `request.answer` (answer an `srq` from a client that never got the frame) | `prompt_voice.py:268-327,282` |
| Attachments (8) | `image.attach_bytes` (base64, remote-safe) · `image.attach` (host path) · `image.detach` · `file.attach` (`data_url` or host path → `@file:` ref) · `pdf.attach` (base64 → page images) · `clipboard.paste` (host clipboard) · `input.detect_drop` · `paste.collapse` | `prompt_voice.py:127-179` |
| Slash / completion (6) | `commands.catalog` · `complete.slash` · `complete.path` · `slash.exec` · `command.dispatch` (R type: `exec\|alias\|plugin\|send\|skill\|prefill`) · `command.resolve` | `tools_commands.py:227,303`; live: catalog returned 309 pairs |
| Subagents (9) | `subagent.list` / `tail` / `steer` / `interrupt` · `delegation.status` / `pause` · `spawn_tree.list` / `load` / `save` | `tui_gateway/AGENTS.md:91-119` |
| Model / config (6) | `model.options` · `model.save_key` · `model.disconnect` · `config.get` · `config.set` (keys: model, fast, busy, verbose, approval_mode, approvals.mode, yolo, reasoning, details_mode, thinking_mode, cwd, prompt, personality, skin, voice.voice_chat_mode, …; scope session vs persisted) · `config.show` | `methods_config_set.py:465-483` |
| Session extras | `message.react` · `rollback.list` / `diff` / `restore` · `process.list` / `kill` / `stop` · `handoff.request` / `state` / `fail` · `terminal.resize` · `verification.status` · `llm.oneshot` · `image.generate` | |
| Liveness / capabilities | `ping` · `gateway.capabilities` · `client.capabilities` | `contracts/liveness.py:17-41` |

### 3.2 Management (overlaps REST)

| Domain | Methods |
|---|---|
| Profiles (7) | `profiles.list` (roster + canonical / last / worker session; live: 6 rows) · `describe` · `configure` (soul, model, skills, toolsets, MCP, `ui_meta` with revisions) · `create` · `get_asset` / `set_asset` · `remember_onboarding` |
| Projects (16) | `projects.list` / `get` / `create` / `update` / `archive` / `delete` / `set_active` / `add_folder` / `remove_folder` / `set_primary` / `tree` / `project_sessions` / `discover_repos` / `record_repos` / `for_cwd` · `project.facts` |
| Tools / MCP / plugins / skills (20) | `tools.list` / `show` / `configure` · `toolsets.list` · `mcp.catalog` / `servers.list` / `status` / `add` / `remove` / `test` / `set_api_key` / `oauth.start` / `poll` / `callback` / `cancel` · `reload.mcp` / `reload.env` · `plugins.list` / `manage` (incl. git-install) · `skills.manage` / `reload` |
| Cron (1) | `cron.manage` (list / add / remove / pause / resume) + `cron.changed` |
| Learning (4) | `learning.frames` / `detail` / `edit` / `delete` (skills / memory nodes) |
| Connectors (5) | `connectors.list` / `connect` / `operation.status` / `operation.wake` · `connection.respond` |
| Browser / CDP (5) | `browser.manage` · `browser.controller.register` / `heartbeat` / `result` / `detach` (identity-bound) |
| Hosted rooms (18) | `groups.capabilities` / `create` / `list` / `state` / `log` / `send` / `approve` / `stop` / `retry` / `rename` / `disband` / `promote` / `demote` / `replicate` / `replica_state` / `peer.invite` / `peer.register` / `peer.revoke` |
| Bot relay (4) | `bot_relay.deliver` / `reply` / `roster.sync` / `outbox.drain` |
| Vault (7) | `vault.list` / `sources` / `source.set` / `add` / `remove` / `unlock` (master password over the wire) / `lock` |
| Billing / Nous (16) | `billing.state` / `charge` / `charge_status` / `auto_reload` / `step_up` · `subscription.state` / `preview` / `change` / `upgrade` / `resume` · `usage.bars` · `free_tier.status` / `ack_notice` / `provision` · `setup.status` / `runtime_check` |
| Voice / wake (9) | `voice.toggle` / `record` / `tts` · `wake.start` / `stop` / `status` / `pause` / `resume` / `feed` (client PCM) |
| Misc | `agents.list` · `insights.get` · `system.battery` · `diagnostics.share_nous` · `preview.restart` · `pet.*` (15, desktop pet) · `shell.exec` · `cli.exec` |

## 4. Server→client requests (12)

`approval` (P: command, description, choices, allow_session, allow_permanent, smart_denied, tool_name → R `{choice: once|session|always|deny, all?}`) · `clarify` (single question or batch `questions` → `{answer}|{answers}`) · `sudo` / `secret` (masked values) · `vault.code` / `vault.save_login` / `vault.unlock_prompt` · `preview.read` / `preview.act` / `terminal.read` / `window.read` / `tour` (desktop GUI bridges, only for `source:"desktop"` sessions). Source: `contracts/server_requests.py:58,94,229`.

`desktop_ui` tools that need the GUI bridges are folded in **only when the session source is `"desktop"`** (`server.py:1827-1831`; root `AGENTS.md:154-175`). Caduceus should create sessions with its own source unless it implements those bridges. Otherwise the agent gets preview/terminal/tour tools that a browser cannot answer. `[INFERENCE: `source` is a free-form string stored as the session's platform; only `"desktop"` is special-cased in the code I read.]`

## 5. Server→client events (69)

| Group | Events |
|---|---|
| Connection | `gateway.ready` · `error` · `notice` · `status.update` (kind: status, lifecycle, compacting, goal, loop, heartbeat, process…) · `notification.show` / `clear` · `request.cancel` |
| Turn stream | `message.start` · `message.delta` · `message.interim` · `message.complete` (text, usage, status `complete\|error\|interrupted`, reasoning, failure_reason, recoverable, billing) · `reasoning.delta` · `reasoning.available` · `thinking.delta` · `review.summary` · `reaction` · `message.reaction` |
| Tools | `tool.generating` · `tool.start` (tool_id, args, preview) · `tool.complete` (result, summary, inline_diff, todos) · `tool.output_risk` · `todo.updated` · `agent.terminal.output` / `terminal.close` |
| Session state | `session.info` (model, provider, reasoning_effort, fast, yolo, approval_mode, cwd, branch, project, running, usage, credential_warning, desktop_contract…) · `session.usage` · `session.title` · `session.control.update` · `session.reclaimed` · `session.resume_progress` |
| Side agents | `btw.complete` · `background.complete` · `subagent.spawn_requested` / `start` / `progress` / `thinking` / `tool` / `complete` · `moa.progress` / `reference` / `phase` / `aggregating` |
| Voice | `voice.status` · `voice.transcript` · `voice.interrupted` · `wake.detected` |
| Change signals (broadcast) | `sessions.changed` · `cron.changed` · `platforms.changed` · `pairing.changed` · `skin.changed` · `pet.changed` · `setup.ready` · `bot_relay.outbox.pending` |
| Connectors / browser | `connection.request` / `update` · `browser.progress` · `browser.controller.command` / `cancel` |
| Desktop GUI | `preview.open` / `close` / `restart.progress` / `restart.complete` · `pane.reveal` · `layout.apply` · `tip.show` |
| Billing / pet | `billing.step_up.verification` · `pet.generate.progress` · `pet.hatch.progress` |

Source: `contracts/events.py:60-690`.

---

## 6. Coverage matrix (README §2.1 and §2.2)

| Capability | Contract backing | Status | Evidence |
|---|---|---|---|
| Native message stream | `prompt.submit` → `message.start` / `delta` / `interim` / `complete` | **supported** | `prompt_voice.py:73`; `events.py:107,120,133,190` |
| Streamed reasoning / thinking | `reasoning.delta`, `reasoning.available`, `thinking.delta`, `message.complete.reasoning`; display via `config.set reasoning\|thinking_mode` | **supported** | `events.py:121-123` |
| Tool cards | `tool.generating` / `start` / `complete` (inline_diff, todos, duration), `tool.output_risk` | **supported** | `events.py:256-296` |
| Approvals once / session / always / deny | srq `approval` → `{choice, all}`; `approval.respond` / `pending` / `received`; `request.cancel`; YOLO and mode via `config.set yolo\|approval_mode` | **supported** | `server_requests.py:94`; `prompt_voice.py:297-327`; enum `ApprovalChoice` |
| Clarify (choices, free text, batch, countdown) | srq `clarify` (single or batch), `clarify.lock`, `request.answer`; 300 s deadline | **supported** (countdown is client-side, from the deadline) | `server_requests.py:20-28,58`; `prompt_voice.py:268` |
| Queue | `prompt.submit` on a busy session → `status: queued`; `queued:true` for client drains; `/queue list\|edit\|rm\|move` via `slash.exec`; `queued` in the resume snapshot | **supported** | `prompt_voice.py:35,54-58`; `hermes_cli/commands.py:111-114` |
| Interrupt | `session.interrupt` → `interrupted\|not_interrupted` | **supported** | `sessions.py:530` |
| Steer / redirect | `session.steer`, `session.redirect` → `queued\|redirected\|rejected` | **supported** | `sessions.py:549-551` |
| `/btw` | `prompt.btw` → `btw.complete` | **supported** | `prompt_voice.py:231`; `events.py:412` |
| `/background` | `prompt.background` → `background.complete` | **supported** | `prompt_voice.py:229`; `events.py:411` |
| `/goal` (and loop / heartbeat) | `session.control {action, args}`, `session.control.read`, `session.control.update` | **supported** | `config_free_tier_control.py:507`; `events.py:386` |
| Attachments / images | `image.attach_bytes`, `file.attach` (data_url), `pdf.attach` (base64), `image.detach`; 384 MiB frames | **supported** (host-path variants `image.attach`, `clipboard.paste`, `input.detect_drop` do not apply to a remote browser) | `prompt_voice.py:127-179`; `web_server.py:384` |
| Voice STT | `voice.record` captures the **host** microphone. A browser needs REST `POST /api/audio/transcribe` (Desktop does this) or `wake.feed` PCM | **partial in RPC; supported via REST** | `prompt_voice.py:385`; `web_routers/audio.py:77`; `apps/desktop/src/api/system.ts:172` |
| Voice TTS | `voice.tts` plays on the **host**. Browser: REST `POST /api/audio/speak` or WS `/api/audio/speak-stream` (PCM); voice-live via `/api/audio/voice-live/session` | **partial in RPC; supported via REST/WS** | `audio.py:283,372`; `apps/desktop/src/lib/voice-playback.ts:105-170` |
| Edit message | `prompt.submit {text, truncate_before_row_id, confirm_truncate}` | **supported** | `prompt_voice.py:28-45` |
| Regenerate | Same truncate-and-resubmit with the original user text | **supported** (the client composes it) | same |
| Fork / branch | `session.branch {name, count}` | **supported** | `sessions.py:358` |
| Undo | `session.undo` | **supported** | `sessions.py:370` |
| Retry | `slash.exec "/retry"` or truncate-and-resubmit | **supported** | `commands.py:68` |
| Copy | client-side | n/a | |
| Model switch per session | `config.set {key:"model", session_id}`; `session.create {model, provider}`; `model.options` | **supported** | `methods_config_set.py:465-466`; `/model` is session-scoped by default (`commands.py:157`) |
| Reasoning-effort switch | `config.set reasoning`; `session.create reasoning_effort` | **supported** | `methods_config_set.py:468` |
| Context usage / cost / cache | `session.usage` (context_used / max / percent, cost_usd, cache_hit_pct, tokens, calls), `session.usage` tick, `session.context_breakdown`, usage in `message.complete` | **supported** | `sessions.py:422,463`; schema `Usage` |
| Compress | `session.compress {focus_topic}` | **supported** | `sessions.py:508` |
| Slash commands | `commands.catalog`, `complete.slash`, `slash.exec`, `command.dispatch` (includes skills and quick commands) | **supported** | `tools_commands.py:227,303`; `tui_gateway/AGENTS.md:121-132` |
| Subagents / delegation | `subagent.*` events, `subagent.list` / `tail` / `steer` / `interrupt`, `delegation.status` / `pause`, `spawn_tree.*` | **supported** | `tui_gateway/AGENTS.md:91-119` |
| Todo list | `todo.updated` (revision), `tool.complete.todos`, `todo_state` on resume | **supported** | `events.py:306` |
| Activity display modes | `config.set details_mode\|tool_progress`, client rendering | **supported** | `methods_config_set.py:468` |
| Session list | `session.list` (title filter, limit, include_hidden, `source` per row) | **partial**: no offset or sort. REST `GET /api/sessions` has limit / offset / source / archived | `sessions.py:209`; `web_routers/sessions.py:165-168` |
| Full-text search | none in RPC | **GAP (RPC)**; REST `GET /api/sessions/search?q&sources&exclude_sources` | `web_routers/sessions.py:254-257` |
| Resume | `session.resume` / `session.activate` | **supported** | `sessions.py:166,179` |
| Rename | `session.title` (queued when the row is not yet created) | **supported** | `sessions.py:280` |
| Delete | `session.delete` (refused while live) | **supported** | `sessions.py:266` |
| Archive / hide | `session.set_hidden` | **supported** (hide ≈ archive) | `sessions.py:297` |
| Pins | none | **GAP** (projects exist: `projects.*`) | |
| Export | `session.save` writes a file on the host; REST `GET /api/sessions/{id}/export` returns JSON | **partial** | `sessions.py:385`; `web_routers/sessions.py:727` |
| Cross-source sessions (CLI, messaging, cron, webhook, kanban) | `session.list` returns `source` but **denies sub-agent and kanban sources**; REST lists all with source filters; Claude Code / Codex via `session.foreign.*`; handoff via `handoff.*` | **partial**: no live tail of sessions run by other processes; writes refused while another process owns the session | `sessions.py:209-210`; `active_sessions.py:101-117` |
| Resumable streams after disconnect | `session.events.since` + `open_requests` + `inflight` snapshot + turn-marker auto-continue | **supported** (bounded ring, in-memory, reset on restart) | §2.5 |
| Multi-device, same session | Fan-out transport; attach by `session.activate` / `resume`; srq delivered to all, first answer wins | **supported** (ownership not enforced) | §2.6 |
| Drafts saved server-side | none | **GAP** | |
| Saved prompts | none (`quick_commands` in config are commands, not prompts) | **GAP** | `methods_tools.py:507-520` |
| Public share links | none | **GAP** | |
| Fast raw-model chat | `llm.oneshot` (stateless; titles / ideas) | **partial** | contract `llm.oneshot` |
| Git-worktree sessions | `/worktree` is `cli_only`; Desktop does worktrees in Electron main on the local machine | **GAP for remote** | `commands.py:78-80`; `apps/desktop/electron/git-worktree-ops.ts` |
| Push notifications (approval needed, run finished) | none; events reach connected sockets only. `session.active_list.status` and `approval.pending` can be polled | **GAP** | `server.py:673-690` |

---

## 7. Missing compared with WebUI chat

From README §2.1/§2.2, with WebUI marked ● where Hermes RPC is short:

1. **Server-side drafts across devices.** Absent. Caduceus stores them itself; decision 1 suggests a file under `HERMES_HOME`.
2. **Saved prompts.** Absent. Caduceus-owned state.
3. **Public share links.** Absent. They need a Caduceus-served read-only renderer.
4. **Pins.** Absent. Projects and `ui_meta` (`profiles.configure ui_meta` with revisions) are the closest Hermes-owned seams `[INFERENCE: ui_meta is per-profile, not per-session]`.
5. **Run journal that survives a server restart.** WebUI keeps a run journal. Hermes keeps an in-memory ring with epoch reset, plus turn-marker auto-continue and database transcripts. After a backend restart, mid-turn deltas are lost, but the persisted turn and auto-continue cover recovery.
6. **Browser-mic voice and hands-free mode.** Supported only through REST audio and voice-live routes, not RPC.
7. **Full-text search and paginated listing.** REST only.
8. **Git-worktree sessions and Office/HTML file previews.** Not in RPC. Files and git have partial REST coverage (`/api/files/*`, `/api/git/file-diff`).
9. **Claude Code import.** Covered by `session.foreign.*`. This one is not a gap.

---

## 8. Alternatives: `/v1/runs` + SSE and `/api/pty`

| | Gateway JSON-RPC (`/api/ws`) | API server `/v1/runs` + SSE (:8642, PatterStage) | `/api/pty` (TUI in xterm) |
|---|---|---|---|
| Host process | Dashboard / `serve` (agents in-process) | Messaging gateway (`hermes gateway`, API server enabled) | Dashboard spawns `hermes --tui` |
| Auth | Cookie → 30 s WS ticket | Bearer `API_SERVER_KEY` (`patterstage.md:37`) | Same as `/api/ws` (`chat_ws.py:104-136`) |
| Chat fidelity | Full: 219 methods, 69 events, srq approvals and clarify, steer / btw / bg / goal, edits, subagents, todos | Run-scoped: `message.delta`, `tool.started` / `completed` (preview ≤ 500 chars), `reasoning.available`, `approval.request` / `responded`, `run.steered` / `stopping` / `interrupted`; steer / stop / approval endpoints; idempotency keys; sessions CRUD + fork + chat stream (`api_server.py:66-101`; `api_server_runs.py:92-96,187-192,809-813,880`) | Everything the TUI does, as pixels: no structured UI, poor on mobile |
| Resume | seq replay + inflight snapshot | `GET /v1/runs/{id}` status poll + SSE re-open; idempotency store survives restarts as `run.interrupted` (`api_server_runs.py:245-246,364-365`) | PTY keep-alive (~30 min, README §2.1) |
| Best for | **Native interactive chat (default)** | Fire-and-forget automation runs, missions and workflow stages that must survive the dashboard process, server-to-server calls with idempotency | Optional "terminal mode" for power users (decision 3); can share sessions with native chat through `HERMES_TUI_GATEWAY_URL` (§2.6) |

Recommendation `[INFERENCE]`: use `/api/ws` for chat and run control, `/v1/runs` for unattended task/mission execution in the unified Tasks model (decision 4), and `/api/pty` as an opt-in tab. Note the process split: a `/v1/runs` run lives in the gateway process and cannot be driven over `/api/ws` while that process owns it (§2.6).

---

## 9. Hermes Desktop as a UX reference

Stack: Electron, React 19, `@assistant-ui/react` 0.14 (transcript / composer runtime), `@assistant-ui/react-streamdown` + `@streamdown/code` / `math`, `@nous-research/ui` 0.18.2 (MIT), nanostores, TanStack Query + Virtual, Tailwind 4, CodeMirror, xterm, dnd-kit, shiki (`apps/desktop/package.json`).

| Area | Features | Paths (`apps/desktop/src/…`) |
|---|---|---|
| Transcript | assistant-ui thread, response groups, timeline rail and timestamps, message reactions, inline user-edit composer, changed-files card, sticky prompt clip, virtualized transcript window and retention, render boundaries | `components/assistant-ui/thread/*`, `app/chat/transcript-window.ts`, `use-transcript-retention.ts` |
| Markdown / rendering | markdown-text with artifacts, file links, media, math (KaTeX), tables, ANSI, directive chips, inline previews, shiki code, zoomable images, video | `components/assistant-ui/markdown-text.tsx`, `components/chat/shiki-*`, `lib/markdown-*` |
| Tool cards | approval card, delegate (subagent) card, fallback, run ticker / summary, skill activity, clarify tool, connector tool, MCP setup tool, artifact card | `components/assistant-ui/tool/*`, `clarify-tool.tsx`, `connector-tool.tsx`, `artifact-card.tsx` |
| Composer | rich editor, slash / path / URL refs, completion drawer, attachments + drop overlay, large-paste spill, model pill, reasoning pill, queue panel, suggestion pills, undo history, voice menu / fan / activity, restored-draft notice, floating pop-out composer | `app/chat/composer/*` |
| Status stack | todos, subagent section / controls / transcript, goal / loop / heartbeat controls, background processes, previews | `app/chat/composer/status-stack/*` |
| Sessions | session tiles / panes (multi-pane), session picker / switcher, branch tree, date groups, search, project labels, import (foreign), runtime / stored id mapping, single-flight resume, gone-session draft recovery | `app/chat/session-tile*.ts(x)`, `lib/session-*.ts`, `app/session-import`, `app/session/hooks/*` |
| Preview / right rail | in-app browser preview (act / read / annotate / console / tour), file preview, artifact preview; files, review (git) and terminal panes | `app/chat/right-rail/*`, `app/right-sidebar/{files,review,terminal}` |
| Voice | dictation recorder, voice conversation, GPT-Live (voice-live), streaming TTS playback over `/api/audio/speak-stream`, auto-speak replies, wake word, stop phrase | `app/chat/composer/hooks/use-composer-voice.ts`, `lib/voice-live.ts`, `lib/voice-playback.ts`, `app/wake-indicator` |
| Settings | providers / keys / models / fallback models, connections (remote URL + token or OAuth, extra headers), gateway, toolsets, MCP, memory, vault, voice providers, notifications, keybinds, appearance, sessions, terminal backend, billing, local models | `app/settings/*` |
| Shell | command palette, command center, cron, agents, profiles, messaging, artifacts, learning ("starmap"), webhooks, HUD, quick entry, notifications | `app/*` |
| Transport | `JsonRpcGatewayClient` wrapper, gateway RPC helpers, liveness policy, recovery tests, OAuth ticket minting (Electron main), in-flight turn journal, chat-messages hydration / reconciliation | `lib/gateway-rpc.ts`, `lib/gateway-events.ts`, `lib/gateway-liveness-policy.ts`, `lib/inflight-turn-journal.ts`, `lib/chat-messages/*`, `electron/oauth-rest-request.ts` |
| Plugins (internal registry) | `hermes-bots` (Bot Mode), `kanban`, `radio`, `hello-runtime` | `plugins/*`, `apps/desktop/src/AGENTS.md:65-99` |

**Reusable directly:** `@hermes/shared`: `JsonRpcGatewayClient`, `JsonRpcRequestChannel`, `GatewayEventHub`, `reconnect-backoff`, `websocket-url`, generated contract types, `slash.ts`, `fuzzy.ts`, `reasoning-effort.ts`, `skin.ts` / `theme-presets.ts`, `format.ts`, `i18n.ts` (`apps/shared/src/index.ts`). These are framework-agnostic with zero dependencies.

**Patterns to port, not code:**

- Desktop renderer modules are tied to nanostores and Electron capability bridges. Caduceus should port their logic: chat-messages reconciliation, stale-runtime-id recovery, single-flight resume, open-request card parking.
- Desktop's design rules apply to a mobile-first PWA too. State lives with its authority; persisted keys carry their scope; background events never steal focus; profile, connection and mode switches re-home the view instead of rebooting (`apps/desktop/AGENTS.md:28-124`; `DESIGN.md:46-79,318-393`).
- `@nous-research/ui` is MIT on npm and could seed the design system `[INFERENCE: not evaluated for mobile/touch]`.

---

## 10. Security for a remote browser client

- **No per-method authorization.** `rpc_dispatch._handle_admitted_request` validates params, then calls the handler. Nothing checks roles or scopes (`rpc_dispatch.py:17-42`). Any authenticated `/api/ws` socket is equivalent to the operator. `prompt.submit` already drives an agent with terminal tools behind approvals.
- **Methods that act outside a chat turn** and need UI gating, confirmation, or exclusion from Caduceus's mobile surface:
  - **Host exec:** `shell.exec` (blocks hardline/dangerous commands, 30 s, redacted output; `methods_tools.py:1531-1561`), `cli.exec` (runs `hermes <argv>` with provider credentials, small blocklist; `methods_tools.py:476-492`; `server.py:3291-3296`), `command.dispatch` quick commands of `type: exec` (`methods_tools.py:507-519`), `preview.restart` (spawns an agent).
  - **Code install / config:** `plugins.manage` (git install), `skills.manage` install, `mcp.servers.add` / `set_api_key`, `model.save_key` / `disconnect`, `config.set`, `profiles.create` / `configure`, `tools.configure`, `reload.env` / `reload.mcp`, `cron.manage add`.
  - **Filesystem / process:** `rollback.restore`, `session.workspace.move`, `session.cwd.set`, `process.kill` / `stop`, `learning.edit` / `delete`, `session.delete`.
  - **Secrets / identity:** `vault.unlock` (master password in params), `vault.add` / `list`, srq `sudo` / `secret` / `vault.*`, `connectors.connect`, `mcp.servers.oauth.*`, `browser.manage connect`.
  - **Money / external:** `billing.charge` / `auto_reload`, `subscription.upgrade` / `change`, `image.generate`, `llm.oneshot`, `diagnostics.share_nous` (uploads a debug bundle), `handoff.request`.
  - **Network trust:** `groups.peer.invite` / `register` / `revoke`, `groups.promote`, `bot_relay.*`.
- **Scoping that does exist:**
  - Subagent control is pinned to the owning session's live socket and generation (`tui_gateway/AGENTS.md:96-119`).
  - `process.*` is limited to processes owned by the caller's session.
  - `browser.controller.*` requires the server-minted `auth_identity` and fails closed with 4403 (`ws.py:96-99`; contract summary).
  - `spawn_tree.load` path is confined to its root (`methods_session.py:2240-2247`).
  - Billing mutations need a `billing:manage` step-up device flow.
  - `config.set` model changes can require `confirm_expensive_model`.
  - Profile fail-closed guards (§2.4).
- **Transport-level protections:** single-use 30 s tickets; the ticket protocol is never echoed back; Host/Origin checks against DNS rebinding; audit events `WS_TICKET_MINTED` / `REJECTED` (`dashboard_auth/audit.py:34-35`); refresh-token rotation; the legacy token is refused in gated mode.
- **Known holes (dashboard report):** `/api/ws` exposes `shell.exec` / `cli.exec`. File write endpoints bypass the sensitive-path check. Kanban author can be forged. CORS preflight returns 401 (`~/hermes-dashboard/docs/research/hermes-dashboard.md:418-420`).
- **`/api/pub` lets any authenticated client inject frames to `/api/events` subscribers on a channel** (`chat_ws.py:612-621`). Caduceus should not consume `/api/events` as a trust source.
- **Caduceus guidance** `[INFERENCE]`:
  - Keep Caduceus's method allowlist in its module registry and never expose `shell.exec` / `cli.exec` in v1 chat.
  - Put install, billing and vault methods behind explicit admin screens with confirmation.
  - Treat a phone session as full operator access and say so in the UI. Hermes has no scoped or read-only token today.

---

## 11. Live verification (http://100.64.0.10:9119, read-only)

Procedure: Python `httpx` + `websockets` from this Mac over the tailnet. Credentials were read from the creds file and never printed. No prompt, session-create, exec or config method was called.

| Step | Result |
|---|---|
| `GET /api/status` (public) | `version 0.21.4`, `auth_required true`, `auth_providers ["basic"]`, `auth_flows ["cookie","native_pkce"]`, `gateway_running true` |
| `POST /auth/password-login {provider:"basic",…}` | 200 `{ok, next}`; cookies `hermes_session_at`, `hermes_session_rt`, `hermes_session_provider` |
| `GET /api/auth/me` | 200 `{user_id, email, display_name, org_id, provider, expires_at}` |
| `POST /api/auth/ws-ticket` | 200 `{ticket (43 chars), ttl_seconds: 30}` |
| WS `/api/ws`, subprotocols `hermes-gateway-v1` + `hermes-gateway-ticket.<t>`, Origin = dashboard | Accepted; selected subprotocol `hermes-gateway-v1`; first frame `{"jsonrpc":"2.0","method":"event","params":{"type":"gateway.ready","payload":{change_events:true, heartbeat:true, replay_epoch:<32 hex>, skin}}}` |
| `gateway.ping` | `{"ok":true}` (66 ms) |
| `ping` | `{"pong":true}` |
| `gateway.capabilities` | `{"per_session_exclusive_submit":true}` |
| `session.events.stats` | `{sessions:0, events:0, bytes:0, max_per_session:512, max_bytes_per_session:4194304, max_bytes_process:67108864}` (matches `event_replay.py:28-34`) |
| `session.active_list` | `sessions: []` (no live sessions) |
| `session.list {limit:3}` | 3 rows, keys `id, message_count, preview, source, started_at, title` (contents not recorded) |
| `profiles.list` | 6 profiles; row keys include `canonical_session, last_session, worker_session, model, provider, skill_count, ui_meta_revisions` |
| `delegation.status` | `{active: [], paused, max_spawn_depth, max_concurrent_children}` |
| `commands.catalog` | 309 completion pairs + `sub` / `canon` / `commands` maps |
| `nonexistent.method` | error `-32601` "unknown method … out of sync" |
| `session.events.stats {bogus:1}` | error `4000` "Extra inputs are not permitted" |
| `?ticket=` instead of subprotocol | Accepted |
| Reused ticket / no credential / `?token=x` | HTTP 403 (closed before accept) |
| Origin `http://100.64.0.10:5173` (same host, other port) | Accepted |
| Origin `https://console.example.com` | HTTP 403 |
| No Origin header | Accepted |
| CORS preflight `/api/auth/ws-ticket` from `:5173` | 400, no `Access-Control-Allow-Origin` |
| CORS preflight from `http://localhost:5173` | 200 with `access-control-allow-origin`, no `allow-credentials` |

Not verified live (to stay read-only): server→client requests, replay with real events, multi-device fan-out, `session.resume` snapshots. Those come from source and tests (`apps/shared/src/json-rpc-gateway-replay.test.ts`, `apps/desktop/src/lib/json-rpc-gateway-recovery.test.ts`).

---

## 12. Decision inputs for the architecture owner

1. **Chat transport: adopt `/api/ws` and vendor `@hermes/shared`.** You get the replay, heartbeat and server-request logic Desktop already uses. Caduceus must still own the reconnect loop, mint a ticket per dial, and recover with `activate`, falling back to `resume`.
2. **Deployment needs same-origin HTTPS.** Either reverse-proxy Caduceus and Hermes under one origin with `dashboard.public_url` set, or add a BFF. Web Push needs a BFF or companion regardless, because the protocol delivers only to connected sockets.
3. **Session `source`: do not use `"desktop"`** unless Caduceus implements the `preview.*` / `terminal.read` / `tour` / `window.read` bridges (§4).
4. **Use REST alongside RPC** for search and pagination (`/api/sessions*`), audio (`/api/audio/*`), files, kanban, gateway control, logs and analytics. The 336 REST operations remain necessary.
5. **Caduceus-owned state** for drafts, saved prompts, pins, share links and push subscriptions. Store it under `HERMES_HOME` per decision 1.
6. **Security posture:** an authenticated phone has operator-level access. Build the method allowlist and admin gating into the module registry (decision 7).
