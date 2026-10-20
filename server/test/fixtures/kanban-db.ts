// What Hermes has no write path for (a worker that crashed and was given up on, the playbook a task came from) a test writes into Hermes's `kanban.db` itself,
// as a worker would have. Hermes owns the file and writes it too, in every `hermes kanban` call and every request of its Kanban API, and a write made while it
// holds the write lock is refused at once ("database is locked") unless the connection waits for the lock. On a busy machine Hermes holds it long enough for that
// to happen to a test that does not wait.
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** How long a write waits for a lock Hermes holds: far longer than any transaction of its, and well inside a test's own limit. */
export const KANBAN_LOCK_WAIT_MS = 20_000;

/** Runs `edit` on the kanban database of the Hermes home `home`, waiting for any lock Hermes holds. It blocks while it waits: make it quick. */
export function editKanbanDb(home: string, edit: (db: DatabaseSync) => void): void {
  const db = new DatabaseSync(path.join(home, 'kanban.db'), { timeout: KANBAN_LOCK_WAIT_MS });
  try {
    edit(db);
  } finally {
    db.close();
  }
}
