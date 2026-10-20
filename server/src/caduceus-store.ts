// Caduceus's own store: Caduceus-only concepts (never copies of Hermes data), in `<Hermes root home>/caduceus/`
// so that `hermes backup` includes it (architecture §2). Readable by the owner only.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface CaduceusStore {
  /** `<Hermes root home>/caduceus`. */
  readonly dir: string;
  readonly db: DatabaseSync;
  close(): void;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS owner (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    user_agent TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    source TEXT NOT NULL
  );
`;

/**
 * Changes to SCHEMA (above, as M0 #03 shipped it), applied in order; `PRAGMA user_version` counts the ones applied.
 * Never edit a shipped migration: append a new one.
 */
const MIGRATIONS = [
  // M0 #04: passkeys. The password becomes optional (a passkey-only owner), and the owner gets a random WebAuthn
  // user handle, so passkeys from two Caduceus installs on the same RP ID never overwrite each other.
  `
  CREATE TABLE owner_new (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    password_hash TEXT,
    webauthn_user_id TEXT NOT NULL DEFAULT (lower(hex(randomblob(32)))),
    created_at INTEGER NOT NULL
  );
  INSERT INTO owner_new (id, password_hash, created_at) SELECT id, password_hash, created_at FROM owner;
  DROP TABLE owner;
  ALTER TABLE owner_new RENAME TO owner;
  CREATE TABLE passkeys (
    id TEXT PRIMARY KEY,
    public_key BLOB NOT NULL,
    counter INTEGER NOT NULL,
    transports TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_used_at INTEGER
  );
  `,
  // M0 #07: per-device preferences. A device is a browser profile, known by the `caduceus_device` cookie (see
  // device-preferences.ts), not a session: signing out and in again, or revoking a session, leaves its choices alone.
  // `section` names a group of preferences (`appearance`), `value` is its JSON.
  `
  CREATE TABLE device_preferences (
    device_id TEXT NOT NULL,
    section TEXT NOT NULL,
    value TEXT NOT NULL,
    PRIMARY KEY (device_id, section)
  );
  `,
  // M0 #08: the audit log gains the risk tier and the Hermes profile of what was done (NULL when there is none), and
  // Caduceus gains a small settings table, which holds read-only mode.
  `
  ALTER TABLE audit ADD COLUMN tier TEXT;
  ALTER TABLE audit ADD COLUMN profile TEXT;
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  // M4 #01: preferences of a Hermes profile that only Caduceus knows (the assistant display name), keyed by the profile's name.
  `
  CREATE TABLE profile_preferences (
    profile TEXT PRIMARY KEY,
    assistant_name TEXT NOT NULL
  );
  `,
  // M5 #01: changes that need a gateway restart to apply (the restart-to-apply banner). One row per profile and reason; `raised_at`
  // is when the latest such change was made. A row goes once its profile's gateway has started after that time.
  `
  CREATE TABLE gateway_restart_pending (
    profile TEXT NOT NULL,
    reason TEXT NOT NULL,
    raised_at INTEGER NOT NULL,
    PRIMARY KEY (profile, reason)
  );
  `,
  // M3 #03: the owner's saved task filters: a name and the filter definition (JSON, see contracts/task-filters.ts), never a task.
  // `position` is the order they were made in.
  `
  CREATE TABLE saved_filters (
    position INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    definition TEXT NOT NULL
  );
  `,
  // M4 #02: the text a write to one of a profile's behaviour files replaced (R1), a ring buffer per file. `target` names the file
  // (`soul:<profile>`, `config:<profile>`, `file:<resolved path>`); Hermes's copy is the only live one.
  `
  CREATE TABLE file_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target TEXT NOT NULL,
    at INTEGER NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX file_snapshots_target ON file_snapshots (target, id);
  `,
  // M3 #08: the categories that group task templates (the templates themselves are YAML files under `playbooks/`). A template names its
  // category by `id`, so a rename changes `name` only; `position` is the owner's order.
  `
  CREATE TABLE template_categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    position INTEGER NOT NULL
  );
  `,
  // M3 #10: the workspace registry, the owner's named directories in the owner's order (`position`). Nothing of Hermes's projects is kept here.
  `
  CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL UNIQUE,
    position INTEGER NOT NULL
  );
  `,
  // M1 #11: chat drafts (the owner's unsent composer text, per Hermes profile and session id or `new`) and the attachments they keep (the bytes
  // themselves, so a draft survives a reload on any device). `revision` counts every draft write; it comes from the settings counter
  // `chat.draft-revision`, so a draft that was deleted and made again never repeats a revision a device may still hold.
  `
  CREATE TABLE chat_drafts (
    profile TEXT NOT NULL,
    session TEXT NOT NULL,
    text TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (profile, session)
  );
  CREATE TABLE chat_draft_attachments (
    position INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    profile TEXT NOT NULL,
    session TEXT NOT NULL,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    pasted INTEGER NOT NULL,
    origin TEXT,
    body BLOB NOT NULL
  );
  CREATE INDEX chat_draft_attachments_draft ON chat_draft_attachments (profile, session);
  `,
  // M1 #11: the owner's saved prompts. `profile` is NULL for a prompt every profile shows; `tags` is a JSON array of lower-case words.
  `
  CREATE TABLE saved_prompts (
    position INTEGER PRIMARY KEY AUTOINCREMENT,
    id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    text TEXT NOT NULL,
    tags TEXT NOT NULL,
    profile TEXT,
    updated_at INTEGER NOT NULL
  );
  `,
  // M2 #02: what a device has put aside in its Inbox, against the Hermes reference and the state's stamp (never the item itself): `until` is when
  // a snooze ends, NULL for a dismissal. And the activity feed's cursor per device (R8): the last event it has seen.
  `
  CREATE TABLE inbox_hidden (
    device_id TEXT NOT NULL,
    ref TEXT NOT NULL,
    stamp TEXT NOT NULL,
    until INTEGER,
    at INTEGER NOT NULL,
    PRIMARY KEY (device_id, ref)
  );
  CREATE TABLE activity_cursors (
    device_id TEXT PRIMARY KEY,
    seen INTEGER NOT NULL
  );
  `,
  // M2 #03: Web Push. One subscription per device (the `caduceus_device` cookie), with the settings it asked for (JSON), the origin its pages are served
  // from (where a notification's tap goes) and its user agent (how Settings › Security names it). `push_log` is the dedupe log: a notification
  // is sent to a device once for each Hermes state (`key`), across restarts. `push_digest` holds what a device's digest has not sent yet.
  `
  CREATE TABLE push_subscriptions (
    id TEXT PRIMARY KEY,
    device_id TEXT NOT NULL UNIQUE,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    origin TEXT NOT NULL,
    user_agent TEXT NOT NULL,
    settings TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_sent_at INTEGER
  );
  CREATE TABLE push_log (
    device_id TEXT NOT NULL,
    key TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (device_id, key)
  );
  CREATE TABLE push_digest (
    device_id TEXT NOT NULL,
    key TEXT NOT NULL,
    title TEXT NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (device_id, key)
  );
  `,
  // M7 #02: the bytes an Office save replaced (R11), a ring buffer per file like the text snapshots above, but binary. `target` is the file's canonical path.
  `
  CREATE TABLE file_byte_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    target TEXT NOT NULL,
    at INTEGER NOT NULL,
    bytes BLOB NOT NULL
  );
  CREATE INDEX file_byte_snapshots_target ON file_byte_snapshots (target, id);
  `,
  // M7 #06: share links (R4). Only the SHA-256 of a token is kept; the frozen transcript is a file under `shares/<id>.json`. `revoked_at` starts the undo window.
  `
  CREATE TABLE shares (
    id TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    session_id TEXT NOT NULL,
    profile TEXT NOT NULL,
    title TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER,
    revoked_at INTEGER
  );
  `,
  // M5 #15: the extra sign-in methods (`oidc`, `tailscale`): whether each is on and its settings as JSON. The OIDC client secret is in it, in a store only the owner can read.
  `
  CREATE TABLE auth_methods (
    id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL,
    config TEXT NOT NULL
  );
  `,
  // M4 #10: the banks Hindsight listed the last time it answered a profile (the only Hindsight data Caduceus keeps; D1), the MCP servers the owner marked as
  // notes sources, and the stdio commands the owner approved to run (`fingerprint` is a hash of the command line, so a changed command asks again).
  `
  CREATE TABLE hindsight_banks (
    profile TEXT NOT NULL,
    bank_id TEXT NOT NULL,
    name TEXT,
    mission TEXT,
    facts INTEGER NOT NULL,
    updated_at TEXT,
    PRIMARY KEY (profile, bank_id)
  );
  CREATE TABLE notes_sources (
    profile TEXT NOT NULL,
    server TEXT NOT NULL,
    PRIMARY KEY (profile, server)
  );
  CREATE TABLE notes_commands (
    profile TEXT NOT NULL,
    server TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    approved_at INTEGER NOT NULL,
    PRIMARY KEY (profile, server)
  );
  `,
  // M3 #09: the scheduled jobs whose notifications the owner switched off (Inbox item and push), a preference of Caduceus's keyed by profile and job id.
  // Hermes's own job is not touched. A row is a job that is silenced; the rest notify.
  `
  CREATE TABLE job_notifications_off (
    profile TEXT NOT NULL,
    job_id TEXT NOT NULL,
    PRIMARY KEY (profile, job_id)
  );
  `,
  // Security: a push subscription ends with the session that made it (the session id; older rows have none and stay until the owner removes them).
  `
  ALTER TABLE push_subscriptions ADD COLUMN session_id TEXT;
  `,
  // M6 #05: Artifacts. A row describes one kept file (`artifacts/<id>` beside the database) and where it came from. `origin` names what a capture took it from
  // (a Kanban attachment) so the same attachment is kept once. A deleted or evicted artifact keeps its row as a tombstone (`deleted_at`, `purged` once the file is
  // gone), so the next sweep of the board does not capture it again.
  `
  CREATE TABLE artifacts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    title TEXT NOT NULL,
    kind TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_board TEXT,
    source_profile TEXT,
    source_playbook TEXT,
    source_task TEXT,
    source_label TEXT NOT NULL,
    origin TEXT UNIQUE,
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    deleted_at INTEGER,
    purged INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX artifacts_source ON artifacts (source_type, source_id);
  `,
  // M5 #05: budgets (R9). A budget is an amount per period, optionally for one profile; an alert row says that the budget's 80% or 100% alert was raised in the
  // period that began on \`period_start\` (a UTC day), so each is raised once however often usage is read. Neither holds any usage: that is Hermes's.
  `
  CREATE TABLE budgets (
    id TEXT PRIMARY KEY,
    amount REAL NOT NULL,
    period TEXT NOT NULL,
    profile TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE budget_alerts (
    budget_id TEXT NOT NULL REFERENCES budgets (id) ON DELETE CASCADE,
    period_start TEXT NOT NULL,
    threshold INTEGER NOT NULL,
    at INTEGER NOT NULL,
    PRIMARY KEY (budget_id, period_start, threshold)
  );
  `,
  // Security: the address a profile's Hindsight key was first sent to. The key goes nowhere else, whatever Hermes's setting is changed to.
  `
  CREATE TABLE hindsight_key_urls (
    profile TEXT PRIMARY KEY,
    api_url TEXT NOT NULL
  );
  `,
  // M6 #06: the budget guard. A trip is one budget used up in one period at one amount (so it trips once, and again only if the owner raises the budget and
  // it is used up again, or a new period starts); its actions are exactly what the guard paused, each with what it needs to put it back (`target`, JSON). A
  // job in `guard_exempt_jobs` is one the owner keeps running through a trip.
  `
  CREATE TABLE guard_trips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    budget_id TEXT NOT NULL,
    amount REAL NOT NULL,
    period TEXT NOT NULL,
    period_start TEXT NOT NULL,
    profile TEXT,
    spent REAL NOT NULL,
    at INTEGER NOT NULL,
    done INTEGER NOT NULL DEFAULT 0,
    UNIQUE (budget_id, period_start, amount)
  );
  CREATE TABLE guard_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trip_id INTEGER NOT NULL,
    kind TEXT NOT NULL,
    target TEXT NOT NULL,
    label TEXT NOT NULL,
    status TEXT NOT NULL,
    reason TEXT,
    at INTEGER NOT NULL
  );
  CREATE TABLE guard_exempt_jobs (
    profile TEXT NOT NULL,
    job_id TEXT NOT NULL,
    PRIMARY KEY (profile, job_id)
  );
  `,
  // M8 #03: Today's review state. `today_state` is the owner's place: when Caduceus began keeping it (`began_at`: work that finished earlier was never offered for
  // review) and the last two visits (`visit_at`, and the one before the current stretch of visits: `previous_visit_at`). `today_opened` holds the markers of what the owner opened:
  // the id and the stamp of the finish they opened (never the task or the run itself), so an item that finishes again comes back as new work.
  `
  CREATE TABLE today_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    began_at INTEGER NOT NULL,
    visit_at INTEGER,
    previous_visit_at INTEGER
  );
  CREATE TABLE today_opened (
    id TEXT PRIMARY KEY,
    stamp TEXT NOT NULL,
    at INTEGER NOT NULL
  );
  `,
];

/** Opens (creating on first run) the store under the Hermes root home, and makes it owner-only. */
export function openCaduceusStore(hermesRoot: string): CaduceusStore {
  const dir = path.join(hermesRoot, 'caduceus');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // The mode above only applies when the directory is new, and a restored backup comes back with default modes.
  fs.chmodSync(dir, 0o700);
  const file = path.join(dir, 'caduceus.db');
  // SQLite creates its -wal and -shm files with the database file's mode, so creating it 0600 covers them too.
  fs.closeSync(fs.openSync(file, 'a', 0o600));
  fs.chmodSync(file, 0o600);
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  const { user_version: applied } = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (const [index, migration] of MIGRATIONS.entries()) {
    if (index < applied) continue;
    db.exec('BEGIN');
    db.exec(migration);
    db.exec(`PRAGMA user_version = ${index + 1}`);
    db.exec('COMMIT');
  }
  return { dir, db, close: () => db.close() };
}
