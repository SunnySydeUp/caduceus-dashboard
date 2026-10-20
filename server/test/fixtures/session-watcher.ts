// Makes Hermes's session change watcher report, so that what the test does next is a change it reports and not part of its baseline.
//
// Hermes's watcher (`tui_gateway/change_watcher.py`) records a digest of the session rows on its first pass, about half a second after the first gateway
// connection, and broadcasts `sessions.changed` when a later pass finds the digest moved: a session written before that pass is part of the baseline and
// is never announced. Hermes 0.22 digests the rows (id, title, message count, pin, archive, read mark...) and no longer the file's modification time, so
// touching the file does nothing. A row of a session that nothing lists (an ended cron run) has its title changed, as another Hermes tool would change
// it, until the watcher reports. This is a bounded poll of the watcher's own 0.5 s tick, and it fails with the time it gave up at.
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { vi } from 'vitest';
import { seedSessions } from './seed-session.ts';

const PRIMER = 'watcher-primer';
const GIVE_UP_MS = 10_000;

export async function primeSessionWatcher(home: string, client: { on(event: 'sessions.changed', handler: () => void): () => void }): Promise<void> {
  await seedSessions(home, [{ id: PRIMER, source: 'cron', exchanges: 0, endReason: 'cron_complete' }]);
  let reported = false;
  const stop = client.on('sessions.changed', () => {
    reported = true;
  });
  const store = new DatabaseSync(path.join(home, 'state.db'));
  store.exec('PRAGMA busy_timeout = 2000');
  const retitle = store.prepare('UPDATE sessions SET title = ? WHERE id = ?');
  let turn = 0;
  try {
    await vi.waitFor(
      () => {
        if (reported) return;
        turn += 1;
        retitle.run(`Primer ${turn}`, PRIMER);
        throw new Error('Hermes has not reported a change yet');
      },
      { timeout: GIVE_UP_MS, interval: 600 },
    );
  } finally {
    stop();
    store.close();
  }
}
