// Restoring a backup (M5 #14). Hermes does the restore (`hermes import`, a spawned action the policy proxy forwards as `POST /api/ops/import` or
// `/api/ops/import-upload`); Caduceus's part is what must surround it. A restore puts back files that Hermes and Caduceus hold open, Caduceus's own SQLite
// store among them, so it is done like an update: Caduceus drains first (no new turn starts, and the turns working are given a while to end), Hermes imports,
// the Hermes backend restarts on the restored home (which runs the contract drift check again), and Caduceus restarts itself through the supervised hook,
// still draining, so that it opens the restored store anew. A restore that fails changes nothing that needs a restart: the drain just ends.
import { setTimeout as delay } from 'node:timers/promises';
import { waitForTurns, type Drain } from './drain.ts';
import type { HermesBackend } from './hermes-backend.ts';
import type { ReadActionStatus } from './maintenance-routes.ts';

/** The operations of Hermes that restore a backup: from a path on this Mac and from an uploaded file. */
const RESTORE_OPERATIONS: Record<string, true> = { 'POST /api/ops/import': true, 'POST /api/ops/import-upload': true };

export const isRestore = (operation: string): boolean => RESTORE_OPERATIONS[operation] === true;

/** How many answers in a row Hermes may fail to give about the restore before Caduceus stops waiting for it. */
const MAX_MISSED = 20;

export interface RestoreDeps {
  backend: HermesBackend;
  /** Reads Hermes's status of an action: the one the maintenance routes read through, which keeps the import's exit code across Hermes's restart. */
  actionStatus: ReadActionStatus;
  drain: Drain;
  /** Ends every page connection and asks the process to restart; without it Caduceus cannot restore, since it cannot reopen its own store. */
  restart?: () => Promise<void> | void;
  pollMs: number;
  drainTimeoutMs: number;
}

/** A restore that has begun: its drain is on, and it ends one of two ways. */
export interface RestoreRun {
  /** Hermes took the import: wait for it to end, restart Hermes and Caduceus. */
  accepted(): void;
  /** Hermes did not take the import: the drain ends. */
  refused(): void;
}

export type RestoreStart = { ok: true; run: RestoreRun } | { ok: false; status: number; body: { error: 'busy' | 'unavailable'; message: string } };

export interface Restore {
  /** Starts the drain and waits for the working turns (a while at most). Refused when Caduceus is already draining, or cannot restart itself. */
  begin(): Promise<RestoreStart>;
}

export function createRestore({ backend, actionStatus, drain, restart, pollMs, drainTimeoutMs }: RestoreDeps): Restore {
  /** Waits for Hermes's import to end; true when it ended well. */
  const imported = async (): Promise<boolean> => {
    let missed = 0;
    for (;;) {
      const status = await actionStatus('import');
      if (status) {
        missed = 0;
        if (!status.running) return status.exitCode === 0 || status.exitCode === null;
      } else if (++missed >= MAX_MISSED) return false;
      await delay(pollMs);
    }
  };

  return {
    async begin() {
      if (drain.active()) return { ok: false, status: 409, body: { error: 'busy', message: 'Caduceus is already draining for an update or a restart. Wait for it to finish.' } };
      if (!restart) {
        return { ok: false, status: 409, body: { error: 'unavailable', message: 'Caduceus is not running as the background service here, so it cannot restart itself after a restore replaces its own files.' } };
      }
      drain.begin('A backup is being restored.');
      await waitForTurns(backend, { pollMs, timeoutMs: drainTimeoutMs, say: () => undefined });
      return {
        ok: true,
        run: {
          refused: () => drain.end(),
          accepted() {
            // Not awaited: the page follows Hermes's log of the import, then watches Caduceus's connection drop and come back.
            void (async () => {
              try {
                if (await imported()) {
                  await backend.restart();
                  // Still draining when the process goes: no turn can start in between. Its restart takes the drain with it.
                  await restart();
                  return;
                }
              } catch {
                // A backend that is stopped has nothing to restart; either way the drain must not outlive the attempt.
              }
              drain.end();
            })();
          },
        },
      };
    },
  };
}
