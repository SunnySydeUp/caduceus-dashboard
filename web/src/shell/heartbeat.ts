import type { GatewayStatus } from '../gateway-connection.ts';

/**
 * The heartbeat in words. The scope sigil's ring shows the connection as a colour and a line style, so the words go into the scope button's accessible name ("Profile
 * scope: All profiles. Hermes connected."): the state is never told by colour alone, and it stays reachable by keyboard and screen reader.
 */
export function heartbeatWords({ state, attempt }: Pick<GatewayStatus, 'state' | 'attempt'>): string {
  if (state === 'connected') return 'Hermes connected';
  if (state === 'offline') return 'Hermes offline';
  return attempt > 0 ? `Hermes reconnecting, attempt ${attempt}` : 'Hermes connecting';
}
