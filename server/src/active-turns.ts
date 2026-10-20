// How many turns Hermes is working on right now, asked of Hermes (`session.active_list` on its gateway, whose sessions every browser shares): what a
// drain waits for before it lets an update or a restart stop Hermes. Caduceus keeps no count of its own.
import { isRecord } from '@caduceus/contracts/policy/guards';
import type { HermesBackend } from './hermes-backend.ts';

/** The number of sessions Hermes is working on, or `undefined` when Hermes did not say (it is down, or did not answer in `timeoutMs`). */
export async function workingTurns(backend: HermesBackend, timeoutMs = 5_000): Promise<number | undefined> {
  if (backend.status.state !== 'ready') return undefined;
  const socket = await backend.openGateway({ handshakeTimeoutMs: timeoutMs });
  const { promise, resolve } = Promise.withResolvers<number | undefined>();
  const timer = setTimeout(() => resolve(undefined), timeoutMs);
  socket.addEventListener('close', () => resolve(undefined));
  socket.addEventListener('open', () => socket.send(JSON.stringify({ jsonrpc: '2.0', id: 'active-turns', method: 'session.active_list', params: {} })));
  socket.addEventListener('message', (event) => {
    let frame: unknown;
    try {
      frame = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (!isRecord(frame) || frame.id !== 'active-turns') return;
    const sessions = isRecord(frame.result) && Array.isArray(frame.result.sessions) ? frame.result.sessions : undefined;
    resolve(sessions?.filter((row) => isRecord(row) && row.status === 'working').length);
  });
  try {
    return await promise;
  } finally {
    clearTimeout(timer);
    socket.close();
  }
}
