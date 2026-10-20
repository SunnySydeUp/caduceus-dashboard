// Health: gathers what Caduceus knows and what Hermes's own status endpoints say, and evaluates it (`health-rules.ts`).
// Nothing of Hermes is kept: every report asks again, so Caduceus never holds a copy of Hermes's data. The one thing remembered is
// Caduceus's own observation of which Repairs have come back (`repair-recurrence.ts`).
import type { CompatibilityReport, HealthReport } from '@caduceus/contracts/caduceus-api';
import { evaluateHealth, type HermesAnswers } from './health-rules.ts';
import type { HermesBackend } from './hermes-backend.ts';
import { createRepairHistory } from './repair-recurrence.ts';
import type { ReadOnlyMode } from './read-only.ts';

export interface HealthOptions {
  backend: HermesBackend;
  now: () => number;
  /** Whether the running Hermes matches the contracts Caduceus was built for (the answer waits for a check that is under way). */
  compatibility: () => Promise<CompatibilityReport>;
  readOnly: ReadOnlyMode;
  /** How long Hermes has to answer each status request before the report goes on without it. */
  askTimeoutMs?: number;
}

export interface Health {
  report(): Promise<HealthReport>;
}

const DEFAULT_ASK_TIMEOUT_MS = 5_000;

/** The Hermes endpoints a report reads, by the field of `HermesAnswers` each fills. All are plain reads. */
const QUESTIONS: Record<keyof HermesAnswers, string> = {
  status: '/api/status',
  cronJobs: '/api/cron/jobs?profile=all',
  kanbanStats: '/api/plugins/kanban/stats',
  kanbanDiagnostics: '/api/plugins/kanban/diagnostics',
  credentialPool: '/api/credentials/pool',
  modelOptions: '/api/model/options?include_unconfigured=true',
  systemStats: '/api/system/stats',
  health: '/api/health',
  identity: '/api/host/identity',
  egress: '/api/egress/status',
  idle: '/api/health/idle',
};

export function createHealth({ backend, now, compatibility, readOnly, askTimeoutMs = DEFAULT_ASK_TIMEOUT_MS }: HealthOptions): Health {
  const history = createRepairHistory();
  /** `answer`, or `late` if it is not there within the time a report allows. */
  function within<T, L>(answer: Promise<T>, late: L, signal: AbortSignal): Promise<T | L> {
    const { promise: timedOut, resolve } = Promise.withResolvers<L>();
    signal.addEventListener('abort', () => resolve(late), { once: true });
    return Promise.race([answer, timedOut]);
  }

  /** Hermes's answer as parsed JSON, or `undefined` when it does not give one in time (down, slow, an error, not JSON). */
  function ask(path: string): Promise<unknown> {
    const timeout = AbortSignal.timeout(askTimeoutMs);
    // `backend.fetch` waits for a backend that is not ready, which a signal cannot cut short; the race can.
    const answer = backend
      .fetch(path, { signal: timeout })
      .then((res) => (res.ok ? (res.json() as Promise<unknown>) : undefined))
      .catch(() => undefined);
    return within(answer, undefined, timeout);
  }

  return {
    async report() {
      const at = now();
      const ready = backend.status.state === 'ready';
      const hermes: HermesAnswers = {};
      // A check that is still running (Hermes has just started) is not an answer yet.
      const compatible = within(compatibility(), { state: 'checking' } as const, AbortSignal.timeout(askTimeoutMs));
      if (ready) {
        await Promise.all(
          (Object.entries(QUESTIONS) as [keyof HermesAnswers, string][]).map(async ([field, path]) => {
            hermes[field] = await ask(path);
          }),
        );
      }
      const { subsystems, repairs } = evaluateHealth({
        now: at,
        backend: backend.status,
        restarts: backend.restarts,
        compatibility: await compatible,
        readOnly: { enabled: readOnly.enabled() },
        hermes,
      });
      const recurring = history.observe({ open: repairs, known: subsystems.filter((subsystem) => subsystem.state !== 'unknown').map((subsystem) => subsystem.id) }, at);
      return {
        checkedAt: new Date(at).toISOString(),
        subsystems,
        repairs: repairs.map((repair) => (recurring.has(repair.id) ? { ...repair, recurring: recurring.get(repair.id) } : repair)),
      };
    },
  };
}
