// The risk tier of every Hermes REST operation Caduceus can forward (architecture §5; `hermes-api-coverage.md` §7).
//
// One table, keyed by `METHOD /path` exactly as the pinned `contracts/hermes/openapi.json` names it. A test reads the
// pin and fails when an operation has no row here (or a row has no operation), so a regenerate that brings new
// operations cannot slip past: somebody has to decide their tier. Anything that is not in the table is denied.
//
// Where the tier depends on what the request says, the base tier is the least the request can be, and `REFINED` lifts it
// from the request's query or JSON body (a script cron job, a stdio MCP server, a hard delete…).
//
// Tiers follow, in this order of authority: architecture §5, the ticket that builds the screen using the operation,
// then the research table in `hermes-api-coverage.md` §7. Where a later ticket states a different tier than the
// architecture, the architecture's wins here, and the ticket changes this table (and its test) on purpose.
import { isRecord } from './guards.ts';
import { CADUCEUS_OPERATIONS, CADUCEUS_WEBSOCKET_ROUTES } from './owned.ts';
import { DENIED_MESSAGES, stricter, type DeniedReason, type Policy, type Tier } from './tiers.ts';

const denied = (reason: DeniedReason): Policy => ({ tier: 'denied', read: false, reason });
/** A read: it changes nothing, so read-only mode lets it through. */
const READ: Policy = { tier: 'T0', read: true };
/** A write with an undo toast. */
const T0: Policy = { tier: 'T0', read: false };
const T1: Policy = { tier: 'T1', read: false };
/** Costly or outward-facing, but changes no state in Hermes. */
const T1_READ: Policy = { tier: 'T1', read: true };
const T2: Policy = { tier: 'T2', read: false };
const T3: Policy = { tier: 'T3', read: false };
/** Discloses secrets or bulky private data without changing anything: T3 all the same. */
const T3_READ: Policy = { tier: 'T3', read: true };

const POLICY: Record<string, Policy> = {
  // Status, health and the host.
  'GET /api/status': READ,
  'GET /api/health': READ,
  'GET /api/health/idle': READ,
  'POST /api/health/retirement': T2,
  'GET /api/host/identity': READ,
  'GET /api/ssh/ownership': READ,
  'GET /api/system/stats': READ,
  'GET /api/egress/status': READ,
  'GET /api/portal': READ,
  'GET /api/logs': READ,
  'GET /api/actions/{name}/status': READ,
  'GET /api/hermes/update/check': READ,
  'GET /api/hermes/update/receipt': READ,
  'POST /api/hermes/update': T2,

  // Hermes's own sign-in and web UI: Caduceus signs the owner in and serves its own app.
  'GET /api/auth/me': denied('hermes-auth'),
  'GET /api/auth/providers': denied('hermes-auth'),
  'POST /api/auth/ws-ticket': denied('hermes-auth'),
  'GET /auth/login': denied('hermes-auth'),
  'GET /auth/callback': denied('hermes-auth'),
  'GET /auth/native/authorize': denied('hermes-auth'),
  'POST /auth/password-login': denied('hermes-auth'),
  'POST /auth/logout': denied('hermes-auth'),
  'POST /auth/native/token': denied('hermes-auth'),
  'POST /auth/native/refresh': denied('hermes-auth'),
  'GET /login': denied('hermes-auth'),
  'GET /{full_path}': denied('not-proxied'),
  'GET /dashboard-plugins/{plugin_name}/{file_path}': denied('not-proxied'),
  'GET /dashboard-plugins/@{profile}/{plugin_name}/{file_path}': denied('not-proxied'),
  // Hermes's own CLI (`hermes plugins install`) asks its backend to load the plugin for a profile's open chats; the browser never does.
  'POST /api/dashboard/agent-plugins/activate': denied('not-proxied'),
  // The Chronos managed-cron webhook is called by Nous's servers, never by a browser.
  'POST /api/cron/fire': denied('not-proxied'),

  // Sessions and history.
  'GET /api/sessions': READ,
  'GET /api/sessions/search': READ,
  'GET /api/sessions/stats': READ,
  'GET /api/sessions/empty/count': READ,
  'GET /api/sessions/{session_id}': READ,
  'GET /api/sessions/{session_id}/messages': READ,
  'GET /api/sessions/{session_id}/messages/around': READ,
  'GET /api/sessions/{session_id}/mutation-snapshot': READ,
  'GET /api/sessions/{session_id}/timeline': READ,
  'GET /api/sessions/{session_id}/latest-descendant': READ,
  'GET /api/sessions/{session_id}/export': READ,
  'GET /api/profiles/sessions': READ,
  'GET /api/profiles/sessions/sidebar': READ,
  'GET /api/profiles/projects/tree': READ,
  'POST /api/profiles/sessions/pull-requests': READ,
  'PATCH /api/sessions/{session_id}': T0,
  // Single and empty deletes are T1 (M1 #14); bulk deletes and prunes are T3 (architecture §5). A dry-run prune counts.
  'DELETE /api/sessions/{session_id}': T1,
  'DELETE /api/sessions/empty': T1,
  'POST /api/sessions/bulk-delete': T3,
  'POST /api/sessions/prune': T3,
  // Importing a session is additive (architecture §5).
  'POST /api/sessions/import': T1,
  'POST /api/sessions/owner-backfill': T2,
  'POST /api/chat/image-upload': T0,
  'GET /api/chat/workspaces': READ,

  // Profiles.
  'GET /api/profiles': READ,
  'GET /api/profiles/active': READ,
  'GET /api/profiles/{name}/setup-command': READ,
  'GET /api/profiles/{name}/soul': READ,
  'GET /api/profiles/{name}/desktop-overlay': READ,
  'POST /api/profiles': T1,
  // "Make default" is the only thing that writes Hermes's sticky default, and it is T2 (architecture §5).
  'POST /api/profiles/active': T2,
  'PATCH /api/profiles/{name}': T0,
  'DELETE /api/profiles/{name}': T3,
  'PUT /api/profiles/{name}/soul': T3,
  'PUT /api/profiles/{name}/description': T0,
  'PUT /api/profiles/{name}/model': T1,
  'POST /api/profiles/{name}/describe-auto': T1,
  'POST /api/profiles/{name}/export': T3,
  'POST /api/profiles/import': T3,
  'POST /api/profiles/{name}/open-terminal': denied('host-terminal'),

  // Configuration and keys.
  'GET /api/config': READ,
  'GET /api/config/defaults': READ,
  'GET /api/config/raw': READ,
  'GET /api/config/schema': READ,
  'PUT /api/config': T3,
  'PUT /api/config/raw': T3,
  'GET /api/env': READ,
  'PUT /api/env': T2,
  'DELETE /api/env': T2,
  'POST /api/env/reveal': T3_READ,
  'GET /api/credentials/pool': READ,
  'POST /api/credentials/pool': T2,
  'DELETE /api/credentials/pool/{provider}/{index}': T2,
  'POST /api/providers/validate': READ,
  'GET /api/providers/custom-endpoints': READ,
  'POST /api/providers/custom-endpoints': T2,
  'POST /api/providers/custom-endpoints/validate': T1_READ,
  'POST /api/providers/custom-endpoints/{endpoint_id}/activate': T1,
  'DELETE /api/providers/custom-endpoints/{endpoint_id}': T2,
  'GET /api/providers/oauth': READ,
  'POST /api/providers/oauth/{provider_id}/start': T1,
  'POST /api/providers/oauth/{provider_id}/submit': T1,
  'GET /api/providers/oauth/{provider_id}/poll/{session_id}': READ,
  'DELETE /api/providers/oauth/sessions/{session_id}': T0,
  'DELETE /api/providers/oauth/{provider_id}': T2,

  // Models.
  'GET /api/model/info': READ,
  'GET /api/model/options': READ,
  'GET /api/model/recommended-default': READ,
  'GET /api/model/auxiliary': READ,
  'GET /api/model/moa': READ,
  'PUT /api/model/moa': T1,
  'POST /api/model/set': T1,
  'GET /api/local-models/status': READ,
  'GET /api/local-models/hardware': READ,
  'GET /api/local-models/catalog': READ,
  'GET /api/local-models/jobs': READ,
  'GET /api/local-models/jobs/{job_id}': READ,
  'GET /api/local-models/search': READ,
  'GET /api/local-models/search/files': READ,
  // Local models (M4 #14): T1 across the board, runtime install and downloads included.
  'POST /api/local-models/runtime/install': T1,
  'POST /api/local-models/download': T1,
  'POST /api/local-models/download-browsed': T1,
  'POST /api/local-models/quickstart': T1,
  'POST /api/local-models/server': T1,
  'POST /api/local-models/eject': T1,
  'POST /api/local-models/activate': T1,
  'POST /api/local-models/sideload': T1,
  'DELETE /api/local-models/models/{model_id}': T1,
  'POST /api/local-models/download/pause': T1,
  'POST /api/local-models/download/resume': T1,

  // Skills, tools, MCP and plugins.
  'GET /api/skills': READ,
  'GET /api/skills/content': READ,
  'GET /api/skills/hub/official': READ,
  'GET /api/skills/hub/sources': READ,
  'GET /api/skills/hub/search': READ,
  'GET /api/skills/hub/preview': READ,
  'GET /api/skills/hub/scan': READ,
  'POST /api/skills': T1,
  'PUT /api/skills/content': T1,
  'PUT /api/skills/toggle': T0,
  'POST /api/skills/hub/install': T3,
  'POST /api/skills/hub/update': T3,
  'POST /api/skills/hub/uninstall': T1,
  'GET /api/tools/toolsets': READ,
  'GET /api/tools/toolsets/{name}/config': READ,
  'GET /api/tools/toolsets/{name}/models': READ,
  'GET /api/tools/terminal/backends': READ,
  'GET /api/tools/computer-use/status': READ,
  'PUT /api/tools/toolsets/{name}': T1,
  'PUT /api/tools/toolsets/{name}/model': T1,
  'PUT /api/tools/toolsets/{name}/provider': T1,
  // Writes the toolset's API keys: the Keys tier.
  'PUT /api/tools/toolsets/{name}/env': T2,
  'POST /api/tools/toolsets/{name}/post-setup': T3,
  'PUT /api/tools/terminal/backend': T3,
  'POST /api/tools/computer-use/permissions/grant': T3,
  'GET /api/mcp/servers': READ,
  'GET /api/mcp/catalog': READ,
  'GET /api/mcp/oauth/flows/{flow_id}': READ,
  'GET /api/mcp/oauth/callback/{server_name}': T1,
  'DELETE /api/mcp/oauth/flows/{flow_id}': T0,
  'POST /api/mcp/servers': T2,
  // Replaces the whole server map (an edit's save): T2 while every server is HTTP or SSE, T3 once any is stdio (see REFINED).
  'PUT /api/mcp/servers': T2,
  'PUT /api/mcp/servers/{name}/enabled': T0,
  'DELETE /api/mcp/servers/{name}': T1,
  'POST /api/mcp/servers/{name}/test': T1_READ,
  'POST /api/mcp/servers/{name}/auth': T1,
  'POST /api/mcp/catalog/install': T3,
  'GET /api/dashboard/plugins': READ,
  'GET /api/dashboard/plugins/hub': READ,
  'GET /api/dashboard/plugins/catalog': READ,
  'GET /api/dashboard/plugins/rescan': T0,
  'GET /api/dashboard/themes': READ,
  'GET /api/dashboard/font': READ,
  'PUT /api/dashboard/theme': T0,
  'PUT /api/dashboard/font': T0,
  'POST /api/dashboard/plugins/{name}/visibility': T0,
  'PUT /api/dashboard/plugin-providers': T2,
  // Plugins are git-installed Python: install and update are T3; the rest is T1 (M5 #11).
  'POST /api/dashboard/agent-plugins/install': T3,
  'POST /api/dashboard/agent-plugins/{name}/update': T3,
  'POST /api/dashboard/agent-plugins/{name}/enable': T1,
  'POST /api/dashboard/agent-plugins/{name}/disable': T1,
  'DELETE /api/dashboard/agent-plugins/{name}': T1,
  'GET /api/plugins/hermes-achievements/achievements': READ,
  'GET /api/plugins/hermes-achievements/scan-status': READ,
  'GET /api/plugins/hermes-achievements/recent-unlocks': READ,
  'GET /api/plugins/hermes-achievements/sessions/{session_id}/badges': READ,
  'POST /api/plugins/hermes-achievements/rescan': T0,
  'POST /api/plugins/hermes-achievements/reset-state': T1,

  // Memory and learning.
  'GET /api/memory': READ,
  'GET /api/memory/providers/{name}/config': READ,
  'GET /api/memory/providers/{provider}/oauth/status': READ,
  'PUT /api/memory/provider': T1,
  'PUT /api/memory/providers/{name}/config': T2,
  'POST /api/memory/providers/{name}/setup': T3,
  'POST /api/memory/providers/{provider}/oauth/start': T1,
  'POST /api/memory/reset': T3,
  'GET /api/learning/graph': READ,
  'GET /api/learning/node': READ,
  'PUT /api/learning/node': T1,
  'DELETE /api/learning/node': T1,
  'GET /api/curator': READ,
  'PUT /api/curator/paused': T1,
  'POST /api/curator/run': T2,

  // Scheduling. Run now, pause, resume and delete are T1 (M3 #05); scripts are code, so they are T3 (see REFINED).
  'GET /api/cron/jobs': READ,
  'GET /api/cron/jobs/{job_id}': READ,
  'GET /api/cron/jobs/{job_id}/runs': READ,
  'GET /api/cron/delivery-targets': READ,
  'GET /api/cron/blueprints': READ,
  'POST /api/cron/jobs': T1,
  'PUT /api/cron/jobs/{job_id}': T1,
  'DELETE /api/cron/jobs/{job_id}': T1,
  'POST /api/cron/jobs/{job_id}/pause': T1,
  'POST /api/cron/jobs/{job_id}/resume': T1,
  'POST /api/cron/jobs/{job_id}/trigger': T1,
  'POST /api/cron/blueprints/instantiate': T1,

  // Kanban. A single card's change is T0 (M3 #02); bulk changes, deleting a task and terminating a run are T2.
  'GET /api/plugins/kanban/board': READ,
  'GET /api/plugins/kanban/boards': READ,
  'GET /api/plugins/kanban/tasks/{task_id}': READ,
  'GET /api/plugins/kanban/tasks/{task_id}/attachments': READ,
  'GET /api/plugins/kanban/tasks/{task_id}/log': READ,
  'GET /api/plugins/kanban/attachments/{attachment_id}': READ,
  'GET /api/plugins/kanban/runs/{run_id}': READ,
  'GET /api/plugins/kanban/runs/{run_id}/inspect': READ,
  'GET /api/plugins/kanban/assignees': READ,
  'GET /api/plugins/kanban/config': READ,
  'GET /api/plugins/kanban/diagnostics': READ,
  'GET /api/plugins/kanban/home-channels': READ,
  'GET /api/plugins/kanban/model-options': READ,
  'GET /api/plugins/kanban/orchestration': READ,
  'GET /api/plugins/kanban/profiles': READ,
  'GET /api/plugins/kanban/projects': READ,
  'GET /api/plugins/kanban/stats': READ,
  'GET /api/plugins/kanban/workflow': READ,
  'GET /api/plugins/kanban/workers/active': READ,
  'POST /api/plugins/kanban/tasks': T1,
  'PATCH /api/plugins/kanban/tasks/{task_id}': T0,
  'DELETE /api/plugins/kanban/tasks/{task_id}': T2,
  'POST /api/plugins/kanban/tasks/bulk': T2,
  'POST /api/plugins/kanban/tasks/{task_id}/comments': T0,
  'POST /api/plugins/kanban/tasks/{task_id}/attachments': T0,
  'DELETE /api/plugins/kanban/attachments/{attachment_id}': T1,
  'POST /api/plugins/kanban/links': T0,
  'DELETE /api/plugins/kanban/links': T0,
  'POST /api/plugins/kanban/tasks/{task_id}/reclaim': T1,
  'POST /api/plugins/kanban/tasks/{task_id}/specify': T1,
  'POST /api/plugins/kanban/tasks/{task_id}/reassign': T1,
  'POST /api/plugins/kanban/tasks/{task_id}/decompose': T1,
  'POST /api/plugins/kanban/tasks/{task_id}/estimate': T1_READ,
  'POST /api/plugins/kanban/estimate': T1_READ,
  'POST /api/plugins/kanban/tasks/{task_id}/home-subscribe/{platform}': T0,
  'DELETE /api/plugins/kanban/tasks/{task_id}/home-subscribe/{platform}': T0,
  'POST /api/plugins/kanban/runs/{run_id}/terminate': T1,
  // The dispatcher nudge starts workers; M3 #02 makes it T1.
  'POST /api/plugins/kanban/dispatch': T1,
  'PUT /api/plugins/kanban/orchestration': T2,
  'POST /api/plugins/kanban/boards': T1,
  'PATCH /api/plugins/kanban/boards/{slug}': T1,
  // Archive by default (T1); `?delete=true` removes the board for good (T3, see REFINED).
  'DELETE /api/plugins/kanban/boards/{slug}': T1,
  'POST /api/plugins/kanban/boards/{slug}/export': T1,
  'POST /api/plugins/kanban/boards/{slug}/switch': T0,
  'POST /api/plugins/kanban/boards/import': T3,
  'PATCH /api/plugins/kanban/profiles/{profile_name}': T0,
  'POST /api/plugins/kanban/profiles/{profile_name}/describe-auto': T1,

  // Messaging, pairing, webhooks and the gateway.
  'GET /api/messaging/platforms': READ,
  'GET /api/messaging/telegram/onboarding/{pairing_id}': READ,
  'GET /api/messaging/whatsapp/onboarding/{pairing_id}': READ,
  'PUT /api/messaging/platforms/{platform_id}': T2,
  // Only reads the platform's state, the gateway's report and the pairing store (`web_routers/messaging.py`): it sends nothing to the chat platform and writes nothing, so it is a read.
  'POST /api/messaging/platforms/{platform_id}/test': READ,
  'POST /api/messaging/telegram/onboarding/start': T1,
  'POST /api/messaging/whatsapp/onboarding/start': T1,
  'POST /api/messaging/telegram/onboarding/{pairing_id}/apply': T2,
  'POST /api/messaging/whatsapp/onboarding/{pairing_id}/apply': T2,
  'DELETE /api/messaging/telegram/onboarding/{pairing_id}': T0,
  'DELETE /api/messaging/whatsapp/onboarding/{pairing_id}': T0,
  'GET /api/pairing': READ,
  'POST /api/pairing/approve': T2,
  'POST /api/pairing/revoke': T2,
  'POST /api/pairing/clear-pending': T1,
  'GET /api/webhooks': READ,
  'POST /api/webhooks': T2,
  'POST /api/webhooks/enable': T2,
  'PUT /api/webhooks/{name}/enabled': T0,
  'DELETE /api/webhooks/{name}': T1,
  'GET /api/gateway/migrate/plan': READ,
  'POST /api/gateway/start': T1,
  'POST /api/gateway/stop': T2,
  'POST /api/gateway/restart': T2,
  'POST /api/gateway/drain': T2,
  'POST /api/gateway/migrate': T2,

  // Files and git. The paths in these requests go through the file guard (`FILE_PATHS`).
  'GET /api/files': READ,
  'GET /api/files/read': READ,
  'GET /api/files/download': READ,
  'GET /api/files/stream': READ,
  'HEAD /api/files/stream': READ,
  'GET /api/media': READ,
  // Fetches an image from an allow-listed CDN for the gateway and answers it as a data URL: nothing changes on the machine.
  'GET /api/media/proxy': READ,
  'GET /api/fs/list': READ,
  'GET /api/fs/read-text': READ,
  'GET /api/fs/read-data-url': READ,
  'GET /api/fs/download': READ,
  'GET /api/fs/git-root': READ,
  'GET /api/fs/default-cwd': READ,
  // Every write to the Mac's files is a T3 unless the file is in a workspace Caduceus knows (the server lowers it then: `lowerInWorkspace`), and none reaches a place that runs code later (the file guard).
  'POST /api/files/upload': T3,
  'POST /api/files/upload-stream': T3,
  'POST /api/files/mkdir': T3,
  'DELETE /api/files': T3,
  'POST /api/fs/write-text': T3,
  'GET /api/git/status': READ,
  'GET /api/git/gh-auth': READ,
  'GET /api/git/worktrees': READ,
  'GET /api/git/branches': READ,
  'GET /api/git/base-branches': READ,
  'GET /api/git/review/list': READ,
  'GET /api/git/review/diff': READ,
  'GET /api/git/file-diff': READ,
  'GET /api/git/review/commit-context': READ,
  'GET /api/git/review/rev-parse': READ,
  'GET /api/git/review/ship-info': READ,
  'POST /api/git/review/pr-list': READ,
  'POST /api/git/review/stage': T0,
  'POST /api/git/review/unstage': T0,
  'POST /api/git/review/commit': T1,
  'POST /api/git/branch/switch': T1,
  'POST /api/git/worktree/add': T1,
  'POST /api/git/worktree/remove': T1,
  'POST /api/git/review/revert': T3,
  'POST /api/git/review/push': T3,
  'POST /api/git/review/create-pr': T3,

  // Maintenance.
  'GET /api/ops/hooks': READ,
  'GET /api/ops/checkpoints': READ,
  'POST /api/ops/prompt-size': READ,
  'POST /api/ops/doctor': T1,
  'POST /api/ops/security-audit': T1,
  'POST /api/ops/dump': T1,
  // The archive holds every key Hermes has (its `.env`, `auth.json`, the vault, Caduceus's own store): making one is a T3, like downloading it.
  'POST /api/ops/backup': T3,
  'POST /api/ops/config-migrate': T1,
  'POST /api/ops/checkpoints/prune': T2,
  'POST /api/ops/hooks': T3,
  'DELETE /api/ops/hooks': T2,
  'GET /api/ops/backup/download': T3_READ,
  'POST /api/ops/import': T3,
  'POST /api/ops/import-upload': T3,
  // The REST route uploads a redacted bundle; the Nous diagnostics RPC is denied.
  'POST /api/ops/debug-share': T3,

  // Audio. Transcribing and speaking change nothing in Hermes.
  'GET /api/audio/voice-config': READ,
  'GET /api/audio/voice-live/status': READ,
  'GET /api/audio/elevenlabs/voices': READ,
  'POST /api/audio/transcribe': READ,
  'POST /api/audio/speak': READ,
  'POST /api/audio/tts-lease': READ,
  // Like tts-lease: a warm-up signal for the speech model, nothing the owner keeps.
  'POST /api/audio/stt-lease': READ,
  'POST /api/audio/voice-live/session': T0,

  // Analytics.
  'GET /api/analytics/usage': READ,
  'GET /api/analytics/models': READ,
  // Whether Hermes may count and send usage metrics to Nous. Reading it is free; changing it is a privacy decision, so it takes a passkey.
  'GET /api/shared-metrics/consent': READ,
  'PUT /api/shared-metrics/consent': T2,
};

/** Where a request names a file the guard must check, and whether it is a read or a write. */
export interface FilePathSource {
  in: 'query' | 'body' | 'multipart';
  field: string;
  access: 'read' | 'browse' | 'write' | 'relocate' | 'backup-output';
}

const FILE_PATHS: Record<string, FilePathSource> = {
  'GET /api/files': { in: 'query', field: 'path', access: 'browse' },
  'GET /api/files/read': { in: 'query', field: 'path', access: 'browse' },
  'GET /api/files/download': { in: 'query', field: 'path', access: 'browse' },
  'GET /api/files/stream': { in: 'query', field: 'path', access: 'browse' },
  'HEAD /api/files/stream': { in: 'query', field: 'path', access: 'browse' },
  'GET /api/media': { in: 'query', field: 'path', access: 'read' },
  'GET /api/fs/list': { in: 'query', field: 'path', access: 'read' },
  'GET /api/fs/read-text': { in: 'query', field: 'path', access: 'read' },
  'GET /api/fs/read-data-url': { in: 'query', field: 'path', access: 'read' },
  'GET /api/fs/download': { in: 'query', field: 'path', access: 'read' },
  'POST /api/fs/write-text': { in: 'body', field: 'path', access: 'write' },
  'POST /api/files/upload': { in: 'body', field: 'path', access: 'write' },
  'POST /api/files/upload-stream': { in: 'multipart', field: 'path', access: 'write' },
  'POST /api/files/mkdir': { in: 'body', field: 'path', access: 'write' },
  'DELETE /api/files': { in: 'body', field: 'path', access: 'write' },
  // Git runs in the folder the request names: every change stays inside the roots a write may use (a read may look at any repository, as Projects does).
  'GET /api/git/status': { in: 'query', field: 'path', access: 'read' },
  'GET /api/git/worktrees': { in: 'query', field: 'path', access: 'read' },
  'GET /api/git/branches': { in: 'query', field: 'path', access: 'read' },
  'GET /api/git/base-branches': { in: 'query', field: 'path', access: 'read' },
  'GET /api/git/review/list': { in: 'query', field: 'path', access: 'read' },
  'GET /api/git/review/diff': { in: 'query', field: 'path', access: 'read' },
  'GET /api/git/file-diff': { in: 'query', field: 'path', access: 'read' },
  'GET /api/git/review/commit-context': { in: 'query', field: 'path', access: 'read' },
  'GET /api/git/review/rev-parse': { in: 'query', field: 'path', access: 'read' },
  'GET /api/git/review/ship-info': { in: 'query', field: 'path', access: 'read' },
  'POST /api/git/review/pr-list': { in: 'body', field: 'path', access: 'read' },
  'POST /api/git/review/stage': { in: 'body', field: 'path', access: 'write' },
  'POST /api/git/review/unstage': { in: 'body', field: 'path', access: 'write' },
  'POST /api/git/review/commit': { in: 'body', field: 'path', access: 'write' },
  'POST /api/git/branch/switch': { in: 'body', field: 'path', access: 'write' },
  'POST /api/git/worktree/add': { in: 'body', field: 'path', access: 'write' },
  'POST /api/git/worktree/remove': { in: 'body', field: 'path', access: 'write' },
  'POST /api/git/review/revert': { in: 'body', field: 'path', access: 'write' },
  'POST /api/git/review/push': { in: 'body', field: 'path', access: 'write' },
  'POST /api/git/review/create-pr': { in: 'body', field: 'path', access: 'write' },
  // Archives written to a path the request chooses. A backup only ever goes to a backups folder of Hermes's home.
  'POST /api/ops/backup': { in: 'body', field: 'output', access: 'backup-output' },
  'POST /api/profiles/{name}/export': { in: 'body', field: 'output', access: 'write' },
  'POST /api/plugins/kanban/boards/{slug}/export': { in: 'body', field: 'output', access: 'write' },
};

/**
 * What a write to the Mac's files costs when every file it names is inside a workspace Caduceus knows (architecture §5), for the operations that are a T3
 * anywhere else: a raw text save, an Office save, an upload, a new folder, a delete, a rename (which has an undo toast) and a move. Deleting a folder with
 * everything in it stays a T3 in a workspace too.
 */
const IN_WORKSPACE: Record<string, (facts: RequestFacts) => Tier> = {
  'POST /api/fs/write-text': () => 'T1',
  'PUT /_caduceus/api/files/office': () => 'T1',
  'POST /api/files/upload': () => 'T1',
  'POST /api/files/upload-stream': () => 'T1',
  'POST /api/files/mkdir': () => 'T1',
  'DELETE /api/files': ({ body }) => (flag(object(body).recursive) ? 'T3' : 'T1'),
  'POST /_caduceus/api/files/rename': () => 'T0',
  'POST /_caduceus/api/files/move': () => 'T1',
};

/** The policy of a file write whose files are all in a workspace Caduceus knows: its T3 comes down to what a workspace costs. */
export function lowerInWorkspace(operation: string, policy: Policy, facts: RequestFacts): Policy {
  const inside = Object.hasOwn(IN_WORKSPACE, operation) ? IN_WORKSPACE[operation](facts) : undefined;
  return inside !== undefined && policy.tier === 'T3' ? { ...policy, tier: inside } : policy;
}

/** Operations that carry file uploads and so may have a large body. */
const UPLOADS: Record<string, true> = {
  'POST /api/fs/write-text': true,
  'POST /api/files/upload': true,
  'POST /api/files/upload-stream': true,
  'POST /api/ops/import-upload': true,
  'POST /api/chat/image-upload': true,
  'POST /api/sessions/import': true,
  'POST /api/audio/transcribe': true,
  'POST /api/plugins/kanban/tasks/{task_id}/attachments': true,
};

/** What the request says, as far as a tier can depend on it. `body` is the parsed JSON body, when it has one. */
export interface RequestFacts {
  query: URLSearchParams;
  body: Record<string, unknown> | undefined;
}

/** A string field with anything in it: even blanks count, since what Hermes makes of them is Hermes's business. */
const set = (value: unknown) => typeof value === 'string' && value !== '';
/** A boolean as Hermes's (pydantic's) lenient parsing reads it: `true`, 1, and the strings `1 on t true y yes` in any case. */
const flag = (value: unknown) => value === true || value === 1 || (typeof value === 'string' && ['1', 'on', 't', 'true', 'y', 'yes'].includes(value.toLowerCase()));
const object = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});
/** Whether a cron job (or its update) would run a script: its own, or the monitor script the scheduler runs before each run. */
const runsScript = (job: Record<string, unknown>) => set(job.script) || flag(job.no_agent) || set(job.monitor_script);

const wholeFrom = (least: number) => (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= least;
/** A count of workers: a whole number from 1, or `null` for no limit of the owner's own. */
const capOrNone = (value: unknown) => value === null || wholeFrom(1)(value);

/**
 * The Kanban dispatcher's settings, which live in Hermes's `kanban:` config section, and what each may hold. Saving only these (and
 * nothing else) through `PUT /api/config` is a T2, not the T3 that the whole config is: none of them runs a program or reaches a file
 * (`dispatch_profiles`, `dispatch_in_gateway` and the rest of the section are left out on purpose).
 */
export const DISPATCHER_SETTINGS: Readonly<Record<string, (value: unknown) => boolean>> = {
  max_in_progress: capOrNone,
  max_in_progress_per_profile: capOrNone,
  dispatch_interval_seconds: wholeFrom(5),
  dispatch_stale_timeout_seconds: wholeFrom(0),
  failure_limit: wholeFrom(1),
  orchestrator_profile: (value) => typeof value === 'string',
  default_assignee: (value) => typeof value === 'string',
  auto_decompose: (value) => typeof value === 'boolean',
  auto_promote_children: (value) => typeof value === 'boolean',
};

/** Whether a `PUT /api/config` body writes only dispatcher settings (and, at most, which profile's home they go to). */
function writesOnlyDispatcherSettings(body: Record<string, unknown> | undefined): boolean {
  const { config, profile, ...rest } = object(body);
  const sections = object(config);
  const settings = sections.kanban;
  if (Object.keys(rest).length > 0 || (profile !== undefined && typeof profile !== 'string')) return false;
  if (Object.keys(sections).length !== 1 || !isRecord(settings)) return false;
  const entries = Object.entries(settings);
  return entries.length > 0 && entries.every(([key, value]) => Object.hasOwn(DISPATCHER_SETTINGS, key) && DISPATCHER_SETTINGS[key](value));
}

/**
 * The export Hermes writes for a board (`POST /boards/{slug}/export` with no `output`): an absolute path in its `kanban/board-exports` folder,
 * named `<slug>-<date>-<time>.tar.gz`. Archiving a board saves one first, so that putting the board back (Undo) can import it again.
 */
const STAGED_EXPORT = /^\/(?:[^/]+\/)*kanban\/board-exports\/([a-z0-9][a-z0-9_-]*)-\d{8}-\d{6}\.tar\.gz$/;

/** Whether an import only puts back the board a staged export was made from, under its own address, and asks for nothing more. */
function restoresStagedExport(body: Record<string, unknown> | undefined): boolean {
  const { archive, slug, switch: activate, ...rest } = object(body);
  if (typeof archive !== 'string' || typeof slug !== 'string' || Object.keys(rest).length > 0 || (activate !== undefined && activate !== false)) return false;
  return !archive.split('/').includes('..') && STAGED_EXPORT.exec(archive)?.[1] === slug;
}

/** A tier at least the base (stricter wins), or a whole new tier and read-ness (a dry run changes nothing). */
type Refined = Tier | { tier: Tier; read: boolean };

/** Lifts an operation above its base tier (or, for a dry run, down to a read) from what the request says. */
const REFINED: Record<string, (facts: RequestFacts) => Refined> = {
  'POST /api/cron/jobs': ({ body }) => (runsScript(object(body)) ? 'T3' : 'T1'),
  'PUT /api/cron/jobs/{job_id}': ({ body }) => (runsScript(object(object(body).updates)) ? 'T3' : 'T1'),
  // A query parameter given twice: Hermes reads the last, so any of them can be the one that counts.
  'DELETE /api/plugins/kanban/boards/{slug}': ({ query }) => (query.getAll('delete').some(flag) ? 'T3' : 'T1'),
  'PUT /api/config': ({ body }) => (writesOnlyDispatcherSettings(body) ? { tier: 'T2', read: false } : 'T3'),
  // A nudge starts workers. A preview starts none, but Hermes reads the last of a repeated `dry_run`, so only a lone plain `true` is one.
  'POST /api/plugins/kanban/dispatch': ({ query }) => {
    const given = query.getAll('dry_run');
    return given.length === 1 && given[0] === 'true' ? { tier: 'T0', read: true } : 'T1';
  },
  // An import brings in tasks from a file the owner chose, which workers will read. Putting back what Hermes exported a moment ago is not that.
  'POST /api/plugins/kanban/boards/import': ({ body }) => (restoresStagedExport(body) ? { tier: 'T1', read: false } : 'T3'),
  'POST /api/mcp/servers': ({ body }) => (set(object(body).command) ? 'T3' : 'T2'),
  'PUT /api/mcp/servers': ({ body }) => {
    const { servers } = object(body);
    // Anything that is not a map of plain objects, or that names a `command` (even a blank one), could start a program.
    return isRecord(servers) && Object.values(servers).every((server) => isRecord(server) && !('command' in server)) ? 'T2' : 'T3';
  },
  'POST /api/webhooks': ({ body }) => (set(object(body).script) ? 'T3' : 'T2'),
  'POST /api/model/set': ({ body }) => (set(object(body).api_key) || set(object(body).base_url) ? 'T2' : 'T1'),
  'POST /api/profiles': ({ body }) => {
    const { mcp_servers, hub_skills } = object(body);
    return (Array.isArray(mcp_servers) && mcp_servers.length > 0) || (Array.isArray(hub_skills) && hub_skills.length > 0) ? 'T3' : 'T1';
  },
  'POST /api/git/worktree/remove': ({ body }) => (flag(object(body).force) ? 'T3' : 'T1'),
  // A commit that also pushes (`push: true`) sends commits to a remote: the push's tier.
  'POST /api/git/review/commit': ({ body }) => (flag(object(body).push) ? 'T3' : 'T1'),
  // Lowering is the risky direction: only a plain JSON `true` makes a prune a dry run.
  'POST /api/sessions/prune': ({ body }) => (object(body).dry_run === true ? { tier: 'T0', read: true } : 'T3'),
  // An Inbox decision is the chat's own answer to an approval (`approvalChoice` in `gateway.ts`): "always" is a standing permission, and a deny only ever makes the agent do less.
  'POST /_caduceus/api/inbox/{id}/decision': ({ body }) => {
    const { choice } = object(body);
    if (choice === 'always') return 'T2';
    return choice === 'deny' ? { tier: 'T0', read: true } : 'T0';
  },
};

/** One REST operation as the policy sees it. */
export interface RestPolicy extends Policy {
  filePath?: FilePathSource | readonly FilePathSource[];
  /** The body may be an upload (large). */
  upload: boolean;
  refine?: (facts: RequestFacts) => Refined;
}

/** Every pinned operation, with its policy: `METHOD /path` → policy. */
export const REST_OPERATIONS: Readonly<Record<string, RestPolicy>> = Object.fromEntries(
  Object.entries(POLICY).map(([operation, policy]) => [
    operation,
    { ...policy, filePath: FILE_PATHS[operation], upload: UPLOADS[operation] === true, refine: REFINED[operation] } satisfies RestPolicy,
  ]),
);

/** Where an operation's body or query holds the profile it works on: a path parameter named `name` or `profile_name`. */
const PROFILE_PATH_PARAMS = ['name', 'profile_name'];

/** The WebSocket routes Hermes serves besides REST; none is a plain HTTP request. */
const WEBSOCKET_ROUTES: Record<string, Policy> = {
  '/api/ws': { tier: 'T0', read: false },
  '/api/pty': { tier: 'T2', read: false },
  '/api/console': { tier: 'T2', read: false },
  '/api/plugins/kanban/events': { tier: 'T0', read: true },
  '/api/events': { tier: 'denied', read: false, reason: 'frame-injection' },
  '/api/pub': { tier: 'denied', read: false, reason: 'frame-injection' },
};

/** The policy of a WebSocket route by path: one of Hermes's (`/api/ws`, `/api/pty`, …) or one Caduceus serves itself; `undefined` for any other path. */
export function classifyWebSocketRoute(pathname: string): Policy | undefined {
  return Object.hasOwn(CADUCEUS_WEBSOCKET_ROUTES, pathname) ? CADUCEUS_WEBSOCKET_ROUTES[pathname] : WEBSOCKET_ROUTES[pathname];
}

export type PathNormalised = { ok: true; pathname: string; segments: string[] } | { ok: false };

/**
 * The path as Hermes will see it. Hermes decodes percent-escapes before it routes, so the policy must classify what
 * Hermes will route, and what is forwarded is the path as classified: an escaped letter, an escaped slash, `.`/`..`,
 * a doubled slash or a control character would otherwise let a request be classified as one thing and routed as another.
 */
export function normalisePath(raw: string): PathNormalised {
  if (!raw.startsWith('/')) return { ok: false };
  const parts = raw.split('/').slice(1);
  // One trailing slash is dropped; Hermes redirects it to the route without.
  if (parts.length > 1 && parts[parts.length - 1] === '') parts.pop();
  const segments: string[] = [];
  for (const part of parts) {
    let segment: string;
    try {
      segment = decodeURIComponent(part);
    } catch {
      return { ok: false };
    }
    // eslint-disable-next-line no-control-regex
    if (segment === '' || segment === '.' || segment === '..' || /[/\\\u0000-\u001f\u007f]/.test(segment)) return { ok: false };
    segments.push(segment);
  }
  return { ok: true, segments, pathname: `/${segments.map(encodeURIComponent).join('/')}` };
}

/** What `classifyRest` found for a request line. */
export type RestMatch =
  | { ok: true; operation: string; policy: RestPolicy; params: Record<string, string>; pathname: string }
  | { ok: false; pathname: string | undefined; reason: DeniedReason; message: string };

interface Template {
  operation: string;
  policy: RestPolicy;
  segments: readonly string[];
}

/**
 * Makes the function that finds the operation a request line is. `extra` adds operations beyond the pin (the Hermes
 * routes a test server answers, say) with their policy; the pinned ones cannot be overridden. The operations Caduceus performs itself
 * (`CADUCEUS_OPERATIONS`) are always known.
 *
 * Several operations can match one path (`DELETE /api/sessions/empty` and `DELETE /api/sessions/{session_id}`); then the
 * strictest wins, so a path cannot be argued into a lower tier. A path that matches nothing, or is not valid, is denied.
 */
export function createRestClassifier(extra: Readonly<Record<string, Policy>> = {}): (method: string, rawPath: string) => RestMatch {
  const operations: Record<string, RestPolicy> = {
    ...Object.fromEntries(Object.entries({ ...extra, ...CADUCEUS_OPERATIONS }).map(([operation, policy]): [string, RestPolicy] => [operation, { ...policy, upload: false, refine: REFINED[operation] }])),
    ...REST_OPERATIONS,
  };
  const templates: Record<string, Template[]> = {};
  for (const [operation, policy] of Object.entries(operations)) {
    const [method, path] = operation.split(' ');
    (templates[method] ??= []).push({ operation, policy, segments: path.split('/').slice(1) });
  }

  return (method, rawPath) => {
    const path = normalisePath(rawPath);
    if (!path.ok) return { ok: false, pathname: undefined, reason: 'bad-path', message: DENIED_MESSAGES['bad-path'] };
    const websocket = WEBSOCKET_ROUTES[path.pathname];
    if (websocket) {
      const reason = websocket.reason ?? 'not-proxied';
      return { ok: false, pathname: path.pathname, reason, message: DENIED_MESSAGES[reason] };
    }
    let best: { operation: string; policy: RestPolicy; params: Record<string, string> } | undefined;
    for (const { operation, policy, segments } of templates[method.toUpperCase()] ?? []) {
      if (segments.length !== path.segments.length) continue;
      const params: Record<string, string> = {};
      const matches = segments.every((expected, index) => {
        if (expected.startsWith('{') && expected.endsWith('}')) {
          params[expected.slice(1, -1)] = path.segments[index];
          return true;
        }
        return expected === path.segments[index];
      });
      if (!matches) continue;
      const stricterThanBest = best && (stricter(best.policy.tier, policy.tier) !== best.policy.tier || (best.policy.tier === policy.tier && best.policy.read && !policy.read));
      if (!best || stricterThanBest) best = { operation, policy, params };
    }
    if (!best) return { ok: false, pathname: path.pathname, reason: 'unclassified', message: DENIED_MESSAGES.unclassified };
    return { ok: true, pathname: path.pathname, ...best };
  };
}

/** Finds the pinned operation a request line is (`createRestClassifier` with nothing added). */
export const classifyRest = createRestClassifier();

/** The tier and read-ness a matched operation has for the request at hand: its base policy, lifted by what the request says. */
export function resolveTier({ policy }: Extract<RestMatch, { ok: true }>, facts: RequestFacts): Policy {
  const refined = policy.refine?.(facts);
  if (refined === undefined) return policy;
  if (typeof refined === 'string') return { ...policy, tier: stricter(policy.tier, refined) };
  return { tier: refined.tier, read: refined.read };
}

/** The Hermes profile a request works on: `?profile=`, then the body's `profile`, then the profile a path names. */
export function profileOf(match: Extract<RestMatch, { ok: true }>, { query, body }: RequestFacts): string | null {
  const fromQuery = query.getAll('profile').at(-1);
  if (fromQuery) return fromQuery;
  if (body && typeof body.profile === 'string' && body.profile) return body.profile;
  if (match.operation.includes('/profiles/{')) {
    for (const name of PROFILE_PATH_PARAMS) if (match.params[name]) return match.params[name];
  }
  return null;
}

/** The operations that delete a profile's sessions. Hermes serves every profile from one backend, so a call that names none acts on whichever home it happens to hold. */
const NEEDS_EXPLICIT_PROFILE: Record<string, true> = {
  'DELETE /api/sessions/{session_id}': true,
  'DELETE /api/sessions/empty': true,
  'POST /api/sessions/bulk-delete': true,
  'POST /api/sessions/prune': true,
};

/** Whether the request is a destructive session call that names no profile (a blank one counts as none). A dry-run prune deletes nothing, so it needs none. */
export function lacksExplicitProfile(match: Extract<RestMatch, { ok: true }>, facts: RequestFacts): boolean {
  if (NEEDS_EXPLICIT_PROFILE[match.operation] !== true || resolveTier(match, facts).read) return false;
  return (profileOf(match, facts) ?? '').trim() === '';
}
