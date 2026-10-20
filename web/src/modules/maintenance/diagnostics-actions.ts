// What Diagnostics changes or runs (M5 #13), each through `fetchTiered` with the tier the policy map gives the route: Hermes's diagnostic actions are Tier 1
// (prompt size is a read), the debug share Tier 3 (it uploads), the restarts Tier 2 (a passkey, and Caduceus drains first).
import { fetchTiered } from '../../tiered.ts';
import { runTiered, type ActionOutcome } from '../profiles/profile-actions.ts';
import type { DiagnosticAction } from './diagnostics-model.ts';

/** Starts one of Hermes's diagnostic actions; its output is then followed with `useActionOutput`. */
export function runDiagnostic(action: DiagnosticAction): Promise<ActionOutcome> {
  return runTiered(fetchTiered({ method: 'POST', path: `/api/ops/${action.id}`, confirm: action.confirm }));
}

/** What a debug share answered: the pages Hermes uploaded, and what it says it did to them. */
export interface DebugShare {
  urls: Record<string, string>;
  failures: Record<string, string> | string[];
  redacted: boolean;
  autoDeleteSeconds: number | null;
}

/** Uploads a redacted report and the newest log lines to Hermes's paste service (Tier 3: the owner types "debug share"). */
export async function shareDebug(lines: number): Promise<ActionOutcome<DebugShare>> {
  const outcome = await runTiered<{ urls?: Record<string, string>; failures?: Record<string, string> | string[]; redacted?: boolean; auto_delete_seconds?: number }>(
    fetchTiered({
      method: 'POST',
      path: '/api/ops/debug-share',
      body: { lines, redact: true },
      confirm: {
        title: 'Upload a debug report?',
        text: `Hermes uploads a report about this install and the newest ${lines} lines of its logs to its paste service, and gives you links. Hermes removes the keys and tokens it recognises first, but the links are public to anyone who has them. Hermes deletes the pastes itself after a while.`,
        object: 'debug share',
        confirmLabel: 'Upload report',
        recoverability: { undoable: false, note: 'Once uploaded, anyone with the link can read it until Hermes deletes it.' },
      },
    }),
  );
  if (outcome.kind !== 'done') return outcome;
  const { urls = {}, failures = [], redacted = false, auto_delete_seconds } = outcome.body;
  return { kind: 'done', body: { urls, failures, redacted, autoDeleteSeconds: typeof auto_delete_seconds === 'number' ? auto_delete_seconds : null } };
}

/** Restarts the Hermes backend, or Caduceus itself (Tier 2). Caduceus drains first, so no new turn starts; every page reconnects by itself. */
export function restart(target: 'backend' | 'caduceus'): Promise<ActionOutcome> {
  const hermes = target === 'backend';
  return runTiered(
    fetchTiered({
      method: 'POST',
      path: '/_caduceus/api/maintenance/restart',
      body: { target },
      confirm: {
        title: hermes ? 'Restart the Hermes backend?' : 'Restart Caduceus?',
        text: hermes
          ? 'Caduceus pauses new turns and waits a little for the ones in progress to finish, then restarts the Hermes it runs. A turn that is still running is interrupted. Every open chat reconnects by itself.'
          : 'Caduceus pauses new turns and waits a little for the ones in progress to finish, then restarts itself and the Hermes it runs. This page loses its connection for a moment and reconnects by itself.',
        object: hermes ? 'Hermes backend' : 'Caduceus',
        confirmLabel: hermes ? 'Restart Hermes' : 'Restart Caduceus',
      },
    }),
  );
}
