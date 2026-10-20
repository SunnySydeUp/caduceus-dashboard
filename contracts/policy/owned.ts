// The operations Caduceus performs itself and not through Hermes, that the owner confirms in the shared tiered dialog (architecture §2,
// "guarded file operations", R11). They are classified like Hermes's routes (same request lines, same tiers, same dialog and the same
// typed confirmation), but they are not forwarded anywhere: the Caduceus server runs them, and `server/src/policy.ts` judges the request
// before it does. A test would not find them in Hermes's pinned contract, so they are listed here and not in `rest.ts`.
import type { FilePathSource } from './rest.ts';
import type { Policy } from './tiers.ts';

/** An operation of Caduceus's own; `filePath` is where its request names a file for the file guard, as for Hermes's file routes. */
export interface OwnedPolicy extends Policy {
  filePath?: FilePathSource | readonly FilePathSource[];
}

export const CADUCEUS_OPERATIONS: Readonly<Record<string, OwnedPolicy>> = {
  /** Empties one of Hermes's log files (M5 #06). The owner types the file's name. */
  'POST /_caduceus/api/logs/truncate': { tier: 'T3', read: false },
  /** Creates a Kanban task through `hermes kanban create` (M3 #07), for the fields the Kanban REST API cannot set. The same tier as the plugin's own `POST /tasks`. */
  'POST /_caduceus/api/work/tasks': { tier: 'T1', read: false },
  /** Sends a task back to Ready (Retry, M3 #04 and #11): a T1 of Caduceus's own, so that it is judged and audited by the server. A card's move to Ready on the board stays Hermes's own `PATCH`, a T0 with an undo toast. */
  'POST /_caduceus/api/work/tasks/{task_id}/retry': { tier: 'T1', read: false },
  /** The owner's decisions on a task of the Inbox (M3 #09): Approve and Answer are T1 like Retry; Reject carries a note the owner has just written and is a T0. */
  'POST /_caduceus/api/work/tasks/{task_id}/approve': { tier: 'T1', read: false },
  'POST /_caduceus/api/work/tasks/{task_id}/answer': { tier: 'T1', read: false },
  'POST /_caduceus/api/work/tasks/{task_id}/reject': { tier: 'T0', read: false },
  /** The notification switch of one scheduled job (M3 #09): a preference of Caduceus's, keyed by profile and job id. Hermes's job is not changed. */
  'PUT /_caduceus/api/work/jobs/{profile}/{job_id}/notifications': { tier: 'T0', read: true },
  /** Saves a playbook or template as a new version (M6 #01): the owner's own definition in Caduceus's folder, the old version stays readable. */
  'PUT /_caduceus/api/work/playbooks/{id}': { tier: 'T1', read: false },
  /** Deletes a playbook or template (M6 #01); the toast offers an undo, and the versions a run was started from stay readable. */
  'DELETE /_caduceus/api/work/playbooks/{id}': { tier: 'T1', read: false },
  /** Starts a playbook run (M6 #02): makes the first stage's Kanban task, after which the engine makes the rest as stages end. The owner confirms, and the dialog names the playbook and the profiles it will assign. */
  'POST /_caduceus/api/work/playbooks/{id}/runs': { tier: 'T1', read: false },
  /** Re-runs a playbook run from one stage (M6 #03): a new attempt of that stage, with the stages that are done left as they are. */
  'POST /_caduceus/api/work/playbook-runs/{root}/rerun': { tier: 'T1', read: false },
  /** The budget guard (M6 #06). Undoing its pauses is a T1 whose dialog names what resumes; raising a budget from the Inbox is a T1; turning the guard off is a T2 (it is what stops unattended spending); the rest is Caduceus's own preference. */
  'POST /_caduceus/api/budget-guard/undo': { tier: 'T1', read: false },
  'POST /_caduceus/api/budget-guard/raise': { tier: 'T1', read: false },
  'POST /_caduceus/api/budget-guard/disable': { tier: 'T2', read: false },
  'POST /_caduceus/api/budget-guard/enable': { tier: 'T0', read: false },
  'PUT /_caduceus/api/budget-guard/settings': { tier: 'T0', read: false },
  /** Keeps one scheduled job running when the budget guard trips (M6 #06): a preference of Caduceus's, keyed by profile and job id. */
  'PUT /_caduceus/api/work/jobs/{profile}/{job_id}/guard-exempt': { tier: 'T0', read: false },
  /** Deletes an artifact (M6 #05): it leaves the list at once and the toast offers an undo for a minute, after which its file is removed. */
  'DELETE /_caduceus/api/artifacts/{id}': { tier: 'T1', read: false },
  /** The undo of that delete, a pin that keeps an artifact out of the size cap's cleanup, the cap itself, and keeping a task's attachment as an artifact: Caduceus's own files, nothing in Hermes changes. */
  'POST /_caduceus/api/artifacts/{id}/restore': { tier: 'T0', read: false },
  'PUT /_caduceus/api/artifacts/{id}/pin': { tier: 'T0', read: false },
  'PUT /_caduceus/api/artifacts-settings': { tier: 'T0', read: false },
  'POST /_caduceus/api/artifacts/from-task': { tier: 'T0', read: false },
  'POST /_caduceus/api/artifacts/from-session': { tier: 'T0', read: false },
  /** Saves a cron script into a profile's `scripts/` folder through Hermes's file endpoint (M3 #12), refusing every way out of that folder. Code the scheduler will run: T3, the owner types the script's name. */
  'PUT /_caduceus/api/work/scripts': { tier: 'T3', read: false },
  /** Checks a key Hermes holds with Hermes's own validation (M5 #10): the key goes to its provider, the verdict comes back, and nothing in Hermes changes. */
  'POST /_caduceus/api/keys/test': { tier: 'T1', read: true },
  /** Installs or updates a Hermes plugin by running Hermes's own `hermes plugins install|update`, so the log can stream while it works (M5 #11). Git-installed Python: T3, the owner types the address or the name. */
  'POST /_caduceus/api/plugins/operations': { tier: 'T3', read: false },
  /**
   * Updates Hermes or Caduceus itself (M5 #12): drains Caduceus first (no new turns), runs the update with a live log, restarts, checks the result
   * and lets turns start again. It replaces the code that is running, so the owner confirms it with a passkey: T2, like Hermes's own update route.
   */
  'POST /_caduceus/api/updates/operations': { tier: 'T2', read: false },
  /**
   * Restarts the Hermes backend or Caduceus itself, drained (M5 #13): no new turns, then the restart, then pages reconnect. A passkey (T2), and, like the
   * Health Repair that restarts the backend, allowed in read-only mode: it changes nothing in Hermes's data, and read-only mode is when the owner may need it.
   */
  'POST /_caduceus/api/maintenance/restart': { tier: 'T2', read: true },
  /**
   * The workspace registry (M3 #10), Caduceus's own list of named directories. Adding one is a T1 because a raw file write inside a registered workspace is
   * a T1 rather than a T3; renaming and reordering are T0; removing one is a T1 (it forgets the name, never the folder).
   */
  'POST /_caduceus/api/work/workspaces': { tier: 'T1', read: false },
  'PUT /_caduceus/api/work/workspaces/order': { tier: 'T0', read: false },
  'PUT /_caduceus/api/work/workspaces/{id}': { tier: 'T0', read: false },
  'DELETE /_caduceus/api/work/workspaces/{id}': { tier: 'T1', read: false },
  /**
   * The owner's decision on an Inbox item (M2 #01): Caduceus gives it to Hermes as an `approval.respond` or `request.answer`. The same tiers as
   * the chat's own answer: a deny is allowed in read-only mode, "always" is a standing permission (T2), the rest are T0.
   */
  'POST /_caduceus/api/inbox/{id}/decision': { tier: 'T0', read: false },
  /**
   * Kills the terminal shell and starts a fresh one (M7 #05): a T1, the owner confirms. The shell itself is a WebSocket route
   * (`CADUCEUS_WEBSOCKET_ROUTES`): opening it is a T2.
   */
  'POST /_caduceus/api/terminal/restart': { tier: 'T1', read: false },
  /**
   * The guarded file operations of Workspace › Files (R11, M7 #02), inside the roots Hermes's file API exposes and never on `.env`, `auth.json` or `caduceus/`.
   * Like every write to the Mac's files they are a T3 anywhere but inside a workspace Caduceus knows (`lowerInWorkspace`): there a rename keeps the file in its
   * folder and has an undo toast (T0), and a move names source, destination and profile (T1). The Office save overwrites the original only after a snapshot of the
   * prior bytes: a T1 inside a workspace Caduceus knows, a T3 elsewhere (a protected area), as a raw text save is.
   */
  'POST /_caduceus/api/files/rename': { tier: 'T3', read: false, filePath: { in: 'body', field: 'path', access: 'relocate' } },
  'POST /_caduceus/api/files/move': {
    tier: 'T3',
    read: false,
    filePath: [
      { in: 'body', field: 'path', access: 'relocate' },
      { in: 'body', field: 'destination', access: 'write' },
    ],
  },
  /**
   * Share links (R4, M7 #06). Making one freezes a session's transcript as a read-only snapshot behind a tokenised link and names the session and profile: a T1.
   * Revoking stops the link at once and has an undo window before the snapshot is deleted (T0, like a profile rename's undo); Undo is a T0 too.
   */
  'POST /_caduceus/api/shares': { tier: 'T1', read: false },
  'DELETE /_caduceus/api/shares/{id}': { tier: 'T0', read: false },
  'POST /_caduceus/api/shares/{id}/restore': { tier: 'T0', read: false },
  /** Budgets (M5 #05), Caduceus's own spend limits: making, changing or deleting one is a T1 the owner confirms (it changes when Caduceus tells them of spending, nothing in Hermes). */
  'POST /_caduceus/api/budgets': { tier: 'T1', read: false },
  'PUT /_caduceus/api/budgets/{id}': { tier: 'T1', read: false },
  'DELETE /_caduceus/api/budgets/{id}': { tier: 'T1', read: false },
  'PUT /_caduceus/api/files/office': { tier: 'T3', read: false, filePath: { in: 'body', field: 'path', access: 'write' } },
  /**
   * The Hindsight browser (R10, M4 #10): Caduceus calls the Hindsight API its Hermes profile is set to, with the key it reads from Hermes's audited env reveal, and
   * the key goes no further than that call. Browsing, recall and reflect change nothing in Hindsight, so they are reads (the server records each one in the audit
   * log itself); adding a memory writes to the owner's memory bank: a T1.
   */
  /**
   * Adding or replacing a device's push subscription (security): the push service's endpoint and keys decide who can read every approval command and
   * question the Inbox sends, so it takes a passkey (T2) and is audited. Turning notifications off and changing their settings stay as they were.
   */
  'PUT /_caduceus/api/push/subscription': { tier: 'T2', read: false },
  'GET /_caduceus/api/hindsight/status': { tier: 'T0', read: true },
  'GET /_caduceus/api/hindsight/banks/{bank}/memories': { tier: 'T0', read: true },
  'GET /_caduceus/api/hindsight/banks/{bank}/directives': { tier: 'T0', read: true },
  'GET /_caduceus/api/hindsight/banks/{bank}/mental-models': { tier: 'T0', read: true },
  'POST /_caduceus/api/hindsight/banks/{bank}/recall': { tier: 'T0', read: true },
  'POST /_caduceus/api/hindsight/banks/{bank}/reflect': { tier: 'T0', read: true },
  'POST /_caduceus/api/hindsight/banks/{bank}/memories': { tier: 'T1', read: false },
  /** The owner says the Hindsight address Hermes now names is right, so the key is used with it again (the new address typed). */
  'POST /_caduceus/api/hindsight/key-address': { tier: 'T3', read: false },
  /**
   * External notes (R11, M4 #10): Caduceus is an MCP client for the servers of a profile's Hermes config that the owner marks as notes sources, and calls only their
   * read and search tools. Marking a source is Caduceus's own preference (T0). Running the command of an stdio source is code on the Mac: the first time for a
   * server (and again when its command changes) the owner types the server's name (T3). Search and preview are reads.
   */
  'GET /_caduceus/api/notes/sources': { tier: 'T0', read: true },
  'PUT /_caduceus/api/notes/sources/{server}': { tier: 'T0', read: false },
  'POST /_caduceus/api/notes/sources/{server}/approve': { tier: 'T3', read: false },
  'POST /_caduceus/api/notes/search': { tier: 'T0', read: true },
  'POST /_caduceus/api/notes/preview': { tier: 'T0', read: true },
};

/** The WebSocket routes the Caduceus server serves itself, with the policy every upgrade passes (`classifyWebSocketRoute`). */
export const CADUCEUS_WEBSOCKET_ROUTES: Readonly<Record<string, Policy>> = {
  /** A real shell in a PTY run by Caduceus (M7 #05): a shell is the most the owner can do on the Mac, so every upgrade needs a step-up grant. */
  '/_caduceus/api/terminal': { tier: 'T2', read: false },
};
