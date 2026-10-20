// What the wizard asks Hermes through the page's gateway connection (M5 #16): the two readiness probes behind the checks. They take the client as an argument
// so that a test runs them against a real Hermes.
import type { SetupRuntimeCheckResult, SetupStatusResult } from '@caduceus/contracts/hermes/gateway';

/** The part of the page's shared Hermes client these calls use. */
export interface GatewayRequests {
  request<T>(method: string, params?: Record<string, unknown>): Promise<T>;
}

export interface SetupAnswers {
  /** Hermes's loose check (`setup.status`); `undefined` when it could not be asked. */
  status: SetupStatusResult | undefined;
  /** Hermes's strict check (`setup.runtime_check`, which resolves the model as a new session would); `undefined` when it could not be asked. */
  runtime: SetupRuntimeCheckResult | undefined;
}

/**
 * Asks Hermes both readiness questions about a profile, each on its own: one that fails to answer does not hide the other. With a `provider`, the strict check
 * is about that provider alone (Hermes then ignores its fallback chain), so a provider the owner has just connected is verified, not masked by another.
 */
export async function readSetup(client: GatewayRequests, profile: string, provider?: string): Promise<SetupAnswers> {
  const [status, runtime] = await Promise.all([
    client.request<SetupStatusResult>('setup.status', { profile }).catch(() => undefined),
    client.request<SetupRuntimeCheckResult>('setup.runtime_check', { profile, ...(provider === undefined ? {} : { provider }) }).catch(() => undefined),
  ]);
  return { status, runtime };
}
